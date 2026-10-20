// ============================================================================
// Ma trận Khách hàng (port PRM ContactMatrixPage) — thay tab "Danh sách liên hệ" cũ.
// ----------------------------------------------------------------------------
//   • Bảng nhiệt Nhóm × Trạng thái — bấm ô để lọc ngay
//   • Tìm không dấu · Phạm vi Đang chăm sóc / Chưa chăm sóc / Đã nghỉ / Tất cả
//   • Bộ lọc dạng viên: Nhóm, Trạng thái, Chi nhánh, Người phụ trách, Loại khách,
//     Công ty, Tỉnh + hàng chip bộ lọc đang bật
//   • BẢNG sắp xếp được, chip nhóm bấm để đổi nhanh, "Hiện thêm" cho danh bạ lớn
//   • Chọn nhiều → Xếp vào nhóm / Bỏ chăm sóc / Đổi người phụ trách / Gắn thêm công ty /
//     Đánh dấu nghỉ / Xoá vĩnh viễn (admin) — giữ đủ thao tác của Danh sách liên hệ cũ
// Loại khách mặc định "Đang hợp tác" (chốt 19/10/2026), hiện thành chip để bỏ được.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Grid3x3, Layers, Plus, Search, Star, UserPlus, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { usePersistedState } from '../../hooks/usePersistedState';
import { branchOf } from '../../lib/branchRef';
import { addContactClient, deactivateContact, deleteContact } from '../../lib/contactOps';
import { buildContactStats, CARE_STATUS_LABEL, dueLabel, type CareStatus, type ContactStats } from '../../lib/cskh/cadence';
import { relativeDayLabel, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { contactSearchHaystack, matchesQuery } from '../../lib/cskh/search';
import { isCooperatingClient } from '../../lib/cskh/seedTiers';
import type { CskhContact } from '../../lib/cskh/types';
import { CLASSIFIED_TIERS, TIER_LABEL } from '../../lib/cskh/types';
import { compareVnName } from '../../lib/vnName';
import ContactFormModal from '../../components/contacts/ContactFormModal';
import { assignGroups, setOwner } from './data/api';
import { useCskh } from './context';
import {
  CARE_STATUS_COLOR, chipStyle, GROUP_COLOR, groupDisplayOf, NEW_GROUP_VALUE, resolveGroupKey, scoreColor, TIER_COLOR,
} from './ui';
import { MigrationBanner, Spinner } from './components/Card';
import { ContactAvatar } from './components/ContactAvatar';
import { GroupOptions, QuickGroupSelect } from './components/GroupSelect';

type ActiveStatus = Exclude<CareStatus, 'unclassified'>;
const STATUSES: readonly ActiveStatus[] = ['overdue', 'due_soon', 'ok'];

/** Phạm vi: đang chăm sóc (mặc định) / chưa chăm sóc / đã nghỉ (rời công ty khách) / tất cả. */
type Scope = 'care' | 'other' | 'left' | 'all';
const SCOPE_LABEL: Readonly<Record<Scope, string>> = { care: 'Đang chăm sóc', other: 'Chưa chăm sóc', left: 'Đã nghỉ', all: 'Tất cả' };
const SCOPES: Scope[] = ['care', 'other', 'left', 'all'];

/** Loại khách của các công ty người này phụ trách. */
type ClientKind = 'cooperating' | 'suspended' | 'prospect' | 'unlinked';
const KIND_LABEL: Readonly<Record<ClientKind, string>> = {
  cooperating: 'Đang hợp tác', suspended: 'Ngưng hợp tác', prospect: 'Tiềm năng', unlinked: 'Chưa gắn công ty',
};

type SortKey = 'due' | 'name' | 'recent' | 'score';
type SortDir = 'asc' | 'desc';
const SORT_OPTIONS: ReadonlyArray<{ value: `${SortKey}:${SortDir}`; label: string }> = [
  { value: 'due:asc', label: 'Hạn chăm sóc gấp nhất' },
  { value: 'due:desc', label: 'Hạn chăm sóc xa nhất' },
  { value: 'score:asc', label: 'Điểm thấp → cao' },
  { value: 'score:desc', label: 'Điểm cao → thấp' },
  { value: 'recent:desc', label: 'Tương tác mới nhất' },
  { value: 'recent:asc', label: 'Lâu chưa tương tác' },
  { value: 'name:asc', label: 'Tên A → Z' },
  { value: 'name:desc', label: 'Tên Z → A' },
];
const DEFAULT_DIR: Readonly<Record<SortKey, SortDir>> = { due: 'asc', name: 'asc', recent: 'desc', score: 'asc' };

/** Chỉ vẽ bấy nhiêu dòng mỗi lần — danh bạ lớn vẫn mượt trên iPhone. */
const PAGE = 60;

interface Filters {
  scope: Scope;
  group: string;        // 'all' | khoá nhóm
  status: 'all' | ActiveStatus;
  branch: string;       // 'all' | branch id
  owner: string;        // 'all' | 'none' | user id
  kind: 'all' | ClientKind;
  company: string;      // 'all' | client id
  province: string;     // 'all' | tên tỉnh
}
const DEFAULT_FILTERS: Filters = {
  scope: 'care', group: 'all', status: 'all', branch: 'all', owner: 'all', kind: 'cooperating', company: 'all', province: 'all',
};
type Dim = keyof Filters | 'search';

function sortValue(c: CskhContact, st: ContactStats | undefined, key: SortKey): number | string | null {
  switch (key) {
    case 'due': return st?.daysUntilDue ?? null;
    case 'score': return st?.score?.total ?? null;
    case 'recent': return c.lastInteractionAt;
    case 'name': return c.fullName;
  }
}

/** Ô chọn dạng viên thuốc — tô xanh khi đang lọc. */
function PillSelect({ value, active, label, onChange, children }: {
  value: string; active: boolean; label: string; onChange: (v: string) => void; children: ReactNode;
}) {
  return (
    <span className={`relative inline-flex items-center rounded-full border h-9 md:h-8 ${active ? 'border-[#1D4ED8] bg-blue-50 text-[#1D4ED8]' : 'border-[#E0DFDA] bg-white text-[#555]'}`}>
      <select value={value} aria-label={label} onChange={e => onChange(e.target.value)}
        className="appearance-none bg-transparent pl-3 pr-7 h-full text-[12px] font-medium outline-none cursor-pointer max-w-[200px]">
        {children}
      </select>
      <ChevronDown size={13} className="absolute right-2 pointer-events-none" />
    </span>
  );
}

const bulkSelectCls = 'text-[12px] h-9 md:h-8 px-2 rounded-lg border border-blue-200 bg-white outline-none max-w-[200px]';

export default function CskhMatrix() {
  const { data, loading, clients, toast, openProfile, openLog, openPicker, openGroups } = useCskh();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { branches } = useBranchLookup();
  const [storedFilters, setFilters] = usePersistedState<Filters>('cskh_matrix_filters', DEFAULT_FILTERS);
  // Bộ lọc lưu từ phiên bản cũ có thể thiếu khoá mới → luôn trộn với mặc định
  const filters: Filters = { ...DEFAULT_FILTERS, ...storedFilters };
  const [search, setSearch] = useState('');
  const [sort, setSort] = usePersistedState<{ key: SortKey; dir: SortDir }>('cskh_matrix_sort', { key: 'due', dir: 'asc' });
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [showMatrix, setShowMatrix] = usePersistedState('cskh_matrix_heat_open', true);
  const [creating, setCreating] = useState(false);
  const today = todayVN();

  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const cadence = data?.settings.cadence;
  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const userName = useMemo(() => new Map((data?.users ?? []).map(u => [u.id, u.full_name])), [data]);

  const stats = useMemo(
    () => (data && cadence ? buildContactStats(contacts, data.interactions, data.gifts, data.occasions, cadence, today) : new Map<string, ContactStats>()),
    [data, contacts, cadence, today],
  );

  // Tính một lần cho cả danh bạ: khoá nhóm, chi nhánh, loại khách, chuỗi tìm kiếm
  const derived = useMemo(() => new Map(contacts.map(c => {
    const branchIds = new Set<string>();
    const branchNames: string[] = [];
    const kinds = new Set<ClientKind>();
    for (const id of c.clientIds) {
      const cl = clientById.get(id);
      const b = branchOf(cl ?? null, branches);
      if (b && !branchIds.has(b.id)) { branchIds.add(b.id); branchNames.push(b.name); }
      if (!cl) continue;
      if (isCooperatingClient(cl)) kinds.add('cooperating');
      else if (cl.client_type === 'active') kinds.add('suspended');
      else kinds.add('prospect');
    }
    if (!c.clientIds.length) kinds.add('unlinked');
    return [c.id, {
      groupKey: groupDisplayOf(c, groupById).key,
      branchIds,
      branchNames,
      kinds,
      haystack: contactSearchHaystack(c, branchNames),
    }] as const;
  })), [contacts, clientById, branches, groupById]);

  const passes = (c: CskhContact, skip: readonly Dim[] = []): boolean => {
    const on = (d: Dim) => !skip.includes(d);
    const d = derived.get(c.id);
    if (!d) return false;
    if (on('scope')) {
      if (filters.scope === 'care' && (c.tier === 'unclassified' || c.isArchived)) return false;
      if (filters.scope === 'other' && (c.tier !== 'unclassified' || c.isArchived)) return false;
      if (filters.scope === 'left' && !c.isArchived) return false;
    }
    if (on('group') && filters.group !== 'all' && d.groupKey !== filters.group) return false;
    if (on('status') && filters.status !== 'all' && stats.get(c.id)?.status !== filters.status) return false;
    if (on('branch') && filters.branch !== 'all' && !d.branchIds.has(filters.branch)) return false;
    if (on('owner') && filters.owner !== 'all' && (filters.owner === 'none' ? c.ownerId !== null : c.ownerId !== filters.owner)) return false;
    if (on('kind') && filters.kind !== 'all' && !d.kinds.has(filters.kind)) return false;
    if (on('company') && filters.company !== 'all' && !c.clientIds.includes(filters.company)) return false;
    if (on('province') && filters.province !== 'all' && c.province !== filters.province) return false;
    if (on('search') && search.trim() && !matchesQuery(d.haystack, search)) return false;
    return true;
  };

  const filtered = contacts.filter(c => passes(c));
  const sorted = [...filtered].sort((a, b) => {
    const va = sortValue(a, stats.get(a.id), sort.key);
    const vb = sortValue(b, stats.get(b.id), sort.key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    let cmp = 0;
    if (va !== null && vb !== null) {
      cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : sort.key === 'name' ? compareVnName(String(va), String(vb)) : String(va).localeCompare(String(vb), 'vi');
    }
    if (sort.dir === 'desc') cmp = -cmp;
    return cmp || compareVnName(a.fullName, b.fullName);
  });
  const visible = sorted.slice(0, limit);
  // Đang tìm mà người cần tìm nằm ở phạm vi / loại khách khác → gợi ý mở rộng
  const outside = search.trim() ? contacts.filter(c => passes(c, ['scope', 'kind'])).length - filtered.length : 0;

  // ── Bảng nhiệt Nhóm × Trạng thái: người đang chăm sóc, theo các bộ lọc trừ nhóm/trạng thái/tìm ──
  const matrix = (() => {
    const rows = [
      ...CLASSIFIED_TIERS.map(t => ({ key: t as string, label: TIER_LABEL[t], color: TIER_COLOR[t] })),
      ...groups.map(g => ({ key: `g:${g.id}`, label: g.name, color: GROUP_COLOR[g.color] })),
    ].map(r => ({ ...r, cells: { overdue: 0, due_soon: 0, ok: 0 } as Record<ActiveStatus, number>, total: 0, sum: 0, n: 0 }));
    const byKey = new Map(rows.map(r => [r.key, r]));
    const colTotal: Record<ActiveStatus, number> = { overdue: 0, due_soon: 0, ok: 0 };
    for (const c of contacts) {
      if (c.tier === 'unclassified' || c.isArchived) continue;
      if (!passes(c, ['scope', 'group', 'status', 'search'])) continue;
      const st = stats.get(c.id);
      const row = byKey.get(derived.get(c.id)?.groupKey ?? c.tier);
      if (!st || st.status === 'unclassified' || !row) continue;
      row.cells[st.status] += 1;
      row.total += 1;
      colTotal[st.status] += 1;
      if (st.score) { row.sum += st.score.total; row.n += 1; }
    }
    const shown = rows.filter(r => r.total > 0);
    const max = Math.max(1, ...shown.flatMap(r => STATUSES.map(s => r.cells[s])));
    return { rows: shown, colTotal, max };
  })();

  // ── Tuỳ chọn bộ lọc (chỉ những giá trị đang có trong danh bạ) ──
  const options = useMemo(() => {
    const bIds = new Set<string>();
    const cIds = new Set<string>();
    const provinces = new Set<string>();
    for (const c of contacts) {
      derived.get(c.id)?.branchIds.forEach(id => bIds.add(id));
      c.clientIds.forEach(id => cIds.add(id));
      if (c.province) provinces.add(c.province);
    }
    return {
      branches: branches.filter(b => bIds.has(b.id)),
      companies: clients.filter(c => cIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
      provinces: [...provinces].sort((a, b) => a.localeCompare(b, 'vi')),
    };
  }, [contacts, derived, branches, clients]);
  const clientsSorted = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [clients]);

  // ── Chọn hàng loạt ──
  const selectedIds = [...selected].filter(id => contacts.some(c => c.id === id));
  const visibleSelected = visible.filter(c => selected.has(c.id)).length;
  const headCheck = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headCheck.current) headCheck.current.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
  }, [visibleSelected, visible.length]);
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleVisible = () => setSelected(prev => {
    const next = new Set(prev);
    const allOn = visible.length > 0 && visible.every(c => next.has(c.id));
    for (const c of visible) { if (allOn) next.delete(c.id); else next.add(c.id); }
    return next;
  });

  const setFilter = (patch: Partial<Filters>) => { setFilters({ ...filters, ...patch }); setLimit(PAGE); };

  const run = async (fn: () => Promise<string>, clear = true) => {
    setBusy(true);
    try {
      toast(await fn());
      if (clear) setSelected(new Set());
      emitCskhDataChanged();
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Xếp 1 hoặc nhiều người vào 1 nhóm (nhóm mặc định hoặc nhóm tự tạo). */
  const assignGroup = (ids: readonly string[], key: string, oneName?: string) => {
    if (key === NEW_GROUP_VALUE) { openGroups(); return; }
    const t = resolveGroupKey(key, groupById);
    if (!t || !ids.length) return;
    const who = oneName ?? `${ids.length} người`;
    if (t.tier === 'unclassified' && ids.length > 1 && !confirm(
      `Bỏ ${who} khỏi danh sách chăm sóc?\nHọ vẫn ở trong danh bạ, chỉ không còn được nhắc liên hệ, sinh nhật và chấm điểm. Chọn lại được bất cứ lúc nào.`,
    )) return;
    void run(async () => {
      await assignGroups(ids.map(id => ({ contactId: id, tier: t.tier, groupId: t.groupId })), user);
      return t.tier === 'unclassified' ? `Đã bỏ ${who} khỏi danh sách chăm sóc` : `Đã xếp ${who} vào nhóm ${t.label}`;
    }, ids.length > 1);
  };

  const rawOf = (ids: readonly string[]) => ids.map(id => data?.rawContacts.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  const opCtx = { user, clientName: (id: string | null) => (id ? clientById.get(id)?.name ?? null : null) };

  const bulkLink = (clientId: string) => {
    if (!clientId) return;
    void run(async () => {
      for (const raw of rawOf(selectedIds)) await addContactClient(raw, clientId, opCtx);
      return `Đã gắn thêm ${selectedIds.length} người vào ${clientById.get(clientId)?.name ?? 'công ty'}`;
    });
  };
  const bulkDeactivate = () => {
    if (!confirm(`Đánh dấu ${selectedIds.length} người đã nghỉ (rời công ty khách)?\nHọ ra khỏi hàng đợi chăm sóc nhưng giữ nguyên hạng và toàn bộ lịch sử.`)) return;
    void run(async () => {
      for (const raw of rawOf(selectedIds)) if (raw.is_active) await deactivateContact(raw, opCtx);
      return `Đã đánh dấu nghỉ ${selectedIds.length} người`;
    });
  };
  const bulkDelete = () => {
    const list = rawOf(selectedIds);
    const names = list.slice(0, 5).map(c => `• ${c.name}`).join('\n');
    if (!confirm(
      `XOÁ VĨNH VIỄN ${list.length} liên hệ?\n\n${names}${list.length > 5 ? `\n… và ${list.length - 5} người nữa` : ''}\n\n` +
      'Nhật ký CSKH, thương vụ, quà tặng KHÔNG bị xoá (chỉ mất liên kết người), nhưng NGÀY ĐẶC BIỆT / SỰ KIỆN của họ SẼ BỊ XOÁ THEO.\n' +
      'Khôi phục được ở trang Lịch sử (Hoàn tác).\n\nMuốn giữ lại thì bấm Huỷ và chọn "Đánh dấu nghỉ".',
    )) return;
    void run(async () => {
      for (const raw of list) await deleteContact(raw, opCtx);
      return `Đã xoá vĩnh viễn ${list.length} người`;
    });
  };

  const sortBy = (key: SortKey) => setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] });
  const sortHead = (key: SortKey, label: string) => {
    const on = sort.key === key;
    const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button type="button" onClick={() => sortBy(key)} aria-label={`Sắp xếp theo ${label}`}
        className={`inline-flex items-center gap-1 ${on ? 'text-[#1D4ED8]' : 'hover:text-[#1D4ED8]'}`}>
        {label}{on && <Icon size={11} strokeWidth={2.6} />}
      </button>
    );
  };
  const pickCell = (group: string, status: Filters['status']) => {
    const same = filters.group === group && filters.status === status;
    setFilter({ group: same ? 'all' : group, status: same ? 'all' : status, scope: filters.scope === 'care' || filters.scope === 'all' ? filters.scope : 'care' });
  };

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.group !== 'all') chips.push({ label: `Nhóm: ${resolveGroupKey(filters.group, groupById)?.label ?? '?'}`, clear: () => setFilter({ group: 'all' }) });
  if (filters.status !== 'all') chips.push({ label: `Trạng thái: ${CARE_STATUS_LABEL[filters.status]}`, clear: () => setFilter({ status: 'all' }) });
  if (filters.branch !== 'all') chips.push({ label: `Chi nhánh: ${branches.find(b => b.id === filters.branch)?.name ?? '?'}`, clear: () => setFilter({ branch: 'all' }) });
  if (filters.owner !== 'all') chips.push({ label: `Phụ trách: ${filters.owner === 'none' ? 'chưa giao' : userName.get(filters.owner) ?? '?'}`, clear: () => setFilter({ owner: 'all' }) });
  if (filters.kind !== 'all') chips.push({ label: `Khách: ${KIND_LABEL[filters.kind]}`, clear: () => setFilter({ kind: 'all' }) });
  if (filters.company !== 'all') chips.push({ label: `Công ty: ${clientById.get(filters.company)?.name ?? '?'}`, clear: () => setFilter({ company: 'all' }) });
  if (filters.province !== 'all') chips.push({ label: filters.province, clear: () => setFilter({ province: 'all' }) });
  if (search.trim()) chips.push({ label: `"${search.trim()}"`, clear: () => setSearch('') });

  const careCount = contacts.filter(c => c.tier !== 'unclassified' && !c.isArchived).length;
  const avgCare = (() => {
    const scores = contacts.map(c => stats.get(c.id)?.score?.total).filter((s): s is number => typeof s === 'number');
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  })();

  if (!data) {
    return loading ? <Spinner /> : <p className="py-16 text-center text-[12.5px] text-[#999]">Chưa tải được dữ liệu CSKH.</p>;
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] md:text-[20px] font-bold text-[#111] leading-tight">Ma trận Khách hàng</h1>
          <p className="text-[12.5px] text-[#666] mt-0.5">
            {careCount} người đang chăm sóc · {contacts.length} người trong danh bạ{avgCare !== null && <> · điểm sức khỏe TB {avgCare}/100</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button type="button" onClick={openGroups}
            className="inline-flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg border border-gray-300 bg-white text-[12.5px] font-medium text-[#333]">
            <Layers size={14} /> Nhóm
          </button>
          <button type="button" onClick={openPicker}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg border border-gray-300 bg-white text-[12.5px] font-medium text-[#333]">
            <UserPlus size={14} /> Chọn người chăm sóc
          </button>
          <button type="button" onClick={() => setCreating(true)}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg bg-[#1D4ED8] text-white text-[12.5px] font-semibold">
            <Plus size={14} /> Thêm liên hệ
          </button>
        </div>
      </header>

      {!data.migrationReady && <MigrationBanner />}

      {/* ── Nhóm × Trạng thái ── */}
      {careCount > 0 && (
        <section className="bg-white border border-[#E8E7E2] rounded-[10px]" aria-label="Nhóm và trạng thái chăm sóc">
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
            <h2 className="text-[13px] font-semibold text-[#111] flex items-center gap-1.5 mr-auto"><Grid3x3 size={14} className="text-[#888]" /> Nhóm × Trạng thái</h2>
            {STATUSES.map(s => {
              const on = filters.group === 'all' && filters.status === s;
              return (
                <button key={s} type="button" onClick={() => pickCell('all', s)} disabled={matrix.colTotal[s] === 0 && !on}
                  className={`inline-flex items-center gap-1 h-8 md:h-7 px-2.5 rounded-full text-[11.5px] font-medium border disabled:opacity-40 ${on ? 'border-current' : 'border-transparent'}`}
                  style={chipStyle(CARE_STATUS_COLOR[s])}>
                  {CARE_STATUS_LABEL[s]} <b>{matrix.colTotal[s]}</b>
                </button>
              );
            })}
            <button type="button" onClick={() => setShowMatrix(!showMatrix)} aria-expanded={showMatrix}
              className="inline-flex items-center gap-0.5 text-[12px] text-[#1D4ED8] min-h-[32px]">
              {showMatrix ? <>Thu gọn <ChevronUp size={13} /></> : <>Chi tiết <ChevronDown size={13} /></>}
            </button>
          </div>
          {showMatrix && (matrix.rows.length === 0
            ? <p className="px-4 pb-4 text-[12px] text-[#aaa]">Không có ai đang chăm sóc khớp bộ lọc đang chọn.</p>
            : (
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[12px] min-w-[460px]">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-wide text-[#999]">
                      <th className="text-left font-semibold px-2 py-1">Nhóm</th>
                      {STATUSES.map(s => <th key={s} className="font-semibold px-1 py-1">{CARE_STATUS_LABEL[s]}</th>)}
                      <th className="font-semibold px-2 py-1 text-right">Tổng</th>
                      <th className="font-semibold px-2 py-1 text-right">Điểm TB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map(r => {
                      const avg = r.n ? Math.round(r.sum / r.n) : null;
                      return (
                        <tr key={r.key}>
                          <td className="px-2 py-1">
                            <button type="button" onClick={() => pickCell(r.key, 'all')}
                              className={`inline-flex items-center gap-1.5 rounded px-1 min-h-[32px] md:min-h-0 ${filters.group === r.key && filters.status === 'all' ? 'bg-blue-50 text-[#1D4ED8] font-semibold' : 'hover:text-[#1D4ED8]'}`}>
                              <i className="w-2 h-2 rounded-full" style={{ background: r.color }} />{r.label}
                            </button>
                          </td>
                          {STATUSES.map(s => {
                            const n = r.cells[s];
                            const on = filters.group === r.key && filters.status === s;
                            const alpha = n === 0 ? 0 : Math.round(26 + 76 * (n / matrix.max));
                            return (
                              <td key={s} className="px-1 py-1">
                                <button type="button" disabled={n === 0 && !on} onClick={() => pickCell(r.key, s)} aria-pressed={on}
                                  aria-label={`${r.label} · ${CARE_STATUS_LABEL[s]}: ${n} người`}
                                  className={`w-full h-9 md:h-8 rounded-md text-[12.5px] font-semibold ${on ? 'ring-2 ring-[#1D4ED8]' : ''}`}
                                  style={{ background: n ? `${CARE_STATUS_COLOR[s]}${alpha.toString(16).padStart(2, '0')}` : '#F7F6F2', color: n ? CARE_STATUS_COLOR[s] : '#ccc' }}>
                                  {n || '–'}
                                </button>
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-right font-medium">{r.total}</td>
                          <td className="px-2 py-1 text-right">
                            {avg === null ? <span className="text-[#ccc]">–</span> : <b style={{ color: scoreColor(avg) }}>{avg}</b>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
      )}

      {/* ── Tìm + phạm vi + bộ lọc ── */}
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setLimit(PAGE); }}
              placeholder="Tìm tên, công ty, SĐT, email, chi nhánh… (gõ không dấu được)"
              className="w-full pl-8 pr-3 h-10 md:h-8 rounded-lg border border-gray-300 text-[13px] outline-none focus:border-blue-500" />
          </div>
          <div className="flex gap-0.5 bg-[#F4F3EF] border border-[#E8E7E2] rounded-lg p-0.5 overflow-x-auto no-scrollbar max-w-full" role="group" aria-label="Phạm vi">
            {SCOPES.map(s => (
              <button key={s} type="button" onClick={() => { setFilter({ scope: s, ...(s === 'other' || s === 'left' ? { group: 'all', status: 'all' } : {}) }); setSelected(new Set()); }}
                aria-pressed={filters.scope === s}
                className={`px-3 h-9 md:h-7 rounded-md text-[12px] whitespace-nowrap ${filters.scope === s ? 'bg-white text-[#333] font-medium border border-[#E0DFDA]' : 'text-[#888]'}`}>
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <PillSelect value={filters.group} active={filters.group !== 'all'} label="Lọc theo nhóm" onChange={v => setFilter({ group: v })}>
            <option value="all">Mọi nhóm</option>
            <GroupOptions groups={groups} />
          </PillSelect>
          <PillSelect value={filters.status} active={filters.status !== 'all'} label="Lọc theo trạng thái" onChange={v => setFilter({ status: v as Filters['status'] })}>
            <option value="all">Mọi trạng thái</option>
            {STATUSES.map(s => <option key={s} value={s}>{CARE_STATUS_LABEL[s]}</option>)}
          </PillSelect>
          {options.branches.length > 0 && (
            <PillSelect value={filters.branch} active={filters.branch !== 'all'} label="Lọc theo chi nhánh" onChange={v => setFilter({ branch: v })}>
              <option value="all">Mọi chi nhánh</option>
              {options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </PillSelect>
          )}
          <PillSelect value={filters.owner} active={filters.owner !== 'all'} label="Lọc theo người phụ trách" onChange={v => setFilter({ owner: v })}>
            <option value="all">Mọi người phụ trách</option>
            <option value="none">Chưa giao</option>
            {data.users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </PillSelect>
          <PillSelect value={filters.kind} active={filters.kind !== 'all'} label="Lọc theo loại khách" onChange={v => setFilter({ kind: v as Filters['kind'] })}>
            <option value="all">Mọi loại khách</option>
            {(Object.keys(KIND_LABEL) as ClientKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </PillSelect>
          <PillSelect value={filters.company} active={filters.company !== 'all'} label="Lọc theo công ty" onChange={v => setFilter({ company: v })}>
            <option value="all">Mọi công ty</option>
            {options.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </PillSelect>
          {options.provinces.length > 0 && (
            <PillSelect value={filters.province} active={filters.province !== 'all'} label="Lọc theo tỉnh" onChange={v => setFilter({ province: v })}>
              <option value="all">Mọi tỉnh</option>
              {options.provinces.map(p => <option key={p} value={p}>{p}</option>)}
            </PillSelect>
          )}
          <span className="ml-auto inline-flex items-center gap-1.5">
            <select value={`${sort.key}:${sort.dir}`} aria-label="Sắp xếp"
              onChange={e => { const [k, d] = e.target.value.split(':') as [SortKey, SortDir]; setSort({ key: k, dir: d }); }}
              className="text-[12px] h-9 md:h-8 px-2 rounded-lg border border-gray-300 bg-white outline-none">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </span>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map(ch => (
              <span key={ch.label} className="inline-flex items-center gap-1 h-8 md:h-6 pl-2.5 pr-1 rounded-full bg-blue-50 text-[#1D4ED8] text-[11.5px] font-medium">
                {ch.label}
                <button type="button" onClick={ch.clear} aria-label={`Bỏ lọc ${ch.label}`} className="w-6 h-6 md:w-4 md:h-4 rounded-full hover:bg-blue-100 flex items-center justify-center"><X size={11} /></button>
              </span>
            ))}
            <button type="button" onClick={() => { setFilters({ ...DEFAULT_FILTERS, scope: filters.scope, kind: 'all' }); setSearch(''); setLimit(PAGE); }}
              className="text-[11.5px] text-[#888] hover:text-[#333] px-1 min-h-[32px] md:min-h-0">Xoá tất cả</button>
            <span className="text-[11.5px] text-[#aaa] ml-auto">{filtered.length} người</span>
          </div>
        )}
        {outside > 0 && (
          <p className="text-[12px] text-[#92400E]">
            Còn {outside} người khớp "{search.trim()}" ở phạm vi / loại khách khác —{' '}
            <button type="button" onClick={() => setFilter({ scope: 'all', kind: 'all' })} className="underline font-medium">tìm trong tất cả</button>
          </p>
        )}
      </div>

      {/* ── Thanh thao tác hàng loạt ── */}
      {selectedIds.length > 0 && (
        <div className="sticky top-0 z-10 bg-blue-50 border border-blue-200 rounded-[10px] p-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-blue-900">Đã chọn {selectedIds.length}</span>
          <select value="" disabled={busy} aria-label="Xếp vào nhóm" onChange={e => assignGroup(selectedIds, e.target.value)} className={bulkSelectCls}>
            <option value="">Xếp vào nhóm…</option>
            <GroupOptions groups={groups} cadence={cadence} allowCreate />
          </select>
          <select value="" disabled={busy} aria-label="Đổi người phụ trách"
            onChange={e => {
              const v = e.target.value;
              if (!v) return;
              const owner = v === 'none' ? null : v;
              void run(async () => { await setOwner(selectedIds, owner, user); return `Đã đổi người phụ trách cho ${selectedIds.length} người`; });
            }} className={bulkSelectCls}>
            <option value="">Đổi người phụ trách…</option>
            <option value="none">— Chưa giao —</option>
            {data.users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <select value="" disabled={busy} aria-label="Gắn thêm công ty" onChange={e => bulkLink(e.target.value)} className={bulkSelectCls}>
            <option value="">Gắn thêm công ty…</option>
            {clientsSorted.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" disabled={busy} onClick={bulkDeactivate} className="h-9 md:h-8 px-2.5 rounded-lg border border-amber-300 bg-white text-amber-700 text-[12px] font-medium">Đánh dấu nghỉ</button>
          {isAdmin && (
            <button type="button" disabled={busy} onClick={bulkDelete} className="h-9 md:h-8 px-2.5 rounded-lg border border-red-300 bg-white text-red-700 text-[12px] font-medium">Xoá vĩnh viễn</button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="text-[12px] text-blue-700 hover:underline ml-auto min-h-[32px]">Bỏ chọn</button>
        </div>
      )}

      {/* ── Bảng ── */}
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#E8E7E2] bg-[#F9F9F7] text-[11px] text-[#777]">
                <th className="px-3 py-2 w-8">
                  <input ref={headCheck} type="checkbox" className="w-4 h-4 accent-blue-600 align-middle" aria-label="Chọn các dòng đang hiện"
                    checked={visible.length > 0 && visibleSelected === visible.length} onChange={toggleVisible} disabled={!visible.length} />
                </th>
                <th className="text-left font-semibold px-2 py-2">{sortHead('name', 'Liên hệ')}</th>
                <th className="text-left font-semibold px-2 py-2 hidden md:table-cell">Nhóm</th>
                <th className="text-left font-semibold px-2 py-2 hidden lg:table-cell">Chi nhánh / Tỉnh</th>
                <th className="text-left font-semibold px-2 py-2 hidden md:table-cell">{sortHead('recent', 'Tương tác cuối')}</th>
                <th className="text-left font-semibold px-2 py-2 hidden sm:table-cell">{sortHead('due', 'Hạn chăm sóc')}</th>
                <th className="text-right font-semibold px-2 py-2">{sortHead('score', 'Điểm')}</th>
                <th className="text-left font-semibold px-2 py-2 hidden xl:table-cell">Phụ trách</th>
                <th className="px-2 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-[12.5px] text-[#aaa]">
                  {contacts.length === 0 ? 'Chưa có người liên hệ nào — bấm "Thêm liên hệ".' : 'Không có ai khớp bộ lọc.'}
                </td></tr>
              ) : visible.map(c => {
                const st = stats.get(c.id);
                const d = derived.get(c.id);
                const isPrimary = c.primaryClientIds.length > 0;
                return (
                  <tr key={c.id} className={`border-b border-[#F0EFEB] last:border-0 hover:bg-[#FAFAF8] ${selected.has(c.id) ? 'bg-blue-50/50' : ''} ${c.isArchived ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2 align-middle">
                      <input type="checkbox" className="w-4 h-4 accent-blue-600 align-middle" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Chọn ${c.fullName}`} />
                    </td>
                    <td className="px-2 py-2 min-w-[180px]">
                      <button type="button" onClick={() => openProfile(c.id)} className="flex items-center gap-2 text-left group/name">
                        <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={34} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1">
                            <b className="text-[13px] text-[#111] group-hover/name:text-[#1D4ED8] truncate max-w-[200px]">{c.fullName}</b>
                            {isPrimary && <Star size={12} className="text-amber-500 fill-amber-500 shrink-0" aria-label="Liên hệ chính" />}
                            {c.isArchived && <span className="px-1.5 rounded-full text-[10px] bg-gray-100 text-gray-600">Đã nghỉ</span>}
                          </span>
                          <span className="block text-[11px] text-[#999] truncate max-w-[240px]">
                            {[c.organization || 'Chưa gắn công ty', c.jobTitle].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </button>
                      {/* Điện thoại: nhóm + hạn nằm dưới tên */}
                      <div className="md:hidden flex flex-wrap items-center gap-1.5 mt-1 pl-[42px]">
                        <QuickGroupSelect contact={c} groups={groups} groupById={groupById} cadence={cadence} disabled={busy}
                          onPick={k => assignGroup([c.id], k, c.fullName)} onCreate={openGroups} />
                        {st && st.status !== 'unclassified' && (
                          <span className="text-[11px] font-medium" style={{ color: CARE_STATUS_COLOR[st.status] }}>{dueLabel(st)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 hidden md:table-cell">
                      <QuickGroupSelect contact={c} groups={groups} groupById={groupById} cadence={cadence} disabled={busy}
                        onPick={k => assignGroup([c.id], k, c.fullName)} onCreate={openGroups} />
                    </td>
                    <td className="px-2 py-2 hidden lg:table-cell text-[11.5px] text-[#666]">
                      {d?.branchNames.join(', ') || c.province || <span className="text-[#ccc]">—</span>}
                    </td>
                    <td className="px-2 py-2 hidden md:table-cell text-[11.5px] text-[#666] whitespace-nowrap">
                      {c.lastInteractionAt ? relativeDayLabel(c.lastInteractionAt, today) : <span className="text-[#ccc]">—</span>}
                    </td>
                    <td className="px-2 py-2 hidden sm:table-cell whitespace-nowrap">
                      {st && st.status !== 'unclassified'
                        ? <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={chipStyle(CARE_STATUS_COLOR[st.status])}>{dueLabel(st)}</span>
                        : <span className="text-[#ccc]">—</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {st?.score ? <b className="text-[13px]" style={{ color: scoreColor(st.score.total) }}>{st.score.total}</b> : <span className="text-[#ccc]">–</span>}
                    </td>
                    <td className="px-2 py-2 hidden xl:table-cell text-[11.5px] text-[#666] whitespace-nowrap">
                      {c.ownerId ? userName.get(c.ownerId) ?? '—' : <span className="text-[#bbb]">Chưa giao</span>}
                    </td>
                    <td className="px-2 py-2">
                      {!c.isArchived && (
                        <button type="button" onClick={() => openLog(c.id)} title="Ghi tương tác" aria-label={`Ghi tương tác với ${c.fullName}`}
                          className="w-9 h-9 md:w-7 md:h-7 rounded-lg border border-[#E8E7E2] bg-white text-[#666] hover:text-[#1D4ED8] hover:border-blue-200 flex items-center justify-center">
                          <Plus size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sorted.length > limit && (
          <div className="border-t border-[#F0EFEB] px-3 py-2 text-center">
            <button type="button" onClick={() => setLimit(limit + PAGE)} className="text-[12.5px] text-[#1D4ED8] font-medium min-h-[36px]">
              Hiện thêm {Math.min(PAGE, sorted.length - limit)} người (còn {sorted.length - limit})
            </button>
          </div>
        )}
      </div>

      {/* ── Thêm liên hệ (form chung với hồ sơ Khách hàng) → mở luôn hồ sơ CSKH ── */}
      {creating && (
        <ContactFormModal contact={null} clients={clients} toast={toast} onClose={() => setCreating(false)}
          onSaved={saved => { setCreating(false); emitCskhDataChanged(); openProfile(saved.id); }} />
      )}
    </div>
  );
}
