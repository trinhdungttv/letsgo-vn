import { useState, useEffect } from 'react';
import {
  Plus, X, Briefcase,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { formatCurrency } from '../lib/format';
import type { CRMPipelineEntry, CRMDeal, CRMProduct, Contact } from '../lib/types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { useRegions } from '../hooks/useRegions';
import { CompanyProfileModal, STAGES, RATING_CONFIG } from '../components/crm/CompanyProfileModal';

interface CRMPipelineProps {
  pipeline: CRMPipelineEntry[];
  products: CRMProduct[];
  onRefresh: () => Promise<void>;
  onDealCreate: (d: CRMDeal) => void;
  toast: (msg: string) => void;
  /** Khi được truyền (vd. từ Dashboard), tự động mở hồ sơ công ty có id này. */
  focusEntryId?: string | null;
  onFocusHandled?: () => void;
}

const DEAL_STAGE_LABELS: Record<string, string> = {
  new: 'Mới', contacted: 'Đã liên hệ', in_progress: 'Đang xử lý',
  proposal: 'Báo giá', won: 'Đã ký HĐ', lost: 'Không thành',
};

interface AddDealForm {
  title: string;
  contactId: string;
  productId: string;
  value: number;
  stage: CRMDeal['stage'];
  owner: string;
  expectedClose: string;
}

// ── Main CRMPipeline ────────────────────────────────────────────────────────
export default function CRMPipeline({ pipeline, products, onRefresh, onDealCreate, toast, focusEntryId, onFocusHandled }: CRMPipelineProps) {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [profileEntry, setProfileEntry] = useState<CRMPipelineEntry | null>(null);
  const [modalForm, setModalForm] = useState({ name: '', region: '', estimate: '', rating: 'normal', contactId: '', productId: '', customPrice: '' });
  const [localPipeline, setLocalPipeline] = useState(pipeline);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showDealModal, setShowDealModal] = useState(false);
  const [dealForm, setDealForm] = useState<AddDealForm>({ title: '', contactId: '', productId: '', value: 0, stage: 'new', owner: '', expectedClose: '' });
  const [isSubmittingDeal, setIsSubmittingDeal] = useState(false);

  const { regions, add: addRegion } = useRegions();
  const [showAddRegion, setShowAddRegion] = useState(false);
  const [newRegionName, setNewRegionName] = useState('');

  const handleAddRegion = async () => {
    const name = newRegionName.trim();
    if (!name) return;
    try {
      await addRegion(name);
      setModalForm(f => ({ ...f, region: name }));
      setNewRegionName('');
      setShowAddRegion(false);
      toast('Đã thêm khu vực mới');
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  useEffect(() => { setLocalPipeline(pipeline); }, [pipeline]);

  useEffect(() => {
    if (!focusEntryId) return;
    const entry = localPipeline.find(p => p.id === focusEntryId);
    if (entry) {
      setProfileEntry(entry);
      onFocusHandled?.();
    }
  }, [focusEntryId, localPipeline, onFocusHandled]);

  useEffect(() => {
    supabase.from('contacts').select('id, name, phone, role, clients(name)').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setContacts(data as unknown as Contact[]); });
  }, []);

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealForm.title || !dealForm.productId) { toast('Vui lòng điền tiêu đề và sản phẩm'); return; }
    setIsSubmittingDeal(true);
    try {
      const { data, error } = await supabase.from('crm_deals').insert({
        title: dealForm.title,
        contact_id: dealForm.contactId || null,
        product_id: dealForm.productId,
        value: dealForm.value,
        stage: dealForm.stage,
        owner: dealForm.owner,
        expected_closing_date: dealForm.expectedClose || null,
      }).select('*, crm_leads(name, company), crm_products(name), contacts(name, phone)').single();
      if (error) throw error;
      onDealCreate(data as CRMDeal);
      setShowDealModal(false);
      setDealForm({ title: '', contactId: '', productId: '', value: 0, stage: 'new', owner: '', expectedClose: '' });
      toast('Tạo thương vụ thành công');
      await logActivity({
        user, action: 'insert', table: 'crm_deals', recordId: data.id,
        description: `Tạo thương vụ "${dealForm.title}"`,
        newData: data,
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    finally { setIsSubmittingDeal(false); }
  };

  const handleAdd = async () => {
    if (!modalForm.name) { toast('Nhập tên công ty'); return; }
    try {
      const { data, error } = await supabase.from('crm_pipeline').insert({
        company_name: modalForm.name, region: modalForm.region || null,
        worker_estimate: parseInt(modalForm.estimate) || null,
        stage: 'tiem-nang', rating: modalForm.rating,
        contact_id: modalForm.contactId || null,
        product_id: modalForm.productId || null,
        custom_price: modalForm.customPrice ? parseFloat(modalForm.customPrice) : null,
        last_contact: new Date().toISOString().split('T')[0],
      }).select('*, contacts(name, phone), crm_products(name, category, price)').single();
      if (error) throw error;
      // Cùng 1 công ty phải thấy được ở Thị trường > Công ty/Dự án — không phải nhập tay lại lần 2.
      await supabase.from('market_leads').insert({
        company_name: modalForm.name, region: modalForm.region || null,
        workers_needed: parseInt(modalForm.estimate) || 0,
        source: 'CRM Pipeline', status: 'Chưa LH',
        suppliers: [{ name: "Let's Go VN", qty: 0, is_us: true }],
        crm_id: data.id,
      });
      await onRefresh();
      setModalForm({ name: '', region: '', estimate: '', rating: 'normal', contactId: '', productId: '', customPrice: '' });
      setShowModal(false);
      toast('Đã thêm vào pipeline!');
      await logActivity({
        user, action: 'insert', table: 'crm_pipeline', recordId: data.id,
        description: `Thêm công ty "${data.company_name}" vào pipeline`,
        newData: data,
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleDrop = async (targetStage: string) => {
    if (!dragId) return;
    const entry = localPipeline.find(e => e.id === dragId);
    if (!entry || entry.stage === targetStage) { setDragId(null); setDragOver(null); return; }
    const stageLabel = STAGES.find(s => s.id === targetStage)?.label || targetStage;
    setLocalPipeline(prev => prev.map(e => e.id === dragId ? { ...e, stage: targetStage } : e));
    setDragId(null); setDragOver(null);
    try {
      const { error } = await supabase.from('crm_pipeline').update({ stage: targetStage }).eq('id', dragId);
      if (error) throw error;
      await onRefresh();
      toast(`${entry.company_name} → ${stageLabel}`);
      await logActivity({
        user, action: 'update', table: 'crm_pipeline', recordId: dragId,
        description: `Chuyển "${entry.company_name}" sang giai đoạn "${stageLabel}"`,
        oldData: entry, newData: { ...entry, stage: targetStage },
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); await onRefresh(); }
  };

  const handleDelete = async (id: string) => {
    try {
      const existing = localPipeline.find(e => e.id === id);
      const { error } = await supabase.from('crm_pipeline').delete().eq('id', id);
      if (error) throw error;
      setProfileEntry(null);
      await onRefresh();
      toast('Đã xóa');
      if (existing) {
        await logActivity({
          user, action: 'delete', table: 'crm_pipeline', recordId: id,
          description: `Xóa công ty "${existing.company_name}" khỏi pipeline`,
          oldData: existing,
        });
      }
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleUpdate = (updated: CRMPipelineEntry) => {
    setLocalPipeline(prev => prev.map(e => e.id === updated.id ? updated : e));
    if (profileEntry?.id === updated.id) setProfileEntry(updated);
  };

  const archivedKNN = localPipeline.filter(e => e.stage === 'khong-nhu-cau');
  const archivedNgung = localPipeline.filter(e => e.stage === 'ngung');

  return (
    <>
      <PageHeader
        title="CRM Pipeline BD"
        subtitle="Phễu bán hàng — kéo thả thẻ để chuyển giai đoạn"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDealModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white border border-[#1D4ED8] text-[#1D4ED8] hover:bg-blue-50 transition"
            >
              <Briefcase size={13} /> Tạo thương vụ mới
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"
            >
              <Plus size={13} /> Thêm công ty
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        {/* Kanban */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {STAGES.map(stage => {
            const items = localPipeline.filter(e => e.stage === stage.id);
            const isOver = dragOver === stage.id;
            return (
              <div
                key={stage.id}
                className={`bg-[#F5F4EF] rounded-lg transition-all ${isOver ? 'ring-2 ring-blue-400 bg-blue-50' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(stage.id); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(stage.id)}
              >
                <div className={`px-3 py-2 rounded-t-lg flex items-center justify-between ${stage.headerBg}`}>
                  <span className={`text-[11.5px] font-semibold ${stage.headerText}`}>{stage.label}</span>
                  <span className={`text-[11px] font-medium ${stage.headerText} opacity-60`}>{items.length}</span>
                </div>
                <div className="p-1.5 flex flex-col gap-1.5 min-h-[80px]">
                  {items.map(entry => {
                    const rc = RATING_CONFIG[entry.rating || 'normal'] || RATING_CONFIG.normal;
                    return (
                      <div
                        key={entry.id}
                        draggable
                        onDragStart={() => setDragId(entry.id)}
                        onDragEnd={() => { setDragId(null); setDragOver(null); }}
                        onClick={() => setProfileEntry(entry)}
                        className={`bg-white border border-[#E8E7E2] rounded-lg px-2.5 py-2 cursor-grab hover:border-blue-400 hover:shadow-sm transition select-none ${dragId === entry.id ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-1 mb-0.5">
                          <div className="text-[12px] font-semibold text-[#111] leading-tight truncate">{entry.company_name}</div>
                          <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${rc.dot}`} title={rc.label} />
                        </div>
                        <div className="text-[11px] text-[#888] truncate">
                          {entry.region || ''}
                          {entry.worker_estimate ? ` · ~${entry.worker_estimate} LĐ` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Archived */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'Không nhu cầu', items: archivedKNN },
            { label: 'Ngưng HĐ',      items: archivedNgung },
          ].map(sec => (
            <div key={sec.label} className="bg-[#F5F4EF] rounded-lg p-3">
              <div className="text-[11.5px] font-semibold text-[#888] mb-2">{sec.label} ({sec.items.length})</div>
              <div className="space-y-1">
                {sec.items.slice(0, 3).map(e => (
                  <button key={e.id} onClick={() => setProfileEntry(e)}
                    className="w-full text-left text-[12px] text-[#555] hover:text-[#111] transition truncate py-0.5">
                    {e.company_name}{e.region ? ` · ${e.region}` : ''}
                  </button>
                ))}
                {sec.items.length > 3 && <div className="text-[11px] text-[#bbb]">+{sec.items.length - 3} khác</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-[10px] border border-[#E8E7E2] w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-[15px] font-semibold text-[#111] mb-4">Thêm công ty mới</h2>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Tên công ty *</label>
                <input value={modalForm.name} onChange={e => setModalForm(f => ({ ...f, name: e.target.value }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Khu vực/KCN</label>
                <div className="flex items-center gap-1.5">
                  <select value={modalForm.region} onChange={e => setModalForm(f => ({ ...f, region: e.target.value }))}
                    className="flex-1 text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                    <option value="">Chọn khu vực</option>
                    {!regions.some(r => r.name === modalForm.region) && modalForm.region && (
                      <option value={modalForm.region}>{modalForm.region}</option>
                    )}
                    {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowAddRegion(s => !s)}
                    title="Thêm khu vực mới"
                    className="shrink-0 px-2.5 py-1.5 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition">
                    <Plus size={14} />
                  </button>
                </div>
                {showAddRegion && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <input value={newRegionName} onChange={e => setNewRegionName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddRegion())}
                      placeholder="Tên khu vực/KCN mới"
                      className="flex-1 text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" autoFocus />
                    <button type="button" onClick={handleAddRegion}
                      className="shrink-0 px-3 py-1.5 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] transition">
                      Thêm
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Ước tính LĐ</label>
                  <input type="number" value={modalForm.estimate} onChange={e => setModalForm(f => ({ ...f, estimate: e.target.value }))}
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" placeholder="50" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Đánh giá</label>
                  <select value={modalForm.rating} onChange={e => setModalForm(f => ({ ...f, rating: e.target.value }))}
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                    <option value="hot">Tiềm năng cao</option>
                    <option value="normal">Bình thường</option>
                    <option value="low">Thấp</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Người liên hệ (từ CSKH)</label>
                <select value={modalForm.contactId} onChange={e => setModalForm(f => ({ ...f, contactId: e.target.value }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  <option value="">Chọn người liên hệ</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.role ? ` — ${c.role}` : ''}{(c as any).clients?.name ? ` (${(c as any).clients.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Sản phẩm / Dịch vụ quan tâm</label>
                <select value={modalForm.productId} onChange={e => setModalForm(f => ({ ...f, productId: e.target.value }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  <option value="">Chọn sản phẩm</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.category || 'Khác'} — {p.name}</option>)}
                </select>
              </div>
              {modalForm.productId && (
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">
                    Giá tuỳ chỉnh (tuỳ chọn)
                    {(() => {
                      const p = products.find(pr => pr.id === modalForm.productId);
                      return p ? ` — Giá chuẩn: ${formatCurrency(p.price || 0)}` : '';
                    })()}
                  </label>
                  <input type="number" value={modalForm.customPrice}
                    onChange={e => setModalForm(f => ({ ...f, customPrice: e.target.value }))}
                    placeholder="Để trống = dùng giá chuẩn, có thể nhập cao hơn hoặc thấp hơn"
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={handleAdd}
                className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF]">Thêm</button>
            </div>
          </div>
        </div>
      )}

      {/* Profile drawer */}
      {profileEntry && (
        <CompanyProfileModal
          entry={profileEntry}
          contacts={contacts}
          products={products}
          onClose={() => setProfileEntry(null)}
          onUpdate={handleUpdate}
          onDelete={() => handleDelete(profileEntry.id)}
          toast={toast}
          isAdmin={user?.role === 'admin'}
        />
      )}

      {/* Create Deal modal */}
      {showDealModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-base font-semibold text-gray-900">Tạo thương vụ mới</h2>
              <button onClick={() => setShowDealModal(false)} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleCreateDeal} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Tiêu đề thương vụ <span className="text-red-500">*</span></label>
                <input type="text" value={dealForm.title} onChange={e => setDealForm({ ...dealForm, title: e.target.value })}
                  placeholder="VD: Dự án cung ứng lao động Q3" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Người liên hệ</label>
                <select value={dealForm.contactId} onChange={e => setDealForm({ ...dealForm, contactId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Chọn người liên hệ (từ CSKH)</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.role ? ` — ${c.role}` : ''}{(c as any).clients?.name ? ` (${(c as any).clients.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Sản phẩm / Dịch vụ <span className="text-red-500">*</span></label>
                <select value={dealForm.productId} onChange={e => setDealForm({ ...dealForm, productId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Chọn sản phẩm</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.category || 'Khác'} — {p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Giá trị (₫)</label>
                  <input type="number" value={dealForm.value} onChange={e => setDealForm({ ...dealForm, value: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Giai đoạn</label>
                  <select value={dealForm.stage} onChange={e => setDealForm({ ...dealForm, stage: e.target.value as CRMDeal['stage'] })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {Object.entries(DEAL_STAGE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Người phụ trách</label>
                  <input type="text" value={dealForm.owner} onChange={e => setDealForm({ ...dealForm, owner: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Ngày dự kiến đóng</label>
                  <input type="date" value={dealForm.expectedClose} onChange={e => setDealForm({ ...dealForm, expectedClose: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowDealModal(false)} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
                <button type="submit" disabled={isSubmittingDeal} className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition">
                  {isSubmittingDeal ? 'Đang tạo...' : 'Tạo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
