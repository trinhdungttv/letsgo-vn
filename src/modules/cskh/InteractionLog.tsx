// ============================================================================
// Nhật ký CSKH (port PRM InteractionLogPage; thay trang CSKH.tsx cũ).
// ----------------------------------------------------------------------------
// Mới nhất trước: loại, kênh, ai chủ động, nội dung, việc tiếp theo + hạn (chip
// "Trễ hạn" đỏ), Đã xong / Đang chờ. Lọc theo người liên hệ, "Có việc đang mở",
// chi nhánh, người ghi, loại. Tick xong tại dòng (đóng luôn việc trong Workspace);
// sửa dòng (nội dung, ngày, hình thức, việc đã hứa — việc trong Workspace đổi theo);
// xoá có xác nhận (xoá mềm). Dòng cũ chưa gắn người vẫn hiện đủ theo tên công ty /
// người liên hệ dạng chữ.
// Đợt "Ghi cho nhóm" (cùng dấu đợt created_at) gom thành 1 dòng "Tặng hoa 20/10 · 12 người";
// bút chì → Sửa đợt (đổi ngày / nội dung cả loạt, bỏ / thêm người, xoá cả đợt) — chỉ người
// tạo đợt hoặc admin.
// Việc Workspace có GẮN người liên hệ (work_tasks.contact_ids) xen vào dòng thời gian (ngày tạo,
// đã xong thì ngày xong) — chỉ xem, xử lý ở Workspace; lọc riêng bằng loại "Việc Workspace".
// ============================================================================
import { VoiceList } from '../../components/voice/VoiceUI';
import { listVoiceByType, type VoiceRecording } from '../../lib/voiceRec/api';
import { onCskhDataChanged } from '../../lib/cskh/events';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, ClipboardList, Gift, NotebookText, PenLine, Pencil, Trash2, Users } from 'lucide-react';
import { ICON_TILE, TINT } from '../../components/workspace/wsTheme';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { branchOf } from '../../lib/branchRef';
import { formatCurrencyFull } from '../../lib/format';
import { formatDateVN, longDateVN, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { batchGiftsOf, canEditBatch, groupBatches, type InteractionBatch, type LogEntry } from '../../lib/cskh/groupLog';
import { giftOfLog } from '../../lib/cskh/logGift';
import { diffDays } from '../../lib/cskh/lunar';
import { matchesQuery, normalizeSearch } from '../../lib/cskh/search';
import type { CskhInteraction, InteractionType } from '../../lib/cskh/types';
import { CHANNEL_LABEL, GIFT_DIRECTION_LABEL, INTERACTION_LABEL, INTERACTION_TYPES } from '../../lib/cskh/types';
import { compareVnName } from '../../lib/vnName';
import { isWorkTaskDone, isWorkTaskOpen, workTaskLogDate, workTaskTitleWithoutCompany, WORK_TASK_STATUS_LABEL, type CskhWorkTask } from '../../lib/cskh/workTasks';
import { taskTypeLabel } from '../../lib/workTaskTypes';
import { applyBatchEdit, archiveBatch, archiveInteraction, setFollowUpDone, updateInteraction } from './data/api';
import { useCskh } from './context';
import {
  INTERACTION_ICON, PANEL, PILL_PRIMARY, PILL_TINTED, ROUND_ICON,
} from './ui';
import { MigrationBanner, Spinner } from './components/Card';
import { BatchEditModal } from './components/BatchEditModal';
import { LogInteractionModal } from './components/LogInteractionModal';
import { RescheduleSheet } from './components/RescheduleSheet';
import { CompanyTag, MoreButton, PageTitle, PillSelect, Quiet, Row, SearchField, Switch } from './components/apple';

const PAGE = 50;

/** Dòng trên dòng thời gian: nhật ký (lẻ / đợt nhóm) hoặc việc Workspace có gắn người. */
type TimelineEntry = LogEntry | { kind: 'work'; task: CskhWorkTask; date: string };
/** Loại "Việc Workspace" trong ô lọc loại (không phải hình thức tương tác). */
const WORK_TYPE = 'work';

/** Màu ô icon theo hình thức tương tác (kiểu ứng dụng iOS). */
const TYPE_TILE: Readonly<Record<InteractionType, keyof typeof ICON_TILE>> = {
  call: 'green', message: 'blue', email: 'indigo', meet: 'orange', coffee: 'orange', gift: 'red', other: 'gray',
};

export default function CskhInteractionLog() {
  const { space, data, loading, clients, toast, openProfile, openLog, openGroupLog } = useCskh();
  // Bản ghi âm cuộc gọi (migration 206) — hiện dưới dòng nhật ký cùng người + cùng ngày
  const [voices, setVoices] = useState<VoiceRecording[]>([]);
  const loadVoices = useCallback(() => { listVoiceByType('contact_call').then(setVoices).catch(() => setVoices([])); }, []);
  useEffect(() => { loadVoices(); return onCskhDataChanged(loadVoices); }, [loadVoices]);
  const voicesOf = useMemo(() => {
    const m = new Map<string, VoiceRecording[]>();
    for (const v of voices) { const k = `${v.subject_id}|${v.related_date ?? v.recorded_at.slice(0, 10)}`; m.set(k, [...(m.get(k) ?? []), v]); }
    return m;
  }, [voices]);
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const today = todayVN();
  const [search, setSearch] = useState('');
  const [person, setPerson] = useState('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [branch, setBranch] = useState('all');
  const [recorder, setRecorder] = useState('all');
  const [type, setType] = useState<'all' | InteractionType | typeof WORK_TYPE>('all');
  const [limit, setLimit] = useState(PAGE);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CskhInteraction | null>(null);
  const [editingBatch, setEditingBatch] = useState<InteractionBatch | null>(null);
  // Việc đã hứa đang hẹn lại / để dịp khác
  const [resched, setResched] = useState<CskhInteraction | null>(null);

  const contactById = useMemo(() => new Map((data?.contacts ?? []).map(c => [c.id, c])), [data]);
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const logs = useMemo(() => (data?.interactions ?? []).filter(i => !i.isArchived), [data]);
  const works = useMemo(() => data?.workTasks ?? [], [data]);
  const userName = useMemo(() => new Map((data?.users ?? []).map(u => [u.id, u.full_name])), [data]);

  /** Tên người + công ty hiển thị (dòng cũ chưa gắn người thì dùng chữ đã lưu). */
  const whoOf = (i: CskhInteraction) => {
    const c = i.contactId ? contactById.get(i.contactId) : undefined;
    return {
      name: c?.fullName || i.contactPerson || 'Không rõ người liên hệ',
      company: (i.clientId && clientById.get(i.clientId)?.name) || i.clientName || c?.organization || '',
    };
  };
  const branchIdOf = useCallback((i: CskhInteraction): string | null => {
    const clientId = i.clientId ?? (i.contactId ? contactById.get(i.contactId)?.clientIds[0] : undefined);
    return branchOf(clientId ? clientById.get(clientId) ?? null : null, branches)?.id ?? null;
  }, [contactById, clientById, branches]);
  const workBranchId = useCallback((t: CskhWorkTask): string | null => {
    const clientId = t.clientId ?? contactById.get(t.contactIds[0])?.clientIds[0];
    return branchOf(clientId ? clientById.get(clientId) ?? null : null, branches)?.id ?? null;
  }, [contactById, clientById, branches]);

  const options = useMemo(() => {
    const people = new Map<string, string>();
    const recorders = new Map<string, string>();
    const bIds = new Set<string>();
    for (const i of logs) {
      if (i.contactId) people.set(i.contactId, contactById.get(i.contactId)?.fullName ?? i.contactPerson);
      if (i.createdBy) recorders.set(i.createdBy, i.createdByName || 'Không rõ');
      const b = branchIdOf(i);
      if (b) bIds.add(b);
    }
    // Người chỉ có việc Workspace (chưa có dòng nhật ký nào) vẫn phải chọn được ở ô lọc
    for (const t of works) {
      for (const id of t.contactIds) { const c = contactById.get(id); if (c) people.set(id, c.fullName); }
      if (t.userId) recorders.set(t.userId, userName.get(t.userId) || 'Không rõ');
      const b = workBranchId(t);
      if (b) bIds.add(b);
    }
    // Trùng tên (VD 2 "Mr Tuấn" ở Coherent và HEMPEL) → thêm tên công ty để chọn đúng người
    const nameCount = new Map<string, number>();
    for (const n of people.values()) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    for (const [id, n] of people) {
      const org = contactById.get(id)?.organization;
      if ((nameCount.get(n) ?? 0) > 1 && org) people.set(id, `${n} · ${org}`);
    }
    return {
      people: [...people].sort((a, b) => compareVnName(a[1], b[1])),
      recorders: [...recorders].sort((a, b) => a[1].localeCompare(b[1], 'vi')),
      branches: branches.filter(b => bIds.has(b.id)),
    };
  }, [logs, works, contactById, branchIdOf, workBranchId, branches, userName]);

  const q = normalizeSearch(search);
  const filtered = logs.filter(i => {
    if (type === WORK_TYPE) return false;
    if (person !== 'all' && i.contactId !== person) return false;
    if (openOnly && !((i.followUpAction.trim() && !i.followUpDone) || i.extraTasks.some(t => !t.done))) return false;
    if (recorder !== 'all' && i.createdBy !== recorder) return false;
    if (type !== 'all' && i.type !== type) return false;
    if (branch !== 'all' && branchIdOf(i) !== branch) return false;
    if (q) {
      const w = whoOf(i);
      if (!matchesQuery(normalizeSearch([w.name, w.company, i.content, i.followUpAction, i.createdByName].join(' ')), search)) return false;
    }
    return true;
  });
  const filteredWorks = works.filter(t => {
    if (type !== 'all' && type !== WORK_TYPE) return false;
    if (person !== 'all' && !t.contactIds.includes(person)) return false;
    if (openOnly && !isWorkTaskOpen(t)) return false;
    if (recorder !== 'all' && t.userId !== recorder) return false;
    if (branch !== 'all' && workBranchId(t) !== branch) return false;
    if (q) {
      const names = t.contactIds.map(id => contactById.get(id)?.fullName ?? '');
      const company = t.clientId ? clientById.get(t.clientId)?.name ?? '' : '';
      if (!matchesQuery(normalizeSearch([...names, company, t.title, t.notes ?? '', t.userId ? userName.get(t.userId) ?? '' : ''].join(' ')), search)) return false;
    }
    return true;
  });
  const openCount = logs.reduce((n, i) => n + (i.followUpAction.trim() && !i.followUpDone ? 1 : 0) + i.extraTasks.filter(t => !t.done).length, 0);
  const openWorkCount = works.filter(isWorkTaskOpen).length;
  const filtersOn = person !== 'all' || openOnly || recorder !== 'all' || type !== 'all' || branch !== 'all' || !!q;

  const toggleDone = async (i: CskhInteraction) => {
    setBusyId(i.id);
    try {
      await setFollowUpDone(i, !i.followUpDone, user);
      emitCskhDataChanged();
      toast(i.followUpDone ? 'Đã mở lại việc đã hứa' : i.followUpTaskId ? 'Đã xong — việc trong Workspace cũng đã đóng' : 'Đã xong việc đã hứa');
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (i: CskhInteraction) => {
    const w = whoOf(i);
    const gifts = data?.gifts ?? [];
    const gift = giftOfLog(gifts, i);
    const extra = (i.followUpTaskId && !i.followUpDone ? '\nViệc đã hứa đi kèm (chưa xong) trong Workspace cũng bị xoá.' : '')
      + (gift ? `\nMón quà “${gift.item}” ghi kèm cũng bị xoá khỏi Lịch sử quà.` : '');
    if (!confirm(`Xoá dòng nhật ký ngày ${formatDateVN(i.occurredAt)} với ${w.name}?${extra}\n\nKhôi phục được ở trang Lịch sử.`)) return;
    setBusyId(i.id);
    try {
      await archiveInteraction(i, user, gifts);
      emitCskhDataChanged();
      toast('Đã xoá dòng nhật ký');
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return loading ? <Spinner /> : <p className="py-16 text-center text-[13px] text-[#86868B]">Chưa tải được dữ liệu CSKH.</p>;
  // Đợt ghi nhóm gom thành 1 dòng; việc Workspace xen theo ngày (cùng ngày thì sau nhật ký);
  // phân trang theo dòng hiển thị
  const dateOf = (e: TimelineEntry) => (e.kind === 'work' ? e.date : e.kind === 'batch' ? e.batch.occurredAt : e.item.occurredAt);
  const entries: TimelineEntry[] = [
    ...groupBatches(filtered),
    ...filteredWorks.map((task): TimelineEntry => ({ kind: 'work', task, date: workTaskLogDate(task) })),
  ].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  const shown = entries.slice(0, limit);
  // Gom theo ngày (dữ liệu đã xếp mới nhất trước) → tiêu đề "Hôm nay / Hôm qua / dd/mm/yyyy"
  const days: { date: string; items: TimelineEntry[] }[] = [];
  for (const e of shown) {
    const last = days[days.length - 1];
    if (last && last.date === dateOf(e)) last.items.push(e);
    else days.push({ date: dateOf(e), items: [e] });
  }
  const editingGifts = editingBatch
    ? batchGiftsOf(data.gifts, editingBatch.createdAt, editingBatch.items.map(i => i.contactId as string))
    : [];

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle
        eyebrow="Lịch sử liên hệ"
        title={space === 'sale' ? 'Nhật ký Sale' : 'Nhật ký CSKH'}
        subtitle={<>{logs.length} lần tương tác · {openCount} việc đã hứa đang mở{works.length > 0 && <> · {works.length} việc Workspace ({openWorkCount} đang mở)</>}</>}
        actions={(
          <>
            <button type="button" onClick={() => openGroupLog()} className={PILL_TINTED}>
              <Users size={15} strokeWidth={2.2} /> Ghi cho nhóm
            </button>
            <button type="button" onClick={() => openLog()} className={PILL_PRIMARY}>
              <PenLine size={15} strokeWidth={2.2} /> Ghi tương tác
            </button>
          </>
        )}
      />

      {!data.migrationReady && <MigrationBanner />}

      <div className={`${PANEL} p-3 md:p-4 flex flex-wrap items-center gap-2`}>
        <SearchField value={search} onChange={v => { setSearch(v); setLimit(PAGE); }}
          placeholder="Tìm người, công ty, nội dung… (gõ không dấu được)" className="flex-1 min-w-[220px] max-w-md basis-full md:basis-auto" />
        <PillSelect value={person} active={person !== 'all'} label="Lọc theo người liên hệ" onChange={v => { setPerson(v); setLimit(PAGE); }}>
          <option value="all">Mọi người liên hệ</option>
          {options.people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </PillSelect>
        <PillSelect value={type} active={type !== 'all'} label="Lọc theo loại" onChange={v => setType(v as typeof type)}>
          <option value="all">Mọi loại</option>
          {INTERACTION_TYPES.map(t => <option key={t} value={t}>{INTERACTION_LABEL[t]}</option>)}
          <option value={WORK_TYPE}>Việc Workspace</option>
        </PillSelect>
        {options.branches.length > 0 && (
          <PillSelect value={branch} active={branch !== 'all'} label="Lọc theo chi nhánh" onChange={setBranch}>
            <option value="all">Mọi chi nhánh</option>
            {options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </PillSelect>
        )}
        {options.recorders.length > 0 && (
          <PillSelect value={recorder} active={recorder !== 'all'} label="Lọc theo người ghi" onChange={setRecorder}>
            <option value="all">Mọi người ghi</option>
            {options.recorders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </PillSelect>
        )}
        <Switch checked={openOnly} onChange={setOpenOnly} label="Có việc đang mở" />
        {filtersOn && (
          <button type="button" onClick={() => { setSearch(''); setPerson('all'); setOpenOnly(false); setRecorder('all'); setType('all'); setBranch('all'); }}
            className="text-[13px] font-medium text-[#0066CC] hover:opacity-70 px-1 min-h-[36px] md:min-h-0">Xoá lọc</button>
        )}
        <span className="text-[12px] text-[#86868B] ml-auto tabular-nums">{filtered.length + filteredWorks.length} dòng</span>
      </div>

      {shown.length === 0 && (
        <div className={PANEL}>
          <Quiet icon={<NotebookText size={18} />}>{logs.length || works.length ? 'Không có dòng nào khớp bộ lọc.' : 'Chưa có nhật ký nào — bấm "Ghi tương tác".'}</Quiet>
        </div>
      )}

      {days.map(day => (
        <section key={day.date} aria-label={formatDateVN(day.date)}>
          <h2 className="px-1 mb-2 flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#1D1D1F]">{dayHeading(day.date, today)}</span>
            <span className="text-[12px] text-[#86868B]">{formatDateVN(day.date)} · {day.items.reduce((n, e) => n + (e.kind === 'batch' ? e.batch.items.length : 1), 0)} dòng</span>
          </h2>
          <div className={`${PANEL} px-4 md:px-5 py-1`}>
            {day.items.map((entry, idx) => {
              if (entry.kind === 'work') {
                const t = entry.task;
                const company = t.clientId ? clientById.get(t.clientId)?.name ?? '' : '';
                const people = t.contactIds.flatMap(id => { const c = contactById.get(id); return c ? [c] : []; });
                const done = isWorkTaskDone(t);
                const late = !done && t.due ? diffDays(t.due, today) : null;
                const owner = t.userId ? userName.get(t.userId) : undefined;
                return (
                  <Row key={`work_${t.id}`} first={idx === 0} inset={48} align="start">
                    <span className={`w-9 h-9 shrink-0 rounded-[10px] ${ICON_TILE.indigo} text-white flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.12)]`}>
                      <ClipboardList size={17} strokeWidth={2.1} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        {people.map((c, k) => (
                          <button key={c.id} type="button" onClick={() => openProfile(c.id)} className="text-[15px] font-semibold text-[#1D1D1F] hover:text-[#0066CC] transition-colors">
                            {c.fullName}{k < people.length - 1 ? ',' : ''}
                          </button>
                        ))}
                        <CompanyTag name={company} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-0.5 text-[12px] text-[#86868B]">
                        <span className="font-medium text-[#3A3A3C]">Việc Workspace</span>
                        <span>· {taskTypeLabel(t.taskType)}</span>
                        {owner && <span>· phụ trách {owner}</span>}
                      </div>
                      <div className={`mt-2 rounded-[12px] px-3 py-2 ${done ? 'bg-[#F5F5F7]' : late !== null && late > 0 ? 'bg-[#FF3B30]/[0.07]' : 'bg-[#5856D6]/[0.08]'}`}>
                        <span className={`text-[13.5px] leading-snug ${done ? 'text-[#6E6E73]' : 'text-[#1D1D1F] font-medium'}`}>{workTaskTitleWithoutCompany(t.title, company)}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className={`px-2 rounded-full text-[11px] font-medium ${done ? TINT.green : t.status === 'in_progress' ? TINT.blue : TINT.gray}`}>{WORK_TASK_STATUS_LABEL[t.status] ?? t.status}</span>
                          {late !== null && late > 0 && <span className={`px-2 rounded-full text-[11px] font-semibold ${TINT.red}`}>Trễ hạn {late} ngày</span>}
                          {late === 0 && <span className={`px-2 rounded-full text-[11px] font-semibold ${TINT.orange}`}>Hạn hôm nay</span>}
                          {t.due && !done && (late === null || late < 0) && <span className="text-[11.5px] text-[#86868B]">hạn {formatDateVN(t.due)}</span>}
                          {done && t.completedAt && <span className="text-[11.5px] text-[#86868B]">xong {formatDateVN(workTaskLogDate(t))}</span>}
                          <span className="text-[11.5px] text-[#86868B]">· xử lý ở Workspace</span>
                        </span>
                      </div>
                      {t.notes && (
                        <div className="mt-1.5">
                          <span className="text-[11.5px] font-medium text-[#86868B]">{done ? 'Kết quả' : 'Ghi chú'}</span>
                          <LogContent text={t.notes} />
                        </div>
                      )}
                    </div>
                  </Row>
                );
              }
              if (entry.kind === 'batch') {
                const b = entry.batch;
                const BIcon = INTERACTION_ICON[b.type];
                const names = b.items.map(i => (i.contactId ? contactById.get(i.contactId)?.fullName : null) ?? i.contactPerson).filter(Boolean);
                const editable = canEditBatch(b, user);
                return (
                  <Row key={b.key} first={idx === 0} inset={48} align="start">
                    <span className={`w-9 h-9 shrink-0 rounded-[10px] ${ICON_TILE[TYPE_TILE[b.type]]} text-white flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.12)]`}>
                      <BIcon size={17} strokeWidth={2.1} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <span className="text-[15px] font-semibold text-[#1D1D1F]">{b.content || INTERACTION_LABEL[b.type]}</span>
                        <span className={`inline-flex items-center gap-1 px-2 rounded-full text-[11px] font-semibold ${TINT.blue}`}><Users size={11} strokeWidth={2.4} /> {b.items.length} người</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1.5 mt-0.5 text-[12px] text-[#86868B]">
                        <span className="font-medium text-[#3A3A3C]">{INTERACTION_LABEL[b.type]}</span>
                        <span>· Ghi cho nhóm</span>
                        {b.createdByName && <span>· ghi bởi {b.createdByName}</span>}
                      </div>
                      <p className="text-[13px] text-[#3A3A3C] leading-snug mt-1.5">
                        {names.slice(0, 6).join(', ')}{names.length > 6 && <span className="text-[#86868B]"> và {names.length - 6} người khác</span>}
                      </p>
                    </div>
                    {editable && (
                      <button type="button" onClick={() => setEditingBatch(b)} title="Sửa đợt ghi nhóm" aria-label={`Sửa đợt ${b.content}`} className={ROUND_ICON}>
                        <Pencil size={15} />
                      </button>
                    )}
                  </Row>
                );
              }
              const i = entry.item;
              const w = whoOf(i);
              const Icon = INTERACTION_ICON[i.type];
              const hasFollowUp = i.followUpAction.trim() !== '';
              const late = hasFollowUp && !i.followUpDone && i.followUpDue ? diffDays(i.followUpDue, today) : null;
              const gift = i.type === 'gift' ? giftOfLog(data.gifts, i) : null;
              const giftRemoved = i.type === 'gift' && !gift && !!giftOfLog(data.gifts, i, true);
              return (
                <Row key={i.id} first={idx === 0} inset={48} align="start">
                  <span className={`w-9 h-9 shrink-0 rounded-[10px] ${ICON_TILE[TYPE_TILE[i.type]]} text-white flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.12)]`}>
                    <Icon size={17} strokeWidth={2.1} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      {i.contactId && contactById.has(i.contactId) ? (
                        <button type="button" onClick={() => openProfile(i.contactId as string)} className="text-[15px] font-semibold text-[#1D1D1F] hover:text-[#0066CC] transition-colors">{w.name}</button>
                      ) : <span className="text-[15px] font-semibold text-[#1D1D1F]">{w.name}</span>}
                      <CompanyTag name={w.company} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-0.5 text-[12px] text-[#86868B]">
                      <span className="font-medium text-[#3A3A3C]">{INTERACTION_LABEL[i.type]}</span>
                      {i.channel && <span>· {CHANNEL_LABEL[i.channel]}</span>}
                      {i.initiatedBy === 'them' && <span className={`px-2 rounded-full text-[11px] font-medium ${TINT.purple}`}>Họ chủ động</span>}
                      {i.createdByName && <span>· ghi bởi {i.createdByName}</span>}
                    </div>
                    {i.content && <LogContent text={i.content} />}
                    {i.contactId && voicesOf.get(`${i.contactId}|${i.occurredAt}`) && (
                      <div className="mt-2"><VoiceList items={voicesOf.get(`${i.contactId}|${i.occurredAt}`)!} onChanged={loadVoices} compact /></div>
                    )}
                    {gift && (
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[12px] px-3 py-2 bg-[#FF3B30]/[0.07] text-[13px]">
                        <Gift size={14} className="text-[#D70015] shrink-0" strokeWidth={2.2} />
                        <span className="font-medium text-[#1D1D1F]">{gift.item}</span>
                        {gift.estimatedValue != null && <span className="text-[#6E6E73] tabular-nums">{formatCurrencyFull(gift.estimatedValue)}</span>}
                        <span className={`px-2 rounded-full text-[11px] font-medium ${gift.direction === 'given' ? TINT.blue : TINT.green}`}>{GIFT_DIRECTION_LABEL[gift.direction]}</span>
                        <span className="text-[11.5px] text-[#86868B]">· có trong Lịch sử quà</span>
                      </p>
                    )}
                    {i.type === 'gift' && !gift && i.contactId && (
                      giftRemoved
                        ? <p className="mt-2 text-[12px] text-[#86868B]">Món quà của dòng này đã được xoá khỏi Lịch sử quà.</p>
                        : (
                          <button type="button" onClick={() => setEditing(i)}
                            className={`mt-2 inline-flex items-center gap-1.5 rounded-[12px] px-3 py-1.5 text-[12.5px] font-medium text-left ${TINT.orange} hover:opacity-80 transition`}>
                            <Gift size={13} strokeWidth={2.2} className="shrink-0" /> Chưa ghi món quà vào Lịch sử quà — bấm để ghi
                          </button>
                        )
                    )}
                    {hasFollowUp && (
                      <div className={`mt-2 flex items-start gap-2.5 rounded-[12px] px-3 py-2 ${i.followUpDone ? 'bg-[#F5F5F7]' : late !== null && late > 0 ? 'bg-[#FF3B30]/[0.07]' : 'bg-[#FF9500]/[0.09]'}`}>
                        <button type="button" disabled={busyId === i.id} onClick={() => toggleDone(i)}
                          aria-label={i.followUpDone ? `Mở lại: ${i.followUpAction}` : `Đánh dấu xong: ${i.followUpAction}`}
                          title={i.followUpDone ? 'Mở lại' : 'Đánh dấu xong'}
                          className="group w-8 h-8 md:w-6 md:h-6 -m-1 md:m-0 shrink-0 flex items-center justify-center disabled:opacity-50">
                          <span className={`w-[22px] h-[22px] rounded-full flex items-center justify-center transition ${i.followUpDone
                            ? 'bg-[#34C759] text-white'
                            : 'border-[1.5px] border-[#C7C7CC] bg-white text-transparent group-hover:border-[#34C759] group-hover:text-[#34C759]'}`}>
                            <Check size={12} strokeWidth={3} />
                          </span>
                        </button>
                        <span className="min-w-0 flex-1 text-[13.5px] leading-snug pt-0.5">
                          <span className={i.followUpDone ? 'text-[#86868B] line-through' : 'text-[#1D1D1F] font-medium'}>{i.followUpAction}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            {i.followUpDone ? <span className={`px-2 rounded-full text-[11px] font-medium ${TINT.green}`}>Đã xong</span>
                              : <span className={`px-2 rounded-full text-[11px] font-medium ${TINT.orange}`}>Đang chờ</span>}
                            {late !== null && late > 0 && <span className={`px-2 rounded-full text-[11px] font-semibold ${TINT.red}`}>Trễ hạn {late} ngày</span>}
                            {late === 0 && <span className={`px-2 rounded-full text-[11px] font-semibold ${TINT.orange}`}>Hạn hôm nay</span>}
                            {i.followUpDue && (late === null || late < 0) && <span className="text-[11.5px] text-[#86868B]">hạn {formatDateVN(i.followUpDue)}</span>}
                            {!i.followUpDue && !i.followUpDone && <span className={`px-2 rounded-full text-[11px] font-medium ${TINT.orange}`}>Để dịp khác</span>}
                            {i.followUpTaskId && i.followUpDue && <span className="text-[11.5px] text-[#86868B]">· có việc trong Workspace</span>}
                          </span>
                        </span>
                        {!i.followUpDone && (
                          <button type="button" onClick={() => setResched(i)} title="Đổi lịch / huỷ → Hẹn lại hoặc Để dịp khác" aria-label={`Hẹn lại: ${i.followUpAction}`}
                            className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 -my-0.5 rounded-full text-[12px] font-medium text-[#C93400] hover:bg-[#FF9500]/[0.16] active:scale-95 transition">
                            <CalendarClock size={14} strokeWidth={2.2} /> <span className="hidden md:inline">Hẹn lại</span>
                          </button>
                        )}
                      </div>
                    )}
                    {i.extraTasks.map(t => {
                      const tLate = !t.done && t.due ? diffDays(t.due, today) : null;
                      const row: CskhInteraction = { ...i, id: `${i.id}#${t.id}`, followUpAction: t.action, followUpDue: t.due, followUpDone: t.done, followUpTaskId: t.id, extraTaskIds: [], extraTasks: [] };
                      return (
                        <div key={t.id} className={`mt-2 flex items-start gap-2.5 rounded-[12px] px-3 py-2 ${t.done ? 'bg-[#F5F5F7]' : tLate !== null && tLate > 0 ? 'bg-[#FF3B30]/[0.07]' : 'bg-[#FF9500]/[0.09]'}`}>
                          <button type="button" disabled={busyId === row.id} onClick={() => toggleDone(row)}
                            aria-label={t.done ? `Mở lại: ${t.action}` : `Đánh dấu xong: ${t.action}`} title={t.done ? 'Mở lại' : 'Đánh dấu xong'}
                            className="group w-8 h-8 md:w-6 md:h-6 -m-1 md:m-0 shrink-0 flex items-center justify-center disabled:opacity-50">
                            <span className={`w-[22px] h-[22px] rounded-full flex items-center justify-center transition ${t.done
                              ? 'bg-[#34C759] text-white'
                              : 'border-[1.5px] border-[#C7C7CC] bg-white text-transparent group-hover:border-[#34C759] group-hover:text-[#34C759]'}`}>
                              <Check size={12} strokeWidth={3} />
                            </span>
                          </button>
                          <span className="min-w-0 flex-1 text-[13.5px] leading-snug pt-0.5">
                            <span className={t.done ? 'text-[#86868B] line-through' : 'text-[#1D1D1F] font-medium'}>{t.action}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5">
                              {t.done ? <span className={`px-2 rounded-full text-[11px] font-medium ${TINT.green}`}>Đã xong</span>
                                : <span className={`px-2 rounded-full text-[11px] font-medium ${TINT.orange}`}>Đang chờ</span>}
                              {tLate !== null && tLate > 0 && <span className={`px-2 rounded-full text-[11px] font-semibold ${TINT.red}`}>Trễ hạn {tLate} ngày</span>}
                              {tLate === 0 && <span className={`px-2 rounded-full text-[11px] font-semibold ${TINT.orange}`}>Hạn hôm nay</span>}
                              {t.due && (tLate === null || tLate < 0) && <span className="text-[11.5px] text-[#86868B]">hạn {formatDateVN(t.due)}</span>}
                              <span className="text-[11.5px] text-[#86868B]">· có việc trong Workspace</span>
                            </span>
                          </span>
                          {!t.done && (
                            <button type="button" onClick={() => setResched(row)} title="Đổi lịch → Hẹn lại" aria-label={`Hẹn lại: ${t.action}`}
                              className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 -my-0.5 rounded-full text-[12px] font-medium text-[#C93400] hover:bg-[#FF9500]/[0.16] active:scale-95 transition">
                              <CalendarClock size={14} strokeWidth={2.2} /> <span className="hidden md:inline">Hẹn lại</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <span className="shrink-0 flex flex-col md:flex-row gap-0.5">
                    <button type="button" disabled={busyId === i.id} onClick={() => setEditing(i)} title="Sửa dòng nhật ký" aria-label={`Sửa nhật ký ngày ${formatDateVN(i.occurredAt)} với ${w.name}`}
                      className={ROUND_ICON}>
                      <Pencil size={15} />
                    </button>
                    <button type="button" disabled={busyId === i.id} onClick={() => remove(i)} title="Xoá dòng nhật ký" aria-label="Xoá dòng nhật ký"
                      className={`${ROUND_ICON} hover:!text-[#D70015] hover:!bg-[#FF3B30]/10`}>
                      <Trash2 size={15} />
                    </button>
                  </span>
                </Row>
              );
            })}
          </div>
        </section>
      ))}

      {editing && (
        <LogInteractionModal
          contacts={data.contacts}
          clients={clients}
          gifts={data.gifts}
          occasions={data.occasions}
          existing={editing}
          today={today}
          onClose={() => setEditing(null)}
          onUpdate={async edit => {
            const contact = editing.contactId ? contactById.get(editing.contactId) ?? null : null;
            try {
              await updateInteraction(editing, edit, contact, { user, clients, branches }, data.gifts);
            } catch (e) {
              return (e as Error).message;
            }
            setEditing(null);
            emitCskhDataChanged();
            toast('Đã lưu thay đổi nhật ký');
            return null;
          }}
        />
      )}

      {resched && <RescheduleSheet item={resched} onClose={() => setResched(null)} />}

      {editingBatch && (
        <BatchEditModal
          batch={editingBatch}
          gifts={editingGifts}
          contacts={data.contacts}
          today={today}
          onClose={() => setEditingBatch(null)}
          onApply={async edit => {
            try {
              const r = await applyBatchEdit(editingBatch, editingGifts, edit, data.contacts, { user, clients, branches });
              setEditingBatch(null);
              emitCskhDataChanged();
              toast(`Đã sửa đợt${r.noGiftNames.length ? ` — ${r.noGiftNames.length} người mới chưa gắn công ty nên không ghi quà` : ''}`);
              return null;
            } catch (e) {
              return (e as Error).message;
            }
          }}
          onDelete={async () => {
            try {
              await archiveBatch(editingBatch, editingGifts, user);
              setEditingBatch(null);
              emitCskhDataChanged();
              toast(`Đã xoá đợt (${editingBatch.items.length} người)`);
              return null;
            } catch (e) {
              return (e as Error).message;
            }
          }}
        />
      )}

      {entries.length > shown.length && (
        <div className={`${PANEL} px-3 py-1`}>
          <MoreButton onClick={() => setLimit(limit + PAGE)}>
            Hiện thêm {Math.min(PAGE, entries.length - shown.length)} dòng (còn {entries.length - shown.length})
          </MoreButton>
        </div>
      )}
    </div>
  );
}

/** "Hôm nay" / "Hôm qua" / "Thứ Hai, 12 tháng 10". */
/** Nội dung nhật ký: dài thì mặc định gập 4 dòng, bấm "Xem thêm" mới mở đủ (đỡ rối trang). */
const LOG_COLLAPSE_CHARS = 220;
const LOG_COLLAPSE_LINES = 5;
function LogContent({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LOG_COLLAPSE_CHARS || text.split('\n').length > LOG_COLLAPSE_LINES;
  return (
    <div className="mt-1.5">
      <p className={`text-[14px] text-[#1D1D1F] leading-relaxed whitespace-pre-line break-words ${long && !open ? 'line-clamp-4' : ''}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="mt-0.5 py-1.5 text-[13px] font-medium text-[#0066CC] hover:underline">
          {open ? 'Thu gọn' : 'Xem thêm'}
        </button>
      )}
    </div>
  );
}

function dayHeading(iso: string, today: string): string {
  const d = diffDays(iso, today);
  if (d === 0) return 'Hôm nay';
  if (d === 1) return 'Hôm qua';
  return longDateVN(iso);
}
