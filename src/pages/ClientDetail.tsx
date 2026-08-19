import { useState, useMemo, useEffect } from 'react';
import { useHashTab } from '../hooks/useHashSubRoute';
import { ArrowLeft, Edit2, Check, X, RefreshCw, ArrowRightLeft, FileText, Upload, Trash2, Sparkles, Download } from 'lucide-react';
import { Line, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler } from 'chart.js';
import type { Client, LaborHistoryEntry, ClientManagerHistory, ClientBranchHistory, MarketZone, CRMDeal as CRMDealType, ClientGift, ClientDocument, ClientDocumentType, CRMProduct, CRMPipelineEntry, ServiceType } from '../lib/types';
import { CompanyProfileModal } from '../components/crm/CompanyProfileModal';
import { getOrCreatePipelineEntryForClient } from '../lib/pipelineHelpers';
import { formatDate, getMonthLast, recentMonths, getCurrentWeekLabel, recentWeekLabels, weekLabelsForMonth, weekLabelFull, sortLaborHistory, statusPill, monthLabel } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { useContacts } from '../hooks/useContacts';
import { useManagers } from '../hooks/useManagers';
import { useBranchData } from '../hooks/useBranchData';
import { askGeminiAboutDocument, geminiConfigured } from '../lib/gemini';
import { HealthScoreRing } from '../components/clients/HealthScoreRing';
import PaymentTermsSection from '../components/clients/PaymentTermsSection';
import { calcHealthScore, hsColor, hsLabel } from '../utils/healthScore';
import PaymentHistory from '../components/clients/PaymentHistory';
import ExportMdModal from '../components/clients/ExportMdModal';
import SocialLinksRow from '../components/SocialLinksRow';
import { parseLatLngFromLink, isValidVnLatLng } from '../lib/geo';
import DayCell from '../components/DayCell';
import CoverImageEditor from '../components/CoverImageEditor';
import SearchSelect from './market/SearchSelect';
import { fetchIndustries, addIndustry } from './market/industries';
import { formatDayRange, normalizeDayRange } from '../utils/timelineDays';
import { isSuspended, suspensionLabel, suspensionMonth, suspensionDate, shortMonth, todayISO } from '../utils/suspension';
import { branchOptions, branchLabelOf } from '../lib/branchRef';
import { KpiTile, SectionCard, InfoRow, PencilButton, QuickNav, useSectionState } from '../components/ui/PanelKit';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler);

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type TimelineForm = {
  cutoff_day: number | null; cutoff_day_end: number | null;
  calc_day: number | null; calc_day_end: number | null;
  payment_start: number | null; payment_end: number | null;
  salary_day: number | null; salary_day_end: number | null;
};

/** Chỉ nhập 1 ô => mốc 1 ngày: dồn về ngày bắt đầu, bỏ ngày kết thúc. */
function normalizeTimelineForm(f: TimelineForm): TimelineForm {
  const cutoff = normalizeDayRange(f.cutoff_day, f.cutoff_day_end);
  const calc = normalizeDayRange(f.calc_day, f.calc_day_end);
  const pay = normalizeDayRange(f.payment_start, f.payment_end);
  const salary = normalizeDayRange(f.salary_day, f.salary_day_end);
  return {
    cutoff_day: cutoff.start, cutoff_day_end: cutoff.end,
    calc_day: calc.start, calc_day_end: calc.end,
    payment_start: pay.start, payment_end: pay.end,
    salary_day: salary.start, salary_day_end: salary.end,
  };
}

const DOC_TYPE_LABELS: Record<ClientDocumentType, string> = {
  contract: 'Hợp đồng',
  appendix: 'Phụ lục',
  other: 'Khác',
};

/** Các khối gập/mở của tab "Tổng quan" — dùng chung cho thanh điều hướng nhanh. */
type SectionKey = 'info' | 'labor' | 'pay' | 'docs' | 'health' | 'hist';

const OVERVIEW_NAV: { key: SectionKey; label: string; icon: string }[] = [
  { key: 'info',   label: 'Thông tin & Hợp đồng', icon: '📋' },
  { key: 'labor',  label: 'Lao động',             icon: '👥' },
  { key: 'pay',    label: 'Thanh toán',           icon: '💰' },
  { key: 'docs',   label: 'Tài liệu',             icon: '📄' },
  { key: 'health', label: 'Sức khoẻ',             icon: '❤️' },
  { key: 'hist',   label: 'Lịch sử',              icon: '🕘' },
];

interface ClientDetailProps {
  client: Client;
  laborHistory: LaborHistoryEntry[];
  managerHistory: ClientManagerHistory[];
  products: CRMProduct[];
  onBack: () => void;
  onClientUpdate: (client: Client) => void;
  onLaborUpdate: (entry: LaborHistoryEntry) => void;
  onManagerHistoryAdd: (entry: ClientManagerHistory) => void;
  onMarketZoneAdd: (zone: MarketZone) => void;
  marketZones: MarketZone[];
  toast: (msg: string) => void;
  onOpenDeal?: (dealId: string) => void;
}

export default function ClientDetail({ client, laborHistory, managerHistory, products, onBack, onClientUpdate, onLaborUpdate, onManagerHistoryAdd, onMarketZoneAdd, marketZones, toast, onOpenDeal }: ClientDetailProps) {
  const { user } = useAuth();
  const { managers } = useManagers();
  const CD_TAB_KEYS = ['overview', 'profile'] as const;
  const [activeTab, setActiveTab] = useHashTab<'overview' | 'profile'>('client-detail', CD_TAB_KEYS, 'overview', 2);
  const [profileEntry, setProfileEntry] = useState<CRMPipelineEntry | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  // Sửa nhanh mốc ngưng hợp tác (cho khách đã ngưng từ trước, chưa có/sai ngày).
  const [suspEdit, setSuspEdit] = useState<string | null>(null);
  const [suspSaving, setSuspSaving] = useState(false);
  const [editingProjectType, setEditingProjectType] = useState(false);
  const [tempProjectType, setTempProjectType] = useState<string>('contracted');
  const [tempLgPct, setTempLgPct] = useState(60);
  const [editingSocialLinks, setEditingSocialLinks] = useState(false);
  const [socialForm, setSocialForm] = useState({ website_url: '', facebook_url: '', youtube_url: '', tiktok_url: '' });
  const [chartView, setChartView] = useState<'week' | 'month'>('week');
  const [laborWeek, setLaborWeek] = useState(getCurrentWeekLabel());
  const [laborInput, setLaborInput] = useState(String(client.current_workers || 0));
  const [laborMsg, setLaborMsg] = useState(false);
  const [extraMonth, setExtraMonth] = useState(''); // value of <input type="month"> picker
  const [extraMonths, setExtraMonths] = useState<{ year: number; month: number }[]>([]);
  const monthSortKey = (label: string) => {
    const m = label.match(/Tháng (\d+)\/(\d+)/);
    return m ? Number(m[2]) * 12 + Number(m[1]) : 0;
  };
  const weekGroups = useMemo(() => {
    const base = recentWeekLabels(2);
    const baseMonths = new Set(base.map(g => g.month));
    const extra = extraMonths
      .map(({ year, month }) => ({ month: `Tháng ${month}/${year}`, labels: weekLabelsForMonth(year, month).slice().reverse() }))
      .filter(g => !baseMonths.has(g.month));
    return [...base, ...extra].sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month));
  }, [extraMonths]);

  const selectWeek = (wk: string) => {
    setLaborWeek(wk);
    const existing = hist.find(h => h.week_label === wk);
    setLaborInput(existing ? String(existing.count) : '0');
  };

  const addExtraMonth = () => {
    if (!extraMonth) { toast('Vui lòng chọn tháng/năm cần thêm'); return; }
    const [y, m] = extraMonth.split('-').map(Number);
    if (!y || !m) return;
    setExtraMonths(prev => prev.some(e => e.year === y && e.month === m) ? prev : [...prev, { year: y, month: m }]);
    setExtraMonth('');
    // Jump the week selector to this month's most recent week so it's immediately visible
    const labels = weekLabelsForMonth(y, m);
    selectWeek(labels[labels.length - 1]);
    toast(`Đã thêm Tháng ${m}/${y} vào danh sách tuần`);
  };
  // Trạng thái gập/mở của từng khối trong tab Tổng quan (nhớ theo trình duyệt).
  const { sections, setSections, toggle: toggleSection, goto: gotoSection } = useSectionState<SectionKey>(
    { info: true, labor: true, pay: true, docs: false, health: true, hist: false },
    'client-detail-sections-v1',
    'cd',
  );
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadDocType, setUploadDocType] = useState<ClientDocumentType>('contract');
  const [askingDocId, setAskingDocId] = useState<string | null>(null);
  const [docAnswers, setDocAnswers] = useState<Record<string, string>>({});
  const [transferForm, setTransferForm] = useState<{ manager_name: string; effective_from: string } | null>(null);
  const [branchTransferForm, setBranchTransferForm] = useState<{ branch_id: string; effective_from: string; notes: string } | null>(null);
  const [branchHistory, setBranchHistory] = useState<ClientBranchHistory[]>([]);
  const { branches } = useBranchData();
  const [newZoneOpen, setNewZoneOpen] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [form, setForm] = useState({
    name: client.name || '',
    branch_id: client.branch_id || '',
    manager: client.manager || '',
    industrial_zones: client.industrial_zones || [],
    contract_start: client.contract_start || '',
    contract_end: client.contract_end || '',
    notes: client.notes || '',
    service_type: client.service_type ?? 'leasing',
    map_link: client.map_link || '',
    // Ngành nghề + ảnh cover — cùng 2 cột clients.industry/cover_image_* mà Thị Trường >
    // Công ty/Dự án đang đọc/ghi, nên sửa ở đây thấy ngay bên đó (migration 100, 141).
    industry: client.industry || '',
    cover_image_url: client.cover_image_url || '',
    cover_image_fit: client.cover_image_fit || 'cover',
    cover_image_pos_x: client.cover_image_pos_x ?? 50,
    cover_image_pos_y: client.cover_image_pos_y ?? 50,
  });
  const [industries, setIndustries] = useState<string[]>([]);
  useEffect(() => { fetchIndustries([client.industry]).then(setIndustries); }, [client.industry]);
  const handleAddIndustry = async (name: string) => {
    const err = await addIndustry(name);
    if (err) toast('Lỗi thêm ngành: ' + err);
    setIndustries(prev => [...new Set([...prev, name])].sort((a, b) => a.localeCompare(b, 'vi')));
  };
  const [timelineForm, setTimelineForm] = useState({
    cutoff_day: client.cutoff_day, cutoff_day_end: client.cutoff_day_end,
    calc_day: client.calc_day, calc_day_end: client.calc_day_end,
    payment_start: client.payment_start, payment_end: client.payment_end,
    salary_day: client.salary_day, salary_day_end: client.salary_day_end,
  });
  const { contacts: primaryContacts } = useContacts(client.id);

  useEffect(() => {
    supabase.from('client_branch_history').select('*').eq('client_id', client.id).order('effective_from', { ascending: true })
      .then(({ data }) => { if (data) setBranchHistory(data as ClientBranchHistory[]); });
  }, [client.id]);

  useEffect(() => {
    if (activeTab !== 'profile' || profileEntry) return;
    setProfileLoading(true);
    getOrCreatePipelineEntryForClient(client).then(entry => {
      setProfileEntry(entry);
      setProfileLoading(false);
      if (!entry) toast('Lỗi: không thể mở hồ sơ công ty');
    });
  }, [activeTab, client, profileEntry, toast]);

  // Thương vụ CRM của khách hàng này — chỉ còn dùng để hiện người phụ trách
  // (deal owner) và lối tắt sang CRM Pipeline trong tab Hồ sơ chăm sóc.
  const [deals, setDeals] = useState<CRMDealType[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  // Quà tặng ghi ở bảng cũ client_gifts — hiển thị kèm trong mục Quà tặng của
  // hồ sơ (mục này ghi mới vào crm_gifts) để không mất dấu dữ liệu đã nhập.
  const [legacyGifts, setLegacyGifts] = useState<ClientGift[]>([]);
  const [showExportMd, setShowExportMd] = useState(false);

  useEffect(() => {
    if (activeTab !== 'profile') return;
    supabase.from('crm_deals')
      .select('*, crm_products(name)')
      .or(`lead_id.eq.${client.id},client_id.eq.${client.id}`)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data || []) as CRMDealType[];
        setDeals(rows);
        setSelectedDealId(prev => prev && rows.some(d => d.id === prev) ? prev : (rows[0]?.id || null));
      });
    supabase.from('client_gifts')
      .select('*')
      .eq('client_id', client.id)
      .order('gift_date', { ascending: false })
      .then(({ data }) => setLegacyGifts((data || []) as ClientGift[]));
  }, [activeTab, client.id]);

  const loadDocuments = () => {
    supabase.from('client_documents')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setDocuments((data || []) as ClientDocument[]));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDocuments(); }, [client.id]);

  const handleUploadDocument = async (file: File) => {
    setUploadingDoc(true);
    try {
      const path = `${client.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('documents').getPublicUrl(path);
      const { error: insErr, data: row } = await supabase.from('client_documents').insert({
        client_id: client.id,
        name: file.name,
        file_url: data.publicUrl,
        file_path: path,
        doc_type: uploadDocType,
        uploaded_by: user?.full_name || null,
      }).select().single();
      if (insErr) throw insErr;
      setDocuments(prev => [row as ClientDocument, ...prev]);
      toast('Đã tải lên tài liệu');
      await logActivity({
        user, action: 'insert', table: 'client_documents', recordId: row.id,
        description: `Tải lên tài liệu "${file.name}" (${DOC_TYPE_LABELS[uploadDocType]}) cho "${client.name}"`,
        newData: row,
      });
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteDocument = async (doc: ClientDocument) => {
    if (!confirm(`Xóa tài liệu "${doc.name}"?`)) return;
    try {
      await supabase.storage.from('documents').remove([doc.file_path]);
      const { error } = await supabase.from('client_documents').delete().eq('id', doc.id);
      if (error) throw error;
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
      await logActivity({
        user, action: 'delete', table: 'client_documents', recordId: doc.id,
        description: `Xóa tài liệu "${doc.name}" của "${client.name}"`,
        oldData: doc,
      });
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    }
  };

  const handleAskAboutDocument = async (doc: ClientDocument) => {
    setAskingDocId(doc.id);
    try {
      const answer = await askGeminiAboutDocument(doc.file_url, 'Tóm tắt ngắn gọn nội dung chính của tài liệu này bằng tiếng Việt (loại hợp đồng, các bên liên quan, thời hạn, điều khoản quan trọng).');
      setDocAnswers(prev => ({ ...prev, [doc.id]: answer }));
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setAskingDocId(null);
    }
  };

  const selectedDeal = deals.find(d => d.id === selectedDealId) || null;

  const hist = useMemo(() => sortLaborHistory(laborHistory), [laborHistory]);
  const currentWorkers = hist.length ? hist[hist.length - 1].count : 0;

  const chartData = useMemo(() => {
    if (chartView === 'week') {
      return {
        labels: hist.map(h => h.week_label),
        datasets: [{ label: 'LĐ', data: hist.map(h => h.count), borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 4 }],
      };
    }
    const months = recentMonths(3);
    const counts = months.map(mo => getMonthLast(hist, mo.month));
    return {
      labels: months.map(mo => mo.label),
      datasets: [{ label: 'LĐ', data: counts, backgroundColor: counts.map((_, i) => i === counts.length - 1 ? '#3B82F6' : 'rgba(59,130,246,.3)'), borderRadius: 6, barPercentage: 0.6 }],
    };
  }, [hist, chartView]);

  const chartYMin = useMemo(() => {
    const vals = chartView === 'week'
      ? hist.map(h => h.count)
      : recentMonths(3).map(mo => getMonthLast(hist, mo.month)).filter((v): v is number => v !== null);
    if (!vals.length) return 0;
    // Bar chart: bat dau tu 0 (chieu cao cot phai phan anh dung ty le tuyet doi)
    if (chartView === 'month') return 0;
    // Line chart: padding 20% cua range phia duoi, toi thieu 10 don vi
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min;
    const padding = Math.max(10, Math.round(range * 0.2));
    return Math.max(0, min - padding);
  }, [hist, chartView]);

  const monthRows = useMemo(() => {
    const months = recentMonths(3);
    const counts = months.map(mo => getMonthLast(hist, mo.month));
    return months.map((mo, i) => ({ m: mo.label, cnt: counts[i], prev: i === 0 ? null : counts[i - 1] }));
  }, [hist]);

  /* ── Số liệu cho dải chỉ số nhanh đầu tab Tổng quan ── */
  const healthScore = useMemo(() => calcHealthScore({
    currentWorkers: client.current_workers || 0,
    minWorkers: client.min_workers || 0,
    paidThisMonth: client.paid_this_month || false,
    progCutoff: client.prog_cutoff || false,
    contractEnd: client.contract_end || '',
    lastContactDate: '',
    workerHistory: hist.slice(-6).map(h => h.count),
  }), [client, hist]);

  /** Chênh lệch LĐ của tháng gần nhất so với tháng trước (null nếu thiếu số liệu). */
  const laborDelta = useMemo(() => {
    const last = monthRows[monthRows.length - 1];
    return last && last.cnt !== null && last.prev !== null ? last.cnt - last.prev : null;
  }, [monthRows]);

  /** Số ngày còn lại của hợp đồng (âm = đã quá hạn, null = chưa nhập ngày hết hạn). */
  const contractDaysLeft = useMemo(() => {
    if (!client.contract_end) return null;
    const end = new Date(client.contract_end).getTime();
    if (isNaN(end)) return null;
    return Math.ceil((end - Date.now()) / 86400000);
  }, [client.contract_end]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Tên công ty không được để trống'); return; }
    try {
      // Dán link Google Maps → tự sinh toạ độ; xoá link (khi trước đó có) → xoá toạ độ đi kèm
      const mapPos = parseLatLngFromLink(form.map_link);
      const linkCleared = !form.map_link.trim() && !!client.map_link;
      const baseUpdates = {
        ...form,
        map_link: form.map_link.trim() || null,
        industry: form.industry.trim() || null,
        cover_image_url: form.cover_image_url.trim() || null,
        ...(isValidVnLatLng(mapPos)
          ? { lat: mapPos.lat, lng: mapPos.lng, geocoded_at: new Date().toISOString() }
          : linkCleared ? { lat: null, lng: null, geocoded_at: null } : {}),
        ...normalizeTimelineForm(timelineForm),
        updated_at: new Date().toISOString(),
      };
      if (form.service_type === 'recruitment') {
        baseUpdates.cutoff_day = null as any;
        baseUpdates.calc_day = null as any;
        baseUpdates.salary_day = null as any;
        baseUpdates.payment_start = null as any;
        baseUpdates.payment_end = null as any;
      }
      const updates = baseUpdates;
      const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
      if (error) throw error;
      onClientUpdate({ ...client, ...updates });
      setEditing(false);
      toast('Đã lưu thông tin khách hàng!');
      await logActivity({
        user, action: 'update', table: 'clients', recordId: client.id,
        description: `Cập nhật thông tin khách hàng "${client.name}"`,
        oldData: client, newData: { ...client, ...updates },
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const handleManagerTransfer = async () => {
    if (!transferForm?.manager_name) return;
    try {
      const { data, error } = await supabase.from('client_manager_history')
        .insert({ client_id: client.id, manager_name: transferForm.manager_name, effective_from: transferForm.effective_from, created_by: user?.full_name || null })
        .select().single();
      if (error) throw error;
      onManagerHistoryAdd(data as ClientManagerHistory);
      const updates = { manager: transferForm.manager_name, updated_at: new Date().toISOString() };
      const { error: e2 } = await supabase.from('clients').update(updates).eq('id', client.id);
      if (e2) throw e2;
      onClientUpdate({ ...client, ...updates });
      await logActivity({
        user, action: 'insert', table: 'client_manager_history', recordId: data.id,
        description: `Chuyển quản lý "${client.name}" sang "${transferForm.manager_name}" từ ${monthLabel(transferForm.effective_from)}`,
        newData: data,
      });
      setTransferForm(null);
      toast('Đã ghi nhận chuyển đổi quản lý');
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const handleBranchTransfer = async () => {
    if (!branchTransferForm?.branch_id) { toast('Vui long chon chi nhanh moi'); return; }
    const newBranch = branches.find(b => b.id === branchTransferForm.branch_id);
    if (!newBranch) { toast('Khong tim thay chi nhanh'); return; }
    try {
      const { data, error } = await supabase.from('client_branch_history')
        .insert({
          client_id: client.id,
          branch_id: newBranch.id,
          // Ghi kèm tên tại thời điểm chuyển — nhật ký giữ nguyên chữ dù sau này chi nhánh đổi tên.
          branch_name: newBranch.name,
          effective_from: branchTransferForm.effective_from,
          notes: branchTransferForm.notes || null,
          created_by: user?.full_name || null,
        })
        .select().single();
      if (error) throw error;
      setBranchHistory(prev => [...prev, data as ClientBranchHistory].sort((a, b) => a.effective_from.localeCompare(b.effective_from)));
      const updates = { branch_id: newBranch.id, updated_at: new Date().toISOString() };
      const { error: e2 } = await supabase.from('clients').update(updates).eq('id', client.id);
      if (e2) throw e2;
      onClientUpdate({ ...client, ...updates });
      await logActivity({
        user, action: 'insert', table: 'client_branch_history', recordId: data.id,
        description: `Chuyen chi nhanh "${client.name}" sang "${newBranch.name}" tu ${monthLabel(branchTransferForm.effective_from)}`,
        newData: data,
      });
      setBranchTransferForm(null);
      toast('Da ghi nhan chuyen chi nhanh');
    } catch (e: unknown) {
      toast('Loi: ' + errMsg(e));
    }
  };

  const handleAddZone = async () => {
    const name = newZoneName.trim();
    if (!name) return;
    const existing = marketZones.find(z => z.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      toast(`Khu công nghiệp "${existing.name}" đã có — đã chọn cho công ty này`);
      setForm({ ...form, industrial_zones: [existing.name] });
      setNewZoneOpen(false);
      setNewZoneName('');
      return;
    }
    try {
      const { data, error } = await supabase.from('market_zones')
        .insert({ name, labor_availability: 'Trung bình' })
        .select().single();
      if (error) throw error;
      onMarketZoneAdd(data as MarketZone);
      await logActivity({
        user, action: 'insert', table: 'market_zones', recordId: data.id,
        description: `Thêm khu công nghiệp "${name}" (từ trang khách hàng "${client.name}")`,
        newData: data,
      });
      setForm({ ...form, industrial_zones: [name] });
      setNewZoneOpen(false);
      setNewZoneName('');
      toast(`Đã tạo Khu công nghiệp "${name}" và đồng bộ vào Thị trường > Khu vực`);
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const saveSuspensionDate = async () => {
    if (!suspEdit) { toast('Vui lòng chọn ngày ngưng hợp tác'); return; }
    setSuspSaving(true);
    const now = new Date().toISOString();
    const oldDate = suspensionDate(client);
    try {
      const { error } = await supabase.from('clients')
        .update({ suspended_from: suspEdit, updated_at: now }).eq('id', client.id);
      if (error) throw error;
      onClientUpdate({ ...client, suspended_from: suspEdit });
      await logActivity({
        user, action: 'update', table: 'clients', recordId: client.id,
        description: `Sửa mốc ngưng hợp tác "${client.name}": ${oldDate ? formatDate(oldDate) : '(chưa có)'} → ${formatDate(suspEdit)}`,
        oldData: client, newData: { ...client, suspended_from: suspEdit },
      });
      toast(`Đã cập nhật ngày ngưng thành ${formatDate(suspEdit)}`);
      setSuspEdit(null);
    } catch (e: unknown) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setSuspSaving(false);
    }
  };

  const handleLaborUpdate = async () => {
    const val = parseInt(laborInput);
    if (isNaN(val) || val < 0) { toast('Số lao động không hợp lệ'); return; }
    const wk = laborWeek;
    try {
      const existing = hist.find(h => h.week_label === wk);
      if (existing) {
        const { error } = await supabase.from('client_labor_history').update({ count: val }).eq('id', existing.id);
        if (error) throw error;
        onLaborUpdate({ ...existing, count: val });
        await logActivity({
          user, action: 'update', table: 'client_labor_history', recordId: existing.id,
          description: `Cập nhật LĐ tuần ${wk} cho "${client.name}": ${existing.count.toLocaleString()} → ${val.toLocaleString()}`,
          oldData: existing, newData: { ...existing, count: val },
        });
      } else {
        const { data, error } = await supabase.from('client_labor_history').insert({ client_id: client.id, week_label: wk, count: val, updated_by: user?.full_name || null }).select().single();
        if (error) throw error;
        onLaborUpdate(data);
        await logActivity({
          user, action: 'insert', table: 'client_labor_history', recordId: data.id,
          description: `Thêm số liệu LĐ tuần ${wk} cho "${client.name}": ${val.toLocaleString()}`,
          newData: data,
        });
      }
      setLaborMsg(true);
      setTimeout(() => setLaborMsg(false), 3000);
      toast(`Đã cập nhật ${val.toLocaleString()} LĐ tuần ${wk}`);
    } catch (e: any) {
      toast('Lỗi lưu: ' + e.message);
    }
  };

  const pill = statusPill(client.status);

  return (
    <>
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
        <div className="flex items-center gap-2.5">
          <button onClick={onBack} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            <ArrowLeft size={13} /> Quay lại
          </button>
          <div>
            <div className="text-[14px] font-semibold text-[#111] flex items-center gap-2">
              {client.name}
              {isSuspended(client) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200 font-medium whitespace-nowrap">
                  {suspensionLabel(client)}
                </span>
              )}
            </div>
            <div className="text-[11.5px] text-[#888]">{branchLabelOf(client, branches)} · <span className={pill.cls.includes('emerald') ? 'text-emerald-600' : pill.cls.includes('amber') ? 'text-amber-600' : 'text-red-600'}>{pill.label}</span></div>
            {isSuspended(client) && (
              suspEdit !== null ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[11px] text-[#666]">Ngày ngưng:</span>
                  <input
                    type="date" value={suspEdit} autoFocus disabled={suspSaving}
                    onChange={e => setSuspEdit(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveSuspensionDate(); if (e.key === 'Escape') setSuspEdit(null); }}
                    className="text-[11.5px] px-2 py-1 border border-orange-400 rounded-lg outline-none"
                  />
                  <button onClick={saveSuspensionDate} disabled={suspSaving || !suspEdit}
                    className="text-[11px] px-2 py-1 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 transition">
                    {suspSaving ? 'Đang lưu...' : 'Lưu'}
                  </button>
                  <button onClick={() => setSuspEdit(null)} className="text-[11px] px-2 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Hủy</button>
                </div>
              ) : (
                <div className="text-[11px] text-orange-700 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {suspensionMonth(client) ? (
                    <span>Tháng cuối còn nhập P&amp;L / số lao động: <strong>{shortMonth(suspensionMonth(client)!)}</strong></span>
                  ) : (
                    <span className="text-red-600 font-medium">⚠ Chưa có ngày ngưng — mọi tháng đều đang bị khoá nhập liệu</span>
                  )}
                  {user?.role === 'admin' && (
                    <button
                      onClick={() => setSuspEdit(suspensionDate(client) || todayISO())}
                      className="text-[11px] text-blue-600 hover:underline"
                    >✎ Sửa ngày ngưng</button>
                  )}
                  {client.suspension_reason && <span className="text-[#888]">· Lý do: {client.suspension_reason}</span>}
                </div>
              )
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={form.service_type}
            onChange={async e => {
              const newType = e.target.value as ServiceType;
              setForm(f => ({ ...f, service_type: newType }));
              const extra = newType === 'recruitment'
                ? { cutoff_day: null, calc_day: null, salary_day: null, payment_start: null, payment_end: null }
                : {};
              try {
                const updates = { service_type: newType, ...extra, updated_at: new Date().toISOString() };
                const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
                if (error) throw error;
                onClientUpdate({ ...client, ...updates });
                await logActivity({ user, action: 'update', table: 'clients', recordId: client.id, description: `Doi loai hinh dich vu cua "${client.name}" thanh ${newType}`, oldData: client, newData: { ...client, ...updates } });
                toast('Da cap nhat loai hinh dich vu');
              } catch (err: any) { toast('Loi: ' + err.message); }
            }}
            className="text-[12px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 bg-white"
          >
            <option value="leasing">Cho thue lao dong</option>
            <option value="recruitment">Gioi thieu lao dong</option>
            <option value="hoh">HOH</option>
          </select>
          <button onClick={() => setShowExportMd(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-emerald-500 text-emerald-700 hover:bg-emerald-50 transition">
            <Download size={13} /> Xuất MD
          </button>
          <button onClick={() => setEditing(!editing)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-blue-500 text-blue-700 hover:bg-blue-50 transition">
            {editing ? <><X size={13} /> Hủy</> : <><Edit2 size={13} /> Sửa thông tin</>}
          </button>
        </div>
      </div>
      {showExportMd && <ExportMdModal client={client} onClose={() => setShowExportMd(false)} toast={toast} />}

      {/* Tab bar */}
      <div className="flex border-b border-[#E8E7E2] bg-white shrink-0 px-6">
        {(['overview', 'profile'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-[12.5px] font-medium border-b-2 transition -mb-px ${
              activeTab === tab
                ? 'border-[#1D4ED8] text-[#1D4ED8]'
                : 'border-transparent text-[#888] hover:text-[#555]'
            }`}
          >
            {tab === 'overview' ? '📊 Tổng quan' : '🗂️ Hồ sơ chăm sóc'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {activeTab === 'profile' ? (
          profileLoading || !profileEntry ? (
            <div className="text-[12px] text-[#999] text-center py-8">Đang tải hồ sơ...</div>
          ) : (
            <CompanyProfileModal
              entry={profileEntry}
              contacts={primaryContacts}
              products={products}
              onUpdate={setProfileEntry}
              toast={toast}
              isAdmin={user?.role === 'admin'}
              variant="panel"
              legacyGifts={legacyGifts}
              dealSummary={selectedDeal ? {
                title: selectedDeal.title,
                value: selectedDeal.value || 0,
                onOpen: onOpenDeal ? () => onOpenDeal(selectedDeal.id) : undefined,
              } : undefined}
              dealOwner={selectedDeal?.owner}
              onDealOwnerChange={selectedDeal ? async (owner) => {
                const { error } = await supabase.from('crm_deals').update({ owner, updated_at: new Date().toISOString() }).eq('id', selectedDeal.id);
                if (error) { toast('Lỗi: ' + error.message); return; }
                setDeals(prev => prev.map(d => d.id === selectedDeal.id ? { ...d, owner } : d));
                toast('Đã cập nhật người phụ trách');
              } : undefined}
            />
          )
        ) : (
          <div className="max-w-[1500px] mx-auto">

            {/* ══ Dải chỉ số nhanh — bấm vào ô là nhảy thẳng tới khối liên quan ══ */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2.5">
              <KpiTile
                label="Lao động hiện tại"
                value={currentWorkers.toLocaleString()}
                sub={laborDelta === null
                  ? (client.min_workers ? `Tối thiểu ${client.min_workers.toLocaleString()} LĐ` : 'Chưa có so sánh tháng')
                  : `${laborDelta > 0 ? '+' : ''}${laborDelta.toLocaleString()} so tháng trước`}
                tone={laborDelta === null ? 'muted' : laborDelta > 0 ? 'good' : laborDelta < 0 ? 'bad' : 'muted'}
                onClick={() => gotoSection('labor')}
              />
              <KpiTile
                label="Sức khoẻ khách hàng"
                value={`${healthScore.total}/100`}
                sub={hsLabel(healthScore.total)}
                valueColor={hsColor(healthScore.total)}
                right={<HealthScoreRing score={healthScore.total} size="sm" />}
                onClick={() => gotoSection('health')}
              />
              <KpiTile
                label="Hợp đồng hết hạn"
                value={client.contract_end ? formatDate(client.contract_end) : '—'}
                sub={contractDaysLeft === null
                  ? 'Chưa nhập ngày hết hạn'
                  : contractDaysLeft < 0 ? `Quá hạn ${Math.abs(contractDaysLeft)} ngày` : `Còn ${contractDaysLeft} ngày`}
                tone={contractDaysLeft === null ? 'muted' : contractDaysLeft < 0 ? 'bad' : contractDaysLeft <= 60 ? 'warn' : 'good'}
                onClick={() => gotoSection('info')}
              />
              <KpiTile
                label="Loại dự án"
                value={client.project_type === 'managed' ? 'Không khoán' : 'Đã khoán'}
                sub={client.project_type === 'managed'
                  ? 'LGV 100%'
                  : `LGV ${client.default_lg_pct ?? 60}% · CN ${client.default_cn_pct ?? 40}%`}
                onClick={() => gotoSection('info')}
              />
              <KpiTile
                label="Thanh toán tháng này"
                value={client.paid_this_month ? 'Đã thu' : 'Chưa thu'}
                valueColor={client.paid_this_month ? '#059669' : '#DC2626'}
                sub="Theo ghi nhận Tài chính"
                tone={client.paid_this_month ? 'good' : 'warn'}
                onClick={() => gotoSection('pay')}
              />
            </div>

            {/* ══ Thanh điều hướng nhanh — dính trên đầu khi cuộn ══ */}
            <div className="mt-3">
              <QuickNav items={OVERVIEW_NAV} onGo={gotoSection} />
            </div>

            {/* ══ Bố cục 2 cột: trái = việc làm hằng ngày, phải = thông tin tham chiếu ══ */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start mt-3">
              <div className="xl:col-span-8 space-y-4">

                {/* ── Thông tin & Hợp đồng ── */}
                <SectionCard
                  id="cd-info"
                  icon="📋"
                  title="Thông tin & Hợp đồng"
                  open={sections.info}
                  onToggle={() => toggleSection('info')}
                  actions={editing ? (
                    <>
                      <button onClick={handleSave} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={12} /> Lưu</button>
                      <button onClick={() => setEditing(false)} className="px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Hủy</button>
                    </>
                  ) : (
                    <button onClick={() => { setSections(s => ({ ...s, info: true })); setEditing(true); }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-medium border border-blue-500 text-blue-700 hover:bg-blue-50 transition"><Edit2 size={11} /> Sửa</button>
                  )}
                >
                  {editing ? (
                    <>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="flex flex-col gap-1 col-span-2">
                      <label className="text-[12px] text-[#666] font-medium">Tên công ty</label>
                      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                    <div className="flex flex-col gap-1 col-span-2">
                      <label className="text-[12px] text-[#666] font-medium">Loai hinh dich vu</label>
                      <select
                        value={form.service_type}
                        onChange={e => setForm({ ...form, service_type: e.target.value as ServiceType })}
                        className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                      >
                        <option value="leasing">Cho thue lao dong (mac dinh)</option>
                        <option value="recruitment">Gioi thieu lao dong</option>
                        <option value="hoh">HOH</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Chi Nhánh</label>
                      <select value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                        <option value="">-- Chon chi nhanh --</option>
                        {branchOptions(branches).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Người quản lý</label>
                      <select value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                        {!managers.some(m => m.name === form.manager) && form.manager && <option key={form.manager}>{form.manager}</option>}
                        {managers.map(m => <option key={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Ngày bắt đầu HĐ</label>
                      <input type="date" value={form.contract_start} onChange={e => setForm({ ...form, contract_start: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[12px] text-[#666] font-medium">Ngày hết hạn HĐ</label>
                      <input type="date" value={form.contract_end} onChange={e => setForm({ ...form, contract_end: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Khu Công Nghiệp</label>
                    <div className="flex items-center gap-2">
                      <select
                        value={form.industrial_zones[0] || ''}
                        onChange={e => setForm({ ...form, industrial_zones: e.target.value ? [e.target.value] : [] })}
                        className="flex-1 text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                      >
                        <option value="">— Chọn khu công nghiệp —</option>
                        {marketZones.map(z => (
                          <option key={z.id} value={z.name}>{z.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setNewZoneOpen(v => !v)}
                        className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-[#555] hover:bg-[#FAFAF8] transition shrink-0"
                      >
                        + Thêm KCN mới
                      </button>
                    </div>
                    {marketZones.length === 0 && <span className="text-[12px] text-[#aaa]">Chưa có khu vực nào trong Thị trường &gt; Khu vực</span>}
                    {newZoneOpen && (
                      <div className="mt-1 p-3 rounded-lg border border-blue-200 bg-blue-50 flex items-center gap-2">
                        <input
                          value={newZoneName}
                          onChange={e => setNewZoneName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddZone(); }}
                          placeholder="Tên khu công nghiệp mới"
                          autoFocus
                          className="flex-1 text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                        />
                        <button onClick={handleAddZone} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={13} /> Thêm</button>
                        <button onClick={() => { setNewZoneOpen(false); setNewZoneName(''); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Ngành nghề</label>
                    <SearchSelect
                      value={form.industry}
                      onChange={v => setForm({ ...form, industry: v })}
                      options={industries.map(i => ({ value: i, label: i }))}
                      placeholder="Chọn ngành… — hiện đồng bộ 2 chiều với Thị trường > Công ty/Dự án"
                      allowAdd
                      onAdd={handleAddIndustry}
                    />
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Link Google Maps</label>
                    <div className="flex items-center gap-2">
                      <input
                        value={form.map_link}
                        onChange={e => setForm({ ...form, map_link: e.target.value })}
                        placeholder="https://maps.google.com/…/@lat,lng… → tự định vị lên Bản đồ Thị trường"
                        className="flex-1 text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                      />
                      {form.map_link && (
                        <a href={form.map_link} target="_blank" rel="noopener noreferrer"
                          className="text-[11.5px] px-2 py-1.5 rounded-lg border border-gray-300 text-[#666] hover:bg-[#FAFAF8] transition shrink-0">Mở</a>
                      )}
                      {client.lat != null && client.lng != null && (
                        <span className="text-[11px] text-emerald-600 shrink-0">✓ đã định vị</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Ảnh cover (tỷ lệ 16:9) — hiện ở thẻ Card trong danh sách Khách hàng & Thị trường</label>
                    <CoverImageEditor
                      value={{ url: form.cover_image_url, fit: form.cover_image_fit, posX: form.cover_image_pos_x, posY: form.cover_image_pos_y }}
                      onChange={v => setForm({ ...form, cover_image_url: v.url ?? '', cover_image_fit: v.fit ?? 'cover', cover_image_pos_x: v.posX ?? 50, cover_image_pos_y: v.posY ?? 50 })}
                      urlPlaceholder="Dán link ảnh cổng công ty…"
                    />
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Ghi chú</label>
                    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 min-h-[60px] resize-y" />
                  </div>

                  <div className="flex flex-col gap-1 mb-3">
                    <label className="text-[12px] text-[#666] font-medium">Lịch thanh toán & tính lương</label>
                    <div className="space-y-2.5 p-3 rounded-lg border border-gray-300">
                      {([
                        { label: 'Chốt công', start: 'cutoff_day', end: 'cutoff_day_end', dot: 'bg-orange-400' },
                        { label: 'Tính lương', start: 'calc_day', end: 'calc_day_end', dot: 'bg-blue-400' },
                        { label: 'Kỳ thanh toán', start: 'payment_start', end: 'payment_end', dot: 'bg-emerald-500' },
                        { label: 'Phát lương', start: 'salary_day', end: 'salary_day_end', dot: 'bg-purple-500' },
                      ] as { label: string; start: keyof typeof timelineForm; end: keyof typeof timelineForm; dot: string }[]).map(row => (
                        <div key={row.start} className="flex items-center gap-3">
                          <div className="w-[110px] shrink-0 flex items-center gap-1.5 text-[12.5px] font-medium text-[#444]">
                            <span className={`inline-block w-2 h-2 rounded-full ${row.dot}`} />
                            {row.label}
                          </div>
                          <div className="flex-1">
                            <label className="text-[10.5px] text-[#999] block mb-0.5">
                              {timelineForm[row.start] != null && timelineForm[row.end] == null ? 'Ngày (1 ngày)' : 'Ngày bắt đầu'}
                            </label>
                            <DayCell value={timelineForm[row.start]} onChange={v => setTimelineForm({ ...timelineForm, [row.start]: v })} />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10.5px] text-[#999] block mb-0.5">Ngày kết thúc</label>
                            <DayCell value={timelineForm[row.end]} onChange={v => setTimelineForm({ ...timelineForm, [row.end]: v })} />
                          </div>
                        </div>
                      ))}
                      <div className="text-[11px] text-[#aaa]">Để trống "Ngày kết thúc" nếu mốc chỉ diễn ra trong 1 ngày. Nút <strong>CT</strong> = cuối tháng, tự nhảy theo số ngày thực tế của từng tháng (28/29/30/31).</div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={handleSave} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={13} /> Lưu thay đổi</button>
                    <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
                  </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">

                      {/* Loại dự án & phân chia lợi nhuận — sửa nhanh tại chỗ */}
                      <InfoRow label="Loại dự án">
                        {!editingProjectType ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-md text-[11.5px] font-medium ${client.project_type === 'managed' ? 'bg-blue-50 text-blue-700' : 'bg-[#EAF3DE] text-[#27500A]'}`}>
                              {client.project_type === 'managed' ? 'Không khoán — Nhận lương' : 'Đã nhận khoán'}
                            </span>
                            <span className="text-[11.5px] text-[#666]">
                              {client.project_type === 'managed' ? 'LGV 100%' : `LGV ${client.default_lg_pct ?? 60}% · CN ${client.default_cn_pct ?? 40}%`}
                            </span>
                            <PencilButton title="Sửa loại dự án" onClick={() => { setEditingProjectType(true); setTempProjectType(client.project_type || 'contracted'); setTempLgPct(client.default_lg_pct ?? 60); }} />
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                                {(['contracted', 'managed'] as const).map(t => (
                                  <button key={t} onClick={() => setTempProjectType(t)}
                                    className={`px-2.5 py-1 text-[11.5px] font-medium transition ${tempProjectType === t ? 'bg-[#F5F4EF] text-[#111]' : 'text-[#888] hover:bg-gray-50'}`}>
                                    {t === 'managed' ? 'Không khoán' : 'Đã khoán'}
                                  </button>
                                ))}
                              </div>
                              {tempProjectType !== 'managed' && (
                                <div className="flex items-center gap-1.5 text-[11.5px]">
                                  <span className="text-[#666]">LGV:</span>
                                  <input type="number" min={0} max={100} value={tempLgPct}
                                    onChange={e => setTempLgPct(Math.max(0, Math.min(100, +e.target.value)))}
                                    className="w-[48px] text-[11.5px] px-1.5 py-1 border border-gray-300 rounded-lg text-center" />
                                  <span className="text-[#999]">% · CN: {100 - tempLgPct}%</span>
                                </div>
                              )}
                            </div>
                            <div className="flex gap-1.5">
                              <button onClick={async () => {
                                const updates: Partial<Client> = { project_type: tempProjectType as 'managed' | 'contracted', default_lg_pct: tempProjectType === 'managed' ? 100 : tempLgPct, default_cn_pct: tempProjectType === 'managed' ? 0 : 100 - tempLgPct };
                                const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
                                if (!error) { onClientUpdate({ ...client, ...updates }); toast('Đã lưu'); }
                                setEditingProjectType(false);
                              }} className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">Lưu</button>
                              <button onClick={() => setEditingProjectType(false)} className="px-2.5 py-1 rounded-lg text-[11px] text-[#666] border border-gray-300 hover:bg-gray-50 transition">Huỷ</button>
                            </div>
                          </div>
                        )}
                      </InfoRow>

                      <InfoRow label="Loại dịch vụ">
                        {(client.service_type ?? 'leasing') === 'leasing' ? 'Cho thuê lao động'
                          : client.service_type === 'recruitment' ? 'Giới thiệu lao động' : 'HOH'}
                      </InfoRow>

                      <InfoRow label="Bắt đầu HĐ">{formatDate(client.contract_start) || '—'}</InfoRow>

                      <InfoRow label="Hết hạn HĐ">
                        <span>{formatDate(client.contract_end) || '—'}</span>
                        {contractDaysLeft !== null && (
                          <span className="ml-2 text-[11px]" style={{ color: contractDaysLeft < 0 ? '#DC2626' : contractDaysLeft <= 60 ? '#D97706' : '#059669' }}>
                            {contractDaysLeft < 0 ? `quá hạn ${Math.abs(contractDaysLeft)} ngày` : `còn ${contractDaysLeft} ngày`}
                          </span>
                        )}
                      </InfoRow>

                      <InfoRow label="Chi nhánh">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{branchLabelOf(client, branches)}</span>
                          <button
                            onClick={() => setBranchTransferForm(branchTransferForm ? null : { branch_id: '', effective_from: new Date().toISOString().slice(0, 7), notes: '' })}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium border border-gray-300 text-[#555] hover:bg-[#FAFAF8] transition shrink-0"
                          >
                            <ArrowRightLeft size={11} /> Chuyển chi nhánh
                          </button>
                        </div>
                        {branchTransferForm && (
                          <div className="mt-2 p-3 rounded-lg border border-teal-200 bg-teal-50 flex flex-col gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] text-[#666] font-medium">Chi nhánh mới</label>
                              <select value={branchTransferForm.branch_id} onChange={e => setBranchTransferForm({ ...branchTransferForm, branch_id: e.target.value })} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-teal-500 bg-white">
                                <option value="">-- Chọn chi nhánh --</option>
                                {branchOptions(branches).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                              </select>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] text-[#666] font-medium">Có hiệu lực từ tháng</label>
                              <input type="month" value={branchTransferForm.effective_from} onChange={e => setBranchTransferForm({ ...branchTransferForm, effective_from: e.target.value })} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-teal-500" />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] text-[#666] font-medium">Ghi chú (lý do)</label>
                              <input type="text" value={branchTransferForm.notes} onChange={e => setBranchTransferForm({ ...branchTransferForm, notes: e.target.value })} placeholder="VD: Chuyển nhượng cuối tháng 5" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-teal-500" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={handleBranchTransfer} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-teal-600 text-white hover:bg-teal-700 transition"><Check size={13} /> Xác nhận</button>
                              <button onClick={() => setBranchTransferForm(null)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
                            </div>
                          </div>
                        )}
                      </InfoRow>

                      <InfoRow label="Người quản lý">
                        <div className="flex items-center justify-between gap-2">
                          <span>{client.manager || '—'}</span>
                          <button
                            onClick={() => setTransferForm(transferForm ? null : { manager_name: '', effective_from: new Date().toISOString().slice(0, 7) })}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium border border-gray-300 text-[#555] hover:bg-[#FAFAF8] transition shrink-0"
                          >
                            <ArrowRightLeft size={11} /> Chuyển đổi
                          </button>
                        </div>
                        {transferForm && (
                          <div className="mt-2 p-3 rounded-lg border border-blue-200 bg-blue-50 flex flex-col gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] text-[#666] font-medium">Quản lý mới</label>
                              <select value={transferForm.manager_name} onChange={e => setTransferForm({ ...transferForm, manager_name: e.target.value })} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                                <option value="">— Chọn quản lý —</option>
                                {managers.map(m => <option key={m.id}>{m.name}</option>)}
                              </select>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] text-[#666] font-medium">Có hiệu lực từ tháng</label>
                              <input type="month" value={transferForm.effective_from} onChange={e => setTransferForm({ ...transferForm, effective_from: e.target.value })} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={handleManagerTransfer} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={13} /> Xác nhận</button>
                              <button onClick={() => setTransferForm(null)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
                            </div>
                          </div>
                        )}
                      </InfoRow>

                      <InfoRow label="Khu công nghiệp">
                        {client.industrial_zones && client.industrial_zones.length > 0
                          ? <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">{client.industrial_zones[0]}</span>
                          : '—'}
                      </InfoRow>

                      <InfoRow label="Ngành nghề">{client.industry || '—'}</InfoRow>

                      <InfoRow label="Google Maps">
                        {client.map_link ? (
                          <span className="flex items-center gap-2 flex-wrap">
                            <a href={client.map_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Mở bản đồ</a>
                            {client.lat != null && client.lng != null && <span className="text-[11px] text-emerald-600">✓ đã định vị</span>}
                          </span>
                        ) : '—'}
                      </InfoRow>

                      <InfoRow label="Ghi chú" full>{client.notes || '—'}</InfoRow>

                      <InfoRow label="Lịch lương" full>
                        <div className="flex flex-wrap gap-1.5">
                          {([
                            { label: 'Chốt công', start: client.cutoff_day, end: client.cutoff_day_end, cls: 'bg-orange-50 border-orange-200 text-orange-700' },
                            { label: 'Tính lương', start: client.calc_day, end: client.calc_day_end, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
                            { label: 'Kỳ thanh toán', start: client.payment_start, end: client.payment_end, cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                            { label: 'Phát lương', start: client.salary_day, end: client.salary_day_end, cls: 'bg-purple-50 border-purple-200 text-purple-700' },
                          ]).map(row => (
                            <span key={row.label} className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${row.cls}`}>
                              {row.label}: ngày {formatDayRange(row.start, row.end)}
                            </span>
                          ))}
                        </div>
                      </InfoRow>
                    </div>
                  )}
                </SectionCard>

                {/* ── Theo dõi Lao động ── */}
                <SectionCard
                  id="cd-labor"
                  icon="👥"
                  title="Theo dõi Lao động"
                  badge={`${currentWorkers.toLocaleString()} LĐ hiện tại`}
                  open={sections.labor}
                  onToggle={() => toggleSection('labor')}
                >
              <div className="flex items-center gap-2.5 flex-wrap bg-[#F9F9F7] border border-[#E8E7E2] rounded-lg px-4 py-3 mb-3">
                <RefreshCw size={16} className="text-[#888]" />
                <span className="text-[13px] text-[#555] font-medium">Cập nhật LĐ tuần:</span>
                <select value={laborWeek} onChange={e => selectWeek(e.target.value)} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {weekGroups.map(g => (
                    <optgroup key={g.month} label={g.month}>
                      {g.labels.map(l => <option key={l} value={l}>{weekLabelFull(l)}{l === getCurrentWeekLabel() ? ' *' : ''}</option>)}
                    </optgroup>
                  ))}
                </select>
                <input type="number" value={laborInput} onChange={e => setLaborInput(e.target.value)} className="w-[110px] text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                <button onClick={handleLaborUpdate} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"><Check size={13} /> Cập nhật</button>
                {laborMsg && <span className="text-[12px] text-emerald-600 inline-flex items-center gap-1">✓ Đã lưu!</span>}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[12px] text-[#888]">Thêm tháng cũ:</span>
                  <input type="month" value={extraMonth} onChange={e => setExtraMonth(e.target.value)} className="text-[12px] px-2 py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                  <button onClick={addExtraMonth} className="px-2.5 py-1 rounded-lg text-[12px] font-medium border border-gray-300 text-[#555] hover:bg-white transition">+ Thêm</button>
                </div>
              </div>

              <div className="flex gap-1.5 mb-3">
                <button onClick={() => setChartView('week')} className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition ${chartView === 'week' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-500'}`}>📊 Theo tuần</button>
                <button onClick={() => setChartView('month')} className={`px-3 py-1 rounded-lg text-[12px] font-medium border transition ${chartView === 'month' ? 'bg-blue-100 border-blue-500 text-blue-700' : 'bg-white border-gray-300 text-gray-500'}`}>📅 Theo tháng</button>
              </div>

              <div className="mb-4" style={{ height: 190 }}>
                {chartView === 'week' ? (
                  <Line data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { min: chartYMin } } }} />
                ) : (
                  <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { min: chartYMin } } }} />
                )}
              </div>

              <div className="text-[13px] font-semibold text-[#111] mb-2">Báo cáo tăng giảm theo tháng</div>
              <table className="w-full text-[12.5px]">
                <thead><tr><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Tháng</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Số LĐ cuối tháng</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">So với tháng trước</th></tr></thead>
                <tbody>
                  {monthRows.map(r => {
                    const d = r.cnt !== null && r.prev !== null ? r.cnt - r.prev : null;
                    return (
                      <tr key={r.m} className="border-b border-[#F0EEE9]">
                        <td className="px-3 py-2">{r.m}</td>
                        <td className="px-3 py-2 font-semibold">{r.cnt !== null ? r.cnt.toLocaleString() : '—'}{d !== null && <span className="ml-1" style={{ color: d > 0 ? '#059669' : d < 0 ? '#DC2626' : '#888' }}>({d > 0 ? '+' : ''}{d})</span>}</td>
                        <td className="px-3 py-2 text-[12px] text-[#888]">{d !== null ? (d > 0 ? 'Tăng' : 'Giảm') + ' so tháng trước' : 'Chưa có so sánh'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {hist.length > 0 && (
                <>
                  <div className="text-[13px] font-semibold text-[#111] mt-4 mb-2">Lịch sử nhập liệu</div>
                  <table className="w-full text-[12.5px]">
                    <thead><tr><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Tuần</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Số LĐ</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Người cập nhật</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]">Ngày điền</th><th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7]"></th></tr></thead>
                    <tbody>
                      {[...hist].reverse().slice(0, 12).map(h => (
                        <tr key={h.id} className="border-b border-[#F0EEE9]">
                          <td className="px-3 py-2">{h.week_label}</td>
                          <td className="px-3 py-2 font-semibold">{h.count.toLocaleString()}</td>
                          <td className="px-3 py-2 text-[#888]">{h.updated_by || '—'}</td>
                          <td className="px-3 py-2 text-[#888]">{formatDate(h.created_at)}</td>
                          <td className="px-3 py-2">
                            <button onClick={() => { setLaborWeek(h.week_label); setLaborInput(String(h.count)); }} className="text-[11.5px] text-blue-600 hover:underline">Sửa</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
                </SectionCard>

                {/* ── Thanh toán ── */}
                <SectionCard
                  id="cd-pay"
                  icon="💰"
                  title="Thanh toán"
                  badge={client.paid_this_month ? 'Đã thu tháng này' : undefined}
                  open={sections.pay}
                  onToggle={() => toggleSection('pay')}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-0 lg:divide-x lg:divide-[#E8E7E2] -m-4">
                    <div><PaymentTermsSection client={client} onUpdate={onClientUpdate} toast={toast} embedded /></div>
                    <div><PaymentHistory client={client} embedded /></div>
                  </div>
                </SectionCard>

                {/* ── Hợp đồng & Tài liệu ── */}
                <SectionCard
                  id="cd-docs"
                  icon="📄"
                  title="Hợp đồng & Tài liệu"
                  badge={`${documents.length} tệp`}
                  open={sections.docs}
                  onToggle={() => toggleSection('docs')}
                >
              <div className="flex items-center gap-2 flex-wrap mb-3 bg-[#F9F9F7] border border-[#E8E7E2] rounded-lg px-3 py-2.5">
                <select value={uploadDocType} onChange={e => setUploadDocType(e.target.value as ClientDocumentType)} className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {Object.entries(DOC_TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 cursor-pointer hover:bg-white transition ${uploadingDoc ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Upload size={13} /> {uploadingDoc ? 'Đang tải lên...' : 'Tải lên PDF'}
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadDocument(f); e.target.value = ''; }}
                    disabled={uploadingDoc}
                  />
                </label>
              </div>
              {documents.length === 0 ? (
                <div className="text-[12.5px] text-[#999] py-3 text-center">Chưa có tài liệu nào</div>
              ) : (
                <div className="space-y-2">
                  {documents.map(doc => (
                    <div key={doc.id} className="border border-[#E8E7E2] rounded-lg p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={15} className="text-[#888] shrink-0" />
                          <div className="min-w-0">
                            <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-[#111] hover:text-blue-600 truncate block">{doc.name}</a>
                            <div className="text-[10.5px] text-[#999]">
                              {DOC_TYPE_LABELS[doc.doc_type]} · {doc.uploaded_by || '—'} · {formatDate(doc.created_at)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {geminiConfigured() && (
                            <button
                              onClick={() => handleAskAboutDocument(doc)}
                              disabled={askingDocId === doc.id}
                              title="Tóm tắt bằng AI"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-gray-300 text-[#555] hover:bg-[#FAFAF8] transition disabled:opacity-50"
                            >
                              <Sparkles size={11} /> {askingDocId === doc.id ? 'Đang đọc...' : 'Tóm tắt AI'}
                            </button>
                          )}
                          <a href={doc.file_url} target="_blank" rel="noreferrer" title="Tải xuống" className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-300 text-[#555] hover:bg-[#FAFAF8] transition">
                            <Download size={12} />
                          </a>
                          <button onClick={() => handleDeleteDocument(doc)} title="Xóa" className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-300 text-red-500 hover:bg-red-50 transition">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      {docAnswers[doc.id] && (
                        <div className="mt-2 p-2.5 rounded-lg bg-[#F9F9F7] text-[12px] text-[#444] whitespace-pre-wrap">{docAnswers[doc.id]}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
                </SectionCard>
              </div>

              {/* ══ Cột phải — thông tin tham chiếu ══ */}
              <div className="xl:col-span-4 space-y-4">

                {/* ── Sức khoẻ khách hàng ── */}
                <SectionCard
                  id="cd-health"
                  icon="❤️"
                  title="Sức khoẻ khách hàng"
                  open={sections.health}
                  onToggle={() => toggleSection('health')}
                  actions={<HealthScoreRing score={healthScore.total} size="sm" />}
                >
                  <div className="text-[11.5px] mb-3 font-medium" style={{ color: hsColor(healthScore.total) }}>
                    {hsLabel(healthScore.total)} — {healthScore.total}/100 điểm
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: 'Ổn định lao động',    score: healthScore.stability, max: 30, weight: '30%' },
                      { label: 'Thanh toán đúng hạn', score: healthScore.payment,   max: 25, weight: '25%' },
                      { label: 'Tần suất liên hệ',    score: healthScore.contact,   max: 20, weight: '20%' },
                      { label: 'HĐ còn lại',          score: healthScore.contract,  max: 15, weight: '15%' },
                      { label: 'Tăng trưởng LĐ',      score: healthScore.growth,    max: 10, weight: '10%' },
                    ].map(r => {
                      const pct = Math.round(r.score / r.max * 100);
                      const color = pct >= 70 ? '#059669' : pct >= 40 ? '#D97706' : '#DC2626';
                      return (
                        <div key={r.label} className="flex items-center gap-2">
                          <div className="text-[11px] text-[#374151] shrink-0" style={{ width: 118 }}>{r.label}</div>
                          <div className="flex-1 h-[5px] bg-[#E5E7EB] rounded-full overflow-hidden">
                            <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 9999, transition: 'width .4s' }} />
                          </div>
                          <div className="text-[10.5px] font-bold shrink-0" style={{ color, width: 18, textAlign: 'right' }}>{r.score}</div>
                          <div className="text-[9.5px] text-[#9CA3AF] shrink-0" style={{ width: 26, textAlign: 'right' }}>{r.weight}</div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>

                {/* ── Kênh online ── */}
                <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[12.5px] font-semibold text-[#111]">🔗 Kênh online</div>
                    {!editingSocialLinks ? (
                      <PencilButton title="Sửa kênh online" onClick={() => { setEditingSocialLinks(true); setSocialForm({ website_url: client.website_url || '', facebook_url: client.facebook_url || '', youtube_url: client.youtube_url || '', tiktok_url: client.tiktok_url || '' }); }} />
                    ) : (
                      <div className="flex gap-1.5">
                        <button onClick={async () => {
                          const updates = {
                            website_url: socialForm.website_url.trim() || null,
                            facebook_url: socialForm.facebook_url.trim() || null,
                            youtube_url: socialForm.youtube_url.trim() || null,
                            tiktok_url: socialForm.tiktok_url.trim() || null,
                          };
                          const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
                          if (!error) { onClientUpdate({ ...client, ...updates }); toast('Đã lưu'); } else toast('Lỗi: ' + error.message);
                          setEditingSocialLinks(false);
                        }} className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">Lưu</button>
                        <button onClick={() => setEditingSocialLinks(false)} className="px-2.5 py-1 rounded-lg text-[11px] text-[#666] border border-gray-300 hover:bg-gray-50 transition">Huỷ</button>
                      </div>
                    )}
                  </div>
                  {editingSocialLinks ? (
                    <div className="grid grid-cols-1 gap-2">
                      <input value={socialForm.website_url} onChange={e => setSocialForm({ ...socialForm, website_url: e.target.value })} placeholder="Website https://…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                      <input value={socialForm.facebook_url} onChange={e => setSocialForm({ ...socialForm, facebook_url: e.target.value })} placeholder="Facebook https://…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                      <input value={socialForm.youtube_url} onChange={e => setSocialForm({ ...socialForm, youtube_url: e.target.value })} placeholder="YouTube https://…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                      <input value={socialForm.tiktok_url} onChange={e => setSocialForm({ ...socialForm, tiktok_url: e.target.value })} placeholder="TikTok https://…" className="text-[12.5px] px-2 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
                    </div>
                  ) : (
                    <SocialLinksRow websiteUrl={client.website_url} facebookUrl={client.facebook_url} youtubeUrl={client.youtube_url} tiktokUrl={client.tiktok_url} />
                  )}
                </div>

                {/* ── Lịch sử thay đổi: quản lý + chi nhánh ── */}
                <SectionCard
                  id="cd-hist"
                  icon="🕘"
                  title="Lịch sử thay đổi"
                  badge={`${managerHistory.length + branchHistory.length} mốc`}
                  open={sections.hist}
                  onToggle={() => toggleSection('hist')}
                >
                  <div className="text-[11px] text-[#888] font-semibold uppercase tracking-wide mb-1.5">Chuyển đổi quản lý</div>
              {managerHistory.length > 0 ? (
                <div className="space-y-2">
                  {[...managerHistory].sort((a, b) => b.effective_from.localeCompare(a.effective_from)).map(h => (
                    <div key={h.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-[#E8E7E2] bg-[#FAFAF8]">
                      <div className="text-[13px] text-[#111]">Từ <span className="font-semibold">{monthLabel(h.effective_from)}</span>: {h.manager_name}</div>
                      <div className="text-[11px] text-[#aaa]">ghi nhận bởi {h.created_by || '—'} · {formatDate(h.created_at)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-[#888]">Chưa có lịch sử chuyển đổi quản lý.</div>
              )}
                  <div className="text-[11px] text-[#888] font-semibold uppercase tracking-wide mt-4 mb-1.5">Chuyển chi nhánh</div>
                  {branchHistory.length > 0 ? (
                    <div className="space-y-1">
                      {[...branchHistory].sort((a, b) => b.effective_from.localeCompare(a.effective_from)).map(h => (
                        <div key={h.id} className="flex items-start gap-2 text-[12px] px-3 py-2 rounded-lg border border-[#E8E7E2] bg-[#FAFAF8]">
                          <span className="text-[#999] shrink-0">{monthLabel(h.effective_from)}</span>
                          <span className="font-medium text-[#111]">{h.branch_name}</span>
                          {h.notes && <span className="text-[#888]">— {h.notes}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12.5px] text-[#888]">Chưa có lịch sử chuyển chi nhánh.</div>
                  )}
                </SectionCard>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
