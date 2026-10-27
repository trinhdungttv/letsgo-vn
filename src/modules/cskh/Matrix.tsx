// ============================================================================
// Ma trận Khách hàng (port PRM ContactMatrixPage) — thay tab "Danh sách liên hệ" cũ.
// ----------------------------------------------------------------------------
//   • Bảng nhiệt Nhóm × Trạng thái — bấm ô để lọc ngay
//   • Tìm không dấu (khớp cả sở thích, thói quen, tính cách, tên trường, quê) · Phạm vi
//     Đang chăm sóc / Danh bạ khác / Cả danh bạ / Đã nghỉ — danh bạ chỉ là nguồn để chọn
//   • Bộ lọc dạng viên: Nhóm, Trạng thái, Giới tính (kèm "Gợi ý Nữ/Nam theo tên"), Đặc điểm
//     (Golf (5)…), Chi nhánh, Người phụ trách, Loại khách, Công ty, Tỉnh + chip bộ lọc đang bật
//   • BẢNG sắp xếp được, chip nhóm bấm để đổi nhanh, "Hiện thêm" cho danh bạ lớn
//   • Chọn nhiều → Ghi tương tác (cho cả nhóm) / Xếp vào nhóm / Giới tính / Bỏ chăm sóc / Đổi
//     người phụ trách / Gắn thêm công ty / Đánh dấu nghỉ / Xoá vĩnh viễn (admin)
// Loại khách mặc định "Đang hợp tác" (chốt 19/10/2026), hiện thành chip để bỏ được.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckSquare, ChevronDown, ChevronUp, Grid3x3, Layers, PenLine, Plus, Star, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { usePersistedState } from '../../hooks/usePersistedState';
import { branchOf } from '../../lib/branchRef';
import { addContactClient, deactivateContact, deleteContact } from '../../lib/contactOps';
import { buildContactStats, CARE_STATUS_LABEL, dueLabel, type CareStatus, type ContactStats } from '../../lib/cskh/cadence';
import { relativeDayLabel, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { contactSearchHaystack, matchesQuery } from '../../lib/cskh/search';
import { GENDER_FILTER_LABEL, matchesGender, type GenderFilter } from '../../lib/cskh/gender';
import { buildTagStats, hasTrait, parseTraitFilter, TRAIT_FIELDS, TRAIT_LABEL, traitFilterValue } from '../../lib/cskh/traits';
import { isCooperatingClient } from '../../lib/cskh/seedTiers';
import type { CskhContact, Gender } from '../../lib/cskh/types';
import { CLASSIFIED_TIERS, GENDER_LABEL, TIER_LABEL } from '../../lib/cskh/types';
import { compareVnName } from '../../lib/vnName';
import { assignGroups, setGender, setOwner } from './data/api';
import { useCskh } from './context';
import {
  CARE_STATUS_COLOR, chipStyle, GROUP_COLOR, groupDisplayOf, LINK, NEW_GROUP_VALUE, PANEL, PILL_GRAY, PILL_PRIMARY, PILL_TINTED, resolveGroupKey, ROUND_ADD, scoreColor, TIER_COLOR,
} from './ui';
import { MigrationBanner, Spinner } from './components/Card';
import { CompanyTag, FilterChip, MoreButton, Panel, PageTitle, PillSelect, Quiet, SearchField, Segmented } from './components/apple';
import { ContactAvatar } from './components/ContactAvatar';
import { GroupOptions, QuickGroupSelect } from './components/GroupSelect';

type ActiveStatus = Exclude<CareStatus, 'unclassified'>;
const STATUSES: readonly ActiveStatus[] = ['overdue', 'due_soon', 'ok'];

/**
 * Phạm vi: đang chăm sóc (mặc định) / danh bạ khác (chưa chọn chăm sóc — không phải "bị bỏ bê",
 * danh bạ chỉ là nguồn để chọn) / cả danh bạ / đã nghỉ (rời công ty khách).
 */
type Scope = 'care' | 'other' | 'all' | 'left';
const SCOPE_LABEL: Readonly<Record<Scope, string>> = { care: 'Đang chăm sóc', other: 'Danh bạ khác', all: 'Cả danh bạ', left: 'Đã nghỉ' };
const SCOPES: Scope[] = ['care', 'other', 'all', 'left'];
const GENDER_FILTERS: readonly GenderFilter[] = ['all', 'female', 'male', 'unknown', 'guess_female', 'guess_male'];

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
  gender: GenderFilter;
  trait: string;        // 'all' | "<mục>:<khoá thẻ>"
}
const DEFAULT_FILTERS: Filters = {
  scope: 'care', group: 'all', status: 'all', branch: 'all', owner: 'all', kind: 'cooperating', company: 'all', province: 'all',
  gender: 'all', trait: 'all',
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

export default function CskhMatrix() {
  const { data, loading, clients, toast, openProfile, openNewContact, openLog, openPicker, openGroups, openGroupLog } = useCskh();
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

  const trait = filters.trait === 'all' ? null : parseTraitFilter(filters.trait);
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
    if (on('province') && filters.province !== 'all' && c.province !== filters.province && c.originProvince !== filters.province) return false;
    if (on('gender') && filters.gender !== 'all' && !matchesGender(c, filters.gender)) return false;
    if (on('trait') && trait && !hasTrait(c, trait.field, trait.key)) return false;
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
      if (c.originProvince) provinces.add(c.originProvince);
    }
    return {
      branches: branches.filter(b => bIds.has(b.id)),
      companies: clients.filter(c => cIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
      provinces: [...provinces].sort((a, b) => a.localeCompare(b, 'vi')),
    };
  }, [contacts, derived, branches, clients]);
  const clientsSorted = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [clients]);
  // Đặc điểm (thẻ) của người trong phạm vi đang xem — "Golf (5)" ra 5 người chơi golf
  const scopeKey = filters.scope;
  const traitOptions = useMemo(() => {
    const pool = contacts.filter(c => (scopeKey === 'care' ? c.tier !== 'unclassified' && !c.isArchived
      : scopeKey === 'other' ? c.tier === 'unclassified' && !c.isArchived
        : scopeKey === 'left' ? c.isArchived : true));
    return TRAIT_FIELDS.map(f => ({ field: f, stats: buildTagStats(pool, f) })).filter(g => g.stats.length > 0);
  }, [contacts, scopeKey]);

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
        className={`inline-flex items-center gap-1 transition-colors ${on ? 'text-[#0066CC]' : 'hover:text-[#1D1D1F]'}`}>
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
  if (filters.gender !== 'all') chips.push({ label: GENDER_FILTER_LABEL[filters.gender], clear: () => setFilter({ gender: 'all' }) });
  if (trait) {
    const label = traitOptions.find(g => g.field === trait.field)?.stats.find(t => t.key === trait.key)?.label ?? trait.key;
    chips.push({ label: `${TRAIT_LABEL[trait.field]}: ${label}`, clear: () => setFilter({ trait: 'all' }) });
  }
  if (search.trim()) chips.push({ label: `"${search.trim()}"`, clear: () => setSearch('') });

  const careCount = contacts.filter(c => c.tier !== 'unclassified' && !c.isArchived).length;
  const avgCare = (() => {
    const scores = contacts.map(c => stats.get(c.id)?.score?.total).filter((s): s is number => typeof s === 'number');
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  })();

  if (!data) {
    return loading ? <Spinner /> : <p className="py-16 text-center text-[13px] text-[#86868B]">Chưa tải được dữ liệu CSKH.</p>;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle
        eyebrow="Danh bạ chăm sóc"
        title="Ma trận Khách hàng"
        subtitle={<>{careCount} người đang chăm sóc — chọn từ danh bạ {contacts.length} người{avgCare !== null && <> · sức khỏe TB {avgCare}/100</>}</>}
        actions={(
          <>
            <button type="button" onClick={openGroups} className={`${PILL_GRAY} !flex-none`} aria-label="Quản lý nhóm">
              <Layers size={15} /> <span className="hidden sm:inline">Nhóm</span>
            </button>
            <button type="button" onClick={openPicker} className={PILL_TINTED}>
              <UserPlus size={15} strokeWidth={2.2} /> <span className="md:hidden">Chọn người</span><span className="hidden md:inline">Chọn người chăm sóc</span>
            </button>
            <button type="button" onClick={openNewContact} className={PILL_PRIMARY}>
              <Plus size={15} strokeWidth={2.4} /> Thêm liên hệ
            </button>
          </>
        )}
      />

      {!data.migrationReady && <MigrationBanner />}

      {/* ── Nhóm × Trạng thái ── */}
      {careCount > 0 && (
        <Panel title="Nhóm × Trạng thái" icon={<Grid3x3 size={16} className="text-[#86868B]" />}
          meta="Bấm một ô để lọc danh sách bên dưới"
          action={(
            <button type="button" onClick={() => setShowMatrix(!showMatrix)} aria-expanded={showMatrix} className={LINK}>
              {showMatrix ? <>Thu gọn <ChevronUp size={14} /></> : <>Chi tiết <ChevronDown size={14} /></>}
            </button>
          )}>
          <div className="flex flex-wrap gap-1.5 pb-2">
            {STATUSES.map(s => {
              const on = filters.group === 'all' && filters.status === s;
              return (
                <button key={s} type="button" onClick={() => pickCell('all', s)} disabled={matrix.colTotal[s] === 0 && !on} aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 h-9 md:h-8 px-3 rounded-full text-[13px] font-medium transition disabled:opacity-40 ${on ? 'ring-2 ring-current' : ''}`}
                  style={chipStyle(CARE_STATUS_COLOR[s])}>
                  <i className="w-1.5 h-1.5 rounded-full" style={{ background: CARE_STATUS_COLOR[s] }} />
                  {CARE_STATUS_LABEL[s]} <b className="tabular-nums">{matrix.colTotal[s]}</b>
                </button>
              );
            })}
          </div>
          {showMatrix && (matrix.rows.length === 0
            ? <Quiet>Không có ai đang chăm sóc khớp bộ lọc đang chọn.</Quiet>
            : (
              <div className="overflow-x-auto -mx-1 pb-2">
                <table className="w-full text-[13px] min-w-[460px] border-separate border-spacing-x-1 border-spacing-y-1">
                  <thead>
                    <tr className="text-[12px] text-[#86868B]">
                      <th className="text-left font-medium px-1 py-1">Nhóm</th>
                      {STATUSES.map(s => <th key={s} className="font-medium px-1 py-1">{CARE_STATUS_LABEL[s]}</th>)}
                      <th className="font-medium px-2 py-1 text-right">Tổng</th>
                      <th className="font-medium px-2 py-1 text-right">Điểm TB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map(r => {
                      const avg = r.n ? Math.round(r.sum / r.n) : null;
                      const rowOn = filters.group === r.key && filters.status === 'all';
                      return (
                        <tr key={r.key}>
                          <td className="py-0.5">
                            <button type="button" onClick={() => pickCell(r.key, 'all')} aria-pressed={rowOn}
                              className={`inline-flex items-center gap-2 rounded-full px-2.5 min-h-[34px] md:min-h-[30px] transition ${rowOn ? 'bg-[#0071E3]/10 text-[#0066CC] font-semibold' : 'text-[#1D1D1F] hover:bg-black/[0.04]'}`}>
                              <i className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />{r.label}
                            </button>
                          </td>
                          {STATUSES.map(s => {
                            const n = r.cells[s];
                            const on = filters.group === r.key && filters.status === s;
                            const alpha = n === 0 ? 0 : Math.round(26 + 76 * (n / matrix.max));
                            return (
                              <td key={s}>
                                <button type="button" disabled={n === 0 && !on} onClick={() => pickCell(r.key, s)} aria-pressed={on}
                                  aria-label={`${r.label} · ${CARE_STATUS_LABEL[s]}: ${n} người`}
                                  className={`w-full h-9 md:h-8 rounded-[10px] text-[13px] font-semibold tabular-nums transition hover:brightness-95 ${on ? 'ring-2 ring-[#0071E3] ring-offset-1' : ''}`}
                                  style={{ background: n ? `${CARE_STATUS_COLOR[s]}${alpha.toString(16).padStart(2, '0')}` : '#F5F5F7', color: n ? CARE_STATUS_COLOR[s] : '#C7C7CC' }}>
                                  {n || '–'}
                                </button>
                              </td>
                            );
                          })}
                          <td className="px-2 text-right font-medium text-[#1D1D1F] tabular-nums">{r.total}</td>
                          <td className="px-2 text-right tabular-nums">
                            {avg === null ? <span className="text-[#C7C7CC]">–</span> : <b style={{ color: scoreColor(avg) }}>{avg}</b>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
        </Panel>
      )}

      {/* ── Tìm + phạm vi + bộ lọc ── */}
      <div className={`${PANEL} p-3 md:p-4 space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={search} onChange={v => { setSearch(v); setLimit(PAGE); }}
            placeholder="Tìm tên, công ty, SĐT, email, chi nhánh… (gõ không dấu được)" className="flex-1 min-w-[220px] max-w-md" />
          <Segmented label="Phạm vi" fit value={filters.scope}
            onChange={s => { setFilter({ scope: s, ...(s === 'other' || s === 'left' ? { group: 'all', status: 'all' } : {}) }); setSelected(new Set()); }}
            options={SCOPES.map(s => ({ key: s, label: SCOPE_LABEL[s] }))} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PillSelect value={filters.group} active={filters.group !== 'all'} label="Lọc theo nhóm" onChange={v => setFilter({ group: v })}>
            <option value="all">Mọi nhóm</option>
            <GroupOptions groups={groups} />
          </PillSelect>
          <PillSelect value={filters.status} active={filters.status !== 'all'} label="Lọc theo trạng thái" onChange={v => setFilter({ status: v as Filters['status'] })}>
            <option value="all">Mọi trạng thái</option>
            {STATUSES.map(s => <option key={s} value={s}>{CARE_STATUS_LABEL[s]}</option>)}
          </PillSelect>
          <PillSelect value={filters.gender} active={filters.gender !== 'all'} label="Lọc theo giới tính" onChange={v => setFilter({ gender: v as GenderFilter })}>
            {GENDER_FILTERS.map(g => <option key={g} value={g}>{GENDER_FILTER_LABEL[g]}</option>)}
          </PillSelect>
          {(traitOptions.length > 0 || trait) && (
            <PillSelect value={filters.trait} active={!!trait} label="Lọc theo đặc điểm" onChange={v => setFilter({ trait: v })}>
              <option value="all">Mọi đặc điểm</option>
              {traitOptions.map(g => (
                <optgroup key={g.field} label={TRAIT_LABEL[g.field]}>
                  {g.stats.map(t => <option key={t.key} value={traitFilterValue(g.field, t.key)}>{`${t.label} (${t.count})`}</option>)}
                </optgroup>
              ))}
            </PillSelect>
          )}
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
            <PillSelect value={filters.province} active={filters.province !== 'all'} label="Lọc theo tỉnh (nơi ở hoặc quê)" onChange={v => setFilter({ province: v })}>
              <option value="all">Mọi tỉnh / quê</option>
              {options.provinces.map(p => <option key={p} value={p}>{p}</option>)}
            </PillSelect>
          )}
          <span className="md:ml-auto inline-flex items-center gap-1.5 text-[12px] text-[#86868B]">
            <ArrowUpDown size={14} className="shrink-0" />
            <PillSelect value={`${sort.key}:${sort.dir}`} active={false} label="Sắp xếp"
              onChange={v => { const [k, d] = v.split(':') as [SortKey, SortDir]; setSort({ key: k, dir: d }); }}>
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </PillSelect>
          </span>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {chips.map(ch => <FilterChip key={ch.label} label={ch.label} onClear={ch.clear} />)}
            <button type="button" onClick={() => { setFilters({ ...DEFAULT_FILTERS, scope: filters.scope, kind: 'all' }); setSearch(''); setLimit(PAGE); }}
              className="text-[13px] font-medium text-[#0066CC] hover:opacity-70 px-1.5 min-h-[32px]">Xoá tất cả</button>
            <span className="text-[12px] text-[#86868B] ml-auto tabular-nums">{filtered.length} người</span>
          </div>
        )}
        {outside > 0 && (
          <p className="text-[13px] text-[#6E6E73]">
            Còn {outside} người khớp "{search.trim()}" ở phạm vi / loại khách khác —{' '}
            <button type="button" onClick={() => setFilter({ scope: 'all', kind: 'all' })} className="font-medium text-[#0066CC] hover:opacity-70">tìm trong tất cả</button>
          </p>
        )}
      </div>

      {/* ── Thanh thao tác hàng loạt (nổi, kiểu thanh công cụ Apple) ── */}
      {selectedIds.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-[16px] bg-white/90 backdrop-blur-xl px-3 py-2.5 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_12px_32px_-8px_rgba(0,0,0,0.2)]">
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold tabular-nums">
            <CheckSquare size={14} /> {selectedIds.length} đã chọn
          </span>
          <button type="button" disabled={busy} onClick={() => openGroupLog(selectedIds)}
            className="inline-flex items-center gap-1.5 h-9 md:h-8 px-3.5 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[13px] font-medium hover:bg-[#0071E3]/[0.16] disabled:opacity-40 transition">
            <PenLine size={14} /> Ghi tương tác
          </button>
          <PillSelect value="" active={false} disabled={busy} label="Xếp vào nhóm" onChange={v => assignGroup(selectedIds, v)}>
            <option value="">Xếp vào nhóm…</option>
            <GroupOptions groups={groups} cadence={cadence} allowCreate />
          </PillSelect>
          <PillSelect value="" active={false} disabled={busy} label="Đổi người phụ trách"
            onChange={v => {
              if (!v) return;
              const owner = v === 'none' ? null : v;
              void run(async () => { await setOwner(selectedIds, owner, user); return `Đã đổi người phụ trách cho ${selectedIds.length} người`; });
            }}>
            <option value="">Đổi người phụ trách…</option>
            <option value="none">— Chưa giao —</option>
            {data.users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </PillSelect>
          <PillSelect value="" active={false} disabled={busy} label="Đặt giới tính"
            onChange={v => {
              if (!v) return;
              const g = (v === 'none' ? '' : v) as Gender;
              void run(async () => { await setGender(selectedIds, g, user); return `Đã đặt giới tính ${g ? GENDER_LABEL[g] : 'chưa rõ'} cho ${selectedIds.length} người`; });
            }}>
            <option value="">Giới tính…</option>
            <option value="female">Nữ</option>
            <option value="male">Nam</option>
            <option value="none">Chưa rõ</option>
          </PillSelect>
          <PillSelect value="" active={false} disabled={busy} label="Gắn thêm công ty" onChange={bulkLink}>
            <option value="">Gắn thêm công ty…</option>
            {clientsSorted.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </PillSelect>
          <button type="button" disabled={busy} onClick={bulkDeactivate}
            className="h-9 md:h-8 px-3.5 rounded-full bg-[#FF9500]/[0.14] text-[#B25000] text-[13px] font-medium hover:bg-[#FF9500]/[0.2] disabled:opacity-40 transition">Đánh dấu nghỉ</button>
          {isAdmin && (
            <button type="button" disabled={busy} onClick={bulkDelete}
              className="h-9 md:h-8 px-3.5 rounded-full bg-[#FF3B30]/10 text-[#D70015] text-[13px] font-medium hover:bg-[#FF3B30]/[0.16] disabled:opacity-40 transition">Xoá vĩnh viễn</button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="text-[13px] font-medium text-[#0066CC] hover:opacity-70 ml-auto min-h-[32px] px-1">Bỏ chọn</button>
        </div>
      )}

      {/* ── Bảng ── */}
      <div className={`${PANEL} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#E5E5EA] text-[12px] text-[#86868B]">
                <th className="pl-4 pr-2 py-2.5 w-8">
                  <input ref={headCheck} type="checkbox" className="w-4 h-4 accent-[#0071E3] align-middle" aria-label="Chọn các dòng đang hiện"
                    checked={visible.length > 0 && visibleSelected === visible.length} onChange={toggleVisible} disabled={!visible.length} />
                </th>
                <th className="text-left font-medium px-2 py-2.5">{sortHead('name', 'Liên hệ')}</th>
                <th className="text-left font-medium px-2 py-2.5 hidden md:table-cell">Nhóm</th>
                <th className="text-left font-medium px-2 py-2.5 hidden lg:table-cell">Chi nhánh / Tỉnh</th>
                <th className="text-left font-medium px-2 py-2.5 hidden md:table-cell">{sortHead('recent', 'Tương tác cuối')}</th>
                <th className="text-left font-medium px-2 py-2.5 hidden sm:table-cell">{sortHead('due', 'Hạn chăm sóc')}</th>
                <th className="text-right font-medium px-2 py-2.5">{sortHead('score', 'Điểm')}</th>
                <th className="text-left font-medium px-2 py-2.5 hidden xl:table-cell">Phụ trách</th>
                <th className="pl-2 pr-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={9}>
                  <Quiet icon={<Users size={18} />}>
                    {contacts.length === 0 ? 'Chưa có người liên hệ nào — bấm "Thêm liên hệ".' : 'Không có ai khớp bộ lọc.'}
                  </Quiet>
                </td></tr>
              ) : visible.map(c => {
                const st = stats.get(c.id);
                const d = derived.get(c.id);
                const isPrimary = c.primaryClientIds.length > 0;
                return (
                  <tr key={c.id} className={`border-b border-[#F0F0F2] last:border-0 transition-colors ${selected.has(c.id) ? 'bg-[#0071E3]/[0.06]' : 'hover:bg-[#FAFAFC]'} ${c.isArchived ? 'opacity-60' : ''}`}>
                    <td className="pl-4 pr-2 py-2.5 align-middle">
                      <input type="checkbox" className="w-4 h-4 accent-[#0071E3] align-middle" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Chọn ${c.fullName}`} />
                    </td>
                    <td className="px-2 py-2.5 min-w-[180px]">
                      <button type="button" onClick={() => openProfile(c.id)} className="flex items-center gap-3 text-left group/name">
                        <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={36} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1">
                            <b className="text-[14px] font-semibold text-[#1D1D1F] group-hover/name:text-[#0066CC] truncate max-w-[200px] transition-colors">{c.fullName}</b>
                            {isPrimary && <Star size={12} className="text-[#FF9500] fill-[#FF9500] shrink-0" aria-label="Liên hệ chính" />}
                            {c.isArchived && <span className="px-2 rounded-full text-[11px] font-medium bg-black/[0.05] text-[#6E6E73]">Đã nghỉ</span>}
                          </span>
                          <span className="flex items-center gap-1.5 max-w-[260px]">
                            {c.organization ? <CompanyTag name={c.organization} /> : <span className="text-[12px] text-[#86868B]">Chưa gắn công ty</span>}
                            {c.jobTitle && <span className="text-[12px] text-[#86868B] truncate">{c.jobTitle}</span>}
                          </span>
                        </span>
                      </button>
                      {/* Điện thoại: nhóm + hạn nằm dưới tên */}
                      <div className="md:hidden flex flex-wrap items-center gap-1.5 mt-1.5 pl-[48px]">
                        <QuickGroupSelect contact={c} groups={groups} groupById={groupById} cadence={cadence} disabled={busy}
                          onPick={k => assignGroup([c.id], k, c.fullName)} onCreate={openGroups} />
                        {st && st.status !== 'unclassified' && (
                          <span className="text-[12px] font-medium" style={{ color: CARE_STATUS_COLOR[st.status] }}>{dueLabel(st)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 hidden md:table-cell">
                      <QuickGroupSelect contact={c} groups={groups} groupById={groupById} cadence={cadence} disabled={busy}
                        onPick={k => assignGroup([c.id], k, c.fullName)} onCreate={openGroups} />
                    </td>
                    <td className="px-2 py-2.5 hidden lg:table-cell text-[12.5px] text-[#6E6E73]">
                      {d?.branchNames.join(', ') || c.province || <span className="text-[#C7C7CC]">—</span>}
                    </td>
                    <td className="px-2 py-2.5 hidden md:table-cell text-[12.5px] text-[#6E6E73] whitespace-nowrap">
                      {c.lastInteractionAt ? relativeDayLabel(c.lastInteractionAt, today) : <span className="text-[#C7C7CC]">—</span>}
                    </td>
                    <td className="px-2 py-2.5 hidden sm:table-cell whitespace-nowrap">
                      {st && st.status !== 'unclassified'
                        ? <span className="px-2.5 py-1 rounded-full text-[12px] font-medium" style={chipStyle(CARE_STATUS_COLOR[st.status])}>{dueLabel(st)}</span>
                        : <span className="text-[#C7C7CC]">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {st?.score ? <b className="text-[14px] font-semibold" style={{ color: scoreColor(st.score.total) }}>{st.score.total}</b> : <span className="text-[#C7C7CC]">–</span>}
                    </td>
                    <td className="px-2 py-2.5 hidden xl:table-cell text-[12.5px] text-[#6E6E73] whitespace-nowrap">
                      {c.ownerId ? userName.get(c.ownerId) ?? '—' : <span className="text-[#AEAEB2]">Chưa giao</span>}
                    </td>
                    <td className="pl-2 pr-4 py-2.5">
                      {!c.isArchived && (
                        <button type="button" onClick={() => openLog(c.id)} title="Ghi tương tác" aria-label={`Ghi tương tác với ${c.fullName}`} className={ROUND_ADD}>
                          <Plus size={15} strokeWidth={2.4} />
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
          <div className="border-t border-[#E5E5EA] px-3 py-1.5">
            <MoreButton onClick={() => setLimit(limit + PAGE)}>
              Hiện thêm {Math.min(PAGE, sorted.length - limit)} người (còn {sorted.length - limit})
            </MoreButton>
          </div>
        )}
      </div>

    </div>
  );
}
