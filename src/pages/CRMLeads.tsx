import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Edit2, Link2, Plus, Search, Star, Trash2, UserX, UserCheck, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../lib/auth';
import { useHashTab } from '../hooks/useHashSubRoute';
import { useBranchLookup } from '../hooks/useBranchLookup';
import { RelationshipRadar } from '../components/crm/RelationshipRadar';
import ContactFormModal from '../components/contacts/ContactFormModal';
import { AvatarCircle } from '../components/contacts/AvatarUpload';
import ContactDeleteDialog from '../components/contacts/ContactDeleteDialog';
import ContactPreviewPopup from '../components/contacts/ContactPreviewPopup';
import {
  addContactClient, removeContactClient, setPrimaryContact, unsetPrimaryContact,
  deactivateContact, reactivateContact, deleteContact,
  selectContacts, linksOf, clientIdsOf, primaryClientIdsOf,
} from '../lib/contactOps';
import { branchOf } from '../lib/branchRef';
import { compareVnName } from '../lib/vnName';
import type { Client, Contact, CRMProduct } from '../lib/types';

interface Props {
  clients: Client[];
  products: CRMProduct[];
  /** Mở hồ sơ chi tiết công ty bên Khách hàng — bấm vào tên công ty ở cột "Công ty gắn". */
  onSelectClient: (id: string) => void;
  toast: (m: string) => void;
}

type StatusFilter = 'active' | 'inactive' | 'all';
type CompanyFilter = 'all' | 'unlinked' | string; // string = client_id cụ thể
type BranchFilter = 'all' | 'none' | string;      // string = branch_id cụ thể

// Cột có thể bấm để xếp. 'default' = thứ tự gốc: liên hệ chính lên đầu, rồi mới nhất trước.
type SortKey = 'default' | 'name' | 'company' | 'branch' | 'role' | 'start_date' | 'status';
type SortDir = 'asc' | 'desc';

const SORT_LABEL: Record<Exclude<SortKey, 'default'>, string> = {
  name: 'tên gọi', company: 'công ty', branch: 'chi nhánh',
  role: 'chức vụ', start_date: 'ngày bắt đầu', status: 'trạng thái',
};

// Cột nào xếp được thì khai ở đây; `null` = cột chỉ để hiển thị (SĐT, Email, nút).
const COLUMNS: { label: string; sort: SortKey | null; hint?: string }[] = [
  { label: 'Họ tên', sort: 'name', hint: 'Xếp theo vần TÊN GỌI — như danh bạ Việt Nam' },
  { label: 'Công ty gắn', sort: 'company' },
  { label: 'Chi nhánh', sort: 'branch' },
  { label: 'Chức vụ', sort: 'role' },
  { label: 'SĐT', sort: null },
  { label: 'Email', sort: null },
  { label: 'Từ ngày', sort: 'start_date' },
  { label: 'Trạng thái', sort: 'status' },
  { label: '', sort: null },
];

const CRMLeads: React.FC<Props> = ({ clients, products, onSelectClient, toast }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Ghi tab đang mở vào URL (#/crm-leads/contacts) — F5 hay bookmark đều quay
  // lại đúng "Danh sách liên hệ" thay vì luôn rơi về Relationship Radar.
  const [view, setView] = useHashTab<'radar' | 'contacts'>('crm-leads', ['radar', 'contacts'] as const, 'radar');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>('all');
  const [branchFilter, setBranchFilter] = useState<BranchFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [previewing, setPreviewing] = useState<Contact | null>(null);

  // Dòng đang mở ô chọn "gắn thêm công ty".
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkClientId, setBulkClientId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const clientName = useCallback(
    (id: string | null) => (id ? clients.find(c => c.id === id)?.name || null : null),
    [clients]
  );
  const ctx = useMemo(() => ({ user, clientName }), [user, clientName]);

  // Chi nhánh của một liên hệ đi qua công ty: contact → client → branch.
  // Dùng useBranchLookup (cache dùng chung) thay vì tự query — màn hình này chỉ đọc.
  const { branches } = useBranchLookup();
  const clientById = useMemo(() => new Map(clients.map(cl => [cl.id, cl])), [clients]);
  // Người kiêm nhiệm nhiều công ty có thể trải trên nhiều chi nhánh — trả về cả danh sách.
  const branchesOfContact = useCallback((c: Contact) => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const id of clientIdsOf(c)) {
      const b = branchOf(clientById.get(id) ?? null, branches);
      if (b) seen.set(b.id, { id: b.id, name: b.name });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [clientById, branches]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContacts(await selectContacts(q => q.order('created_at', { ascending: false })));
    } catch (e: any) {
      toast('Lỗi tải dữ liệu: ' + e.message);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = contacts.filter(c => {
      const ids = clientIdsOf(c);
      if (statusFilter === 'active' && !c.is_active) return false;
      if (statusFilter === 'inactive' && c.is_active) return false;
      if (companyFilter === 'unlinked' && ids.length) return false;
      if (companyFilter !== 'all' && companyFilter !== 'unlinked' && !ids.includes(companyFilter)) return false;
      if (branchFilter !== 'all') {
        // Kiêm nhiệm nhiều nơi thì khớp nếu BẤT KỲ chi nhánh nào trùng bộ lọc.
        const bs = branchesOfContact(c);
        const ok = branchFilter === 'none' ? bs.length === 0 : bs.some(b => b.id === branchFilter);
        if (!ok) return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        linksOf(c).some(l => (l.clients?.name || '').toLowerCase().includes(q)) ||
        branchesOfContact(c).some(b => b.name.toLowerCase().includes(q))
      );
    });

    // Thứ tự gốc: người đang là liên hệ chính ở đâu đó lên trước, rồi mới nhất.
    // Cờ nằm ở bảng nối nên phải xếp tại đây, `.order()` của Postgres không với tới.
    if (sortKey === 'default') {
      return [...matched].sort(
        (a, b) => Number(primaryClientIdsOf(b).length > 0) - Number(primaryClientIdsOf(a).length > 0)
      );
    }

    // Ô trống luôn nằm cuối, dù xếp xuôi hay ngược — đọc bảng đỡ rối.
    const dir = sortDir === 'asc' ? 1 : -1;
    const byText = (a: string, b: string) =>
      !a && !b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b, 'vi') * dir;

    return [...matched].sort((a, b) => {
      switch (sortKey) {
        case 'name':    return compareVnName(a.name, b.name) * dir;
        case 'company': return byText(linksOf(a)[0]?.clients?.name || '', linksOf(b)[0]?.clients?.name || '');
        case 'branch':  return byText(branchesOfContact(a)[0]?.name || '', branchesOfContact(b)[0]?.name || '');
        case 'role':    return byText(a.role || '', b.role || '');
        case 'status':  return (Number(b.is_active) - Number(a.is_active)) * dir;
        case 'start_date': {
          const x = a.start_date || '', y = b.start_date || '';
          return !x && !y ? 0 : !x ? 1 : !y ? -1 : (x < y ? -1 : x > y ? 1 : 0) * dir;
        }
        default: return 0;
      }
    });
  }, [contacts, search, statusFilter, companyFilter, branchFilter, sortKey, sortDir, branchesOfContact]);

  // Bấm cột đang xếp thì đảo chiều; bấm cột khác thì xếp xuôi từ đầu.
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      // Xuôi → ngược → bỏ xếp, quay lại thứ tự gốc.
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey('default'); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Bỏ chọn những dòng đã bị lọc khỏi bảng, tránh thao tác hàng loạt lên dòng không nhìn thấy.
  useEffect(() => {
    setSelected(prev => {
      const visible = new Set(filtered.map(c => c.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const counts = useMemo(() => ({
    total: contacts.length,
    active: contacts.filter(c => c.is_active).length,
    unlinked: contacts.filter(c => clientIdsOf(c).length === 0).length,
  }), [contacts]);

  // Chỉ liệt kê chi nhánh thật sự có liên hệ — bỏ qua chi nhánh rỗng cho gọn danh sách.
  // Mọi dropdown chọn công ty đều xếp A→Z — danh sách vài chục cái, không xếp thì không tìm nổi.
  const clientsSorted = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [clients]
  );

  const branchOptionsWithCount = useMemo(() => {
    const tally = new Map<string, { label: string; n: number }>();
    let none = 0;
    for (const c of contacts) {
      const bs = branchesOfContact(c);
      if (!bs.length) { none++; continue; }
      // Người kiêm nhiệm được tính cho từng chi nhánh họ phụ trách, nên tổng các
      // con số này có thể lớn hơn số liên hệ — đúng ý "lọc ra ai làm ở đây".
      for (const b of bs) {
        const cur = tally.get(b.id);
        if (cur) cur.n++;
        else tally.set(b.id, { label: b.name, n: 1 });
      }
    }
    return {
      list: [...tally.entries()]
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
      none,
    };
  }, [contacts, branchesOfContact]);

  // ── Thao tác đơn lẻ ────────────────────────────────────────────────────────
  /** Gắn THÊM một công ty, giữ nguyên những công ty người này đang phụ trách. */
  const handleAddCompany = async (c: Contact, clientId: string) => {
    if (!clientId || clientIdsOf(c).includes(clientId)) { setLinkingId(null); return; }
    try {
      await addContactClient(c, clientId, ctx);
      toast(`Đã gắn "${c.name}" vào ${clientName(clientId)}`);
      await load();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    finally { setLinkingId(null); }
  };

  const handleRemoveCompany = async (c: Contact, clientId: string) => {
    if (!confirm(
      `Gỡ "${c.name}" khỏi công ty "${clientName(clientId)}"?\n\n` +
      `Bản ghi liên hệ và các công ty còn lại vẫn giữ nguyên. Lần gỡ này được ghi vào lịch sử và gắn lại được bất cứ lúc nào.`
    )) return;
    try {
      await removeContactClient(c, clientId, ctx);
      toast(`Đã gỡ "${c.name}" khỏi ${clientName(clientId)}`);
      await load();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  /**
   * Cờ liên hệ chính giờ thuộc về TỪNG công ty. Ở bảng tổng này một dòng có thể
   * ứng với nhiều công ty, nên chỉ bật/tắt nhanh được khi người đó gắn đúng 1
   * công ty; kiêm nhiệm nhiều nơi thì phải vào form Sửa để chọn công ty nào.
   */
  const handleTogglePrimary = async (c: Contact) => {
    const ids = clientIdsOf(c);
    if (!ids.length) { toast('Cần gắn công ty trước khi đặt liên hệ chính'); return; }
    if (!c.is_active) { toast('Người đã nghỉ không thể là liên hệ chính'); return; }
    if (ids.length > 1) {
      toast(`"${c.name}" phụ trách ${ids.length} công ty — mở Sửa để chọn công ty nào nhận cờ liên hệ chính`);
      return;
    }
    try {
      if (primaryClientIdsOf(c).length) await unsetPrimaryContact(c, ids[0], ctx);
      else await setPrimaryContact(c, ids[0], ctx);
      await load();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleToggleActive = async (c: Contact) => {
    try {
      if (c.is_active) {
        await deactivateContact(c, ctx);
        toast(`Đã đánh dấu "${c.name}" nghỉ`);
      } else {
        await reactivateContact(c, ctx);
        toast(`Đã mở lại "${c.name}"`);
      }
      await load();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  // ── Thao tác hàng loạt ─────────────────────────────────────────────────────
  const selectedContacts = useMemo(
    () => filtered.filter(c => selected.has(c.id)),
    [filtered, selected]
  );

  const toggleRow = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(prev => (prev.size === filtered.length ? new Set() : new Set(filtered.map(c => c.id))));
  };

  const runBulk = async (fn: (c: Contact) => Promise<any>, done: string) => {
    setBulkBusy(true);
    let ok = 0;
    const errs: string[] = [];
    for (const c of selectedContacts) {
      try { await fn(c); ok++; } catch (e: any) { errs.push(`${c.name}: ${e.message}`); }
    }
    await load();
    setSelected(new Set());
    setBulkBusy(false);
    toast(errs.length ? `${done} ${ok} người · ${errs.length} lỗi: ${errs[0]}` : `${done} ${ok} người`);
  };

  const handleBulkLink = async () => {
    if (!bulkClientId) { toast('Chọn công ty muốn gắn thêm'); return; }
    const target = bulkClientId;
    // GẮN THÊM, không thay thế: người đang phụ trách nơi khác vẫn giữ nguyên nơi cũ.
    await runBulk(c => addContactClient(c, target, ctx), `Đã gắn thêm vào ${clientName(target)}:`);
    setBulkClientId('');
  };

  const handleBulkDeactivate = async () => {
    if (!confirm(`Đánh dấu ${selectedContacts.length} người đã nghỉ? Bản ghi và lịch sử vẫn được giữ nguyên.`)) return;
    await runBulk(c => (c.is_active ? deactivateContact(c, ctx) : Promise.resolve(c)), 'Đã đánh dấu nghỉ');
  };

  const handleBulkDelete = async () => {
    const names = selectedContacts.slice(0, 5).map(c => `• ${c.name}`).join('\n');
    const more = selectedContacts.length > 5 ? `\n… và ${selectedContacts.length - 5} người nữa` : '';
    const primaries = selectedContacts.filter(c => primaryClientIdsOf(c).length > 0).length;
    const warn = primaries ? `\n\n⚠ Trong đó có ${primaries} người đang là LIÊN HỆ CHÍNH của công ty.` : '';
    if (!confirm(
      `XOÁ VĨNH VIỄN ${selectedContacts.length} liên hệ khỏi hệ thống?\n\n${names}${more}${warn}\n\n` +
      `Các thương vụ / quà tặng đang gắn với những người này sẽ KHÔNG bị xoá, nhưng sẽ mất tên người liên hệ.\n` +
      `Có thể khôi phục lại ở trang Lịch sử (nút Hoàn tác).\n\nBấm OK để xoá.`
    )) return;
    await runBulk(c => deleteContact(c, ctx), 'Đã xoá vĩnh viễn');
  };

  const openAdd = () => { setEditing(null); setShowForm(true); };
  const openEdit = (c: Contact) => { setEditing(c); setShowForm(true); };

  const selectCls = 'text-xs px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';

  return (
    <>
      <PageHeader
        title="CSKH"
        subtitle={view === 'radar'
          ? 'Chăm sóc & Follow-up'
          : `${counts.total} liên hệ · ${counts.active} đang phụ trách · ${counts.unlinked} chưa gắn công ty`}
        actions={
          view === 'contacts' ? (
            <button onClick={openAdd} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
              <span className="flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Thêm liên hệ</span>
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* View tabs */}
        <div className="flex gap-0.5 bg-[#F4F3EF] border border-[#E8E7E2] rounded-lg p-0.5 w-fit">
          {([
            { key: 'radar' as const, label: 'Relationship Radar' },
            { key: 'contacts' as const, label: 'Danh sách liên hệ' },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={[
                'px-3 py-1.5 rounded-md text-[12px] transition-all whitespace-nowrap',
                view === t.key ? 'bg-white text-[#333] font-medium border border-[#E0DFDA]' : 'text-[#888] hover:text-[#555]',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        {view === 'radar' && <RelationshipRadar clients={clients} contacts={contacts} onContactsChanged={load} products={products} toast={toast} />}

        {view === 'contacts' && (
          <>
            {/* Search + filters */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="Tìm tên, SĐT, email, công ty, chi nhánh..." value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className={selectCls}>
                <option value="all">Tất cả chi nhánh</option>
                {branchOptionsWithCount.list.map(b => <option key={b.id} value={b.id}>{b.label} ({b.n})</option>)}
                {branchOptionsWithCount.none > 0 && (
                  <option value="none">⚠ Chưa rõ chi nhánh ({branchOptionsWithCount.none})</option>
                )}
              </select>
              <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} className={selectCls}>
                <option value="all">Tất cả công ty</option>
                <option value="unlinked">⚠ Chưa gắn công ty ({counts.unlinked})</option>
                {clientsSorted.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className={selectCls}>
                <option value="active">Đang phụ trách</option>
                <option value="inactive">Đã nghỉ</option>
                <option value="all">Tất cả trạng thái</option>
              </select>
              {(search || companyFilter !== 'all' || branchFilter !== 'all' || statusFilter !== 'active' || sortKey !== 'default') && (
                <button onClick={() => {
                  setSearch(''); setCompanyFilter('all'); setBranchFilter('all'); setStatusFilter('active');
                  setSortKey('default'); setSortDir('asc');
                }}
                  className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1">
                  <X className="w-3 h-3" /> Xoá lọc
                </button>
              )}
              <span className="text-xs text-gray-400 ml-auto">
                {sortKey !== 'default' && (
                  <span className="text-gray-500">Xếp theo {SORT_LABEL[sortKey]} {sortDir === 'asc' ? '↑' : '↓'} · </span>
                )}
                {filtered.length} kết quả
              </span>
            </div>

            {/* Thanh thao tác hàng loạt */}
            {selected.size > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-blue-900">Đã chọn {selected.size} người</span>
                <span className="w-px h-4 bg-blue-200 mx-1" />
                <select value={bulkClientId} onChange={e => setBulkClientId(e.target.value)} className={selectCls}>
                  <option value="">— Gỡ khỏi công ty —</option>
                  {clientsSorted.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                </select>
                <button onClick={handleBulkLink} disabled={bulkBusy}
                  className="px-2.5 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  Áp dụng gắn công ty
                </button>
                <button onClick={handleBulkDeactivate} disabled={bulkBusy}
                  className="px-2.5 py-1.5 text-xs font-medium border border-amber-300 text-amber-700 bg-white rounded-lg hover:bg-amber-50 disabled:opacity-50 flex items-center gap-1">
                  <UserX className="w-3.5 h-3.5" /> Đánh dấu nghỉ
                </button>
                {isAdmin && (
                  <button onClick={handleBulkDelete} disabled={bulkBusy}
                    className="px-2.5 py-1.5 text-xs font-medium border border-red-300 text-red-700 bg-white rounded-lg hover:bg-red-50 disabled:opacity-50 flex items-center gap-1">
                    <Trash2 className="w-3.5 h-3.5" /> Xoá vĩnh viễn
                  </button>
                )}
                <button onClick={() => setSelected(new Set())} className="text-xs text-blue-700 hover:underline ml-auto">Bỏ chọn</button>
              </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-3 py-3 w-8">
                        <input type="checkbox" className="w-3.5 h-3.5 accent-blue-600"
                          checked={filtered.length > 0 && selected.size === filtered.length}
                          onChange={toggleAll} disabled={filtered.length === 0} />
                      </th>
                      <th className="px-2 py-3 w-8" title="Liên hệ chính của công ty" />
                      {COLUMNS.map(col => (
                        <th key={col.label} className="px-4 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">
                          {col.sort ? (
                            <button onClick={() => toggleSort(col.sort!)} title={col.hint || `Xếp theo ${col.label.toLowerCase()}`}
                              className={`group inline-flex items-center gap-1 transition ${sortKey === col.sort ? 'text-blue-700' : 'hover:text-blue-600'}`}>
                              {col.label}
                              {sortKey === col.sort
                                ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                                : <ChevronsUpDown className="w-3 h-3 text-gray-300 group-hover:text-blue-400" />}
                            </button>
                          ) : col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400 text-xs">Đang tải...</td></tr>
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-4 py-10 text-center">
                          <div className="text-gray-400 text-xs mb-2">
                            {contacts.length === 0 ? 'Chưa có liên hệ nào' : 'Không có liên hệ khớp bộ lọc'}
                          </div>
                          {contacts.length === 0 && <button onClick={openAdd} className="text-xs text-blue-600 hover:underline">+ Thêm ngay</button>}
                        </td>
                      </tr>
                    ) : filtered.map(c => (
                      <tr key={c.id} className={`group border-b border-gray-100 hover:bg-gray-50 ${!c.is_active ? 'opacity-60' : ''} ${selected.has(c.id) ? 'bg-blue-50/50' : ''}`}>
                        <td className="px-3 py-3">
                          <input type="checkbox" className="w-3.5 h-3.5 accent-blue-600"
                            checked={selected.has(c.id)} onChange={() => toggleRow(c.id)} />
                        </td>
                        <td className="px-2 py-3">
                          <button onClick={() => handleTogglePrimary(c)}
                            title={!clientIdsOf(c).length ? 'Cần gắn công ty trước'
                              : primaryClientIdsOf(c).length
                                ? `Liên hệ chính của: ${primaryClientIdsOf(c).map(id => clientName(id)).filter(Boolean).join(', ')}`
                                : 'Đặt làm liên hệ chính'}
                            className="inline-flex">
                            <Star className={`w-4 h-4 ${primaryClientIdsOf(c).length ? 'text-amber-500 fill-amber-500' : 'text-gray-300 hover:text-amber-400'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setPreviewing(c)} title="Xem nhanh thông tin"
                            className="flex items-center gap-2 text-left group/name">
                            <AvatarCircle url={c.avatar_url} name={c.name} size={32} />
                            <div>
                              <div className="font-semibold text-gray-900 group-hover/name:text-blue-600 group-hover/name:underline underline-offset-2 transition">{c.name}</div>
                              {primaryClientIdsOf(c).length > 0 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 mt-0.5">
                                  Liên hệ chính{primaryClientIdsOf(c).length > 1 ? ` · ${primaryClientIdsOf(c).length} cty` : ''}
                                </span>
                              )}
                            </div>
                          </button>
                        </td>
                        <td className="px-4 py-3 min-w-[190px]">
                          {/* Mỗi công ty là một thẻ: bấm TÊN để mở hồ sơ khách hàng,
                              bấm × để gỡ. Một người phụ trách được nhiều nơi nên
                              nút "+" gắn THÊM chứ không thay thế. */}
                          <div className="flex flex-wrap items-center gap-1">
                            {linksOf(c).map(l => (
                              <span key={l.client_id}
                                className="inline-flex items-center gap-0.5 rounded-md bg-gray-50 border border-gray-200 pl-1.5 pr-0.5 py-0.5">
                                <button onClick={() => onSelectClient(l.client_id)} title={`Mở hồ sơ ${l.clients?.name || 'công ty'}`}
                                  className="text-xs text-gray-700 font-medium hover:text-blue-600 hover:underline underline-offset-2 transition">
                                  {l.clients?.name || 'Công ty'}
                                </button>
                                {l.is_primary && <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />}
                                <button onClick={() => handleRemoveCompany(c, l.client_id)} title="Gỡ khỏi công ty này"
                                  className="p-0.5 rounded hover:bg-red-50 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition">
                                  <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
                                </button>
                              </span>
                            ))}

                            {linkingId === c.id ? (
                              <select autoFocus defaultValue="" onChange={e => handleAddCompany(c, e.target.value)}
                                onBlur={() => setLinkingId(null)}
                                className="text-xs px-2 py-1 border border-blue-400 rounded-md focus:outline-none min-w-[150px]">
                                <option value="">— Chọn công ty —</option>
                                {clientsSorted
                                  .filter(cl => !clientIdsOf(c).includes(cl.id))
                                  .map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                              </select>
                            ) : linksOf(c).length ? (
                              <button onClick={() => setLinkingId(c.id)} title="Gắn thêm công ty"
                                className="p-1 rounded hover:bg-gray-100 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition">
                                <Plus className="w-3.5 h-3.5 text-gray-400" />
                              </button>
                            ) : (
                              <button onClick={() => setLinkingId(c.id)}
                                className="flex items-center gap-1 text-xs text-gray-400 italic hover:text-blue-600 transition">
                                <Link2 className="w-3.5 h-3.5" /> Gắn công ty
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {branchesOfContact(c).length ? (
                            <div className="flex flex-wrap gap-1">
                              {branchesOfContact(c).map(b => (
                                <span key={b.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 whitespace-nowrap">{b.name}</span>
                              ))}
                            </div>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{c.role || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{c.phone || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{c.email || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {c.start_date ? new Date(c.start_date).toLocaleDateString('vi-VN') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {c.is_active ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">Đang phụ trách</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500 whitespace-nowrap">
                              Đã nghỉ{c.end_date ? ` · ${new Date(c.end_date).toLocaleDateString('vi-VN')}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-0.5">
                            <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-gray-100 rounded-lg transition" title="Sửa">
                              <Edit2 className="w-3.5 h-3.5 text-gray-500" />
                            </button>
                            <button onClick={() => handleToggleActive(c)} className="p-1.5 hover:bg-gray-100 rounded-lg transition"
                              title={c.is_active ? 'Đánh dấu đã nghỉ' : 'Mở lại — đang phụ trách'}>
                              {c.is_active
                                ? <UserX className="w-3.5 h-3.5 text-amber-600" />
                                : <UserCheck className="w-3.5 h-3.5 text-emerald-600" />}
                            </button>
                            <button onClick={() => setDeleting(c)} className="p-1.5 hover:bg-red-50 rounded-lg transition" title="Xoá liên hệ">
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {showForm && (
        <ContactFormModal
          contact={editing}
          clients={clients}
          onClose={() => setShowForm(false)}
          onSaved={() => load()}
          toast={toast}
        />
      )}

      {deleting && (
        <ContactDeleteDialog
          contact={deleting}
          clients={clients}
          onClose={() => setDeleting(null)}
          onDone={() => load()}
          toast={toast}
        />
      )}

      {previewing && (
        <ContactPreviewPopup
          contact={previewing}
          branches={branchesOfContact(previewing)}
          onClose={() => setPreviewing(null)}
          onEdit={() => { openEdit(previewing); setPreviewing(null); }}
        />
      )}
    </>
  );
};

export default CRMLeads;
