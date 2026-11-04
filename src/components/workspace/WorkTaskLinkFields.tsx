// src/components/workspace/WorkTaskLinkFields.tsx
// Gắn CÔNG TY (khách đang hợp tác hoặc công ty BD Pipeline chưa ký HĐ) + NGƯỜI LIÊN HỆ (CSKH) cho 1 việc.
// Dùng ở form "Thêm công việc" và dòng "Liên quan" khi mở 1 việc trong Workspace. Logic thuần ở lib/workTaskLinks.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Users, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/audit'
import { clientIdsOf, linksOf } from '../../lib/contactOps'
import { ensureClientForPipelineCompany, type PipelineCompanyLite } from '../../lib/pipelineCompanyLink'
import {
  TASK_PIPE_KEY, parseCompanyKey, pipelineChoiceLabel, pipelineTaskClientId, rankTaskContacts, updateWorkTaskContacts,
  type TaskContactLite,
} from '../../lib/workTaskLinks'
import type { AppUser, Client, Contact, WorkTask } from '../../lib/types'
import { BTN_PRIMARY, BTN_SECONDARY, POPOVER, TINT } from './wsTheme'

/** Các <option> của ô "Khách hàng": khách đang hợp tác + công ty BD Pipeline chưa ký HĐ (khoá "pipe:<id>"). */
export function CompanyOptions({ clients, pipeline, emptyLabel = '— Không chọn —' }: {
  clients: readonly Pick<Client, 'id' | 'name'>[]
  pipeline: readonly PipelineCompanyLite[]
  emptyLabel?: string
}) {
  return (
    <>
      <option value="">{emptyLabel}</option>
      {pipeline.length > 0 ? (
        <>
          <optgroup label="Khách hàng đang hợp tác">
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
          <optgroup label="BD Pipeline — đang liên hệ, chưa ký HĐ">
            {pipeline.map(e => <option key={e.id} value={TASK_PIPE_KEY + e.id}>{pipelineChoiceLabel(e)}</option>)}
          </optgroup>
        </>
      ) : clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </>
  )
}

/**
 * Hồ sơ clients đang giữ người liên hệ / việc của công ty đang chọn: khách → chính id đó; thẻ Pipeline →
 * hồ sơ KH tiềm năng cùng tên nếu đã có (chỉ đọc, KHÔNG tạo — tạo lúc bấm Lưu).
 */
export function useCompanyClientId(companyKey: string, pipelineById: ReadonlyMap<string, PipelineCompanyLite>): string | null {
  const parsed = parseCompanyKey(companyKey)
  const entry = parsed?.kind === 'pipeline' ? pipelineById.get(parsed.id) ?? null : null
  const [resolved, setResolved] = useState<{ key: string; id: string | null }>({ key: '', id: null })
  useEffect(() => {
    if (!entry) return
    let alive = true
    void pipelineTaskClientId(entry).then(id => { if (alive) setResolved({ key: companyKey, id }) }).catch(() => {})
    return () => { alive = false }
  }, [companyKey, entry])
  if (!parsed) return null
  if (parsed.kind === 'client') return parsed.id
  return resolved.key === companyKey ? resolved.id : null
}

/** Người liên hệ dạng gọn cho ô chọn; `inCompany` = thuộc công ty đang chọn (hoặc là người liên hệ của thẻ Pipeline). */
export function toTaskContacts(contacts: readonly Contact[], companyClientId: string | null, extraIds: readonly string[] = []): TaskContactLite[] {
  const extra = new Set(extraIds)
  return contacts.map(c => ({
    id: c.id,
    name: c.name,
    role: c.role ?? null,
    companies: linksOf(c).map(l => l.clients?.name ?? '').filter(Boolean),
    inCompany: extra.has(c.id) || (!!companyClientId && clientIdsOf(c).includes(companyClientId)),
  }))
}

/** Ô chọn NHIỀU người liên hệ: chip đã chọn + ô gõ tìm; chưa gõ thì gợi ý người của công ty đang chọn. */
export function TaskContactPicker({ contacts, value, onChange, companyClientId, extraCompanyContactIds, companyName, nameOf }: {
  contacts: readonly Contact[]
  value: readonly string[]
  onChange: (ids: string[]) => void
  companyClientId: string | null
  /** Người liên hệ của thẻ Pipeline (crm_pipeline.contact_id) — coi như người của công ty. */
  extraCompanyContactIds?: readonly string[]
  companyName?: string | null
  /** Tên của người đã chọn mà không có trong `contacts` (đã nghỉ…). */
  nameOf?: (id: string) => string | undefined
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lite = useMemo(() => toTaskContacts(contacts, companyClientId, extraCompanyContactIds), [contacts, companyClientId, extraCompanyContactIds])
  const byId = useMemo(() => new Map(lite.map(c => [c.id, c])), [lite])
  const options = useMemo(() => rankTaskContacts(lite, { query, selected: value }), [lite, query, value])
  const companyCount = useMemo(() => lite.filter(c => c.inCompany).length, [lite])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  useEffect(() => { setHi(0) }, [query, companyClientId])

  const add = (id: string) => { onChange([...value, id]); setQuery(''); inputRef.current?.focus() }
  const remove = (id: string) => onChange(value.filter(x => x !== id))

  const hint = query.trim()
    ? 'Không tìm thấy ai — thêm người mới ở CSKH → Danh sách liên hệ'
    : companyClientId || extraCompanyContactIds?.length
      ? (companyCount ? 'Đã chọn hết người của công ty — gõ tên để tìm người khác' : `${companyName ?? 'Công ty này'} chưa có người liên hệ — gõ tên để tìm`)
      : 'Gõ tên, chức vụ hoặc công ty để tìm người liên hệ'

  return (
    <div ref={boxRef} className="relative">
      <div
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
        className="min-h-[34px] w-full flex flex-wrap items-center gap-1 px-1.5 py-1 bg-white border border-black/[0.12] rounded-[10px] focus-within:border-[#0071E3] focus-within:ring-4 focus-within:ring-[#0071E3]/15 transition cursor-text"
      >
        {value.map(id => {
          const c = byId.get(id)
          return (
            <span key={id} className={`inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full text-[12px] font-medium ${TINT.blue}`}
              title={c?.companies.join(', ') || undefined}>
              {c?.name ?? nameOf?.(id) ?? 'Người liên hệ'}
              {c?.companies[0] && <span className="font-normal opacity-70 max-w-[120px] truncate">· {c.companies[0]}</span>}
              <button type="button" aria-label="Bỏ người này" onClick={e => { e.stopPropagation(); remove(id) }}
                className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-[#0071E3]/20"><X size={10} /></button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, Math.max(options.length - 1, 0))) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); if (options[hi]) add(options[hi].id) }
            else if (e.key === 'Escape') { setOpen(false) }
            else if (e.key === 'Backspace' && !query && value.length) remove(value[value.length - 1])
          }}
          placeholder={value.length ? '' : companyCount ? `Chọn người của ${companyName ?? 'công ty'}…` : 'Gõ tên người liên hệ…'}
          className="flex-1 min-w-[120px] h-6 px-1 text-[13px] bg-transparent text-[#1D1D1F] placeholder:text-[#AEAEB2] focus:outline-none"
        />
      </div>
      {open && (
        <div className={`absolute left-0 right-0 top-full mt-1 z-30 py-1 max-h-64 overflow-auto ${POPOVER}`}>
          {options.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-[#86868B]">{hint}</div>
          ) : options.map((c, i) => (
            <button key={c.id} type="button"
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => add(c.id)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${i === hi ? 'bg-[#0071E3]/[0.08]' : ''}`}>
              <span className="text-[13px] font-medium text-[#1D1D1F] truncate">{c.name}</span>
              {c.role && <span className="text-[11.5px] text-[#86868B] truncate">{c.role}</span>}
              <span className="ml-auto text-[11px] text-[#86868B] truncate max-w-[45%]">
                {c.inCompany && <span className="text-[#1E7B34] font-medium">✓ </span>}{c.companies.join(', ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Dòng "Liên quan" khi mở 1 việc trong Workspace: công ty + người liên hệ của việc, sửa được.
 * Việc đã có công ty thì chỉ đổi người liên hệ (đổi công ty sẽ lệch tên việc "Công ty — …" và
 * lịch sử 2 hồ sơ); việc chưa gắn công ty thì gắn thêm được.
 */
export function WorkTaskLinksRow({ task, companyName, contacts, contactNames, clients, pipeline, branchIdOf, user, toast, onSaved }: {
  task: WorkTask
  companyName: string | null
  contacts: readonly Contact[]
  contactNames: Readonly<Record<string, string>>
  clients: readonly Client[]
  pipeline: readonly PipelineCompanyLite[]
  /** Chi nhánh suy ra từ công ty vừa gắn (việc chưa có chi nhánh thì điền). */
  branchIdOf: (clientId: string) => string | null
  user: AppUser | null
  toast: (m: string) => void
  onSaved: (patch: Partial<WorkTask>, clientName?: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [companyKey, setCompanyKey] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const pipelineById = useMemo(() => new Map(pipeline.map(e => [e.id, e])), [pipeline])
  const currentIds = task.contact_ids ?? []
  const pickedKey = task.client_id ? task.client_id : companyKey
  const companyClientId = useCompanyClientId(pickedKey, pipelineById)
  const pipe = parseCompanyKey(companyKey)?.kind === 'pipeline' ? pipelineById.get(companyKey.slice(TASK_PIPE_KEY.length)) ?? null : null
  const nameOf = (id: string) => contactNames[id] ?? contacts.find(c => c.id === id)?.name

  function start() { setCompanyKey(''); setIds([...currentIds]); setEditing(true) }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const patch: Partial<WorkTask> = {}
      let newCompanyName: string | undefined
      const parsed = !task.client_id ? parseCompanyKey(companyKey) : null
      if (parsed) {
        let clientId = parsed.id
        if (parsed.kind === 'pipeline') {
          if (!pipe) throw new Error('Không tìm thấy công ty ở BD Pipeline')
          const r = await ensureClientForPipelineCompany(pipe, user)
          clientId = r.id; newCompanyName = r.name
        } else newCompanyName = clients.find(c => c.id === clientId)?.name
        const fields: Partial<WorkTask> = { client_id: clientId }
        const b = task.branch_id ? null : (parsed.kind === 'pipeline' ? pipe?.branch_id ?? null : branchIdOf(clientId))
        if (b) fields.branch_id = b
        const { error } = await supabase.from('work_tasks').update(fields).eq('id', task.id)
        if (error) throw new Error(error.message)
        Object.assign(patch, fields)
        await logActivity({
          user, action: 'update', table: 'work_tasks', recordId: task.id,
          description: `Gắn việc "${task.title}" vào công ty "${newCompanyName ?? ''}"`,
          oldData: { client_id: null, branch_id: task.branch_id }, newData: fields,
        })
      }
      const same = ids.length === currentIds.length && ids.every((x, i) => x === currentIds[i])
      if (!same) patch.contact_ids = await updateWorkTaskContacts(task.id, ids)
      if (Object.keys(patch).length) { onSaved(patch, newCompanyName); toast('Đã lưu liên quan của việc') }
      setEditing(false)
    } catch (e) {
      toast('Lỗi: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap text-[12px] text-[#6E6E73]">
        <Users size={12} className="text-[#86868B]" />
        <span>Công ty: <b className="font-medium text-[#1D1D1F]">{companyName ?? (task.client_id ? 'Khách hàng' : 'chưa gắn')}</b></span>
        <span className="text-[#C7C7CC]">·</span>
        <span>Người liên hệ:</span>
        {currentIds.length
          ? currentIds.map(id => <span key={id} className={`inline-flex h-5 px-2 items-center rounded-full text-[11.5px] font-medium ${TINT.blue}`}>{nameOf(id) ?? 'Người liên hệ'}</span>)
          : <span className="text-[#AEAEB2]">chưa gắn</span>}
        <button type="button" onClick={start} className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11.5px] font-medium text-[#0066CC] hover:bg-[#0071E3]/10 transition">
          <Pencil size={11} /> {task.client_id ? 'Gắn người liên hệ' : 'Gắn công ty / người'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-[12px] bg-white p-2.5 flex flex-col gap-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]" onClick={e => e.stopPropagation()}>
      {!task.client_id && (
        <div>
          <label className="text-[11.5px] font-medium text-[#6E6E73] mb-1 block">Công ty</label>
          <select value={companyKey} onChange={e => setCompanyKey(e.target.value)}
            className="w-full text-[13px] border border-black/[0.12] rounded-[10px] px-2.5 py-1.5 bg-white text-[#1D1D1F] focus:outline-none focus:border-[#0071E3]">
            <CompanyOptions clients={clients} pipeline={pipeline} emptyLabel="— Chưa gắn công ty —" />
          </select>
        </div>
      )}
      <div>
        <label className="text-[11.5px] font-medium text-[#6E6E73] mb-1 block">Người liên hệ (chọn nhiều)</label>
        <TaskContactPicker contacts={contacts} value={ids} onChange={setIds} companyClientId={companyClientId}
          extraCompanyContactIds={pipe?.contact_id ? [pipe.contact_id] : []}
          companyName={companyName ?? pipe?.company_name ?? clients.find(c => c.id === companyKey)?.name} nameOf={nameOf} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(false)} className={`${BTN_SECONDARY} h-7 px-3 text-[12px]`}>Huỷ</button>
        <button type="button" onClick={save} disabled={saving} className={`${BTN_PRIMARY} h-7 px-3 text-[12px]`}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
      </div>
    </div>
  )
}
