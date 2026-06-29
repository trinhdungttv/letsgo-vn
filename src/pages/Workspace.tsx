import { useState, useEffect, useMemo } from 'react';
import { useHashTab } from '../hooks/useHashSubRoute';
import {
  AlertTriangle, FileText, FilePlus, Send, ClipboardList,
  CalendarClock, TrendingUp, Wallet, CheckCircle2,
  Settings, Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw,
  History, Search, Pencil, Trash2,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { WorkspaceModulesTabs } from '../components/workspace/WorkspaceModulesTabs';
import { WorkTasksCard } from '../components/workspace/WorkTasksCard';
import { BulkLaborModal } from '../components/workspace/BulkLaborModal';
import { GiaoViecModal } from '../components/workspace/GiaoViecModal';
import { QuoteModal } from '../components/workspace/QuoteModal';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { Client, FinanceRecord, CRMPipelineEntry, Page, WorkTask, TaskStatus, WorkTaskComment } from '../lib/types';
import { ROLE_LABELS, CRM_STAGES } from '../lib/constants';
import { formatDate, daysUntil } from '../lib/format';
import { usePersistedState } from '../hooks/usePersistedState';

interface WorkspaceProps {
  clients: Client[];
  finance: FinanceRecord[];
  pipeline: CRMPipelineEntry[];
  onNavigate: (page: Page) => void;
  onClientUpdate: (client: Client) => void;
  toast: (msg: string) => void;
}

// --- Việc đang treo (bảng workspace_tasks) ----------------------
interface WorkspaceTask {
  id: string;
  title: string;
  type: 'doc' | 'task' | string;
  status: 'drafting' | 'pending_approval' | 'pending_sign' | 'done' | 'not_started' | 'overdue' | string;
  assignee: string | null;
  deadline: string | null;
  created_at: string;
}

const WS_STATUS: Record<string, { label: string; cls: string }> = {
  drafting:         { label: 'Đang soạn',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  pending_approval: { label: 'Chờ duyệt',    cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pending_sign:     { label: 'Chờ ký',       cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  done:             { label: 'Hoàn thành',   cls: 'bg-green-50 text-green-700 border-green-200' },
  not_started:      { label: 'Chưa bắt đầu', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  overdue:          { label: 'Quá hạn',      cls: 'bg-red-50 text-red-700 border-red-200' },
};

function SectionCard({ title, icon, children, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2] bg-[#F9F9F7]">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#333]">
          {icon}{title}
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// --- Workspace layout customization (show/hide sections, font size) ---
type SectionKey = 'quick_actions' | 'hd_can_xu_ly' | 'cong_viec_chua_ht' | 'cap_nhat_cn' | 'viec_dang_treo' | 'cong_viec_sap_toi' | 'alerts' | 'prospects' | 'lich_su';

const SECTION_LABELS: Record<SectionKey, string> = {
  quick_actions: 'Thao tác nhanh',
  hd_can_xu_ly: 'HĐ cần xử lý',
  cong_viec_chua_ht: 'Công việc chưa hoàn thành',
  cap_nhat_cn: 'Cập nhật thông tin CN',
  viec_dang_treo: 'Việc đang treo',
  cong_viec_sap_toi: 'Công việc sắp tới',
  alerts: 'Thông báo theo vai trò',
  prospects: 'Prospects cần follow-up',
  lich_su: 'Lịch sử hoàn thành',
};

const SECTION_GROUPS: { label: string; keys: SectionKey[] }[] = [
  { label: 'Chung', keys: ['quick_actions'] },
  { label: 'Ưu tiên hôm nay', keys: ['hd_can_xu_ly', 'cong_viec_chua_ht', 'cap_nhat_cn'] },
  { label: 'Quản lý công việc', keys: ['viec_dang_treo', 'cong_viec_sap_toi'] },
  { label: 'Bảng phụ & Lịch sử', keys: ['alerts', 'prospects', 'lich_su'] },
];

const DEFAULT_ORDER: SectionKey[] = ['quick_actions', 'hd_can_xu_ly', 'cong_viec_chua_ht', 'cap_nhat_cn', 'viec_dang_treo', 'cong_viec_sap_toi', 'alerts', 'prospects', 'lich_su'];

interface WorkspaceLayout {
  order: SectionKey[];
  hidden: SectionKey[];
  fontScale: number;
}

const DEFAULT_LAYOUT: WorkspaceLayout = { order: DEFAULT_ORDER, hidden: [], fontScale: 1 };

function sectionAvailable(key: SectionKey, role: string): boolean {
  if (key === 'prospects') return role === 'kinhdoanh';
  if (key === 'alerts') return role === 'admin' || role === 'ketoan' || role === 'bdh';
  return true;
}

const FONT_MIN = 0.8;
const FONT_MAX = 1.3;
const FONT_STEP = 0.05;

export default function Workspace({ clients, pipeline, onNavigate, onClientUpdate, toast }: WorkspaceProps) {
  const { user } = useAuth();
  const [branchRegion, setBranchRegion] = useState<string | null>(null);

  const [layout, setLayout] = usePersistedState<WorkspaceLayout>('lgvn_workspace_layout', DEFAULT_LAYOUT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const WS_TAB_KEYS = ['morning', 'winloss', 'kcn'] as const;
  const [activeModule, setActiveModule] = useHashTab<'morning' | 'winloss' | 'kcn'>('workspace', WS_TAB_KEYS, 'morning');

  // Merge in any new section keys and drop ones that no longer exist
  const order = [...layout.order.filter(k => DEFAULT_ORDER.includes(k)), ...DEFAULT_ORDER.filter(k => !layout.order.includes(k))];

  // Quick action modals
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showGiaoViec, setShowGiaoViec] = useState(false);
  const [showBulkLabor, setShowBulkLabor] = useState(false);

  // Việc đang treo
  const [wsTasks, setWsTasks] = useState<WorkspaceTask[]>([]);
  const [wsLoading, setWsLoading] = useState(true);
  const [taskTab, setTaskTab] = useState<'all' | 'doc' | 'task'>('all');
  const [showAddWsTask, setShowAddWsTask] = useState(false);
  const [addWsTitle, setAddWsTitle] = useState('');
  const [addWsType, setAddWsType] = useState<'task' | 'doc'>('task');
  const [addWsDeadline, setAddWsDeadline] = useState('');
  const [addWsAssignee, setAddWsAssignee] = useState('');
  const [addingWsTask, setAddingWsTask] = useState(false);
  // Edit workspace task
  const [editingWsId, setEditingWsId] = useState<string | null>(null);
  const [editWsTitle, setEditWsTitle] = useState('');
  const [editWsStatus, setEditWsStatus] = useState('');
  const [editWsDeadline, setEditWsDeadline] = useState('');
  const [editWsAssignee, setEditWsAssignee] = useState('');
  const [savingWsEdit, setSavingWsEdit] = useState(false);

  // Việc đang treo — lịch sử xong
  const [doneWsTasks, setDoneWsTasks] = useState<WorkspaceTask[]>([]);

  // Standalone WorkTasksCard state (bottom-right)
  const [myTasks, setMyTasks] = useState<WorkTask[]>([]);
  const [doneTasks, setDoneTasks] = useState<WorkTask[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyWeek, setHistoryWeek] = useState<string>('all');
  const [historyCategory, setHistoryCategory] = useState<string>('all');
  const [, setTaskComments] = useState<Record<string, WorkTaskComment[]>>({});

  useEffect(() => {
    if (!user || user.role !== 'bdh') return;
    (async () => {
      const { data } = await supabase
        .from('managers')
        .select('region')
        .eq('name', user.full_name)
        .maybeSingle();
      setBranchRegion((data as { region: string | null } | null)?.region || null);
    })();
  }, [user]);

  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    supabase.from('workspace_tasks').select('*').neq('status', 'done').order('deadline', { ascending: true })
      .then(({ data, error }) => { if (!error && data) setWsTasks(data as WorkspaceTask[]); setWsLoading(false); });
    supabase.from('workspace_tasks').select('*').eq('status', 'done').gte('created_at', since).order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setDoneWsTasks(data as WorkspaceTask[]); });
  }, []);

  useEffect(() => {
    if (!user) return;
    // Load done tasks (last 30 days)
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    supabase.from('work_tasks').select('*')
      .eq('user_id', user.id).eq('status', 'done')
      .gte('completed_at', since).order('completed_at', { ascending: false })
      .then(({ data }) => { if (data) setDoneTasks(data as WorkTask[]); });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('work_tasks')
      .select('*')
      .eq('user_id', user.id)
      .neq('status', 'done')
      .order('due_date', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        setMyTasks(data as WorkTask[]);
        const ids = (data as WorkTask[]).map(t => t.id);
        if (!ids.length) return;
        supabase.from('work_task_comments').select('*').in('task_id', ids).order('created_at', { ascending: true })
          .then(({ data: cData }) => {
            if (!cData) return;
            const map: Record<string, WorkTaskComment[]> = {};
            for (const c of cData as WorkTaskComment[]) {
              if (!map[c.task_id]) map[c.task_id] = [];
              map[c.task_id].push(c);
            }
            setTaskComments(map);
          });
      });
  }, [user]);

  const adjustFont = (delta: number) => {
    setLayout(prev => ({ ...prev, fontScale: Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round((prev.fontScale + delta) * 100) / 100)) }));
  };

  const resetLayout = () => setLayout(DEFAULT_LAYOUT);

  const toggleHidden = (key: SectionKey) => {
    setLayout(prev => ({
      ...prev,
      hidden: prev.hidden.includes(key) ? prev.hidden.filter(k => k !== key) : [...prev.hidden, key],
    }));
  };

  // --- Derived data ---
  const expiringList = useMemo(() =>
    clients
      .filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended')
      .map(c => ({ c, d: daysUntil(c.contract_end) }))
      .filter((x): x is { c: Client; d: number } => x.d !== null && x.d >= 0 && x.d <= 30)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6),
  [clients]);

  const unpaidClients = useMemo(() => clients.filter(c => c.client_type === 'active' && !c.paid_this_month), [clients]);
  const alertClients = useMemo(() => clients.filter(c => c.client_type === 'active' && (c.status === 'warn' || c.status === 'danger')), [clients]);
  const branchExpiring = branchRegion ? expiringList.filter(x => x.c.region === branchRegion).map(x => x.c) : [];
  const staleProspects = useMemo(() => pipeline.filter(p => {
    if (p.stage === 'hop-tac') return false;
    const d = daysUntil(p.last_contact);
    return d === null || d > 14;
  }).slice(0, 6), [pipeline]);

  const suspendedClientIds = useMemo(
    () => new Set(clients.filter(c => c.cooperation_status === 'suspended').map(c => c.id)),
    [clients]
  );

  const visibleMyTasks = useMemo(
    () => myTasks.filter(t => !t.client_id || !suspendedClientIds.has(t.client_id)),
    [myTasks, suspendedClientIds]
  );

  const visibleWsTasks = useMemo(() => {
    if (taskTab === 'doc') return wsTasks.filter(t => t.type === 'doc');
    if (taskTab === 'task') return wsTasks.filter(t => t.type === 'task');
    return wsTasks;
  }, [wsTasks, taskTab]);

  // --- Week label helper ---
  function getWeekLabel(dateStr: string | null): string {
    if (!dateStr) return 'Không rõ';
    const d = new Date(dateStr);
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `Tuần ${week} (${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })})`;
  }

  function getWeekKey(dateStr: string | null): string {
    if (!dateStr) return 'unknown';
    const d = new Date(dateStr);
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
  }

  // --- History category helper ---
  function getWorkTaskCategory(taskType: string | null): string {
    if (!taskType) return 'Khác';
    if (taskType === 'Tái ký HĐ') return 'Hợp đồng';
    if (taskType === 'Báo giá') return 'Báo giá';
    if (taskType === 'Thăm quan' || taskType === 'Hỏi thăm CN') return 'Thăm quan / KH';
    if (taskType === 'Văn phòng') return 'Task nội bộ';
    return 'Khác';
  }

  // Combined unified history items
  interface DoneHistoryItem {
    id: string; title: string; category: string; source: 'work' | 'ws';
    doneAt: string | null; notes: string | null; priority: string | null;
    kcn: string | null; assignee: string | null; taskType: string | null;
  }

  const allDoneHistory = useMemo((): DoneHistoryItem[] => {
    const workItems: DoneHistoryItem[] = doneTasks.map(t => ({
      id: t.id, title: t.title, source: 'work',
      category: getWorkTaskCategory(t.task_type),
      doneAt: t.completed_at ?? null,
      notes: t.notes ?? null, priority: t.priority ?? null,
      kcn: t.kcn ?? null, assignee: null, taskType: t.task_type ?? null,
    }));
    const wsItems: DoneHistoryItem[] = doneWsTasks.map(t => ({
      id: t.id, title: t.title, source: 'ws',
      category: t.type === 'doc' ? 'Hồ sơ HĐ' : 'Task nội bộ',
      doneAt: t.created_at ?? null,
      notes: null, priority: null,
      kcn: null, assignee: t.assignee ?? null, taskType: null,
    }));
    return [...workItems, ...wsItems].sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  }, [doneTasks, doneWsTasks]);

  const HISTORY_CATEGORIES = ['Tất cả', 'Hợp đồng', 'Hồ sơ HĐ', 'Báo giá', 'Thăm quan / KH', 'Task nội bộ', 'Khác'];

  const availableWeeks = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of allDoneHistory) {
      const key = getWeekKey(t.doneAt);
      if (!map.has(key)) map.set(key, getWeekLabel(t.doneAt));
    }
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [allDoneHistory]);

  const filteredDoneHistory = useMemo(() => {
    return allDoneHistory.filter(t => {
      const matchCat = historyCategory === 'Tất cả' || historyCategory === 'all' || t.category === historyCategory;
      const matchWeek = historyWeek === 'all' || getWeekKey(t.doneAt) === historyWeek;
      const matchSearch = !historySearch.trim() || t.title.toLowerCase().includes(historySearch.toLowerCase());
      return matchCat && matchWeek && matchSearch;
    });
  }, [allDoneHistory, historyCategory, historyWeek, historySearch]);


  // --- Việc đang treo: đánh dấu xong + lưu lịch sử ---
  async function markWsTaskDone(id: string) {
    const task = wsTasks.find(t => t.id === id);
    setWsTasks(prev => prev.filter(t => t.id !== id));
    await supabase.from('workspace_tasks').update({ status: 'done' }).eq('id', id);
    if (task) setDoneWsTasks(prev => [{ ...task, status: 'done' }, ...prev]);
  }

  // --- Việc đang treo: xoá ---
  async function deleteWsTask(id: string) {
    setWsTasks(prev => prev.filter(t => t.id !== id));
    await supabase.from('workspace_tasks').delete().eq('id', id);
  }

  // --- Việc đang treo: bắt đầu sửa ---
  function startEditWsTask(t: WorkspaceTask) {
    setEditingWsId(t.id);
    setEditWsTitle(t.title);
    setEditWsStatus(t.status);
    setEditWsDeadline(t.deadline ?? '');
    setEditWsAssignee(t.assignee ?? '');
  }

  // --- Việc đang treo: lưu sửa ---
  async function saveWsEdit(id: string) {
    if (!editWsTitle.trim()) return;
    setSavingWsEdit(true);
    const patch = { title: editWsTitle.trim(), status: editWsStatus, deadline: editWsDeadline || null, assignee: editWsAssignee.trim() || null };
    setWsTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    setEditingWsId(null);
    await supabase.from('workspace_tasks').update(patch).eq('id', id);
    setSavingWsEdit(false);
  }

  // --- Callback khi MorningPriority đánh dấu task done → xoá khỏi "Công việc sắp tới" ---
  function handleMorningTaskDone(taskId: string) {
    setMyTasks(prev => prev.filter(t => t.id !== taskId));
  }

  // --- Việc đang treo: thêm mới ---
  async function handleAddWsTask() {
    if (!addWsTitle.trim()) return;
    setAddingWsTask(true);
    const newTask = {
      title: addWsTitle.trim(),
      type: addWsType,
      status: 'not_started' as const,
      assignee: addWsAssignee.trim() || null,
      deadline: addWsDeadline || null,
    };
    const { data, error } = await supabase.from('workspace_tasks').insert(newTask).select().single();
    setAddingWsTask(false);
    if (!error && data) {
      setWsTasks(prev => [data as WorkspaceTask, ...prev]);
      setAddWsTitle('');
      setAddWsType('task');
      setAddWsDeadline('');
      setAddWsAssignee('');
      setShowAddWsTask(false);
      toast('Đã thêm việc đang treo');
    }
  }

  // --- WorkTasksCard (standalone) handlers ---
  function handleTaskCreated(task: WorkTask) {
    setMyTasks(prev => [task, ...prev]);
    setTaskComments(prev => ({ ...prev, [task.id]: [] }));
  }

  async function handleTaskStatus(id: string, status: TaskStatus) {
    setMyTasks(prev => status === 'done' ? prev.filter(t => t.id !== id) : prev.map(t => t.id === id ? { ...t, status } : t));
    await supabase.from('work_tasks').update({
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
  }
  async function handleTaskDelete(id: string) {
    setMyTasks(prev => prev.filter(t => t.id !== id));
    await supabase.from('work_tasks').delete().eq('id', id);
  }

  if (!user) return null;

  // --- Supplementary role-based sections ---
  const renderRoleCard = (): React.ReactNode => {
    if (user.role === 'admin') {
      return (
        <SectionCard title="Thông báo hợp đồng" icon={<AlertTriangle size={14} className="text-[#888]" />}>
          {alertClients.length === 0 ? (
            <div className="text-[12.5px] text-[#999] py-4 text-center">Không có cảnh báo</div>
          ) : (
            <div className="space-y-1.5">
              {alertClients.slice(0, 6).map(c => (
                <div key={c.id} onClick={() => onNavigate('clients')} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7] cursor-pointer">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-[#333] truncate">{c.name}</div>
                    <div className="text-[11px] text-[#999]">HĐ hết: {formatDate(c.contract_end)}</div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${c.status === 'danger' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {c.status === 'danger' ? 'Khẩn cấp' : 'Sắp hết HĐ'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      );
    }
    if (user.role === 'ketoan') {
      return (
        <SectionCard title="Khách hàng chưa thanh toán tháng này" icon={<Wallet size={14} className="text-[#888]" />}>
          {unpaidClients.length === 0 ? (
            <div className="text-[12.5px] text-[#999] py-4 text-center">Tất cả đã thanh toán</div>
          ) : (
            <div className="space-y-1.5">
              {unpaidClients.slice(0, 8).map(c => (
                <div key={c.id} onClick={() => onNavigate('finance')} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7] cursor-pointer">
                  <div className="text-[12.5px] font-medium text-[#333] truncate">{c.name}</div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Chưa TT</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      );
    }
    if (user.role === 'bdh') {
      return (
        <SectionCard title="Hợp đồng sắp hết hạn (chi nhánh) — cập nhật thông tin" icon={<CalendarClock size={14} className="text-[#888]" />}>
          {branchExpiring.length === 0 ? (
            <div className="text-[12.5px] text-[#999] py-4 text-center">Không có hợp đồng sắp hết hạn</div>
          ) : (
            <div className="space-y-1.5">
              {branchExpiring.slice(0, 8).map(c => (
                <div key={c.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7]">
                  <div className="text-[12.5px] font-medium text-[#333] truncate">{c.name}</div>
                  <div className="text-[11px] text-amber-700">{formatDate(c.contract_end)} ({daysUntil(c.contract_end)} ngày)</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      );
    }
    return null;
  };

  const renderSection = (key: SectionKey): React.ReactNode => {
    switch (key) {
      case 'alerts':
        return renderRoleCard();
      case 'prospects':
        if (user.role !== 'kinhdoanh') return null;
        return (
          <SectionCard title="Prospects cần follow-up" icon={<TrendingUp size={14} className="text-[#888]" />} action={
            <button onClick={() => onNavigate('crm-pipeline')} className="text-[11.5px] text-blue-600 hover:underline">Xem BD Pipeline →</button>
          }>
            {staleProspects.length === 0 ? (
              <div className="text-[12.5px] text-[#999] py-4 text-center">Không có prospect cần follow</div>
            ) : (
              <div className="space-y-1.5">
                {staleProspects.map(p => {
                  const stageInfo = CRM_STAGES.find(s => s.id === p.stage);
                  return (
                    <div key={p.id} onClick={() => onNavigate('crm-pipeline')} className="flex items-center justify-between p-2 rounded-lg hover:bg-[#F9F9F7] cursor-pointer">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-[#333] truncate">{p.company_name}</div>
                        <div className="text-[11px] text-[#999]">Liên hệ gần nhất: {p.last_contact ? formatDate(p.last_contact) : 'Chưa liên hệ'}</div>
                      </div>
                      {stageInfo && <span className={`text-[11px] px-2 py-0.5 rounded-full border ${stageInfo.color}`}>{stageInfo.label}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        );
      default:
        return null;
    }
  };

  const visibleSections = order.filter(k => sectionAvailable(k, user.role) && !layout.hidden.includes(k));
  // --- Quick actions ---
  const quickActions: { label: string; icon: React.ReactNode; onClick: () => void }[] = [
    { label: 'Tạo báo giá', icon: <FileText size={14} />, onClick: () => setShowQuoteModal(true) },
    { label: 'Thêm HĐ', icon: <FilePlus size={14} />, onClick: () => toast('Tính năng sắp ra mắt') },
    { label: 'Giao việc', icon: <Send size={14} />, onClick: () => setShowGiaoViec(true) },
    { label: 'Ghi nhận LĐ', icon: <ClipboardList size={14} />, onClick: () => setShowBulkLabor(true) },
  ];

  return (
    <>
      <PageHeader
        title="Workspace"
        subtitle={`Xin chào, ${user.full_name} · ${ROLE_LABELS[user.role] || user.role}`}
        actions={
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${settingsOpen ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            <Settings size={14} /> Tuỳ chỉnh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-5" style={{ zoom: layout.fontScale }}>
        {settingsOpen && (
          <div className="mb-4 bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-4">
            {/* Font size */}
            <div>
              <div className="text-[12px] font-semibold text-[#333] mb-2">Cỡ chữ / không gian làm việc</div>
              <div className="flex items-center gap-2">
                <button onClick={() => adjustFont(-FONT_STEP)} disabled={layout.fontScale <= FONT_MIN} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
                  <ZoomOut size={14} />
                </button>
                <span className="text-[12.5px] text-[#555] w-12 text-center">{Math.round(layout.fontScale * 100)}%</span>
                <button onClick={() => adjustFont(FONT_STEP)} disabled={layout.fontScale >= FONT_MAX} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">
                  <ZoomIn size={14} />
                </button>
                <button onClick={resetLayout} className="ml-2 inline-flex items-center gap-1 text-[11.5px] text-[#999] hover:text-blue-600 transition">
                  <RotateCcw size={12} /> Khôi phục mặc định
                </button>
              </div>
            </div>

            {/* Show/hide workspace sections */}
            <div>
              <div className="text-[12px] font-semibold text-[#333] mb-2">Hiển thị / ẩn các mục</div>
              {SECTION_GROUPS.map(group => {
                const groupKeys = group.keys.filter(k => sectionAvailable(k, user.role));
                if (!groupKeys.length) return null;
                return (
                  <div key={group.label} className="mb-2.5">
                    <div className="text-[10px] font-medium text-[#999] uppercase tracking-wide mb-1">{group.label}</div>
                    <div className="space-y-1">
                      {groupKeys.map(key => {
                        const isHidden = layout.hidden.includes(key);
                        return (
                          <div
                            key={key}
                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[#F0EFEA] transition ${isHidden ? 'opacity-50 bg-[#fafafa]' : 'bg-[#FAFAF8]'} hover:bg-[#F4F4F1]`}
                          >
                            <span className="flex-1 text-[12px] text-[#333]">{SECTION_LABELS[key]}</span>
                            <button onClick={() => toggleHidden(key)} className="text-[#999] hover:text-blue-600 transition shrink-0" title={isHidden ? 'Hiện' : 'Ẩn'}>
                              {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 1. QUICK ACTIONS */}
        {!layout.hidden.includes('quick_actions') && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            {quickActions.map(a => (
              <button
                key={a.label}
                onClick={a.onClick}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#E8E7E2] bg-white text-[12px] font-medium text-[#333] hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                {a.icon}{a.label}
              </button>
            ))}
          </div>
        )}

        {/* 3. MODULES (Morning Priority, Win/Loss, KCN Grid) */}
        <div className="mt-4">
          <WorkspaceModulesTabs clients={clients} onClientUpdate={onClientUpdate} toast={toast} onTabChange={setActiveModule} onTaskDone={handleMorningTaskDone} hiddenSections={layout.hidden} />
        </div>

        {/* chỉ hiện khi tab Morning Priority */}
        {activeModule === 'morning' && <>

        {/* BOTTOM — 2 cột */}
        {(!layout.hidden.includes('viec_dang_treo') || !layout.hidden.includes('cong_viec_sap_toi')) && (
        <div className={`grid grid-cols-1 ${!layout.hidden.includes('viec_dang_treo') && !layout.hidden.includes('cong_viec_sap_toi') ? 'lg:grid-cols-[2fr_1fr]' : ''} gap-3 mt-4`}>
          {/* Left: Việc đang treo (full) */}
          {!layout.hidden.includes('viec_dang_treo') && <SectionCard
            title="Việc đang treo"
            icon={<ClipboardList size={14} className="text-[#888]" />}
            action={
              <div className="flex items-center gap-2">
                {wsTasks.length > 0 && (
                  <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{wsTasks.length} mục</span>
                )}
                <div className="flex gap-1">
                  {([['all', 'Tất cả'], ['doc', 'Hồ sơ·HĐ'], ['task', 'Task nội bộ']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setTaskTab(key)}
                      className={`text-[10.5px] px-2 py-0.5 rounded-md border transition ${taskTab === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-[#666] border-[#E8E7E2] hover:border-blue-300'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowAddWsTask(v => !v)}
                  className="flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-md border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 transition"
                >
                  + Thêm
                </button>
              </div>
            }
          >
            {showAddWsTask && (
              <div className="mb-3 p-3 rounded-lg border border-blue-200 bg-blue-50 flex flex-col gap-2">
                <input
                  autoFocus
                  placeholder="Tên công việc..."
                  value={addWsTitle}
                  onChange={e => setAddWsTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddWsTask(); if (e.key === 'Escape') setShowAddWsTask(false); }}
                  className="text-[12.5px] px-2.5 py-1.5 rounded-md border border-[#E8E7E2] bg-white focus:outline-none focus:border-blue-400 w-full"
                />
                <div className="flex gap-2 flex-wrap">
                  <select
                    value={addWsType}
                    onChange={e => setAddWsType(e.target.value as 'task' | 'doc')}
                    className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none"
                  >
                    <option value="task">Task nội bộ</option>
                    <option value="doc">Hồ sơ·HĐ</option>
                  </select>
                  <input
                    type="date"
                    value={addWsDeadline}
                    onChange={e => setAddWsDeadline(e.target.value)}
                    className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none"
                    placeholder="Hạn chót"
                  />
                  <input
                    placeholder="Người phụ trách"
                    value={addWsAssignee}
                    onChange={e => setAddWsAssignee(e.target.value)}
                    className="text-[11.5px] px-2 py-1 rounded-md border border-[#E8E7E2] bg-white focus:outline-none flex-1 min-w-[100px]"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowAddWsTask(false)}
                    className="text-[11.5px] px-3 py-1 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-white transition"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleAddWsTask}
                    disabled={!addWsTitle.trim() || addingWsTask}
                    className="text-[11.5px] px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {addingWsTask ? 'Đang lưu...' : 'Lưu'}
                  </button>
                </div>
              </div>
            )}
            {wsLoading ? (
              <div className="text-[12.5px] text-[#999] py-4 text-center">Đang tải...</div>
            ) : visibleWsTasks.length === 0 ? (
              <div className="text-[12.5px] text-[#999] py-4 text-center">Không có việc đang treo</div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-0.5">
                {visibleWsTasks.map(t => {
                  const st = WS_STATUS[t.status] || WS_STATUS.not_started;
                  const overdue = t.deadline ? new Date(t.deadline) < new Date(new Date().toDateString()) : false;
                  const isEditing = editingWsId === t.id;
                  return (
                    <div key={t.id} className="flex flex-col gap-2 p-2.5 rounded-lg border border-[#F0EFEB] bg-[#fafafa]">
                      {isEditing ? (
                        <div className="flex flex-col gap-2">
                          <input
                            autoFocus
                            value={editWsTitle}
                            onChange={e => setEditWsTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveWsEdit(t.id); if (e.key === 'Escape') setEditingWsId(null); }}
                            className="text-[12px] px-2 py-1 border border-blue-300 rounded-md focus:outline-none w-full"
                          />
                          <div className="flex gap-2 flex-wrap">
                            <select
                              value={editWsStatus}
                              onChange={e => setEditWsStatus(e.target.value)}
                              className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none"
                            >
                              {Object.entries(WS_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                            <input type="date" value={editWsDeadline} onChange={e => setEditWsDeadline(e.target.value)} className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none" />
                            <input placeholder="Người phụ trách" value={editWsAssignee} onChange={e => setEditWsAssignee(e.target.value)} className="text-[11px] px-2 py-1 border border-[#E8E7E2] rounded-md focus:outline-none flex-1 min-w-[80px]" />
                          </div>
                          <div className="flex gap-1.5 justify-end">
                            <button onClick={() => setEditingWsId(null)} className="text-[11px] px-2.5 py-1 border border-[#E8E7E2] rounded-md text-[#666] hover:bg-white">Huỷ</button>
                            <button onClick={() => saveWsEdit(t.id)} disabled={savingWsEdit} className="text-[11px] px-2.5 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">Lưu</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          {t.type === 'doc'
                            ? <FileText size={14} className="text-[#888] shrink-0 mt-0.5" />
                            : <ClipboardList size={14} className="text-[#888] shrink-0 mt-0.5" />}
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-semibold text-[#111] truncate">{t.title}</div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                              {t.assignee && <span className="text-[11px] text-[#666]">{t.assignee}</span>}
                              {t.deadline && (
                                <span className={`text-[10.5px] ${overdue ? 'text-red-600 font-semibold' : 'text-[#999]'}`}>
                                  Hạn {formatDate(t.deadline)}{overdue ? ' · quá hạn' : ''}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => startEditWsTask(t)}
                              className="p-1 rounded hover:bg-blue-50 text-[#ccc] hover:text-blue-500 transition"
                              title="Sửa"
                            ><Pencil size={12} /></button>
                            <button
                              onClick={() => { if (confirm('Xoá công việc này?')) deleteWsTask(t.id); }}
                              className="p-1 rounded hover:bg-red-50 text-[#ccc] hover:text-red-500 transition"
                              title="Xoá"
                            ><Trash2 size={12} /></button>
                            <button
                              onClick={() => markWsTaskDone(t.id)}
                              className="flex items-center gap-1 text-[10.5px] px-2 py-1 rounded-md border border-[#E8E7E2] text-[#666] hover:bg-white hover:text-green-600 hover:border-green-300 transition-colors"
                              title="Đánh dấu hoàn thành"
                            >
                              <CheckCircle2 size={12} /> Xong
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>}

          {/* Right: Công việc sắp tới */}
          {!layout.hidden.includes('cong_viec_sap_toi') && <WorkTasksCard
            clients={clients}
            tasks={visibleMyTasks}
            onTaskCreated={handleTaskCreated}
            onStatusChange={handleTaskStatus}
            onDelete={handleTaskDelete}
          />}
        </div>
        )}

        </>}

        {/* Supplementary role-based sections (settings-controlled) */}
        {visibleSections.length > 0 && (
          <div className="space-y-4 mt-4">
            {visibleSections.map(key => (
              <div key={key}>{renderSection(key)}</div>
            ))}
          </div>
        )}

        {/* LỊCH SỬ CÔNG VIỆC HOÀN THÀNH — dưới cùng */}
        {!layout.hidden.includes('lich_su') && <div className="mt-6 bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2] bg-[#F9F9F7]">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#333]">
              <History size={14} className="text-[#888]" />
              Lịch sử công việc hoàn thành
              {allDoneHistory.length > 0 && (
                <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{allDoneHistory.length}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#bbb]" />
                <input
                  type="text" value={historySearch} onChange={e => setHistorySearch(e.target.value)}
                  placeholder="Tìm theo tên..."
                  className="text-[11px] pl-6 pr-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-white w-36"
                />
              </div>
              <select
                value={historyWeek} onChange={e => setHistoryWeek(e.target.value)}
                className="text-[11px] px-2 py-1 rounded-md border border-[#E8E7E2] focus:outline-none focus:border-blue-400 bg-white"
              >
                <option value="all">Tất cả tuần</option>
                {availableWeeks.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </div>
          </div>

          {/* Category tabs */}
          <div className="flex gap-1 px-4 pt-2.5 pb-0 border-b border-[#F0EFEB] overflow-x-auto">
            {HISTORY_CATEGORIES.map(cat => {
              const count = allDoneHistory.filter(t => cat === 'Tất cả' ? true : t.category === cat).length;
              const isActive = historyCategory === cat || (cat === 'Tất cả' && historyCategory === 'all');
              return (
                <button
                  key={cat}
                  onClick={() => setHistoryCategory(cat === 'Tất cả' ? 'all' : cat)}
                  className={`flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-t-md border-b-2 whitespace-nowrap transition-colors shrink-0 ${
                    isActive ? 'border-blue-500 text-blue-700 font-semibold bg-blue-50/50' : 'border-transparent text-[#666] hover:text-[#333] hover:bg-[#F5F4F0]'
                  }`}
                >
                  {cat}
                  {count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="p-3">
            {filteredDoneHistory.length === 0 ? (
              <div className="text-[12.5px] text-[#999] py-6 text-center">
                {allDoneHistory.length === 0 ? 'Chưa có công việc nào hoàn thành trong 30 ngày qua' : 'Không có kết quả phù hợp'}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-0.5">
                {filteredDoneHistory.map(t => (
                  <div key={`${t.source}_${t.id}`} className="px-3 py-2.5 border border-[#F0EFEB] bg-[#fafafa] rounded-lg">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md border shrink-0 ${
                            t.category === 'Hợp đồng' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            t.category === 'Hồ sơ HĐ' ? 'bg-violet-50 text-violet-700 border-violet-200' :
                            t.category === 'Báo giá' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            t.category === 'Thăm quan / KH' ? 'bg-teal-50 text-teal-700 border-teal-200' :
                            t.category === 'Task nội bộ' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                            'bg-gray-100 text-gray-600 border-gray-200'
                          }`}>{t.category}</span>
                          {t.source === 'ws' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-600 border border-orange-200 shrink-0">Việc treo</span>
                          )}
                          <span className="text-[12.5px] font-medium text-[#111] truncate">{t.title}</span>
                        </div>
                        <div className="text-[11px] text-[#888] mt-0.5">
                          ✓ Hoàn thành {t.doneAt ? formatDate(t.doneAt.split('T')[0]) : ''}
                          {t.kcn ? ` · ${t.kcn}` : ''}
                          {t.assignee ? ` · ${t.assignee}` : ''}
                          {t.doneAt ? ` · ${getWeekLabel(t.doneAt)}` : ''}
                        </div>
                      </div>
                      {t.priority && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 mt-0.5 ${t.priority === 'high' ? 'bg-red-50 text-red-700 border-red-200' : t.priority === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                          {t.priority === 'high' ? 'Cao' : t.priority === 'medium' ? 'TB' : 'Thấp'}
                        </span>
                      )}
                    </div>
                    {t.notes ? (
                      <div className="mt-1.5 flex items-start gap-1.5 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
                        <span className="text-[10px] text-emerald-600 font-semibold shrink-0 mt-0.5">Kết quả:</span>
                        <span className="text-[11.5px] text-emerald-800">{t.notes}</span>
                      </div>
                    ) : t.source === 'work' ? (
                      <div className="mt-1.5 text-[11px] text-[#bbb] italic">Chưa có ghi chú kết quả</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>}
      </div>
      {/* Quick action modals */}
      {showQuoteModal && <QuoteModal toast={toast} onClose={() => setShowQuoteModal(false)} />}
      {showGiaoViec && (
        <GiaoViecModal
          clients={clients}
          toast={toast}
          onClose={() => setShowGiaoViec(false)}
          onCreated={handleTaskCreated}
        />
      )}
      {showBulkLabor && <BulkLaborModal clients={clients} toast={toast} onClose={() => setShowBulkLabor(false)} />}
    </>
  );
}
