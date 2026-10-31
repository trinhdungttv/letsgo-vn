import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, X, Briefcase, Columns3, RotateCcw, Filter, FileText,
} from 'lucide-react';
import { usePersistedState } from '../hooks/usePersistedState';
import PageHeader from '../components/PageHeader';
import { formatCurrency } from '../lib/format';
import type { CRMPipelineEntry, CRMDeal, CRMProduct, Contact, Client } from '../lib/types';
import { CostPlanModal } from '../components/workspace/CostPlanModal';
import { listPlans } from '../lib/costPlan/api';
import { planCountsByPipeline } from '../lib/costPlan/listFilter';
import type { CostPlanRow } from '../lib/costPlan/types';
import { supabase } from '../lib/supabase';
import { PIPELINE_SELECT } from '../lib/pipelineHelpers';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { useBranchData } from '../hooks/useBranchData';
import { branchOptions, branchOf } from '../lib/branchRef';
import { useMarketRefs, competitorsInZone, linkCompetitor, notifyMarketChanged } from '../components/crm/MarketSupplyBlock';
import { CompanyProfileModal, STAGES, RATING_CONFIG, ARCHIVED_STAGES } from '../components/crm/CompanyProfileModal';
import { selectContacts } from '../lib/contactOps';
import { PipelineSourceChip, PipelineSourcePicker, SOURCE_NAMES_CHANGED } from '../components/crm/PipelineSourceField';
import DuplicateCompanyNotice from '../components/common/DuplicateCompanyNotice';
import { invalidateCompanyIndex, useCompanyDuplicates } from '../hooks/useCompanyDuplicates';
import { EMPTY_SOURCE, cleanSource, matchesSourceFilter, sourceFilterGroups, sourceFullLabel, sourceSaveErrorHint } from '../lib/pipelineSource';
import { parseLatLngFromLink, isValidVnLatLng } from '../lib/geo';
import MapLinkHint from '../components/MapLinkHint';

interface CRMPipelineProps {
  pipeline: CRMPipelineEntry[];
  /** Khách hàng — cho ô chọn khách trong "Phương án giá" */
  clients: Client[];
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
export default function CRMPipeline({ pipeline, clients, products, onRefresh, onDealCreate, toast, focusEntryId, onFocusHandled }: CRMPipelineProps) {
  const { user, token } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [profileEntry, setProfileEntry] = useState<CRMPipelineEntry | null>(null);
  const emptyModalForm = { name: '', branchId: '', estimate: '', rating: 'normal', contactId: '', productId: '', customPrice: '', zone: '', ncc: [] as string[], images: '', mapLink: '', cover: '', source: EMPTY_SOURCE };
  const [modalForm, setModalForm] = useState(emptyModalForm);
  // Dò công ty đã có (Khách hàng / Pipeline / Thị trường) khi gõ tên — khác dấu, loại hình, thiếu-thừa ký tự vẫn bắt được
  const dup = useCompanyDuplicates(modalForm.name, { enabled: showModal });
  const [localPipeline, setLocalPipeline] = useState(pipeline);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Ẩn bớt cột không cần thiết — nhớ theo trình duyệt. Chỉ ẩn hiển thị, thẻ vẫn nằm nguyên ở giai đoạn đó.
  const [hiddenCols, setHiddenCols] = usePersistedState<string[]>('crm_pipeline_hidden_cols', []);
  const [showColMenu, setShowColMenu] = useState(false);
  const [showAllArchived, setShowAllArchived] = useState<Record<string, boolean>>({});
  // Điện thoại: xem từng giai đoạn một (chip chọn giai đoạn) thay vì 5 cột chen nhau.
  const [mobileStage, setMobileStage] = usePersistedState<string>('crm_pipeline_mobile_stage', STAGES[0]?.id ?? '');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showDealModal, setShowDealModal] = useState(false);
  const [dealForm, setDealForm] = useState<AddDealForm>({ title: '', contactId: '', productId: '', value: 0, stage: 'new', owner: '', expectedClose: '' });
  const [isSubmittingDeal, setIsSubmittingDeal] = useState(false);

  const { branches } = useBranchData();
  const { zones: refZones, competitors: refCompetitors } = useMarketRefs();

  // "Phương án giá" mở ngay tại Pipeline (cùng màn hình, cùng dữ liệu với Workspace).
  // 'all' = mọi phương án; 1 dòng pipeline = chỉ phương án của công ty đó, phương án mới tự chọn sẵn công ty.
  const [costPlanFor, setCostPlanFor] = useState<'all' | CRMPipelineEntry | null>(null);
  const [plans, setPlans] = useState<CostPlanRow[]>([]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    listPlans(token).then(p => { if (alive) setPlans(p); }).catch(() => { /* chưa có quyền / chưa có bảng: chỉ không hiện số */ });
    return () => { alive = false; };
  }, [token]);
  const planCounts = useMemo(() => planCountsByPipeline(plans, pipeline), [plans, pipeline]);
  const openCostPlan = (e: CRMPipelineEntry, ev?: React.MouseEvent) => { ev?.stopPropagation(); setCostPlanFor(e); };
  // Số phương án giá trên thẻ. Thẻ điện thoại cả thẻ là 1 nút → chỉ hiển thị (không lồng nút), mở từ hồ sơ.
  const planBadge = (entry: CRMPipelineEntry, clickable = true) => {
    const n = planCounts[entry.id];
    if (!n) return null;
    const cls = 'shrink-0 inline-flex items-center gap-0.5 px-1 rounded border border-violet-200 bg-violet-50 text-[10px] font-semibold leading-[15px] text-violet-700';
    return clickable ? (
      <button type="button" onClick={ev => openCostPlan(entry, ev)} onMouseDown={ev => ev.stopPropagation()} draggable={false}
        title={`${n} phương án giá — bấm để mở`} className={`${cls} hover:bg-violet-100`}><FileText size={9} />{n}</button>
    ) : <span title={`${n} phương án giá`} className={cls}><FileText size={9} />{n}</span>;
  };

  // Lọc theo nguồn (sale / đối tác giới thiệu / công ty / chi nhánh) — áp cho cả
  // kanban lẫn 2 mục lưu trữ, để xem một người giới thiệu đã mang về những dự án nào.
  const [sourceFilter, setSourceFilter] = useState('all');
  const sourceGroups = useMemo(() => sourceFilterGroups(localPipeline, branches), [localPipeline, branches]);
  const noSourceCount = localPipeline.filter(e => matchesSourceFilter(e, 'none')).length;
  const visible = useMemo(() => localPipeline.filter(e => matchesSourceFilter(e, sourceFilter)), [localPipeline, sourceFilter]);
  // Tên người giới thiệu bị sửa hết khỏi các công ty → bộ lọc không còn khớp gì, trả về Tất cả.
  useEffect(() => {
    if (sourceFilter === 'all' || sourceFilter === 'none') return;
    if (!sourceGroups.some(g => g.options.some(o => o.key === sourceFilter))) setSourceFilter('all');
  }, [sourceGroups, sourceFilter]);
  // "Đối tác giới thiệu — Minh Phát" khi lọc 1 người; "Tất cả sale" khi lọc cả nhóm.
  const sourceFilterTitle = (() => {
    if (sourceFilter === 'none') return 'Chưa ghi nguồn';
    for (const g of sourceGroups) {
      const o = g.options.find(x => x.key === sourceFilter);
      if (o) return sourceFilter.startsWith('type:') ? o.label
        : sourceFilter.startsWith('company:') ? `Công ty — ${o.label}`
        : sourceFilter.startsWith('branch:') ? `Chi nhánh — ${o.label}`
        : `${g.label} — ${o.label}`;
    }
    return '';
  })();


  useEffect(() => { setLocalPipeline(pipeline); }, [pipeline]);
  // Đổi tên / gộp người giới thiệu ở ô chọn Nguồn → nạp lại để thẻ và bộ lọc hiện tên mới
  useEffect(() => {
    const h = () => { onRefresh(); };
    window.addEventListener(SOURCE_NAMES_CHANGED, h);
    return () => window.removeEventListener(SOURCE_NAMES_CHANGED, h);
  }, [onRefresh]);

  useEffect(() => {
    if (!focusEntryId) return;
    const entry = localPipeline.find(p => p.id === focusEntryId);
    if (entry) {
      setProfileEntry(entry);
      onFocusHandled?.();
    }
  }, [focusEntryId, localPipeline, onFocusHandled]);

  // Nạp kèm bảng nối contact_clients: hồ sơ công ty lọc người liên hệ theo đúng
  // công ty đang mở, mà một người có thể phụ trách nhiều công ty (migration 145).
  const loadContacts = useCallback(() => {
    selectContacts(q => q.eq('is_active', true).order('name'))
      .then(setContacts)
      .catch(() => {});
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

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
    if (dup.blocked) { toast('Công ty này có thể đã có — xem cảnh báo dưới ô tên; nếu là công ty khác thì tích “vẫn thêm mới”'); return; }
    const recruitImages = modalForm.images.split(/[\s,]+/).map(u => u.trim()).filter(u => /^https?:\/\//i.test(u));
    // Chỉ gửi cột nguồn khi có chọn — chưa chạy migration 162 vẫn thêm được công ty.
    const source = cleanSource(modalForm.source);
    try {
      const { data, error } = await supabase.from('crm_pipeline').insert({
        company_name: modalForm.name, branch_id: modalForm.branchId || null,
        worker_estimate: parseInt(modalForm.estimate) || null,
        stage: 'tiem-nang', rating: modalForm.rating,
        contact_id: modalForm.contactId || null,
        product_id: modalForm.productId || null,
        custom_price: modalForm.customPrice ? parseFloat(modalForm.customPrice) : null,
        last_contact: new Date().toISOString().split('T')[0],
        ...(source.source_type ? source : {}),
      }).select(PIPELINE_SELECT).single();
      if (error) throw new Error(sourceSaveErrorHint(error.message) ?? error.message);
      // Cùng 1 công ty phải thấy được ở Thị trường > Công ty/Dự án — không phải nhập tay lại lần 2.
      // Link Google Maps + ảnh bìa cũng nằm ở dòng này (nguồn chung với hồ sơ công ty — CompanyMedia).
      const mapLink = modalForm.mapLink.trim();
      const mapPos = parseLatLngFromLink(mapLink);
      const { data: lead } = await supabase.from('market_leads').insert({
        company_name: modalForm.name, region: modalForm.zone || (branches.find(b => b.id === modalForm.branchId)?.name ?? null),
        workers_needed: parseInt(modalForm.estimate) || 0,
        source: 'CRM Pipeline', status: 'Chưa LH',
        suppliers: [{ name: "Let's Go VN", qty: 0, is_us: true }, ...modalForm.ncc.map(name => ({ name, qty: 0, is_us: false }))],
        crm_id: data.id,
        ...(recruitImages.length ? { recruit_image_urls: recruitImages } : {}),
        ...(mapLink ? { map_link: mapLink } : {}),
        ...(isValidVnLatLng(mapPos) ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() } : {}),
      }).select('id').single();
      // Ảnh bìa ghi riêng: chưa chạy migration 163 thì chỉ thiếu ảnh bìa, không mất cả dòng Thị trường.
      const cover = modalForm.cover.trim();
      if (lead && /^https?:\/\//i.test(cover)) {
        const { error: coverErr } = await supabase.from('market_leads').update({ cover_image_url: cover }).eq('id', lead.id);
        if (coverErr) toast(/cover_image/.test(coverErr.message) ? 'Chưa lưu được ảnh bìa — cần chạy migration 163 trên Supabase' : 'Lỗi lưu ảnh bìa: ' + coverErr.message);
      }
      // NCC chọn từ đối thủ → ghi "Đang cung cấp cho" ở hồ sơ đối thủ
      await Promise.all(modalForm.ncc.map(n => { const c = refCompetitors.find(x => x.company_name === n); return c ? linkCompetitor(c, modalForm.name, modalForm.zone || null) : null; }));
      if (modalForm.ncc.length || recruitImages.length || modalForm.zone) notifyMarketChanged();
      invalidateCompanyIndex();
      await onRefresh();
      setModalForm(emptyModalForm);
      setShowModal(false);
      toast('Đã thêm vào pipeline!');
      await logActivity({
        user, action: 'insert', table: 'crm_pipeline', recordId: data.id,
        description: `Thêm công ty "${data.company_name}" vào pipeline${source.source_type ? ` (nguồn: ${sourceFullLabel(source, branches)})` : ''}`,
        newData: data,
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  // Chuyển giai đoạn — dùng chung cho kéo thả (máy tính) và ô chọn "Chuyển" (điện thoại, không kéo thả được).
  const moveEntry = async (entryId: string, targetStage: string) => {
    const entry = localPipeline.find(e => e.id === entryId);
    if (!entry || entry.stage === targetStage) return;
    const stageLabel = STAGES.find(s => s.id === targetStage)?.label || targetStage;
    setLocalPipeline(prev => prev.map(e => e.id === entryId ? { ...e, stage: targetStage } : e));
    try {
      const { error } = await supabase.from('crm_pipeline').update({ stage: targetStage }).eq('id', entryId);
      if (error) throw error;
      await onRefresh();
      toast(`${entry.company_name} → ${stageLabel}`);
      await logActivity({
        user, action: 'update', table: 'crm_pipeline', recordId: entryId,
        description: `Chuyển "${entry.company_name}" sang giai đoạn "${stageLabel}"`,
        oldData: entry, newData: { ...entry, stage: targetStage },
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); await onRefresh(); }
  };

  const handleDrop = async (targetStage: string) => {
    if (!dragId) return;
    const id = dragId;
    setDragId(null); setDragOver(null);
    await moveEntry(id, targetStage);
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

  const archivedKNN = visible.filter(e => e.stage === 'khong-nhu-cau');
  const archivedNgung = visible.filter(e => e.stage === 'ngung');

  const COLUMN_DEFS = [
    ...STAGES.map(s => ({ id: s.id, label: s.label, count: visible.filter(e => e.stage === s.id).length })),
    { id: 'khong-nhu-cau', label: 'Không hợp tác', count: archivedKNN.length },
    { id: 'ngung', label: 'Ngưng HĐ', count: archivedNgung.length },
  ];
  const isHidden = (id: string) => hiddenCols.includes(id);
  const visibleStages = STAGES.filter(s => !isHidden(s.id));
  const toggleCol = (id: string) => {
    const visibleCount = COLUMN_DEFS.filter(c => !isHidden(c.id)).length;
    if (!isHidden(id) && visibleCount <= 1) { toast('Cần để lại ít nhất 1 cột'); return; }
    setHiddenCols(h => h.includes(id) ? h.filter(x => x !== id) : [...h, id]);
  };
  const hiddenDefs = COLUMN_DEFS.filter(c => isHidden(c.id));

  const handleRestore = async (entry: CRMPipelineEntry) => {
    if (!confirm(`Khôi phục "${entry.company_name}" về giai đoạn Tiềm năng?`)) return;
    try {
      const { error } = await supabase.from('crm_pipeline').update({ stage: 'tiem-nang', sub_status: null }).eq('id', entry.id);
      if (error) throw error;
      await onRefresh();
      toast(`Đã khôi phục "${entry.company_name}" về Tiềm năng`);
      await logActivity({
        user, action: 'update', table: 'crm_pipeline', recordId: entry.id,
        description: `Khôi phục "${entry.company_name}" về Tiềm năng (trước đó: ${ARCHIVED_STAGES[entry.stage]?.label ?? entry.stage})`,
        oldData: entry, newData: { ...entry, stage: 'tiem-nang', sub_status: null },
      });
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  return (
    <>
      <PageHeader
        title="CRM Pipeline BD"
        subtitle="Phễu bán hàng — kéo thả thẻ để chuyển giai đoạn"
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowColMenu(v => !v)}
                title="Ẩn / hiện các cột"
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${showColMenu || hiddenCols.length ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}
              >
                <Columns3 size={13} /> Cột{hiddenCols.length ? ` (ẩn ${hiddenCols.length})` : ''}
              </button>
              {showColMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-20 w-[240px] bg-white border border-[#E8E7E2] rounded-[12px] shadow-xl p-3">
                    <div className="text-[12px] font-semibold text-[#111] mb-0.5">Hiển thị cột</div>
                    <div className="text-[10.5px] text-[#999] mb-2">Bỏ tick để ẩn cột. Chỉ ẩn hiển thị — thẻ công ty vẫn ở nguyên giai đoạn.</div>
                    <div className="space-y-0.5">
                      {COLUMN_DEFS.map((c, i) => (
                        <label key={c.id} className={`flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[#F9F9F7] cursor-pointer text-[12px] ${i === STAGES.length ? 'mt-1.5 border-t border-[#F0EEE9] pt-2' : ''}`}>
                          <input type="checkbox" checked={!isHidden(c.id)} onChange={() => toggleCol(c.id)} />
                          <span className="flex-1">{c.label}</span>
                          <span className="text-[10.5px] text-[#aaa]">{c.count}</span>
                        </label>
                      ))}
                    </div>
                    {hiddenCols.length > 0 && (
                      <button onClick={() => setHiddenCols([])} className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"><RotateCcw size={10} /> Hiện lại tất cả</button>
                    )}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setCostPlanFor('all')}
              title="Lập / xem phương án báo giá — giống ở Workspace"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white border border-violet-300 text-violet-700 hover:bg-violet-50 transition"
            >
              <FileText size={13} /> <span className="hidden sm:inline">Phương án giá</span><span className="sm:hidden">PA giá</span>
            </button>
            <button
              onClick={() => setShowDealModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white border border-[#1D4ED8] text-[#1D4ED8] hover:bg-blue-50 transition"
            >
              <Briefcase size={13} /> <span className="hidden sm:inline">Tạo thương vụ mới</span><span className="sm:hidden">Thương vụ</span>
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"
            >
              <Plus size={13} /> <span className="hidden sm:inline">Thêm công ty</span><span className="sm:hidden">Công ty</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 md:p-5">
        <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap mb-2 text-[11.5px] text-[#888]">
          <label title="Lọc công ty theo nguồn: sale, đối tác giới thiệu, công ty, chi nhánh"
            className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 rounded-lg border transition ${sourceFilter !== 'all' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E8E7E2] text-[#666]'}`}>
            <Filter size={12} className="shrink-0" /> Nguồn:
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
              className="bg-transparent outline-none text-[13px] md:text-[12px] font-medium py-1.5 md:py-1 max-w-[200px] cursor-pointer">
              <option value="all">Tất cả ({localPipeline.length})</option>
              {sourceGroups.map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map(o => <option key={o.key} value={o.key}>{o.label} ({o.count})</option>)}
                </optgroup>
              ))}
              <option value="none">Chưa ghi nguồn ({noSourceCount})</option>
            </select>
          </label>
          {sourceFilter !== 'all' && (
            <span className="inline-flex items-center gap-1.5 text-[#555]">
              {sourceFilterTitle}: <b className="text-[#111]">{visible.length}</b> công ty
              <button onClick={() => setSourceFilter('all')} className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"><X size={11} /> Bỏ lọc</button>
            </span>
          )}
          {hiddenDefs.length > 0 && (
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              Đang ẩn:
              {hiddenDefs.map(c => (
                <button key={c.id} onClick={() => toggleCol(c.id)} title="Bấm để hiện lại"
                  className="px-2 py-0.5 rounded-full bg-white border border-[#E8E7E2] text-[#555] hover:border-blue-300 hover:text-blue-700">
                  {c.label} ({c.count}) <span className="text-[#bbb]">+</span>
                </button>
              ))}
            </span>
          )}
        </div>
        {/* Kanban — điện thoại: chip chọn giai đoạn + danh sách thẻ rộng đủ đọc tên */}
        {(() => {
          if (!visibleStages.length) return null;
          const cur = visibleStages.find(s => s.id === mobileStage) ?? visibleStages[0];
          const items = visible.filter(e => e.stage === cur.id);
          return (
            <div className="md:hidden mb-4">
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 pb-2.5">
                {visibleStages.map(stage => {
                  const n = visible.filter(e => e.stage === stage.id).length;
                  const active = stage.id === cur.id;
                  return (
                    <button key={stage.id} onClick={() => setMobileStage(stage.id)}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12.5px] font-semibold border transition ${active ? `${stage.headerBg} ${stage.headerText} border-current` : 'bg-white text-[#666] border-[#E8E7E2]'}`}>
                      {stage.label}
                      <span className={`text-[11px] px-1.5 rounded-full ${active ? 'bg-white/70' : 'bg-[#F1F0EA] text-[#888]'}`}>{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="space-y-2">
                {items.length === 0 && (
                  <div className="text-center text-[12.5px] text-[#aaa] py-8 bg-white border border-dashed border-[#E2E0D9] rounded-xl">Chưa có công ty ở giai đoạn này</div>
                )}
                {items.map(entry => {
                  const rc = RATING_CONFIG[entry.rating || 'normal'] || RATING_CONFIG.normal;
                  return (
                    <div key={entry.id} className="bg-white border border-[#E8E7E2] rounded-xl flex items-stretch overflow-hidden">
                      <button onClick={() => setProfileEntry(entry)} className="flex-1 min-w-0 text-left px-3.5 py-3 active:bg-[#F9F9F7]">
                        <div className="flex items-start gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${rc.dot}`} title={rc.label} />
                          <div className="min-w-0">
                            <div className="flex items-start gap-1.5">
                              <div className="flex-1 min-w-0 text-[14px] font-semibold text-[#111] leading-snug line-clamp-2">{entry.company_name}</div>
                              <span className="mt-0.5">{planBadge(entry, false)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0 text-[12px] text-[#888] mt-0.5">
                              <span className="truncate">
                                {branchOf(entry, branches)?.name ?? entry.region ?? '—'}
                                {entry.worker_estimate ? ` · ~${entry.worker_estimate} LĐ` : ''}
                                {entry.last_contact ? ` · LH ${entry.last_contact}` : ''}
                              </span>
                              <PipelineSourceChip entry={entry} branches={branches} className="shrink-0 max-w-[55%]" />
                            </div>
                          </div>
                        </div>
                      </button>
                      {/* Ô chọn gốc của hệ điều hành — chạm là mở danh sách giai đoạn */}
                      <label className="relative shrink-0 flex flex-col items-center justify-center gap-0.5 w-[68px] border-l border-[#F0EEE9] text-[#1D4ED8] active:bg-blue-50">
                        <Columns3 size={15} />
                        <span className="text-[10.5px] font-semibold">Chuyển</span>
                        <select
                          value={entry.stage}
                          onChange={e => moveEntry(entry.id, e.target.value)}
                          aria-label={`Chuyển giai đoạn ${entry.company_name}`}
                          className="absolute inset-0 opacity-0 w-full h-full"
                        >
                          {STAGES.map(st => <option key={st.id} value={st.id}>{st.label}</option>)}
                        </select>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        <div className="hidden md:grid gap-2 mb-4" style={{ gridTemplateColumns: `repeat(${Math.max(visibleStages.length, 1)}, minmax(0, 1fr))` }}>
          {visibleStages.map(stage => {
            const items = visible.filter(e => e.stage === stage.id);
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
                          <span className="flex items-center gap-1 shrink-0">
                            {planBadge(entry)}
                            <span className={`w-2 h-2 rounded-full mt-0.5 ${rc.dot}`} title={rc.label} />
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-[#888]">
                          <span className="truncate">
                            {[branchOf(entry, branches)?.name ?? entry.region, entry.worker_estimate ? `~${entry.worker_estimate} LĐ` : null].filter(Boolean).join(' · ')}
                          </span>
                          <PipelineSourceChip entry={entry} branches={branches} className="shrink-0 max-w-[55%]" />
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
        {(!isHidden('khong-nhu-cau') || !isHidden('ngung')) && (
          <div className={`grid gap-2.5 ${!isHidden('khong-nhu-cau') && !isHidden('ngung') ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {[
              { id: 'khong-nhu-cau', label: 'Không hợp tác', items: archivedKNN },
              { id: 'ngung',         label: 'Ngưng HĐ',      items: archivedNgung },
            ].filter(sec => !isHidden(sec.id)).map(sec => {
              const all = !!showAllArchived[sec.id];
              const shown = all ? sec.items : sec.items.slice(0, 3);
              return (
                <div key={sec.id} className="bg-[#F5F4EF] rounded-lg p-3">
                  <div className="text-[11.5px] font-semibold text-[#888] mb-2">{sec.label} ({sec.items.length})</div>
                  <div className="space-y-0.5">
                    {shown.map(e => (
                      <div key={e.id} className="flex items-center gap-1 group">
                        <button onClick={() => setProfileEntry(e)}
                          className="flex-1 min-w-0 text-left text-[13px] md:text-[12px] text-[#555] hover:text-[#111] transition truncate py-1.5 md:py-0.5">
                          {e.company_name}{(() => { const n = branchOf(e, branches)?.name ?? e.region; return n ? ` · ${n}` : ''; })()}
                          {e.sub_status && <span className="text-[10.5px] text-red-400"> — {e.sub_status}</span>}
                        </button>
                        <PipelineSourceChip entry={e} branches={branches} className="shrink-0 max-w-[40%]" />
                        <button onClick={() => handleRestore(e)} title="Khôi phục về Tiềm năng"
                          className="md:opacity-0 md:group-hover:opacity-100 p-2 md:p-0.5 rounded text-[#999] hover:text-blue-600 hover:bg-white transition shrink-0"><RotateCcw size={13} className="md:hidden" /><RotateCcw size={11} className="hidden md:block" /></button>
                      </div>
                    ))}
                    {sec.items.length > 3 && (
                      <button onClick={() => setShowAllArchived(m => ({ ...m, [sec.id]: !all }))} className="text-[11px] text-blue-600 hover:underline">
                        {all ? 'Thu gọn' : `Xem tất cả (+${sec.items.length - 3})`}
                      </button>
                    )}
                    {sec.items.length === 0 && <div className="text-[11px] text-[#bbb]">Chưa có</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 md:p-0">
          <div className="bg-white rounded-[10px] border border-[#E8E7E2] w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-[15px] font-semibold text-[#111] mb-4">Thêm công ty mới</h2>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Tên công ty *</label>
                <input value={modalForm.name} onChange={e => setModalForm(f => ({ ...f, name: e.target.value }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                <DuplicateCompanyNotice dup={dup} onUseName={n => setModalForm(f => ({ ...f, name: n }))} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Chi nhánh</label>
                <select value={modalForm.branchId} onChange={e => setModalForm(f => ({ ...f, branchId: e.target.value }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  <option value="">Chọn chi nhánh</option>
                  {branchOptions(branches).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Nguồn <span className="font-normal text-[#aaa]">— ai / đâu mang dự án về</span></label>
                <PipelineSourcePicker
                  value={modalForm.source}
                  onChange={v => setModalForm(f => ({ ...f, source: v }))}
                  branches={branches}
                  defaultBranchId={modalForm.branchId}
                />
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
                <label className="text-[12px] text-[#666] font-medium">Khu công nghiệp</label>
                <select value={modalForm.zone} onChange={e => setModalForm(f => ({ ...f, zone: e.target.value, ncc: [] }))}
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  <option value="">Chọn KCN (tuỳ chọn)</option>
                  {refZones.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              {modalForm.zone && (() => {
                const list = competitorsInZone(refCompetitors, modalForm.zone);
                return (
                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] text-[#666] font-medium">Nhà cung ứng khác tại KCN này</label>
                    {list.length === 0 ? <div className="text-[11.5px] text-[#aaa] italic">Chưa có đối thủ nào ghi nhận ở KCN này</div> : (
                      <div className="flex flex-wrap gap-1">
                        {list.map(c => {
                          const on = modalForm.ncc.includes(c.company_name);
                          return (
                            <button type="button" key={c.id} onClick={() => setModalForm(f => ({ ...f, ncc: on ? f.ncc.filter(n => n !== c.company_name) : [...f.ncc, c.company_name] }))}
                              className={`px-2 py-0.5 rounded-full border text-[11.5px] ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                              {on ? '✓ ' : ''}{c.company_name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Ảnh tuyển dụng (dán link, tuỳ chọn)</label>
                <textarea rows={2} value={modalForm.images} onChange={e => setModalForm(f => ({ ...f, images: e.target.value }))}
                  placeholder="Mỗi link một dòng"
                  className="text-[12px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-none" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Link Google Maps (tuỳ chọn)</label>
                <input value={modalForm.mapLink} onChange={e => setModalForm(f => ({ ...f, mapLink: e.target.value }))}
                  placeholder="https://maps.google.com/…/@lat,lng… → ghim lên bản đồ"
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                <MapLinkHint value={modalForm.mapLink} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Ảnh bìa (dán link ảnh, tuỳ chọn)</label>
                <input value={modalForm.cover} onChange={e => setModalForm(f => ({ ...f, cover: e.target.value }))}
                  placeholder="Ảnh cổng / nhà xưởng — chỉnh vị trí sau trong hồ sơ"
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
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

      {/* Hồ sơ công ty — bên phải / giữa màn hình / toàn màn hình (chọn ở góc trên hồ sơ) */}
      {profileEntry && (
        <CompanyProfileModal
          entry={profileEntry}
          contacts={contacts}
          onContactsChanged={loadContacts}
          products={products}
          onClose={() => setProfileEntry(null)}
          onUpdate={handleUpdate}
          onDelete={() => handleDelete(profileEntry.id)}
          toast={toast}
          isAdmin={user?.role === 'admin'}
          onOpenCostPlan={() => setCostPlanFor(profileEntry)}
          costPlanCount={planCounts[profileEntry.id] ?? 0}
          onRefresh={onRefresh}
        />
      )}

      {/* Phương án giá — mở chồng lên hồ sơ công ty; đóng lại là quay về đúng chỗ đang xem */}
      {costPlanFor && (
        <CostPlanModal
          clients={clients} pipeline={pipeline} branches={branches} toast={toast}
          focus={costPlanFor === 'all' ? null : { pipelineId: costPlanFor.id, clientId: costPlanFor.client_id, companyName: costPlanFor.company_name }}
          onPlansChanged={setPlans}
          onClose={() => setCostPlanFor(null)}
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
