// src/components/workspace/MyWorkFeed.tsx
// Feed việc hợp nhất — gộp work_tasks (việc cá nhân) + workspace_tasks (việc chung)
// thành MỘT danh sách nhóm theo thời gian: Quá hạn → Hôm nay → Tuần này → Sau đó.
// Data vẫn nằm ở 2 bảng riêng; chỉ gộp giao diện. Giữ đủ tính năng cũ:
// comment + doc status (Tái ký HĐ), báo cáo khi hoàn thành, sửa/xoá, yêu cầu ngưng HĐ.
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  ChevronDown, Check, X, Trash2, Pencil,
  MessageSquare, History, Search, Plus,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { logActivity } from '../../lib/audit'
import type { Client, WorkTask, TaskStatus, WorkTaskComment, CRMPipelineTask, PipelineTaskStatus, CRMPipelineEntry, CRMProduct, Contact, Branch, WorkspaceTaskComment, WsTaskStatus } from '../../lib/types'
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS, DOC_STATUS_STEPS, TASK_TYPE_OPTIONS, WS_TASK_STATUS_LABELS, WS_TASK_STATUS_COLORS, type DocStatus, type TaskPriority } from '../../lib/types'
import { formatDate } from '../../lib/format'
import { queueGoogleSync, syncGoogleNow, pulledChanges } from '../../lib/googleSync'
import { GoogleSyncCard } from './GoogleSyncCard'
import { CompanyProfileModal, STAGES } from '../crm/CompanyProfileModal'
import { todayISO } from '../../utils/suspension'
import { fetchWorkspaceTaskComments, addWorkspaceTaskComment, updateWorkspaceTaskComment, deleteWorkspaceTaskComment } from '../../lib/workspaceTaskComments'
import { branchOf, branchLabel, branchOptions } from '../../lib/branchRef'

// ---- Việc chung (bảng workspace_tasks) ----
export interface WorkspaceTask {
  id: string
  title: string
  type: 'doc' | 'task' | string
  status: string
  assignee: string | null
  deadline: string | null
  created_at: string
  /** Chi nhánh liên kết — chỉ áp dụng cho type==='task' (Task nội bộ chung) */
  branch_id: string | null
}

const WS_STATUS: Record<string, { label: string; cls: string }> = {
  drafting:         { label: 'Đang soạn',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  pending_approval: { label: 'Chờ duyệt',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending_sign:     { label: 'Chờ ký',       cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  done:             { label: 'Hoàn thành',   cls: 'bg-green-50 text-green-700 border-green-200' },
  not_started:      { label: 'Chưa bắt đầu', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  overdue:          { label: 'Quá hạn',      cls: 'bg-red-50 text-red-700 border-red-200' },
}

const DOC_STATUS_BTN: Record<string, string> = {
  chua_soan: 'bg-gray-100 text-gray-600 border-gray-300',
  dang_soan: 'bg-blue-100 text-blue-700 border-blue-300',
  cho_duyet: 'bg-amber-100 text-amber-700 border-amber-300',
  cho_kh_ky: 'bg-violet-100 text-violet-700 border-violet-300',
  hoan_tat:  'bg-green-100 text-green-700 border-green-300',
  ngung_hd:  'bg-red-100 text-red-700 border-red-300',
}

// ---- Phân loại hiển thị (chip lọc) ----
// 'Khách mới' = việc BD tìm hiểu/theo đuổi công ty CHƯA ký (nguồn: crm_pipeline_tasks,
// gộp đọc từ CRM Pipeline — xem phần "Việc BD (CRM Pipeline)" bên dưới). Khác với 'Hợp đồng'
// (Tái ký HĐ) vốn chỉ áp dụng cho khách ĐANG hợp tác.
type Category = 'Khách mới' | 'Hợp đồng' | 'Báo giá' | 'Thăm quan / KH' | 'Hồ sơ' | 'Nội bộ' | 'Khác'
const CATEGORY_CHIPS: ('Tất cả' | Category)[] = ['Tất cả', 'Khách mới', 'Hợp đồng', 'Báo giá', 'Thăm quan / KH', 'Hồ sơ', 'Nội bộ', 'Khác']
const CATEGORY_TAG: Record<Category, string> = {
  'Khách mới': 'bg-rose-50 text-rose-700 border-rose-200',
  'Hợp đồng': 'bg-blue-50 text-blue-700 border-blue-200',
  'Báo giá':  'bg-amber-50 text-amber-700 border-amber-200',
  'Thăm quan / KH': 'bg-teal-50 text-teal-700 border-teal-200',
  'Hồ sơ':    'bg-violet-50 text-violet-700 border-violet-200',
  'Nội bộ':   'bg-slate-100 text-slate-600 border-slate-200',
  'Khác':     'bg-gray-100 text-gray-600 border-gray-200',
}

// Quy tắc bản cũ (Workspace.tsx gốc getWorkTaskCategory): Thăm quan/Hỏi thăm CN → nhóm riêng, không rơi vào Khác
function workCategory(taskType: string | null): Category {
  if (taskType === 'Tái ký HĐ') return 'Hợp đồng'
  if (taskType === 'Báo giá') return 'Báo giá'
  if (taskType === 'Thăm quan' || taskType === 'Hỏi thăm CN') return 'Thăm quan / KH'
  if (taskType === 'Văn phòng') return 'Nội bộ'
  return 'Khác'
}

interface FeedItem {
  key: string
  source: 'work' | 'ws' | 'pipeline'
  id: string
  title: string
  due: string | null
  category: Category
  work?: WorkTask
  ws?: WorkspaceTask
  pipeline?: CRMPipelineTask
}

type GroupKey = 'overdue' | 'today' | 'week' | 'later'
const GROUP_META: Record<GroupKey, { label: string; head: string; badge: string }> = {
  overdue: { label: 'Quá hạn',   head: 'text-red-600',   badge: 'bg-red-50 text-red-600' },
  today:   { label: 'Hôm nay',   head: 'text-[#0c2340]', badge: 'bg-blue-50 text-blue-700' },
  week:    { label: 'Tuần này',  head: 'text-[#8a887f]', badge: 'bg-[#EFEDE6] text-[#8a887f]' },
  later:   { label: 'Sau đó',    head: 'text-[#8a887f]', badge: 'bg-[#EFEDE6] text-[#8a887f]' },
}

function todayStr() { return new Date().toISOString().split('T')[0] }

function endOfWeekStr() {
  const d = new Date()
  const monOffset = (d.getDay() + 6) % 7 // 0 = thứ 2
  d.setDate(d.getDate() + (6 - monOffset))
  return d.toISOString().split('T')[0]
}

function dueLabel(due: string | null, group: GroupKey): string {
  if (!due) return 'Không hạn'
  if (group === 'overdue') {
    const days = Math.floor((Date.now() - new Date(due).getTime()) / 86400000)
    return `Trễ ${days} ngày`
  }
  if (group === 'today') return 'Hôm nay'
  const d = new Date(due)
  const wd = d.toLocaleDateString('vi-VN', { weekday: 'long' })
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} · ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ---- Stats báo lên hero của Workspace ----
export interface FeedStats {
  overdue: number
  today: number
  doneThisWeek: number
  renewalClientIds: string[]
}

interface Props {
  clients: Client[]
  /** Dữ liệu CRM Pipeline — dùng để mở hồ sơ công ty (CompanyProfileModal) ngay tại Workspace. */
  pipelineEntries: CRMPipelineEntry[]
  products: CRMProduct[]
  /** Danh sách Chi nhánh — dùng để chọn Chi nhánh liên kết cho Task nội bộ (chung). */
  branches: Branch[]
  onClientUpdate: (client: Client) => void
  toast: (msg: string) => void
  onStatsChange?: (stats: FeedStats) => void
  /** tăng số này từ bên ngoài (GiaoViecModal, rail tạo việc tái ký) để feed tải lại */
  refreshToken?: number
  /** tăng số này để mở + focus ô thêm việc nhanh */
  quickAddSignal?: number
  /** ẩn khối lịch sử (điều khiển từ cài đặt Workspace) */
  hideHistory?: boolean
}

export function MyWorkFeed({ clients, pipelineEntries, products, branches, onClientUpdate, toast, onStatsChange, refreshToken = 0, quickAddSignal = 0, hideHistory }: Props) {
  const { user, token } = useAuth()
  const isAdmin = user?.role === 'admin'

  // ---- Đồng bộ Google Calendar ----
  // googleReload tăng khi sync kéo VỀ thay đổi từ Google -> effect tải data chạy lại.
  const [googleReload, setGoogleReload] = useState(0)
  const onGooglePulled = () => setGoogleReload(v => v + 1)
  // Gọi sau mỗi thao tác tạo/sửa/xoá work_tasks: đẩy thay đổi lên Google (gom 2.5s, fire-and-forget).
  const pingGoogle = () => queueGoogleSync(token, onGooglePulled)
  // Poll chiều Google -> web: khi vào trang + mỗi 30s + ngay khi quay lại tab
  // (Calendar API không có webhook nên không thể tức thời thật sự, đây là mức nhanh nhất hợp lý).
  useEffect(() => {
    if (!token) return
    let cancelled = false
    const pull = async () => {
      const res = await syncGoogleNow(token)
      if (!cancelled && pulledChanges(res?.summary) > 0) setGoogleReload(v => v + 1)
    }
    pull()
    const timer = setInterval(pull, 30 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') pull() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', pull)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', pull)
    }
  }, [token])

  // ---- Data ----
  const [myTasks, setMyTasks] = useState<WorkTask[]>([])
  const [wsTasks, setWsTasks] = useState<WorkspaceTask[]>([])
  const [doneWork, setDoneWork] = useState<WorkTask[]>([])
  const [doneWs, setDoneWs] = useState<WorkspaceTask[]>([])
  // Việc BD (CRM Pipeline) — crm_pipeline_tasks không có user_id (việc chung của team BD,
  // không thuộc riêng ai), nên đọc TẤT CẢ chứ không lọc theo user như work_tasks.
  const [pipelineTasks, setPipelineTasks] = useState<CRMPipelineTask[]>([])
  const [donePipeline, setDonePipeline] = useState<CRMPipelineTask[]>([])
  const [comments, setComments] = useState<Record<string, WorkTaskComment[]>>({})
  // Bình luận của Task nội bộ (chung) — cùng bảng workspace_task_comments đọc/ghi ở cả
  // đây lẫn khối "Việc nội bộ liên kết" trên trang Chi nhánh (BranchHistoryFields).
  const [wsComments, setWsComments] = useState<Record<string, WorkspaceTaskComment[]>>({})
  const [loading, setLoading] = useState(true)

  // ---- Hồ sơ công ty (CompanyProfileModal) — mở ngay từ 1 việc "Khách mới", logic giống CRM Pipeline BD ----
  const [localPipelineEntries, setLocalPipelineEntries] = useState<CRMPipelineEntry[]>(pipelineEntries)
  useEffect(() => { setLocalPipelineEntries(pipelineEntries) }, [pipelineEntries])
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => {
    supabase.from('contacts')
      .select('id, name, phone, role, client_id, is_primary, is_active, clients(name)')
      .eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setContacts(data as unknown as Contact[]) })
  }, [])
  const [profileEntry, setProfileEntry] = useState<CRMPipelineEntry | null>(null)

  function openCompanyProfile(crmId: string) {
    const entry = localPipelineEntries.find(e => e.id === crmId)
    if (entry) setProfileEntry(entry)
  }

  function handleProfileUpdate(updated: CRMPipelineEntry) {
    setLocalPipelineEntries(prev => prev.map(e => e.id === updated.id ? updated : e))
    setProfileEntry(updated)
  }

  async function handleProfileDelete() {
    const entry = profileEntry
    if (!entry) return
    setLocalPipelineEntries(prev => prev.filter(e => e.id !== entry.id))
    setPipelineTasks(prev => prev.filter(t => t.crm_id !== entry.id))
    setDonePipeline(prev => prev.filter(t => t.crm_id !== entry.id))
    setProfileEntry(null)
    const { error } = await supabase.from('crm_pipeline').delete().eq('id', entry.id)
    if (error) { toast('Lỗi: ' + error.message); return }
    toast('Đã xóa')
    await logActivity({
      user, action: 'delete', table: 'crm_pipeline', recordId: entry.id,
      description: `Xóa công ty "${entry.company_name}" khỏi pipeline`,
      oldData: entry,
    })
  }

  // Đổi giai đoạn pipeline ngay tại Workspace — cùng 1 logic update crm_pipeline.stage dùng ở Kanban CRM Pipeline BD.
  async function changePipelineStage(crmId: string, stage: string) {
    const entry = localPipelineEntries.find(e => e.id === crmId)
    if (!entry || entry.stage === stage) return
    const stageLabel = STAGES.find(s => s.id === stage)?.label || stage
    setLocalPipelineEntries(prev => prev.map(e => e.id === crmId ? { ...e, stage } : e))
    if (profileEntry?.id === crmId) setProfileEntry(prev => prev ? { ...prev, stage } : prev)
    const { error } = await supabase.from('crm_pipeline').update({ stage }).eq('id', crmId)
    if (error) { toast('Lỗi: ' + error.message); return }
    toast(`${entry.company_name} → ${stageLabel}`)
    await logActivity({
      user, action: 'update', table: 'crm_pipeline', recordId: crmId,
      description: `Chuyển "${entry.company_name}" sang giai đoạn "${stageLabel}"`,
      oldData: entry, newData: { ...entry, stage },
    })
  }

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    ;(async () => {
      setLoading(true)
      const [my, ws, dw, dws, pl, dpl] = await Promise.all([
        supabase.from('work_tasks').select('*').eq('user_id', user.id).neq('status', 'done').order('due_date', { ascending: true }),
        supabase.from('workspace_tasks').select('*').neq('status', 'done').order('deadline', { ascending: true }),
        supabase.from('work_tasks').select('*').eq('user_id', user.id).eq('status', 'done').gte('completed_at', since).order('completed_at', { ascending: false }),
        supabase.from('workspace_tasks').select('*').eq('status', 'done').gte('created_at', since).order('created_at', { ascending: false }),
        supabase.from('crm_pipeline_tasks').select('*').neq('status', 'done').order('due_date', { ascending: true }),
        supabase.from('crm_pipeline_tasks').select('*').eq('status', 'done').gte('updated_at', since).order('updated_at', { ascending: false }),
      ])
      if (cancelled) return
      if (my.data) setMyTasks(my.data as WorkTask[])
      if (ws.data) setWsTasks(ws.data as WorkspaceTask[])
      if (dw.data) setDoneWork(dw.data as WorkTask[])
      if (dws.data) setDoneWs(dws.data as WorkspaceTask[])
      if (pl.data) setPipelineTasks(pl.data as CRMPipelineTask[])
      if (dpl.data) setDonePipeline(dpl.data as CRMPipelineTask[])
      setLoading(false)
      const ids = ((my.data as WorkTask[]) || []).map(t => t.id)
      if (ids.length) {
        const { data: cData } = await supabase.from('work_task_comments').select('*').in('task_id', ids).order('created_at', { ascending: true })
        if (cancelled || !cData) return
        const map: Record<string, WorkTaskComment[]> = {}
        for (const c of cData as WorkTaskComment[]) (map[c.task_id] ||= []).push(c)
        setComments(map)
      }
      const wsIds = ((ws.data as WorkspaceTask[]) || []).map(t => t.id)
      if (wsIds.length) {
        const wsCData = await fetchWorkspaceTaskComments(wsIds)
        if (cancelled) return
        const wsMap: Record<string, WorkspaceTaskComment[]> = {}
        for (const c of wsCData) (wsMap[c.task_id] ||= []).push(c)
        setWsComments(wsMap)
      }
    })()
    return () => { cancelled = true }
  }, [user, refreshToken, googleReload])

  // ---- Ẩn việc gắn KH đã ngưng hợp tác ----
  const suspendedClientIds = useMemo(
    () => new Set(clients.filter(c => c.cooperation_status === 'suspended').map(c => c.id)),
    [clients]
  )
  const visibleWork = useMemo(
    () => myTasks.filter(t => {
      if (t.client_id && suspendedClientIds.has(t.client_id)) return false
      // Quy tắc GĐ: hồ sơ đã "Hoàn tất" / "Ngưng HĐ" còn hiện thêm 1 ngày (kể từ lúc chọn) rồi tự ẩn
      if ((t.doc_status === 'hoan_tat' || t.doc_status === 'ngung_hd') && t.updated_at
        && Date.now() - new Date(t.updated_at).getTime() > 86400000) return false
      return true
    }),
    [myTasks, suspendedClientIds]
  )

  // ---- Gộp + nhóm theo thời gian ----
  const [filter, setFilter] = useState<'Tất cả' | Category>('Tất cả')
  const [search, setSearch] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  // 'overdue' hoặc 'YYYY-MM-DD' — bấm ô radar để lọc theo ngày
  const [dayFilter, setDayFilter] = useState<string | null>(null)

  const allItems = useMemo((): FeedItem[] => [
    ...visibleWork.map((t): FeedItem => ({
      key: `work_${t.id}`, source: 'work', id: t.id, title: t.title,
      due: t.due_date || null, category: workCategory(t.task_type), work: t,
    })),
    ...wsTasks.map((t): FeedItem => ({
      key: `ws_${t.id}`, source: 'ws', id: t.id, title: t.title,
      due: t.deadline, category: t.type === 'doc' ? 'Hồ sơ' : 'Nội bộ', ws: t,
    })),
    ...pipelineTasks.map((t): FeedItem => ({
      key: `pl_${t.id}`, source: 'pipeline', id: t.id, title: `${t.company_name} — ${t.title}`,
      due: t.due_date, category: 'Khách mới', pipeline: t,
    })),
  ], [visibleWork, wsTasks, pipelineTasks])

  // Việc còn "sống" — loại việc đã Hoàn tất/Ngưng HĐ đang trong ngày ân hạn
  const isDocFinished = (it: FeedItem) => !!it.work && (it.work.doc_status === 'hoan_tat' || it.work.doc_status === 'ngung_hd')

  // ---- ① Radar 7 ngày: ô Quá hạn + hôm nay → +5 ngày ----
  const radar = useMemo(() => {
    const active = allItems.filter(it => !isDocFinished(it))
    const today = todayStr()
    const overdue = active.filter(it => it.due && it.due < today).length
    const DW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
    const days = Array.from({ length: 6 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() + i)
      const ds = d.toISOString().split('T')[0]
      return {
        date: ds,
        dw: i === 0 ? 'Hôm nay' : DW[d.getDay()],
        dn: d.getDate(),
        count: active.filter(it => it.due === ds).length,
      }
    })
    return { overdue, days }
  }, [allItems])

  // ---- ② «Nên làm trước»: chấm điểm trễ × ưu tiên × trạng thái hồ sơ ----
  const topSuggest = useMemo(() => {
    const today = todayStr()
    let best: { it: FeedItem; score: number; reason: string } | null = null
    for (const it of allItems) {
      if (isDocFinished(it) || !it.due || it.due > today) continue
      const late = Math.max(0, Math.floor((Date.now() - new Date(it.due).getTime()) / 86400000))
      let score = late * 2
      const reasons: string[] = [late > 0 ? `Trễ ${late} ngày` : 'Đến hạn hôm nay']
      const w = it.work
      if (w) {
        score += w.priority === 'high' ? 6 : w.priority === 'medium' ? 3 : 0
        if (w.priority === 'high') reasons.push('ưu tiên cao')
        if (w.doc_status === 'cho_kh_ky') { score += 4; reasons.push('khách đang chờ ký — chốt sớm') }
        else if (w.doc_status === 'cho_duyet') { score += 3; reasons.push('hồ sơ chờ duyệt nội bộ') }
        else if (w.doc_status === 'dang_soan') score += 2
      }
      if (!best || score > best.score) best = { it, score, reason: reasons.join(' · ') }
    }
    return best
  }, [allItems])

  // ---- ⑤ Lọc: chip phân loại + tìm nhanh + radar ngày + chế độ Tập trung ----
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const today = todayStr()
    const eow = endOfWeekStr()
    const items = allItems.filter(it => {
      if (filter !== 'Tất cả' && it.category !== filter) return false
      if (q) {
        // Tìm được cả theo Chi nhánh của việc, và theo KCN cũ của việc tạo trước migration 137.
        const b = it.work?.branch_id ? branches.find(x => x.id === it.work!.branch_id) : null
        const hay = `${it.title} ${b?.name ?? ''} ${it.work?.kcn ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (dayFilter === 'overdue') { if (!it.due || it.due >= today) return false }
      else if (dayFilter) { if (it.due !== dayFilter) return false }
      return true
    })

    const g: Record<GroupKey, FeedItem[]> = { overdue: [], today: [], week: [], later: [] }
    for (const it of items) {
      if (!it.due) g.later.push(it)
      else if (it.due < today) g.overdue.push(it)
      else if (it.due === today) g.today.push(it)
      else if (it.due <= eow) g.week.push(it)
      else g.later.push(it)
    }
    // Tập trung: chỉ còn Quá hạn + Hôm nay (bỏ qua khi đang lọc theo 1 ngày cụ thể)
    if (focusMode && !dayFilter) { g.week = []; g.later = [] }
    const byDue = (a: FeedItem, b: FeedItem) => (a.due ?? '9999').localeCompare(b.due ?? '9999')
    for (const k of Object.keys(g) as GroupKey[]) g[k].sort(byDue)
    return g
  }, [allItems, filter, search, dayFilter, focusMode, branches])

  const totalVisible = groups.overdue.length + groups.today.length + groups.week.length + groups.later.length

  // ---- Stats lên hero ----
  useEffect(() => {
    if (!onStatsChange) return
    const today = todayStr()
    const monday = new Date()
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    monday.setHours(0, 0, 0, 0)
    // Việc đã Hoàn tất/Ngưng HĐ (đang trong 1 ngày ân hạn trước khi ẩn) không đếm vào quá hạn/hôm nay
    const stillActive = visibleWork.filter(t => t.doc_status !== 'hoan_tat' && t.doc_status !== 'ngung_hd')
    const overdue =
      stillActive.filter(t => t.due_date && t.due_date < today).length +
      wsTasks.filter(t => t.deadline && t.deadline < today).length +
      pipelineTasks.filter(t => t.due_date && t.due_date < today).length
    const todayCount =
      stillActive.filter(t => t.due_date === today).length +
      wsTasks.filter(t => t.deadline === today).length +
      pipelineTasks.filter(t => t.due_date === today).length
    const doneThisWeek =
      doneWork.filter(t => t.completed_at && new Date(t.completed_at) >= monday).length +
      doneWs.filter(t => new Date(t.created_at) >= monday).length +
      donePipeline.filter(t => new Date(t.updated_at) >= monday).length
    const renewalClientIds = visibleWork.filter(t => t.task_type === 'Tái ký HĐ' && t.client_id).map(t => t.client_id as string)
    onStatsChange({ overdue, today: todayCount, doneThisWeek, renewalClientIds })
  }, [visibleWork, wsTasks, doneWork, doneWs, pipelineTasks, donePipeline, onStatsChange])

  // ---- Thêm việc nhanh ----
  const [quickOpen, setQuickOpen] = useState(false)
  const [qTitle, setQTitle] = useState('')
  const [qDue, setQDue] = useState(todayStr())
  const [qKind, setQKind] = useState<'work' | 'ws_task' | 'ws_doc' | 'pipeline'>('work')
  const [qAssignee, setQAssignee] = useState('')
  const [qSaving, setQSaving] = useState(false)
  const quickInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (quickAddSignal > 0) {
      setQuickOpen(true)
      setTimeout(() => quickInputRef.current?.focus(), 60)
    }
  }, [quickAddSignal])

  async function saveQuickTask() {
    if (!qTitle.trim() || !user || qSaving) return
    setQSaving(true)
    if (qKind === 'work') {
      const { data, error } = await supabase.from('work_tasks').insert({
        user_id: user.id, client_id: null, title: qTitle.trim(), task_type: 'Văn phòng',
        due_date: qDue || todayStr(), priority: 'medium', branch_id: null, notes: null, status: 'pending',
      }).select().single()
      if (!error && data) { setMyTasks(prev => [data as WorkTask, ...prev]); pingGoogle() }
    } else if (qKind === 'pipeline') {
      // Gõ tên công ty mới → tạo 1 dòng crm_pipeline (giai đoạn "Tiềm năng") + 1 việc theo dõi đầu
      // tiên + 1 dòng market_leads liên kết (crm_id). Cùng 1 dữ liệu gốc nên hiện ngay ở cả
      // Workspace, CRM Pipeline lẫn Thị trường > Công ty/Dự án — không phải đồng bộ giả 2 chiều.
      const { data: entry, error: e1 } = await supabase.from('crm_pipeline').insert({
        company_name: qTitle.trim(), stage: 'tiem-nang', last_contact: todayStr(),
      }).select().single()
      if (!e1 && entry) {
        const { data: task, error: e2 } = await supabase.from('crm_pipeline_tasks').insert({
          crm_id: entry.id, company_name: entry.company_name,
          title: 'Tìm hiểu / liên hệ ban đầu', due_date: qDue || todayStr(),
        }).select().single()
        if (!e2 && task) setPipelineTasks(prev => [task as CRMPipelineTask, ...prev])
        await supabase.from('market_leads').insert({
          company_name: entry.company_name, source: 'Workspace', status: 'Chưa LH',
          suppliers: [{ name: "Let's Go VN", qty: 0, is_us: true }], crm_id: entry.id,
        })
      }
    } else {
      const { data, error } = await supabase.from('workspace_tasks').insert({
        title: qTitle.trim(), type: qKind === 'ws_doc' ? 'doc' : 'task',
        status: qKind === 'ws_doc' ? 'not_started' : 'todo', assignee: qAssignee.trim() || null, deadline: qDue || null,
      }).select().single()
      if (!error && data) setWsTasks(prev => [data as WorkspaceTask, ...prev])
    }
    setQSaving(false)
    setQTitle('')
    toast(qKind === 'pipeline' ? 'Đã thêm công ty vào CRM Pipeline' : 'Đã thêm việc')
  }

  // ---- Form đầy đủ (quy tắc bản cũ — WorkTasksCard): khách hàng / loại việc / ưu tiên / KCN / ghi chú ----
  const [fullForm, setFullForm] = useState(false)
  const [fClientId, setFClientId] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fType, setFType] = useState(TASK_TYPE_OPTIONS[0])
  const [fDue, setFDue] = useState(todayStr())
  const [fPriority, setFPriority] = useState<TaskPriority>('medium')
  const [fBranchId, setFBranchId] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [fSaving, setFSaving] = useState(false)

  const activeClients = useMemo(() => clients.filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended'), [clients])

  const branchOfClient = (c: Client | null | undefined) => branchOf(c, branches)

  function selectFormClient(id: string) {
    setFClientId(id)
    const b = branchOfClient(clients.find(cl => cl.id === id))
    if (b) setFBranchId(b.id)
  }

  function resetFullForm() {
    setFClientId(''); setFDesc(''); setFType(TASK_TYPE_OPTIONS[0])
    setFDue(todayStr()); setFPriority('medium'); setFBranchId(''); setFNotes('')
  }

  async function saveFullTask() {
    if (!user || !fDesc.trim() || fSaving) return
    setFSaving(true)
    const selectedClient = clients.find(c => c.id === fClientId) || null
    // Quy tắc bản cũ: tiêu đề = "Tên KH — mô tả" nếu có gắn khách hàng
    const title = selectedClient ? `${selectedClient.name} — ${fDesc.trim()}` : fDesc.trim()
    const { data, error } = await supabase.from('work_tasks').insert({
      user_id: user.id,
      client_id: selectedClient?.id || null,
      title,
      task_type: fType,
      due_date: fDue,
      priority: fPriority,
      branch_id: fBranchId || null,
      notes: fNotes.trim() || null,
      status: 'pending',
    }).select().single()
    setFSaving(false)
    if (!error && data) {
      setMyTasks(prev => [data as WorkTask, ...prev])
      resetFullForm()
      setFullForm(false)
      toast('Đã lưu công việc')
      pingGoogle()
    }
  }

  // ---- Hoàn thành: ws → xong ngay; work → modal báo cáo ----
  const [reportItem, setReportItem] = useState<WorkTask | null>(null)
  const [reportText, setReportText] = useState('')
  const [newContractEnd, setNewContractEnd] = useState('')

  async function markWsDone(t: WorkspaceTask) {
    setWsTasks(prev => prev.filter(x => x.id !== t.id))
    setDoneWs(prev => [{ ...t, status: 'done' }, ...prev])
    await supabase.from('workspace_tasks').update({ status: 'done' }).eq('id', t.id)
  }

  function startWorkDone(t: WorkTask) {
    setReportItem(t)
    setReportText('')
    if (t.task_type === 'Tái ký HĐ') {
      const client = t.client_id ? clients.find(c => c.id === t.client_id) : null
      setNewContractEnd(client?.contract_end || '')
    } else setNewContractEnd('')
  }

  async function submitReport() {
    const t = reportItem
    if (!t) return
    if (t.task_type === 'Tái ký HĐ' && !newContractEnd) { alert('Vui lòng nhập hạn hợp đồng mới'); return }
    const patch: Partial<WorkTask> = {
      status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      ...(reportText.trim() ? { notes: reportText.trim() } : {}),
    }
    setMyTasks(prev => prev.filter(x => x.id !== t.id))
    setDoneWork(prev => [{ ...t, ...patch } as WorkTask, ...prev])
    setReportItem(null)
    await supabase.from('work_tasks').update(patch).eq('id', t.id)
    pingGoogle()
    if (t.task_type === 'Tái ký HĐ' && newContractEnd && t.client_id) {
      await supabase.from('clients').update({ contract_end: newContractEnd }).eq('id', t.client_id)
      const client = clients.find(c => c.id === t.client_id)
      if (client) onClientUpdate({ ...client, contract_end: newContractEnd })
    }
  }

  // ---- Việc BD (CRM Pipeline) — pending/in_progress đổi trực tiếp; done cần ghi kết quả ----
  const [pipelineReportItem, setPipelineReportItem] = useState<CRMPipelineTask | null>(null)
  const [pipelineReportText, setPipelineReportText] = useState('')

  function startPipelineDone(t: CRMPipelineTask) {
    setPipelineReportItem(t)
    setPipelineReportText('')
  }

  async function submitPipelineReport() {
    const t = pipelineReportItem
    if (!t || !pipelineReportText.trim()) return
    const now = new Date().toISOString()
    setPipelineTasks(prev => prev.filter(x => x.id !== t.id))
    setDonePipeline(prev => [{ ...t, status: 'done', result_note: pipelineReportText.trim(), updated_at: now }, ...prev])
    setPipelineReportItem(null)
    await supabase.from('crm_pipeline_tasks').update({ status: 'done', result_note: pipelineReportText.trim(), updated_at: now }).eq('id', t.id)
  }

  async function changePipelineStatus(t: CRMPipelineTask, status: PipelineTaskStatus) {
    if (status === 'done') { startPipelineDone(t); return }
    const now = new Date().toISOString()
    setPipelineTasks(prev => prev.map(x => x.id === t.id ? { ...x, status, updated_at: now } : x))
    await supabase.from('crm_pipeline_tasks').update({ status, updated_at: now }).eq('id', t.id)
  }

  async function deletePipelineTask(id: string) {
    const t = pipelineTasks.find(x => x.id === id)
    setPipelineTasks(prev => prev.filter(x => x.id !== id))
    await supabase.from('crm_pipeline_tasks').delete().eq('id', id)
    if (!t) return
    // Nếu đây là việc DUY NHẤT của công ty này và công ty chưa có hoạt động gì khác (mới tạo từ
    // Workspace, chưa liên hệ/tặng quà/gắn thành khách) — dọn luôn công ty khỏi CRM Pipeline +
    // Thị trường, tránh để lại "công ty ma" không ai thấy nhưng vẫn nằm trên Kanban mãi mãi.
    const [{ count: otherTasks }, { count: interactions }, { count: gifts }, { data: entry }] = await Promise.all([
      supabase.from('crm_pipeline_tasks').select('id', { count: 'exact', head: true }).eq('crm_id', t.crm_id),
      supabase.from('crm_interactions').select('id', { count: 'exact', head: true }).eq('crm_id', t.crm_id),
      supabase.from('crm_gifts').select('id', { count: 'exact', head: true }).eq('crm_id', t.crm_id),
      supabase.from('crm_pipeline').select('client_id').eq('id', t.crm_id).single(),
    ])
    if (!otherTasks && !interactions && !gifts && !entry?.client_id) {
      await supabase.from('market_leads').delete().eq('crm_id', t.crm_id)
      await supabase.from('crm_pipeline').delete().eq('id', t.crm_id)
      toast(`Đã xoá luôn "${t.company_name}" khỏi CRM Pipeline (chưa có hoạt động nào khác)`)
    }
  }

  // ---- Trạng thái / doc status / ngưng HĐ (port từ Morning Priority) ----
  const [suspendTask, setSuspendTask] = useState<WorkTask | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [suspendFrom, setSuspendFrom] = useState('')
  const [suspendSaving, setSuspendSaving] = useState(false)

  async function changeWorkStatus(t: WorkTask, status: TaskStatus) {
    if (status === 'done') { startWorkDone(t); return }
    setMyTasks(prev => prev.map(x => x.id === t.id ? { ...x, status } : x))
    await supabase.from('work_tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', t.id)
    pingGoogle()
  }

  async function changeDocStatus(t: WorkTask, step: typeof DOC_STATUS_STEPS[number]) {
    const now = new Date().toISOString()
    if (step.key === 'ngung_hd') { setSuspendTask(t); setSuspendReason(''); setSuspendFrom(todayISO()); return }
    if (step.key === 'hoan_tat') {
      // updated_at = mốc bắt đầu 1 ngày ân hạn trước khi ẩn khỏi feed
      await supabase.from('work_tasks').update({ doc_status: step.key, updated_at: now }).eq('id', t.id)
      setMyTasks(prev => prev.map(x => x.id === t.id ? { ...x, doc_status: step.key, updated_at: now } : x))
      startWorkDone(t)
      return
    }
    setMyTasks(prev => prev.map(x => x.id === t.id ? { ...x, doc_status: step.key, status: 'in_progress', updated_at: now } : x))
    await supabase.from('work_tasks').update({ doc_status: step.key, status: 'in_progress', updated_at: now }).eq('id', t.id)
    pingGoogle()
  }

  async function submitSuspend() {
    if (!suspendTask || !suspendReason.trim() || !suspendFrom || !user) return
    setSuspendSaving(true)
    const client = clients.find(c => c.id === suspendTask.client_id)
    if (!client) { setSuspendSaving(false); return }
    if (isAdmin) {
      const now = new Date().toISOString()
      const patch = {
        cooperation_status: 'suspended' as const,
        suspension_reason: suspendReason.trim(),
        suspended_from: suspendFrom,
        suspended_at: now,
      }
      await supabase.from('clients').update({ ...patch, updated_at: now }).eq('id', client.id)
      onClientUpdate({ ...client, ...patch })
    } else {
      await supabase.from('cooperation_suspension_requests').insert({
        client_id: client.id, task_id: suspendTask.id, requester_id: user.id,
        requester_name: user.full_name || user.username || 'Người dùng',
        reason: suspendReason.trim(), suspended_from: suspendFrom, status: 'pending',
      })
    }
    // Đánh dấu task Ngưng HĐ — còn hiện 1 ngày (badge đỏ) rồi tự ẩn theo quy tắc ân hạn
    const now2 = new Date().toISOString()
    await supabase.from('work_tasks').update({ doc_status: 'ngung_hd', status: 'ngung_hd', updated_at: now2 }).eq('id', suspendTask.id)
    pingGoogle()
    setMyTasks(prev => prev.map(x => x.id === suspendTask.id ? { ...x, doc_status: 'ngung_hd', status: 'ngung_hd' as TaskStatus, updated_at: now2 } : x))
    setSuspendTask(null)
    setSuspendSaving(false)
    toast(isAdmin ? `Đã ngưng hợp tác với "${client.name}"` : 'Đã gửi yêu cầu ngưng HĐ — chờ Quản trị viên duyệt')
  }

  async function deleteWork(id: string) {
    setMyTasks(prev => prev.filter(t => t.id !== id))
    await supabase.from('work_tasks').delete().eq('id', id)
    pingGoogle()
  }

  // ---- ③ «Chờ ai?»: suy từ trạng thái hồ sơ — Chưa/Đang soạn = đến lượt mình, Chờ duyệt = nội bộ, Chờ KH ký = khách ----
  function waitInfo(w: WorkTask): { kind: 'me' | 'internal' | 'client'; cls: string; label: string } | null {
    if (w.task_type !== 'Tái ký HĐ') return null
    const ds = (w.doc_status as DocStatus | null) ?? 'chua_soan'
    if (ds === 'hoan_tat' || ds === 'ngung_hd') return null
    const days = w.updated_at ? Math.max(0, Math.floor((Date.now() - new Date(w.updated_at).getTime()) / 86400000)) : 0
    const wait = days > 0 ? ` · ${days} ngày` : ''
    if (ds === 'cho_kh_ky') return { kind: 'client', cls: 'bg-violet-50 text-violet-700 border-violet-200', label: `⏳ Chờ khách${wait}` }
    if (ds === 'cho_duyet') return { kind: 'internal', cls: 'bg-amber-50 text-amber-700 border-amber-200', label: `⏳ Chờ nội bộ${wait}` }
    return { kind: 'me', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: '🙋 Đến lượt bạn' }
  }

  // «Nhắc lại»: lưu vết đôn đốc bằng 1 bình luận vào việc
  async function remindTask(w: WorkTask) {
    if (!user) return
    const what = w.doc_status === 'cho_kh_ky' ? 'khách ký hợp đồng' : 'duyệt hồ sơ nội bộ'
    const content = `📣 Đã nhắc ${what} — ${new Date().toLocaleDateString('vi-VN')}`
    const { data, error } = await supabase.from('work_task_comments').insert({
      task_id: w.id, user_id: user.id, user_name: user.full_name || user.username || 'Người dùng', content,
    }).select().single()
    if (!error && data) {
      setComments(prev => ({ ...prev, [w.id]: [...(prev[w.id] ?? []), data as WorkTaskComment] }))
      toast('Đã ghi nhắc vào việc')
    }
  }

  // ---- ④ Hoãn nhanh: dời hạn sang ngày mai / tuần sau (tính từ hôm nay) ----
  async function snoozeItem(it: FeedItem, days: number) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    const nd = d.toISOString().split('T')[0]
    if (it.work) {
      const now = new Date().toISOString()
      setMyTasks(prev => prev.map(x => x.id === it.id ? { ...x, due_date: nd, updated_at: now } : x))
      await supabase.from('work_tasks').update({ due_date: nd, updated_at: now }).eq('id', it.id)
      pingGoogle()
    } else if (it.ws) {
      setWsTasks(prev => prev.map(x => x.id === it.id ? { ...x, deadline: nd } : x))
      await supabase.from('workspace_tasks').update({ deadline: nd }).eq('id', it.id)
    } else if (it.pipeline) {
      setPipelineTasks(prev => prev.map(x => x.id === it.id ? { ...x, due_date: nd } : x))
      await supabase.from('crm_pipeline_tasks').update({ due_date: nd }).eq('id', it.id)
    }
    toast(days === 1 ? 'Đã hoãn sang ngày mai' : 'Đã hoãn 1 tuần')
  }

  const phoneOf = (clientId: string | null) =>
    clientId ? (clients.find(c => c.id === clientId)?.phone ?? null) : null

  // ---- Sửa / xoá việc chung ----
  const [editWsId, setEditWsId] = useState<string | null>(null)
  const [editWs, setEditWs] = useState<{ title: string; status: string; deadline: string; assignee: string }>({ title: '', status: '', deadline: '', assignee: '' })

  async function saveWsEdit(id: string) {
    if (!editWs.title.trim()) return
    const patch = { title: editWs.title.trim(), status: editWs.status, deadline: editWs.deadline || null, assignee: editWs.assignee.trim() || null }
    setWsTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
    setEditWsId(null)
    await supabase.from('workspace_tasks').update(patch).eq('id', id)
  }

  async function deleteWs(id: string) {
    setWsTasks(prev => prev.filter(t => t.id !== id))
    await supabase.from('workspace_tasks').delete().eq('id', id)
  }

  // ---- Task nội bộ (chung): đổi trạng thái Cần làm/Đang làm/Đã xong + chọn Chi nhánh liên kết ----
  async function changeWsTaskStatus(t: WorkspaceTask, status: WsTaskStatus) {
    if (status === 'done') { markWsDone(t); return }
    setWsTasks(prev => prev.map(x => x.id === t.id ? { ...x, status } : x))
    await supabase.from('workspace_tasks').update({ status }).eq('id', t.id)
  }

  async function changeWsBranch(t: WorkspaceTask, branchId: string | null) {
    setWsTasks(prev => prev.map(x => x.id === t.id ? { ...x, branch_id: branchId } : x))
    await supabase.from('workspace_tasks').update({ branch_id: branchId }).eq('id', t.id)
  }

  // ---- Bình luận (chỉ work tasks) ----
  const [commentInput, setCommentInput] = useState<Record<string, string>>({})
  const [sendingComment, setSendingComment] = useState<string | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')

  async function sendComment(taskId: string) {
    const content = (commentInput[taskId] ?? '').trim()
    if (!content || !user) return
    setSendingComment(taskId)
    const { data, error } = await supabase.from('work_task_comments').insert({
      task_id: taskId, user_id: user.id, user_name: user.full_name || user.username || 'Người dùng', content,
    }).select().single()
    if (!error && data) {
      setComments(prev => ({ ...prev, [taskId]: [...(prev[taskId] ?? []), data as WorkTaskComment] }))
      setCommentInput(prev => ({ ...prev, [taskId]: '' }))
    }
    setSendingComment(null)
  }

  async function saveCommentEdit(commentId: string, taskId: string) {
    const content = editingCommentText.trim()
    if (!content) return
    setComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).map(c => c.id === commentId ? { ...c, content } : c) }))
    setEditingCommentId(null)
    await supabase.from('work_task_comments').update({ content }).eq('id', commentId)
  }

  async function deleteComment(commentId: string, taskId: string) {
    setComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).filter(c => c.id !== commentId) }))
    await supabase.from('work_task_comments').delete().eq('id', commentId)
  }

  // ---- Bình luận Task nội bộ (chung) — cùng bảng workspace_task_comments với khối
  // "Việc nội bộ liên kết" ở trang Chi nhánh (BranchHistoryFields), qua lib/workspaceTaskComments ----
  const [wsCommentInput, setWsCommentInput] = useState<Record<string, string>>({})
  const [sendingWsComment, setSendingWsComment] = useState<string | null>(null)
  const [editingWsCommentId, setEditingWsCommentId] = useState<string | null>(null)
  const [editingWsCommentText, setEditingWsCommentText] = useState('')

  async function sendWsComment(taskId: string) {
    const content = (wsCommentInput[taskId] ?? '').trim()
    if (!content || !user) return
    setSendingWsComment(taskId)
    const data = await addWorkspaceTaskComment(taskId, user.id, user.full_name || user.username || 'Người dùng', content)
    if (data) {
      setWsComments(prev => ({ ...prev, [taskId]: [...(prev[taskId] ?? []), data] }))
      setWsCommentInput(prev => ({ ...prev, [taskId]: '' }))
    }
    setSendingWsComment(null)
  }

  async function saveWsCommentEdit(commentId: string, taskId: string) {
    const content = editingWsCommentText.trim()
    if (!content) return
    setWsComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).map(c => c.id === commentId ? { ...c, content } : c) }))
    setEditingWsCommentId(null)
    await updateWorkspaceTaskComment(commentId, content)
  }

  async function deleteWsComment(commentId: string, taskId: string) {
    setWsComments(prev => ({ ...prev, [taskId]: (prev[taskId] ?? []).filter(c => c.id !== commentId) }))
    await deleteWorkspaceTaskComment(commentId)
  }

  // ---- Mở rộng dòng ----
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // ---- Lịch sử hoàn thành (accordion) ----
  const [historyOpen, setHistoryOpen] = useState(false)
  const [histSearch, setHistSearch] = useState('')
  const [histCat, setHistCat] = useState('all')

  // `place` = Chi nhánh của việc; việc tạo trước migration 137 chưa gắn chi nhánh thì
  // rơi về KCN cũ đã nhập, để lịch sử của các việc đó không bị trống chỗ này.
  interface DoneItem { id: string; key: string; title: string; category: string; doneAt: string | null; notes: string | null; assignee: string | null; place: string | null }
  const doneHistory = useMemo((): DoneItem[] => [
    ...doneWork.map(t => {
      const b = t.branch_id ? branches.find(x => x.id === t.branch_id) : null
      return {
        id: t.id, key: `w_${t.id}`, title: t.title,
        category: workCategory(t.task_type),
        doneAt: t.completed_at ?? null, notes: t.notes ?? null, assignee: null,
        place: b ? branchLabel(b) : t.kcn ?? null,
      }
    }),
    ...doneWs.map(t => ({
      id: t.id, key: `s_${t.id}`, title: t.title,
      category: t.type === 'doc' ? 'Hồ sơ' : 'Nội bộ',
      doneAt: t.created_at ?? null, notes: null, assignee: t.assignee ?? null, place: null,
    })),
    ...donePipeline.map(t => ({
      id: t.id, key: `pl_${t.id}`, title: `${t.company_name} — ${t.title}`,
      category: 'Khách mới',
      doneAt: t.updated_at ?? null, notes: t.result_note ?? null, assignee: null, place: null,
    })),
  ].sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')), [doneWork, doneWs, donePipeline, branches])

  const HIST_CATS = ['Tất cả', 'Khách mới', 'Hợp đồng', 'Báo giá', 'Thăm quan / KH', 'Hồ sơ', 'Nội bộ', 'Khác']
  const filteredHistory = doneHistory.filter(t =>
    (histCat === 'all' || t.category === histCat) &&
    (!histSearch.trim() || t.title.toLowerCase().includes(histSearch.toLowerCase()))
  )

  // ---- Render 1 dòng việc ----
  function renderRow(it: FeedItem, group: GroupKey) {
    const expanded = expandedKey === it.key
    const isOverdue = group === 'overdue'
    const cmts = it.source === 'work' ? (comments[it.id] ?? []) : it.source === 'ws' ? (wsComments[it.id] ?? []) : []
    // "Task nội bộ (chung)" (type='task') dùng bộ trạng thái riêng Cần làm/Đang làm/Đã xong;
    // "Hồ sơ · HĐ (chung)" (type='doc') giữ nguyên bộ trạng thái kiểu hồ sơ cũ.
    const wsSt = it.ws
      ? (it.ws.type === 'task'
          ? { label: WS_TASK_STATUS_LABELS[(it.ws.status as WsTaskStatus)] ?? WS_TASK_STATUS_LABELS.todo, cls: WS_TASK_STATUS_COLORS[(it.ws.status as WsTaskStatus)] ?? WS_TASK_STATUS_COLORS.todo }
          : (WS_STATUS[it.ws.status] || WS_STATUS.not_started))
      : null
    const wsBranch = it.ws?.branch_id ? branches.find(b => b.id === it.ws!.branch_id) : null
    const workBranch = it.work?.branch_id ? branches.find(b => b.id === it.work!.branch_id) : null
    const isEditingWs = it.source === 'ws' && editWsId === it.id
    const wi = it.work ? waitInfo(it.work) : null
    const phone = it.work ? phoneOf(it.work.client_id) : null

    return (
      <div key={it.key} className="border-t border-[#F0EFEB]">
        <div className="group relative flex items-center gap-2.5 px-4 py-2 hover:bg-[#FBFAF7] cursor-pointer" onClick={() => setExpandedKey(expanded ? null : it.key)}>
          <button
            onClick={e => { e.stopPropagation(); it.source === 'ws' ? markWsDone(it.ws!) : it.source === 'pipeline' ? startPipelineDone(it.pipeline!) : startWorkDone(it.work!) }}
            title="Đánh dấu hoàn thành"
            className={`w-[19px] h-[19px] rounded-full border-[1.8px] shrink-0 flex items-center justify-center transition-colors hover:border-green-500 hover:bg-green-50 ${isOverdue ? 'border-red-300' : 'border-[#cfccc2]'}`}
          >
            <Check size={11} className="opacity-0 hover:opacity-100 text-green-600" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-[#111] truncate">
              {it.pipeline ? (
                <>
                  <button
                    onClick={e => { e.stopPropagation(); openCompanyProfile(it.pipeline!.crm_id) }}
                    className="hover:underline hover:text-blue-600 transition"
                    title="Xem hồ sơ công ty"
                  >
                    {it.pipeline.company_name}
                  </button>
                  <span className="text-[#888] font-normal"> — {it.pipeline.title}</span>
                </>
              ) : it.title}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={`text-[9.5px] font-semibold px-1.5 py-px rounded-md border ${CATEGORY_TAG[it.category]}`}>{it.category}</span>
              {/* Badge trạng thái hồ sơ luôn hiện (yêu cầu GĐ) — chỉ với việc Tái ký HĐ */}
              {it.work?.task_type === 'Tái ký HĐ' && (() => {
                const key = (it.work!.doc_status as DocStatus | null) ?? 'chua_soan'
                const step = DOC_STATUS_STEPS.find(s => s.key === key)
                return step ? (
                  <span className={`text-[9.5px] font-bold px-2 py-px rounded-full border ${DOC_STATUS_BTN[key] ?? 'bg-gray-100 text-gray-600 border-gray-300'}`}>{step.label}</span>
                ) : null
              })()}
              {/* ③ «Chờ ai?» + nút Nhắc lưu vết đôn đốc */}
              {wi && (
                <span className={`text-[9.5px] font-bold px-2 py-px rounded-full border ${wi.cls}`}>{wi.label}</span>
              )}
              {wi && wi.kind !== 'me' && (
                <button
                  onClick={e => { e.stopPropagation(); remindTask(it.work!) }}
                  className="text-[9.5px] font-bold px-2 py-px rounded-full border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
                >
                  Nhắc lại →
                </button>
              )}
              {/* Chi nhánh của việc; việc tạo trước migration 137 chưa có branch_id thì
                  vẫn hiện KCN cũ đã nhập, không để trống chỗ này. */}
              {workBranch
                ? <span className="text-[9.5px] font-semibold px-1.5 py-px rounded-full border border-violet-200 bg-violet-50 text-violet-700">🏢 {branchLabel(workBranch)}</span>
                : it.work?.kcn && <span className="text-[10.5px] text-[#999]">{it.work.kcn}</span>}
              {wsSt && <span className={`text-[9.5px] px-1.5 py-px rounded-full border ${wsSt.cls}`}>{wsSt.label}</span>}
              {wsBranch && <span className="text-[9.5px] font-semibold px-1.5 py-px rounded-full border border-violet-200 bg-violet-50 text-violet-700">🏢 {branchLabel(wsBranch)}</span>}
              {it.ws?.assignee && <span className="text-[10.5px] text-[#888]">{it.ws.assignee}</span>}
              {it.work && <span className={`text-[9.5px] px-1.5 py-px rounded-full border ${TASK_PRIORITY_COLORS[it.work.priority]}`}>{TASK_PRIORITY_LABELS[it.work.priority]}</span>}
              {cmts.length > 0 && <span className="text-[10.5px] text-[#999] flex items-center gap-0.5"><MessageSquare size={10} />{cmts.length}</span>}
            </div>
          </div>
          <span className={`text-[11px] whitespace-nowrap shrink-0 ${isOverdue ? 'text-red-600 font-bold' : 'text-[#999]'}`}>{dueLabel(it.due, group)}</span>
          <ChevronDown size={13} className={`text-[#bbb] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />

          {/* ④ Thao tác nhanh khi rê chuột (desktop) */}
          <div
            className="absolute right-10 top-1/2 -translate-y-1/2 hidden lg:group-hover:flex items-center gap-1 bg-white border border-[#E8E7E2] rounded-[10px] px-1.5 py-1 shadow-[0_6px_18px_rgba(12,35,64,0.14)] z-10"
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => it.source === 'ws' ? markWsDone(it.ws!) : it.source === 'pipeline' ? startPipelineDone(it.pipeline!) : startWorkDone(it.work!)}
              className="text-[10.5px] font-bold px-2.5 py-1 rounded-[7px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition">✓ Xong</button>
            <button onClick={() => snoozeItem(it, 1)}
              className="text-[10.5px] font-bold px-2.5 py-1 rounded-[7px] bg-[#FBFAF7] text-[#666] border border-[#F0EFEB] hover:border-blue-300 transition">+1 ngày</button>
            <button onClick={() => snoozeItem(it, 7)}
              className="text-[10.5px] font-bold px-2.5 py-1 rounded-[7px] bg-[#FBFAF7] text-[#666] border border-[#F0EFEB] hover:border-blue-300 transition">+1 tuần</button>
            {phone && (
              <a href={`tel:${phone}`} onClick={e => e.stopPropagation()}
                className="text-[10.5px] font-bold px-2.5 py-1 rounded-[7px] bg-blue-50 text-blue-600 hover:bg-blue-100 transition whitespace-nowrap">📞 Gọi</a>
            )}
          </div>
        </div>

        {expanded && (
          <div className="px-4 pb-3 pl-[46px] flex flex-col gap-2">
            {/* --- Việc cá nhân: doc status / trạng thái / xoá --- */}
            {it.work && (
              <div className="flex items-center gap-2 flex-wrap">
                {it.work.task_type === 'Tái ký HĐ' ? (
                  <div className="flex items-center gap-1 flex-wrap">
                    {DOC_STATUS_STEPS.map(step => {
                      const active = it.work!.doc_status === step.key
                      return (
                        <button
                          key={step.key}
                          onClick={() => changeDocStatus(it.work!, step)}
                          className={`text-[10px] px-2 py-1 rounded-md border font-medium transition ${active ? (DOC_STATUS_BTN[step.key] ?? '') : 'bg-white text-[#888] border-[#E8E7E2] hover:border-blue-300'} ${step.danger && !active ? 'text-red-500' : ''}`}
                        >
                          {step.label}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <select
                    value={it.work.status}
                    onChange={e => changeWorkStatus(it.work!, e.target.value as TaskStatus)}
                    className={`text-[10.5px] border rounded-md px-2 py-1 focus:outline-none font-medium ${TASK_STATUS_COLORS[it.work.status] ?? 'bg-slate-100 text-slate-600 border-slate-300'}`}
                  >
                    {(['pending', 'in_progress', 'done', 'ngung_hd'] as TaskStatus[]).map(s => (
                      <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                )}
                <span className="text-[10.5px] text-[#999]">Hạn: {formatDate(it.work.due_date)}</span>
                <button
                  onClick={() => {
                    const msg = it.work!.task_type === 'Tái ký HĐ'
                      ? 'Xoá công việc này? Client sẽ hiện lại ở "HĐ cần xử lý".'
                      : 'Xoá công việc này?'
                    if (confirm(msg)) deleteWork(it.id)
                  }}
                  className="ml-auto p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition"
                  title="Xoá"
                ><Trash2 size={13} /></button>
              </div>
            )}

            {/* --- Việc BD (CRM Pipeline): giai đoạn / trạng thái / xem hồ sơ / xoá --- */}
            {it.pipeline && (
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={localPipelineEntries.find(e => e.id === it.pipeline!.crm_id)?.stage || 'tiem-nang'}
                  onChange={e => changePipelineStage(it.pipeline!.crm_id, e.target.value)}
                  title="Giai đoạn pipeline"
                  className="text-[10.5px] border rounded-md px-2 py-1 focus:outline-none font-medium bg-indigo-50 text-indigo-700 border-indigo-200"
                >
                  {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <select
                  value={it.pipeline.status}
                  onChange={e => changePipelineStatus(it.pipeline!, e.target.value as PipelineTaskStatus)}
                  className="text-[10.5px] border rounded-md px-2 py-1 focus:outline-none font-medium bg-rose-50 text-rose-700 border-rose-200"
                >
                  <option value="pending">Chưa xử lý</option>
                  <option value="in_progress">Đang xử lý</option>
                  <option value="done">Đã xong</option>
                </select>
                <span className="text-[10.5px] text-[#999]">Hạn: {formatDate(it.pipeline.due_date)}</span>
                <button
                  onClick={() => openCompanyProfile(it.pipeline!.crm_id)}
                  className="text-[10.5px] font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition"
                >
                  Xem hồ sơ →
                </button>
                <button
                  onClick={() => { if (confirm('Xoá việc này? (nếu công ty chưa có hoạt động nào khác, sẽ xoá luôn khỏi CRM Pipeline)')) deletePipelineTask(it.id) }}
                  className="ml-auto p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition"
                  title="Xoá"
                ><Trash2 size={13} /></button>
              </div>
            )}

            {/* ④ Hoãn nhanh + gọi — hiện trong phần mở rộng để thao tác được trên điện thoại */}
            {!isEditingWs && (
              <div className="flex items-center gap-1.5 flex-wrap lg:hidden">
                <button onClick={() => snoozeItem(it, 1)} className="text-[10.5px] font-bold px-2.5 py-1 rounded-[7px] bg-[#FBFAF7] text-[#666] border border-[#F0EFEB]">⏰ +1 ngày</button>
                <button onClick={() => snoozeItem(it, 7)} className="text-[10.5px] font-bold px-2.5 py-1 rounded-[7px] bg-[#FBFAF7] text-[#666] border border-[#F0EFEB]">⏰ +1 tuần</button>
                {phone && <a href={`tel:${phone}`} className="text-[10.5px] font-bold px-2.5 py-1 rounded-[7px] bg-blue-50 text-blue-600 border border-blue-200">📞 Gọi {phone}</a>}
              </div>
            )}

            {/* --- Việc chung: sửa inline / xoá --- */}
            {it.ws && !isEditingWs && (
              <div className="flex items-center gap-2 flex-wrap">
                {it.ws.type === 'task' ? (
                  <>
                    <select
                      value={it.ws.status in WS_TASK_STATUS_LABELS ? it.ws.status : 'todo'}
                      onChange={e => changeWsTaskStatus(it.ws!, e.target.value as WsTaskStatus)}
                      className={`text-[10.5px] border rounded-md px-2 py-1 focus:outline-none font-medium ${WS_TASK_STATUS_COLORS[(it.ws.status as WsTaskStatus)] ?? WS_TASK_STATUS_COLORS.todo}`}
                    >
                      {(['todo', 'in_progress', 'done'] as WsTaskStatus[]).map(s => (
                        <option key={s} value={s}>{WS_TASK_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                    <select
                      value={it.ws.branch_id ?? ''}
                      onChange={e => changeWsBranch(it.ws!, e.target.value || null)}
                      title="Chi nhánh liên kết"
                      className="text-[10.5px] border border-[#E8E7E2] rounded-md px-2 py-1 focus:outline-none font-medium bg-white text-[#666]"
                    >
                      <option value="">— Không liên kết Chi nhánh —</option>
                      {branchOptions(branches).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </>
                ) : (
                  <span className="text-[10.5px] text-[#999]">Hồ sơ · HĐ</span>
                )}
                {it.ws.deadline && <span className="text-[10.5px] text-[#999]">Hạn: {formatDate(it.ws.deadline)}</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => { setEditWsId(it.id); setEditWs({ title: it.ws!.title, status: it.ws!.status, deadline: it.ws!.deadline ?? '', assignee: it.ws!.assignee ?? '' }) }}
                    className="p-1 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500 transition" title="Sửa"
                  ><Pencil size={13} /></button>
                  <button
                    onClick={() => { if (confirm('Xoá công việc này?')) deleteWs(it.id) }}
                    className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition" title="Xoá"
                  ><Trash2 size={13} /></button>
                </div>
              </div>
            )}
            {it.ws && isEditingWs && (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus value={editWs.title}
                  onChange={e => setEditWs(p => ({ ...p, title: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveWsEdit(it.id); if (e.key === 'Escape') setEditWsId(null) }}
                  className="text-[12px] px-2 py-1 border border-blue-300 rounded-md focus:outline-none w-full"
                />
                <div className="flex gap-2 flex-wrap">
                  <select value={editWs.status} onChange={e => setEditWs(p => ({ ...p, status: e.target.value }))} className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none">
                    {it.ws.type === 'task'
                      ? (['todo', 'in_progress', 'done'] as WsTaskStatus[]).map(s => <option key={s} value={s}>{WS_TASK_STATUS_LABELS[s]}</option>)
                      : Object.entries(WS_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <input type="date" value={editWs.deadline} onChange={e => setEditWs(p => ({ ...p, deadline: e.target.value }))} className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none" />
                  <input placeholder="Người phụ trách" value={editWs.assignee} onChange={e => setEditWs(p => ({ ...p, assignee: e.target.value }))} className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none flex-1 min-w-[90px]" />
                  <button onClick={() => setEditWsId(null)} className="text-[11px] px-2.5 py-1 border border-[#E8E7E2] rounded-md text-[#666]">Huỷ</button>
                  <button onClick={() => saveWsEdit(it.id)} className="text-[11px] px-2.5 py-1 bg-blue-600 text-white rounded-md">Lưu</button>
                </div>
              </div>
            )}

            {/* --- Bình luận Task nội bộ (chung) --- */}
            {it.ws && it.ws.type === 'task' && (
              <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
                {cmts.length > 0 && (
                  <div className="flex flex-col divide-y divide-[#F0EEE9] max-h-36 overflow-y-auto">
                    {(cmts as WorkspaceTaskComment[]).map(cm => (
                      <div key={cm.id} className="px-2.5 py-1.5 group">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10.5px] font-semibold text-[#1D4ED8]">{cm.user_name}</span>
                          <span className="text-[10px] text-[#bbb]">{new Date(cm.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setEditingWsCommentId(cm.id); setEditingWsCommentText(cm.content) }} className="p-0.5 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500"><Pencil size={10} /></button>
                            <button onClick={() => { if (confirm('Xoá bình luận này?')) deleteWsComment(cm.id, it.id) }} className="p-0.5 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500"><Trash2 size={10} /></button>
                          </div>
                        </div>
                        {editingWsCommentId === cm.id ? (
                          <div className="flex gap-1 mt-1">
                            <input autoFocus value={editingWsCommentText} onChange={e => setEditingWsCommentText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveWsCommentEdit(cm.id, it.id); if (e.key === 'Escape') setEditingWsCommentId(null) }}
                              className="flex-1 text-[11px] px-2 py-0.5 border border-blue-300 rounded focus:outline-none" />
                            <button onClick={() => saveWsCommentEdit(cm.id, it.id)} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded"><Check size={10} /></button>
                            <button onClick={() => setEditingWsCommentId(null)} className="text-[10px] px-1.5 py-0.5 border border-[#E8E7E2] rounded text-[#666]"><X size={10} /></button>
                          </div>
                        ) : (
                          <div className="text-[11.5px] text-[#333] whitespace-pre-wrap">{cm.content}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5 p-1.5 border-t border-[#F0EEE9] first:border-t-0">
                  <input
                    type="text" value={wsCommentInput[it.id] ?? ''}
                    onChange={e => setWsCommentInput(prev => ({ ...prev, [it.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendWsComment(it.id) } }}
                    placeholder="Bình luận tiến độ..."
                    className="flex-1 text-[11px] px-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-[#fafafa] placeholder:text-[#ccc]"
                  />
                  <button
                    onClick={() => sendWsComment(it.id)}
                    disabled={sendingWsComment === it.id || !(wsCommentInput[it.id] ?? '').trim()}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 shrink-0"
                  >Gửi</button>
                </div>
              </div>
            )}

            {/* --- Bình luận (work) --- */}
            {it.work && (
              <div className="border border-[#E8E7E2] rounded-lg bg-white overflow-hidden">
                {cmts.length > 0 && (
                  <div className="flex flex-col divide-y divide-[#F0EEE9] max-h-36 overflow-y-auto">
                    {cmts.map(cm => (
                      <div key={cm.id} className="px-2.5 py-1.5 group">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10.5px] font-semibold text-[#1D4ED8]">{cm.user_name}</span>
                          <span className="text-[10px] text-[#bbb]">{new Date(cm.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setEditingCommentId(cm.id); setEditingCommentText(cm.content) }} className="p-0.5 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500"><Pencil size={10} /></button>
                            <button onClick={() => { if (confirm('Xoá bình luận này?')) deleteComment(cm.id, it.id) }} className="p-0.5 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500"><Trash2 size={10} /></button>
                          </div>
                        </div>
                        {editingCommentId === cm.id ? (
                          <div className="flex gap-1 mt-1">
                            <input autoFocus value={editingCommentText} onChange={e => setEditingCommentText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveCommentEdit(cm.id, it.id); if (e.key === 'Escape') setEditingCommentId(null) }}
                              className="flex-1 text-[11px] px-2 py-0.5 border border-blue-300 rounded focus:outline-none" />
                            <button onClick={() => saveCommentEdit(cm.id, it.id)} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded"><Check size={10} /></button>
                            <button onClick={() => setEditingCommentId(null)} className="text-[10px] px-1.5 py-0.5 border border-[#E8E7E2] rounded text-[#666]"><X size={10} /></button>
                          </div>
                        ) : (
                          <div className="text-[11.5px] text-[#333] whitespace-pre-wrap">{cm.content}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5 p-1.5 border-t border-[#F0EEE9] first:border-t-0">
                  <input
                    type="text" value={commentInput[it.id] ?? ''}
                    onChange={e => setCommentInput(prev => ({ ...prev, [it.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(it.id) } }}
                    placeholder="Bình luận tình trạng..."
                    className="flex-1 text-[11px] px-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-[#fafafa] placeholder:text-[#ccc]"
                  />
                  <button
                    onClick={() => sendComment(it.id)}
                    disabled={sendingComment === it.id || !(commentInput[it.id] ?? '').trim()}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 shrink-0"
                  >Gửi</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden">
        {/* Head: tiêu đề + chip lọc */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 flex-wrap">
          <h2 className="text-[13.5px] font-extrabold text-[#0c2340]">Việc của tôi</h2>
          <div className="flex gap-1 flex-wrap">
            {CATEGORY_CHIPS.map(c => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`text-[10.5px] px-2.5 py-0.5 rounded-full border transition ${filter === c ? 'bg-[#0c2340] text-white border-[#0c2340]' : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-300'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Đồng bộ Google Calendar */}
        <GoogleSyncCard toast={toast} onPulled={onGooglePulled} />

        {/* ① Radar 7 ngày */}
        <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto">
          <button
            onClick={() => setDayFilter(v => v === 'overdue' ? null : 'overdue')}
            className={`flex-1 min-w-[52px] text-center py-1.5 rounded-[10px] border transition ${dayFilter === 'overdue' ? 'border-red-500 ring-1 ring-red-300 bg-red-50' : radar.overdue > 0 ? 'border-red-200 bg-red-50/60 hover:border-red-400' : 'border-[#E8E7E2] bg-[#FBFAF7]'}`}
          >
            <div className="text-[9px] font-bold uppercase text-red-500">Quá hạn</div>
            <div className={`text-[14px] font-extrabold leading-tight ${radar.overdue > 0 ? 'text-red-600' : 'text-[#c9c7bf]'}`}>{radar.overdue}</div>
          </button>
          {radar.days.map(d => {
            const active = dayFilter === d.date
            return (
              <button
                key={d.date}
                onClick={() => setDayFilter(v => v === d.date ? null : d.date)}
                className={`flex-1 min-w-[52px] text-center py-1.5 rounded-[10px] border transition ${active ? 'border-blue-500 ring-1 ring-blue-300 bg-blue-50' : d.dw === 'Hôm nay' ? 'border-blue-200 bg-blue-50/50 hover:border-blue-400' : 'border-[#E8E7E2] bg-[#FBFAF7] hover:border-blue-300'}`}
              >
                <div className={`text-[9px] font-bold uppercase ${d.dw === 'Hôm nay' ? 'text-blue-600' : 'text-[#999]'}`}>{d.dw}</div>
                <div className="text-[13px] font-extrabold text-[#0c2340] leading-tight">{d.dn}</div>
                <div className={`text-[9px] font-bold ${d.count > 0 ? 'text-blue-600' : 'text-[#c9c7bf]'}`}>{d.count > 0 ? `${d.count} việc` : '—'}</div>
              </button>
            )
          })}
        </div>

        {/* ⑤ Tìm nhanh + Tập trung */}
        <div className="flex gap-2 px-4 pb-2.5 items-center">
          <div className="flex-1 flex items-center gap-1.5 border border-[#E8E7E2] rounded-[9px] px-2.5 py-1.5 bg-white focus-within:border-blue-400">
            <Search size={12} className="text-[#bbb] shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm nhanh theo tên khách, Chi nhánh..."
              className="flex-1 text-[12px] focus:outline-none placeholder:text-[#ccc] bg-transparent min-w-0"
            />
            {search && <button onClick={() => setSearch('')} className="text-[#bbb] hover:text-[#666]"><X size={12} /></button>}
          </div>
          <button
            onClick={() => setFocusMode(v => !v)}
            className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-[9px] border transition shrink-0 ${focusMode ? 'bg-[#0c2340] text-white border-[#0c2340]' : 'bg-[#FBFAF7] text-[#666] border-[#E8E7E2] hover:border-blue-300'}`}
            title="Chỉ hiện Quá hạn + Hôm nay"
          >
            🎯 Tập trung
          </button>
        </div>

        {/* ② «Nên làm trước» */}
        {topSuggest && (
          <div className="mx-4 mb-2.5 flex items-center gap-3 rounded-[12px] border border-amber-200 bg-gradient-to-br from-amber-50 to-[#FEF9EF] px-3.5 py-2.5">
            <span className="text-[18px]">🔥</span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-extrabold text-[#0c2340] truncate">{topSuggest.it.title}</div>
              <div className="text-[10.5px] font-semibold text-amber-700 mt-0.5">{topSuggest.reason}</div>
            </div>
            <button
              onClick={() => { setFilter('Tất cả'); setSearch(''); setDayFilter(null); setExpandedKey(topSuggest.it.key) }}
              className="text-[11px] font-bold text-white bg-[#0c2340] px-3 py-1.5 rounded-[9px] shrink-0 hover:bg-[#16345c] transition"
            >
              Xử lý ngay →
            </button>
          </div>
        )}

        {/* Thêm việc nhanh + form đầy đủ */}
        <div className="px-4 py-2 border-t border-[#F0EFEB] bg-[#FBFAF7]">
          {!quickOpen && !fullForm ? (
            <button onClick={() => { setQuickOpen(true); setTimeout(() => quickInputRef.current?.focus(), 60) }}
              className="w-full text-left text-[12px] text-[#999] px-3 py-1.5 rounded-[9px] border border-dashed border-[#d6d3c8] bg-white hover:border-blue-300 transition flex items-center gap-1.5">
              <Plus size={13} /> Thêm việc mới — Enter để lưu
            </button>
          ) : quickOpen && !fullForm ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={quickInputRef} autoFocus placeholder={qKind === 'pipeline' ? 'Tên công ty...' : 'Tên công việc...'}
                  value={qTitle} onChange={e => setQTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveQuickTask(); if (e.key === 'Escape') setQuickOpen(false) }}
                  className="flex-1 text-[12.5px] px-3 py-1.5 rounded-[9px] border border-[#E8E7E2] bg-white focus:outline-none focus:border-blue-400"
                />
                <div className="flex gap-2 flex-wrap">
                  <select value={qKind} onChange={e => setQKind(e.target.value as typeof qKind)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none">
                    <option value="work">Việc của tôi</option>
                    <option value="pipeline">Công ty mới (CRM)</option>
                    <option value="ws_task">Task nội bộ (chung)</option>
                    <option value="ws_doc">Hồ sơ · HĐ (chung)</option>
                  </select>
                  <input type="date" value={qDue} onChange={e => setQDue(e.target.value)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none" />
                  {qKind !== 'work' && qKind !== 'pipeline' && (
                    <input placeholder="Người phụ trách" value={qAssignee} onChange={e => setQAssignee(e.target.value)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none w-28" />
                  )}
                  <button onClick={saveQuickTask} disabled={!qTitle.trim() || qSaving} className="text-[11.5px] px-3 py-1 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40">Lưu</button>
                  <button onClick={() => setQuickOpen(false)} className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666]">✕</button>
                </div>
              </div>
              <button onClick={() => { setQuickOpen(false); setFullForm(true); setFDesc(qTitle) }} className="self-start text-[11px] text-blue-600 hover:underline">
                Mở form đầy đủ (khách hàng, loại việc, ưu tiên, Chi nhánh...) →
              </button>
            </div>
          ) : (
            <div className="border border-[#E8E7E2] rounded-lg p-3 flex flex-col gap-2 bg-white">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Tên công việc</label>
                  <input
                    autoFocus
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400"
                    placeholder="VD: đàm phán giá tái ký, soạn HĐ mới..."
                    value={fDesc} onChange={e => setFDesc(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Khách hàng</label>
                  <select
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400"
                    value={fClientId} onChange={e => selectFormClient(e.target.value)}
                  >
                    <option value="">— Không chọn —</option>
                    {activeClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="sm:w-32">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Loại việc</label>
                  <select
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2 py-1.5 bg-white text-[#555] focus:outline-none focus:border-blue-400"
                    value={fType} onChange={e => setFType(e.target.value)}
                  >
                    {TASK_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Ngày dự kiến</label>
                  <input type="date" value={fDue} onChange={e => setFDue(e.target.value)}
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400" />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Mức độ ưu tiên</label>
                  <div className="flex gap-1.5">
                    {(['high', 'medium', 'low'] as TaskPriority[]).map(p => (
                      <button key={p} onClick={() => setFPriority(p)}
                        className={`flex-1 text-[11px] px-2.5 py-1.5 rounded-md border transition-all ${fPriority === p ? TASK_PRIORITY_COLORS[p] + ' font-medium' : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-300'}`}>
                        {TASK_PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Chi Nhánh</label>
                  <select value={fBranchId} onChange={e => setFBranchId(e.target.value)}
                    className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] focus:outline-none focus:border-blue-400">
                    <option value="">— Không chọn —</option>
                    {branchOptions(branches).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Ghi chú / Chuẩn bị</label>
                <textarea rows={2} placeholder="Chuẩn bị tài liệu, thông tin cần lưu ý..."
                  value={fNotes} onChange={e => setFNotes(e.target.value)}
                  className="w-full text-[12px] border border-[#E8E7E2] rounded-md px-2.5 py-1.5 bg-white text-[#333] placeholder:text-[#bbb] focus:outline-none focus:border-blue-400 resize-none" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => { resetFullForm(); setFullForm(false) }}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-[#f4f4f1] transition-colors">Huỷ</button>
                <button onClick={saveFullTask} disabled={!fDesc.trim() || fSaving}
                  className="text-[12px] px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors">
                  {fSaving ? 'Đang lưu...' : 'Lưu công việc'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Feed */}
        {loading ? (
          <div className="text-[12.5px] text-[#999] py-8 text-center border-t border-[#F0EFEB]">Đang tải...</div>
        ) : totalVisible === 0 ? (
          <div className="text-[12.5px] text-[#999] py-8 text-center border-t border-[#F0EFEB]">
            {filter === 'Tất cả' ? '🎉 Không còn việc nào — tuyệt vời!' : 'Không có việc nào trong nhóm này'}
          </div>
        ) : (
          (Object.keys(GROUP_META) as GroupKey[]).map(gk => {
            const items = groups[gk]
            if (!items.length) return null
            const meta = GROUP_META[gk]
            return (
              <div key={gk}>
                <div className={`flex items-center gap-2 px-4 pt-3 pb-1 text-[10.5px] font-extrabold uppercase tracking-wider ${meta.head}`}>
                  {meta.label}
                  <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ${meta.badge}`}>{items.length}</span>
                </div>
                {items.map(it => renderRow(it, gk))}
              </div>
            )
          })
        )}
      </div>

      {/* Lịch sử hoàn thành — accordion */}
      {!hideHistory && (
        <div className="mt-4 bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden">
          <button onClick={() => setHistoryOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-2.5 bg-[#F9F9F7] text-left">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#333]">
              <History size={14} className="text-[#888]" />
              Lịch sử hoàn thành — 30 ngày
              {doneHistory.length > 0 && (
                <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{doneHistory.length}</span>
              )}
            </div>
            <ChevronDown size={15} className={`text-[#999] transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
          </button>
          {historyOpen && (
            <div className="border-t border-[#E8E7E2]">
              <div className="flex items-center gap-2 px-4 py-2 flex-wrap">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#bbb]" />
                  <input
                    value={histSearch} onChange={e => setHistSearch(e.target.value)} placeholder="Tìm theo tên..."
                    className="text-[11px] pl-6 pr-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-white w-40"
                  />
                </div>
                <div className="flex gap-1 flex-wrap">
                  {HIST_CATS.map(c => {
                    const key = c === 'Tất cả' ? 'all' : c
                    const count = c === 'Tất cả' ? doneHistory.length : doneHistory.filter(t => t.category === c).length
                    return (
                      <button key={c} onClick={() => setHistCat(key)}
                        className={`text-[10.5px] px-2 py-0.5 rounded-full border transition ${histCat === key ? 'bg-[#0c2340] text-white border-[#0c2340]' : 'bg-white text-[#666] border-[#E8E7E2]'}`}>
                        {c}{count > 0 ? ` ${count}` : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto px-4 pb-3 flex flex-col gap-1.5">
                {filteredHistory.length === 0 ? (
                  <div className="text-[12px] text-[#999] py-5 text-center">Không có kết quả</div>
                ) : filteredHistory.map(t => (
                  <div key={t.key} className="px-3 py-2 border border-[#F0EFEB] bg-[#fafafa] rounded-lg">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[9.5px] font-semibold px-1.5 py-px rounded-md border ${CATEGORY_TAG[t.category as Category] ?? CATEGORY_TAG['Khác']}`}>{t.category}</span>
                      <span className="text-[12px] font-medium text-[#111] truncate">{t.title}</span>
                    </div>
                    <div className="text-[10.5px] text-[#888] mt-0.5">
                      ✓ {t.doneAt ? formatDate(t.doneAt.split('T')[0]) : ''}
                      {t.place ? ` · ${t.place}` : ''}{t.assignee ? ` · ${t.assignee}` : ''}
                    </div>
                    {t.notes && (
                      <div className="mt-1 flex items-start gap-1.5 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                        <span className="text-[10px] text-emerald-600 font-semibold shrink-0 mt-0.5">Kết quả:</span>
                        <span className="text-[11px] text-emerald-800">{t.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal báo cáo hoàn thành (work task) */}
      {reportItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setReportItem(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-[14px] font-semibold text-gray-900">Hoàn thành công việc</h2>
              <p className="text-[11.5px] text-gray-500 mt-0.5 truncate">{reportItem.title}</p>
            </div>
            <div className="p-5 space-y-3">
              {reportItem.task_type === 'Tái ký HĐ' && (
                <div>
                  <label className="text-[11px] font-semibold text-gray-700 mb-1 block">Hạn hợp đồng mới <span className="text-red-500">*</span></label>
                  <input type="date" value={newContractEnd} onChange={e => setNewContractEnd(e.target.value)}
                    className="w-full text-[12.5px] border border-[#E8E7E2] rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" />
                </div>
              )}
              <div>
                <label className="text-[11px] font-semibold text-gray-700 mb-1 block">Báo cáo kết quả</label>
                <textarea rows={3} autoFocus value={reportText} onChange={e => setReportText(e.target.value)}
                  placeholder="Nội dung đã hoàn thành..."
                  className="w-full text-[12.5px] border border-[#E8E7E2] rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setReportItem(null)} className="flex-1 px-3 py-2 text-[12.5px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Huỷ</button>
              <button onClick={submitReport} className="flex-1 px-3 py-2 text-[12.5px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition">Hoàn thành</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal báo cáo hoàn thành (việc BD / CRM Pipeline) */}
      {pipelineReportItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setPipelineReportItem(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-[14px] font-semibold text-gray-900">Hoàn thành việc BD</h2>
              <p className="text-[11.5px] text-gray-500 mt-0.5 truncate">{pipelineReportItem.company_name} — {pipelineReportItem.title}</p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-700 mb-1 block">Kết quả <span className="text-red-500">*</span></label>
                <textarea rows={3} autoFocus value={pipelineReportText} onChange={e => setPipelineReportText(e.target.value)}
                  placeholder="Nội dung đã trao đổi/kết quả..."
                  className="w-full text-[12.5px] border border-[#E8E7E2] rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setPipelineReportItem(null)} className="flex-1 px-3 py-2 text-[12.5px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Huỷ</button>
              <button onClick={submitPipelineReport} disabled={!pipelineReportText.trim()} className="flex-1 px-3 py-2 text-[12.5px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg transition">Hoàn thành</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal yêu cầu ngưng HĐ */}
      {suspendTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSuspendTask(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-[14px] font-semibold text-gray-900">{isAdmin ? 'Ngưng hợp tác' : 'Yêu cầu ngưng hợp tác'}</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">{clients.find(c => c.id === suspendTask.client_id)?.name ?? suspendTask.title}</p>
              </div>
              <button onClick={() => setSuspendTask(null)} className="p-1 hover:bg-gray-100 rounded-md text-gray-500"><X size={15} /></button>
            </div>
            <div className="p-5 space-y-3">
              {!isAdmin && (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Yêu cầu sẽ được gửi đến <strong>Quản trị viên</strong> để xét duyệt trước khi có hiệu lực.
                </p>
              )}
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">Ngày ngưng hợp tác <span className="text-red-500">*</span></label>
                <input type="date" value={suspendFrom} onChange={e => setSuspendFrom(e.target.value)}
                  className="w-full px-3 py-2 text-[12.5px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <p className="text-[10.5px] text-gray-500 mt-1">Tháng chứa ngày này vẫn nhập được P&amp;L Dự án và số lao động; từ tháng sau mới khoá.</p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">Lý do ngưng <span className="text-red-500">*</span></label>
                <textarea rows={3} value={suspendReason} onChange={e => setSuspendReason(e.target.value)} autoFocus
                  placeholder="Nhập lý do ngưng hợp tác..."
                  className="w-full px-3 py-2 text-[12.5px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setSuspendTask(null)} className="flex-1 px-3 py-2 text-[12.5px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
              <button onClick={submitSuspend} disabled={suspendSaving || !suspendReason.trim() || !suspendFrom}
                className="flex-1 px-3 py-2 text-[12.5px] font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg transition">
                {suspendSaving ? 'Đang gửi...' : isAdmin ? 'Xác nhận ngưng' : 'Gửi yêu cầu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hồ sơ công ty (CRM Pipeline) — cùng CompanyProfileModal dùng ở CRM Pipeline BD */}
      {profileEntry && (
        <CompanyProfileModal
          entry={profileEntry}
          contacts={contacts}
          products={products}
          onClose={() => setProfileEntry(null)}
          onUpdate={handleProfileUpdate}
          onDelete={handleProfileDelete}
          toast={toast}
          isAdmin={isAdmin}
        />
      )}
    </>
  )
}
