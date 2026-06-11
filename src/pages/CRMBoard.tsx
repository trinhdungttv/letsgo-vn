import React, { useState, useEffect } from 'react';
import { ChevronRight, X, Settings, Rocket, ChevronUp, ChevronDown } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { formatCurrency } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useRegions } from '../hooks/useRegions';
import { useManagers } from '../hooks/useManagers';
import type { Client, CRMProduct, CRMDeal, Contact } from '../lib/types';

const STAGE_KEYS = ['new', 'contacted', 'in_progress', 'proposal', 'won', 'lost'] as const;
type StageKey = typeof STAGE_KEYS[number];

const STAGE_STYLES: Record<StageKey, { color: string; colBg: string; textCol: string; prob: number }> = {
  new:         { color: 'bg-slate-500',   colBg: 'bg-slate-50/80',   textCol: 'text-slate-700',   prob: 10  },
  contacted:   { color: 'bg-blue-500',    colBg: 'bg-blue-50/80',    textCol: 'text-blue-700',    prob: 25  },
  in_progress: { color: 'bg-amber-500',   colBg: 'bg-amber-50/80',   textCol: 'text-amber-700',   prob: 50  },
  proposal:    { color: 'bg-violet-500',  colBg: 'bg-violet-50/80',  textCol: 'text-violet-700',  prob: 75  },
  won:         { color: 'bg-emerald-500', colBg: 'bg-emerald-50/80', textCol: 'text-emerald-700', prob: 100 },
  lost:        { color: 'bg-red-500',     colBg: 'bg-red-50/80',     textCol: 'text-red-700',     prob: 0   },
};

const DEFAULT_LABELS: Record<StageKey, string> = {
  new: 'Mới', contacted: 'Đã liên hệ', in_progress: 'Đang xử lý',
  proposal: 'Báo giá', won: 'Đã ký HĐ', lost: 'Không thành',
};

interface PipelineSettings {
  labels: Record<string, string>;
  visible: Record<string, boolean>;
  order: StageKey[];
}

const SETTINGS_KEY = 'letsgo_pipeline_settings';

function loadSettings(): PipelineSettings {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      return {
        labels: { ...DEFAULT_LABELS, ...parsed.labels },
        visible: { new: true, contacted: true, in_progress: true, proposal: true, won: true, lost: true, ...parsed.visible },
        order: parsed.order || [...STAGE_KEYS],
      };
    }
  } catch {}
  return {
    labels: { ...DEFAULT_LABELS },
    visible: { new: true, contacted: true, in_progress: true, proposal: true, won: true, lost: true },
    order: [...STAGE_KEYS],
  };
}

interface CRMBoardProps {
  deals: CRMDeal[];
  products: CRMProduct[];
  onDealUpdate: (d: CRMDeal) => void;
  onDealCreate: (d: CRMDeal) => void;
  onSelectDeal: (id: string) => void;
  onDealActivate: (client: Client) => void;
  toast: (m: string) => void;
}

interface AddDealForm {
  title: string;
  contactId: string;
  productId: string;
  value: number;
  stage: StageKey;
  owner: string;
  expectedClose: string;
}

interface ActivateForm {
  companyName: string;
  region: string;
  manager: string;
}

export default function CRMBoard({ deals, products, onDealUpdate, onDealCreate, onSelectDeal, onDealActivate, toast }: CRMBoardProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { regions } = useRegions();
  const { managers } = useManagers();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<AddDealForm>({ title: '', contactId: '', productId: '', value: 0, stage: 'new', owner: '', expectedClose: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activatingDeal, setActivatingDeal] = useState<CRMDeal | null>(null);
  const [activateForm, setActivateForm] = useState<ActivateForm>({ companyName: '', region: '', manager: '' });
  const [isActivating, setIsActivating] = useState(false);

  const [settings, setSettings] = useState<PipelineSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [draftSettings, setDraftSettings] = useState<PipelineSettings>(loadSettings);

  useEffect(() => {
    supabase.from('contacts').select('id, name, phone, role, clients(name)').eq('is_active', true).order('name')
      .then(({ data }) => { if (data) setContacts(data as Contact[]); });
  }, []);

  useEffect(() => {
    if (showSettings) setDraftSettings({ ...settings, labels: { ...settings.labels }, visible: { ...settings.visible }, order: [...settings.order] });
  }, [showSettings]);

  const saveSettings = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(draftSettings));
    setSettings(draftSettings);
    setShowSettings(false);
    toast('Đã lưu cài đặt Pipeline');
  };

  const moveStage = (idx: number, dir: -1 | 1) => {
    const newOrder = [...draftSettings.order];
    const target = idx + dir;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]];
    setDraftSettings(prev => ({ ...prev, order: newOrder }));
  };

  const visibleStages = settings.order.filter(s => settings.visible[s]);
  const pipelineValue = deals.filter(d => d.stage !== 'lost').reduce((sum, d) => sum + (d.value || 0), 0);

  const dealsByStage = STAGE_KEYS.reduce((acc, s) => {
    acc[s] = deals.filter(d => d.stage === s);
    return acc;
  }, {} as Record<StageKey, CRMDeal[]>);

  const stageTotals = STAGE_KEYS.reduce((acc, s) => {
    acc[s] = dealsByStage[s].reduce((sum, d) => sum + (d.value || 0), 0);
    return acc;
  }, {} as Record<StageKey, number>);

  const handleStageChange = async (deal: CRMDeal, newStage: StageKey) => {
    try {
      const { data, error } = await supabase.from('crm_deals')
        .update({ stage: newStage })
        .eq('id', deal.id)
        .select('*, crm_leads(name, company), crm_products(name), contacts(name, phone)')
        .single();
      if (error) throw error;
      onDealUpdate(data as CRMDeal);
      toast(`Cập nhật thương vụ thành "${settings.labels[newStage] || DEFAULT_LABELS[newStage]}"`);
    } catch (err: any) { toast('Lỗi: ' + err.message); }
  };

  const openActivateModal = (deal: CRMDeal) => {
    setActivatingDeal(deal);
    setActivateForm({
      companyName: deal.title,
      region: '',
      manager: deal.owner || '',
    });
  };

  const handleActivateConfirm = async () => {
    if (!activatingDeal || !activateForm.companyName.trim()) {
      toast('Vui lòng nhập tên công ty');
      return;
    }
    setIsActivating(true);
    try {
      const { data, error } = await supabase.from('clients').insert({
        name: activateForm.companyName.trim(),
        region: activateForm.region.trim() || null,
        manager: activateForm.manager.trim() || null,
        client_type: 'active',
        status: 'ok',
        cutoff_day: 25,
        payment_start: 5,
        payment_end: 8,
        won_date: new Date().toISOString().slice(0, 10),
        pipeline_stage: 'won',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      await supabase.from('crm_deals').update({ stage: 'won' }).eq('id', activatingDeal.id);
      onDealActivate(data as Client);
      setActivatingDeal(null);
      toast(`Đã tạo khách hàng "${activateForm.companyName}" — hãy điền thêm thông tin!`);
    } catch (err: any) { toast('Lỗi: ' + err.message); }
    finally { setIsActivating(false); }
  };

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.productId) { toast('Vui lòng điền tiêu đề và sản phẩm'); return; }
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.from('crm_deals').insert({
        title: formData.title,
        contact_id: formData.contactId || null,
        product_id: formData.productId,
        value: formData.value,
        stage: formData.stage,
        owner: formData.owner,
        expected_closing_date: formData.expectedClose || null,
      }).select('*, crm_leads(name, company), crm_products(name), contacts(name, phone)').single();
      if (error) throw error;
      onDealCreate(data as CRMDeal);
      setShowModal(false);
      setFormData({ title: '', contactId: '', productId: '', value: 0, stage: 'new', owner: '', expectedClose: '' });
      toast('Tạo thương vụ thành công');
    } catch (err: any) { toast('Lỗi: ' + err.message); }
    finally { setIsSubmitting(false); }
  };

  const ownerColor = (owner: string) => {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-orange-500', 'bg-rose-500', 'bg-indigo-500'];
    return colors[owner.charCodeAt(0) % colors.length];
  };

  const formatDateShort = (d: string | null) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('vi-VN', { month: 'short', day: 'numeric' });
  };

  const isOverdue = (d: string | null) => d ? new Date(d) < new Date() : false;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <PageHeader
        title="CRM Pipeline"
        actions={
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] text-[#888] font-medium">{formatCurrency(pipelineValue)} pipeline</span>
            {isAdmin && (
              <button onClick={() => setShowSettings(true)} className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition" title="Cài đặt Pipeline">
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
              + Thêm thương vụ
            </button>
          </div>
        }
      />

      {/* Summary bar */}
      <div className="px-5 py-3 bg-white border-b border-gray-200 flex gap-4 shrink-0 flex-wrap">
        {visibleStages.filter(s => s !== 'won' && s !== 'lost').map(stage => (
          <div key={stage} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${STAGE_STYLES[stage].color}`} />
            <span className="text-sm text-gray-600">
              {settings.labels[stage]}: <span className="font-semibold text-gray-900">{dealsByStage[stage].length}</span>
            </span>
            <span className="text-xs text-gray-500">{formatCurrency(stageTotals[stage])}</span>
          </div>
        ))}
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 min-w-max">
          {visibleStages.map(stage => {
            const stageDeals = dealsByStage[stage];
            const stageConfig = STAGE_STYLES[stage];
            const label = settings.labels[stage] || DEFAULT_LABELS[stage];

            return (
              <div key={stage} className={`w-[280px] shrink-0 rounded-xl ${stageConfig.colBg} p-3 border border-gray-200`}>
                <div className="mb-4 pb-3 border-b border-gray-300/50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${stageConfig.color}`} />
                    <h3 className="font-semibold text-sm text-gray-900">{label}</h3>
                  </div>
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>{stageDeals.length} deals</span>
                    <span className="font-medium text-gray-700">{formatCurrency(stageTotals[stage])}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {stageDeals.map(deal => (
                    <div
                      key={deal.id}
                      className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md transition-shadow cursor-pointer group"
                      onClick={() => onSelectDeal(deal.id)}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-xs text-gray-500 font-medium">
                          {deal.contacts?.name || deal.crm_leads?.name || deal.clients?.name || '—'}
                        </span>
                        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
                      </div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-2 line-clamp-2">{deal.title}</h4>
                      <p className="text-base font-bold text-blue-600 mb-3">{formatCurrency(deal.value || 0)}</p>
                      {deal.crm_products?.name && (
                        <p className="text-xs text-gray-500 mb-2">{deal.crm_products.name}</p>
                      )}
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-6 h-6 rounded-full ${ownerColor(deal.owner || 'U')} flex items-center justify-center text-white text-xs font-semibold`}>
                          {(deal.owner || 'U').charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs text-gray-700">{deal.owner || 'Unassigned'}</span>
                      </div>
                      {deal.expected_closing_date && (
                        <div className={`text-xs mb-2 ${isOverdue(deal.expected_closing_date) ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                          {formatDateShort(deal.expected_closing_date)}
                        </div>
                      )}

                      {/* Stage select */}
                      <select
                        value={deal.stage}
                        onChange={(e) => handleStageChange(deal, e.target.value as StageKey)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {STAGE_KEYS.map(s => (
                          <option key={s} value={s}>{settings.labels[s] || DEFAULT_LABELS[s]}</option>
                        ))}
                      </select>

                      {/* Activate button: show for ALL deals in won stage */}
                      {stage === 'won' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openActivateModal(deal); }}
                          className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition"
                        >
                          <Rocket className="w-3 h-3" />
                          Bắt đầu hợp tác
                        </button>
                      )}
                    </div>
                  ))}
                  {stageDeals.length === 0 && (
                    <div className="text-center py-8 text-gray-400 text-xs">Không có thương vụ</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Deal Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-base font-semibold text-gray-900">Tạo thương vụ mới</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <form onSubmit={handleCreateDeal} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Tiêu đề thương vụ <span className="text-red-500">*</span></label>
                <input type="text" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })}
                  placeholder="VD: Dự án cung ứng lao động Q3" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Người liên hệ</label>
                <select value={formData.contactId} onChange={e => setFormData({ ...formData, contactId: e.target.value })}
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
                <select value={formData.productId} onChange={e => setFormData({ ...formData, productId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Chọn sản phẩm</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Giá trị (₫)</label>
                  <input type="number" value={formData.value} onChange={e => setFormData({ ...formData, value: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Giai đoạn</label>
                  <select value={formData.stage} onChange={e => setFormData({ ...formData, stage: e.target.value as StageKey })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {STAGE_KEYS.map(s => <option key={s} value={s}>{settings.labels[s] || DEFAULT_LABELS[s]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Người phụ trách</label>
                  <input type="text" value={formData.owner} onChange={e => setFormData({ ...formData, owner: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Ngày dự kiến đóng</label>
                  <input type="date" value={formData.expectedClose} onChange={e => setFormData({ ...formData, expectedClose: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition">
                  {isSubmitting ? 'Đang tạo...' : 'Tạo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Activate → New Client Modal */}
      {activatingDeal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Bắt đầu hợp tác</h2>
                <p className="text-xs text-gray-500 mt-0.5">Tạo khách hàng mới từ thương vụ này</p>
              </div>
              <button onClick={() => setActivatingDeal(null)} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Tên công ty <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={activateForm.companyName}
                  onChange={e => setActivateForm(f => ({ ...f, companyName: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Khu vực</label>
                <select
                  value={activateForm.region}
                  onChange={e => setActivateForm(f => ({ ...f, region: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Chọn khu vực...</option>
                  {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Người quản lý</label>
                <select
                  value={activateForm.manager}
                  onChange={e => setActivateForm(f => ({ ...f, manager: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Chọn quản lý...</option>
                  {managers.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <p className="text-xs text-gray-500 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                Sau khi tạo, bạn sẽ được chuyển sang trang chi tiết để điền số lượng lao động, doanh thu, thời hạn hợp đồng.
              </p>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setActivatingDeal(null)} className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Hủy</button>
              <button
                onClick={handleActivateConfirm}
                disabled={isActivating}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition flex items-center justify-center gap-1.5"
              >
                <Rocket className="w-3.5 h-3.5" />
                {isActivating ? 'Đang tạo...' : 'Bắt đầu hợp tác'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline Settings Modal (admin only) */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-base font-semibold text-gray-900">Cài đặt Pipeline</h2>
              <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-500 mb-4">Đổi tên, ẩn/hiện và thay đổi thứ tự các giai đoạn.</p>
              {draftSettings.order.map((stage, idx) => (
                <div key={stage} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${STAGE_STYLES[stage].color}`} />
                  <input
                    type="text"
                    value={draftSettings.labels[stage] || DEFAULT_LABELS[stage]}
                    onChange={e => setDraftSettings(prev => ({ ...prev, labels: { ...prev.labels, [stage]: e.target.value } }))}
                    className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 select-none cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftSettings.visible[stage] !== false}
                      onChange={e => setDraftSettings(prev => ({ ...prev, visible: { ...prev.visible, [stage]: e.target.checked } }))}
                      className="w-3.5 h-3.5"
                    />
                    Hiện
                  </label>
                  <div className="flex flex-col gap-0.5">
                    <button type="button" onClick={() => moveStage(idx, -1)} disabled={idx === 0} className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30">
                      <ChevronUp className="w-3.5 h-3.5 text-gray-600" />
                    </button>
                    <button type="button" onClick={() => moveStage(idx, 1)} disabled={idx === draftSettings.order.length - 1} className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30">
                      <ChevronDown className="w-3.5 h-3.5 text-gray-600" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex gap-2 justify-end">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Hủy</button>
              <button onClick={saveSettings} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Lưu cài đặt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
