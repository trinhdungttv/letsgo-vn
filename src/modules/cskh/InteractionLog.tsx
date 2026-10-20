// ============================================================================
// Nhật ký CSKH (port PRM InteractionLogPage; thay trang CSKH.tsx cũ).
// ----------------------------------------------------------------------------
// Mới nhất trước: loại, kênh, ai chủ động, nội dung, việc tiếp theo + hạn (chip
// "Trễ hạn" đỏ), Đã xong / Đang chờ. Lọc theo người liên hệ, "Có việc đang mở",
// chi nhánh, người ghi, loại. Tick xong tại dòng (đóng luôn việc trong Workspace);
// xoá có xác nhận (xoá mềm). Dòng cũ chưa gắn người vẫn hiện đủ theo tên công ty /
// người liên hệ dạng chữ.
// ============================================================================
import { useCallback, useMemo, useState } from 'react';
import { Check, NotebookText, PenLine, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { branchOf } from '../../lib/branchRef';
import { formatDateVN, relativeDayLabel, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { diffDays } from '../../lib/cskh/lunar';
import { matchesQuery, normalizeSearch } from '../../lib/cskh/search';
import type { CskhInteraction, InteractionType } from '../../lib/cskh/types';
import { CHANNEL_LABEL, INTERACTION_LABEL, INTERACTION_TYPES } from '../../lib/cskh/types';
import { compareVnName } from '../../lib/vnName';
import { archiveInteraction, setFollowUpDone } from './data/api';
import { useCskh } from './context';
import { INTERACTION_ICON } from './ui';
import { MigrationBanner, Spinner } from './components/Card';

const PAGE = 50;
const selectCls = 'text-[12px] h-9 md:h-8 px-2 border border-gray-300 rounded-lg bg-white outline-none focus:border-blue-500 max-w-[220px]';

export default function CskhInteractionLog() {
  const { data, loading, clients, toast, openProfile, openLog } = useCskh();
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const today = todayVN();
  const [search, setSearch] = useState('');
  const [person, setPerson] = useState('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [branch, setBranch] = useState('all');
  const [recorder, setRecorder] = useState('all');
  const [type, setType] = useState<'all' | InteractionType>('all');
  const [limit, setLimit] = useState(PAGE);
  const [busyId, setBusyId] = useState<string | null>(null);

  const contactById = useMemo(() => new Map((data?.contacts ?? []).map(c => [c.id, c])), [data]);
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const logs = useMemo(() => (data?.interactions ?? []).filter(i => !i.isArchived), [data]);

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
    return {
      people: [...people].sort((a, b) => compareVnName(a[1], b[1])),
      recorders: [...recorders].sort((a, b) => a[1].localeCompare(b[1], 'vi')),
      branches: branches.filter(b => bIds.has(b.id)),
    };
  }, [logs, contactById, branchIdOf, branches]);

  const q = normalizeSearch(search);
  const filtered = logs.filter(i => {
    if (person !== 'all' && i.contactId !== person) return false;
    if (openOnly && (!i.followUpAction.trim() || i.followUpDone)) return false;
    if (recorder !== 'all' && i.createdBy !== recorder) return false;
    if (type !== 'all' && i.type !== type) return false;
    if (branch !== 'all' && branchIdOf(i) !== branch) return false;
    if (q) {
      const w = whoOf(i);
      if (!matchesQuery(normalizeSearch([w.name, w.company, i.content, i.followUpAction, i.createdByName].join(' ')), search)) return false;
    }
    return true;
  });
  const openCount = logs.filter(i => i.followUpAction.trim() && !i.followUpDone).length;
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
    const extra = i.followUpTaskId && !i.followUpDone ? '\nViệc đã hứa đi kèm (chưa xong) trong Workspace cũng bị xoá.' : '';
    if (!confirm(`Xoá dòng nhật ký ngày ${formatDateVN(i.occurredAt)} với ${w.name}?${extra}\n\nKhôi phục được ở trang Lịch sử.`)) return;
    setBusyId(i.id);
    try {
      await archiveInteraction(i, user);
      emitCskhDataChanged();
      toast('Đã xoá dòng nhật ký');
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return loading ? <Spinner /> : <p className="py-16 text-center text-[12.5px] text-[#999]">Chưa tải được dữ liệu CSKH.</p>;
  const shown = filtered.slice(0, limit);

  return (
    <div className="space-y-3 md:space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] md:text-[20px] font-bold text-[#111] leading-tight">Nhật ký CSKH</h1>
          <p className="text-[12.5px] text-[#666] mt-0.5">{logs.length} lần tương tác · {openCount} việc đã hứa đang mở</p>
        </div>
        <button type="button" onClick={() => openLog()}
          className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg bg-[#1D4ED8] text-white text-[12.5px] font-semibold">
          <PenLine size={14} /> Ghi tương tác
        </button>
      </header>

      {!data.migrationReady && <MigrationBanner />}

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setLimit(PAGE); }} placeholder="Tìm người, công ty, nội dung… (gõ không dấu được)"
            className="w-full pl-8 pr-3 h-10 md:h-8 rounded-lg border border-gray-300 text-[13px] outline-none focus:border-blue-500" />
        </div>
        <select value={person} onChange={e => { setPerson(e.target.value); setLimit(PAGE); }} className={selectCls} aria-label="Lọc theo người liên hệ">
          <option value="all">Mọi người liên hệ</option>
          {options.people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value as typeof type)} className={selectCls} aria-label="Lọc theo loại">
          <option value="all">Mọi loại</option>
          {INTERACTION_TYPES.map(t => <option key={t} value={t}>{INTERACTION_LABEL[t]}</option>)}
        </select>
        {options.branches.length > 0 && (
          <select value={branch} onChange={e => setBranch(e.target.value)} className={selectCls} aria-label="Lọc theo chi nhánh">
            <option value="all">Mọi chi nhánh</option>
            {options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {options.recorders.length > 0 && (
          <select value={recorder} onChange={e => setRecorder(e.target.value)} className={selectCls} aria-label="Lọc theo người ghi">
            <option value="all">Mọi người ghi</option>
            {options.recorders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-[#444] cursor-pointer min-h-[36px] md:min-h-0">
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          Có việc đang mở
        </label>
        {filtersOn && (
          <button type="button" onClick={() => { setSearch(''); setPerson('all'); setOpenOnly(false); setRecorder('all'); setType('all'); setBranch('all'); }}
            className="text-[12px] text-[#888] hover:text-[#333] min-h-[36px] md:min-h-0">Xoá lọc</button>
        )}
        <span className="text-[11.5px] text-[#aaa] ml-auto">{filtered.length} dòng</span>
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] divide-y divide-[#F0EFEB]">
        {shown.length === 0 && (
          <p className="py-10 text-center text-[12.5px] text-[#aaa] flex flex-col items-center gap-1.5">
            <NotebookText size={18} /> {logs.length ? 'Không có dòng nào khớp bộ lọc.' : 'Chưa có nhật ký nào — bấm "Ghi tương tác".'}
          </p>
        )}
        {shown.map(i => {
          const w = whoOf(i);
          const Icon = INTERACTION_ICON[i.type];
          const hasFollowUp = i.followUpAction.trim() !== '';
          const late = hasFollowUp && !i.followUpDone && i.followUpDue ? diffDays(i.followUpDue, today) : null;
          return (
            <div key={i.id} className="flex gap-3 px-3.5 md:px-4 py-3">
              <span className="w-9 h-9 shrink-0 rounded-full bg-[#EFF6FF] text-[#1D4ED8] flex items-center justify-center mt-0.5"><Icon size={15} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  {i.contactId && contactById.has(i.contactId) ? (
                    <button type="button" onClick={() => openProfile(i.contactId as string)} className="text-[13px] font-semibold text-[#111] hover:text-[#1D4ED8]">{w.name}</button>
                  ) : <span className="text-[13px] font-semibold text-[#111]">{w.name}</span>}
                  {w.company && <span className="text-[11.5px] text-[#999]">· {w.company}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-[#888]">
                  <span className="font-medium text-[#555]">{INTERACTION_LABEL[i.type]}</span>
                  {i.channel && <span>· {CHANNEL_LABEL[i.channel]}</span>}
                  {i.initiatedBy === 'them' && <span className="px-1.5 rounded-full bg-violet-50 text-violet-700">Họ chủ động</span>}
                  <span>· {formatDateVN(i.occurredAt)} ({relativeDayLabel(i.occurredAt, today).toLowerCase()})</span>
                  {i.createdByName && <span>· ghi bởi {i.createdByName}</span>}
                </div>
                {i.content && <p className="text-[12.5px] text-[#333] mt-1 whitespace-pre-line break-words">{i.content}</p>}
                {hasFollowUp && (
                  <div className={`mt-1.5 flex items-start gap-2 rounded-lg px-2.5 py-1.5 ${i.followUpDone ? 'bg-[#F7F6F2]' : 'bg-amber-50 border border-amber-200'}`}>
                    <button type="button" disabled={busyId === i.id} onClick={() => toggleDone(i)}
                      aria-label={i.followUpDone ? `Mở lại: ${i.followUpAction}` : `Đánh dấu xong: ${i.followUpAction}`}
                      className={`w-7 h-7 md:w-5 md:h-5 shrink-0 rounded-full border-2 flex items-center justify-center disabled:opacity-50 ${i.followUpDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-[#D1D5DB] text-transparent hover:border-emerald-500 hover:text-emerald-600'}`}>
                      <Check size={12} strokeWidth={3} />
                    </button>
                    <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
                      <span className={i.followUpDone ? 'text-[#999] line-through' : 'text-[#333]'}>{i.followUpAction}</span>
                      <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                        {i.followUpDone ? <span className="px-1.5 rounded-full text-[10.5px] font-medium bg-emerald-50 text-emerald-700">Đã xong</span>
                          : <span className="px-1.5 rounded-full text-[10.5px] font-medium bg-amber-100 text-amber-800">Đang chờ</span>}
                        {late !== null && late > 0 && <span className="px-1.5 rounded-full text-[10.5px] font-semibold bg-red-100 text-red-700">Trễ hạn {late} ngày</span>}
                        {late === 0 && <span className="px-1.5 rounded-full text-[10.5px] font-semibold bg-amber-100 text-amber-800">Hạn hôm nay</span>}
                        {i.followUpDue && (late === null || late < 0) && <span className="text-[10.5px] text-[#999]">hạn {formatDateVN(i.followUpDue)}</span>}
                        {i.followUpTaskId && <span className="text-[10.5px] text-[#999]">· có việc trong Workspace</span>}
                      </span>
                    </span>
                  </div>
                )}
              </div>
              <button type="button" disabled={busyId === i.id} onClick={() => remove(i)} title="Xoá dòng nhật ký" aria-label="Xoá dòng nhật ký"
                className="shrink-0 w-9 h-9 md:w-7 md:h-7 rounded-lg text-[#bbb] hover:text-red-600 hover:bg-red-50 flex items-center justify-center disabled:opacity-50">
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        {filtered.length > shown.length && (
          <div className="px-3 py-2 text-center">
            <button type="button" onClick={() => setLimit(limit + PAGE)} className="text-[12.5px] text-[#1D4ED8] font-medium min-h-[36px]">
              Hiện thêm {Math.min(PAGE, filtered.length - shown.length)} dòng (còn {filtered.length - shown.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
