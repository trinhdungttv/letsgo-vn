import { useState, useEffect, useCallback, useMemo } from 'react';
import { Edit2, Link2, Plus, Search, Star, Trash2, UserX, UserCheck, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { RelationshipRadar } from '../components/crm/RelationshipRadar';
import ContactFormModal from '../components/contacts/ContactFormModal';
import ContactDeleteDialog from '../components/contacts/ContactDeleteDialog';
import {
  linkContactToClient, setPrimaryContact, unsetPrimaryContact,
  deactivateContact, reactivateContact, deleteContact,
} from '../lib/contactOps';
import type { Client, Contact, CRMProduct } from '../lib/types';

interface Props {
  clients: Client[];
  products: CRMProduct[];
  toast: (m: string) => void;
}

type StatusFilter = 'active' | 'inactive' | 'all';
type CompanyFilter = 'all' | 'unlinked' | string; // string = client_id cụ thể

const CRMLeads: React.FC<Props> = ({ clients, products, toast }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [view, setView] = useState<'radar' | 'contacts'>('radar');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>('all');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkClientId, setLinkClientId] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkClientId, setBulkClientId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const clientName = useCallback(
    (id: string | null) => (id ? clients.find(c => c.id === id)?.name || null : null),
    [clients]
  );
  const ctx = useMemo(() => ({ user, clientName }), [user, clientName]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contacts')
      .select('*, clients(name)')
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) toast('Lỗi tải dữ liệu: ' + error.message);
    else setContacts((data || []) as Contact[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter(c => {
      if (statusFilter === 'active' && !c.is_active) return false;
      if (statusFilter === 'inactive' && c.is_active) return false;
      if (companyFilter === 'unlinked' && c.client_id) return false;
      if (companyFilter !== 'all' && companyFilter !== 'unlinked' && c.client_id !== companyFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.clients?.name || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, search, statusFilter, companyFilter]);

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
    unlinked: contacts.filter(c => !c.client_id).length,
  }), [contacts]);

  // ── Thao tác đơn lẻ ────────────────────────────────────────────────────────
  const handleQuickLink = async (c: Contact) => {
    const target = linkClientId || null;
    if ((c.client_id || null) === target) { setLinkingId(null); return; }
    try {
      await linkContactToClient(c, target, ctx);
      toast(target ? `Đã gắn "${c.name}" vào ${clientName(target)}` : `Đã gỡ "${c.name}" khỏi công ty`);
      await load();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    finally { setLinkingId(null); setLinkClientId(''); }
  };

  const handleTogglePrimary = async (c: Contact) => {
    if (!c.client_id) { toast('Cần gắn công ty trước khi đặt liên hệ chính'); return; }
    if (!c.is_active) { toast('Người đã nghỉ không thể là liên hệ chính'); return; }
    try {
      if (c.is_primary) await unsetPrimaryContact(c, ctx);
      else await setPrimaryContact(c, ctx);
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
    const target = bulkClientId || null;
    await runBulk(c => linkContactToClient(c, target, ctx),
      target ? `Đã gắn vào ${clientName(target)}:` : 'Đã gỡ khỏi công ty:');
    setBulkClientId('');
  };

  const handleBulkDeactivate = async () => {
    if (!confirm(`Đánh dấu ${selectedContacts.length} người đã nghỉ? Bản ghi và lịch sử vẫn được giữ nguyên.`)) return;
    await runBulk(c => (c.is_active ? deactivateContact(c, ctx) : Promise.resolve(c)), 'Đã đánh dấu nghỉ');
  };

  const handleBulkDelete = async () => {
    const names = selectedContacts.slice(0, 5).map(c => `• ${c.name}`).join('\n');
    const more = selectedContacts.length > 5 ? `\n… và ${selectedContacts.length - 5} người nữa` : '';
    const primaries = selectedContacts.filter(c => c.is_primary).length;
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
    <div className="space-y-4">
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
              <input type="text" placeholder="Tìm tên, SĐT, email, công ty..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} className={selectCls}>
              <option value="all">Tất cả công ty</option>
              <option value="unlinked">⚠ Chưa gắn công ty ({counts.unlinked})</option>
              {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className={selectCls}>
              <option value="active">Đang phụ trách</option>
              <option value="inactive">Đã nghỉ</option>
              <option value="all">Tất cả trạng thái</option>
            </select>
            {(search || companyFilter !== 'all' || statusFilter !== 'active') && (
              <button onClick={() => { setSearch(''); setCompanyFilter('all'); setStatusFilter('active'); }}
                className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1">
                <X className="w-3 h-3" /> Xoá lọc
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">{filtered.length} kết quả</span>
          </div>

          {/* Thanh thao tác hàng loạt */}
          {selected.size > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-blue-900">Đã chọn {selected.size} người</span>
              <span className="w-px h-4 bg-blue-200 mx-1" />
              <select value={bulkClientId} onChange={e => setBulkClientId(e.target.value)} className={selectCls}>
                <option value="">— Gỡ khỏi công ty —</option>
                {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
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
                    {['Họ tên', 'Công ty gắn', 'Chức vụ', 'SĐT', 'Email', 'Từ ngày', 'Trạng thái', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400 text-xs">Đang tải...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center">
                        <div className="text-gray-400 text-xs mb-2">
                          {contacts.length === 0 ? 'Chưa có liên hệ nào' : 'Không có liên hệ khớp bộ lọc'}
                        </div>
                        {contacts.length === 0 && <button onClick={openAdd} className="text-xs text-blue-600 hover:underline">+ Thêm ngay</button>}
                      </td>
                    </tr>
                  ) : filtered.map(c => (
                    <tr key={c.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!c.is_active ? 'opacity-60' : ''} ${selected.has(c.id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-3 py-3">
                        <input type="checkbox" className="w-3.5 h-3.5 accent-blue-600"
                          checked={selected.has(c.id)} onChange={() => toggleRow(c.id)} />
                      </td>
                      <td className="px-2 py-3">
                        <button onClick={() => handleTogglePrimary(c)}
                          title={!c.client_id ? 'Cần gắn công ty trước' : c.is_primary ? 'Liên hệ chính — bấm để bỏ' : 'Đặt làm liên hệ chính'}
                          className="inline-flex">
                          <Star className={`w-4 h-4 ${c.is_primary ? 'text-amber-500 fill-amber-500' : 'text-gray-300 hover:text-amber-400'}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{c.name}</div>
                        {c.is_primary && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 mt-0.5">Liên hệ chính</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {linkingId === c.id ? (
                          <div className="flex items-center gap-1">
                            <select value={linkClientId} onChange={e => setLinkClientId(e.target.value)} autoFocus
                              className="text-xs px-2 py-1 border border-blue-400 rounded-md focus:outline-none min-w-[140px]">
                              <option value="">— Gỡ khỏi công ty —</option>
                              {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                            </select>
                            <button onClick={() => handleQuickLink(c)} className="text-[11px] px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700">OK</button>
                            <button onClick={() => { setLinkingId(null); setLinkClientId(''); }} className="text-[11px] px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100">Hủy</button>
                          </div>
                        ) : (
                          <button onClick={() => { setLinkingId(c.id); setLinkClientId(c.client_id || ''); }}
                            className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 transition">
                            <Link2 className="w-3.5 h-3.5" />
                            {c.clients?.name || <span className="text-gray-400 italic">Gắn công ty</span>}
                          </button>
                        )}
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
    </div>
  );
};

export default CRMLeads;
