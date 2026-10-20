// src/pages/Workspace.tsx — «Bàn làm việc»
// Bố cục theo demo đã duyệt (docs/workspace_mockup.html):
//   Hero (chào + 4 stat) → quick actions → [Feed «Việc của tôi» | Rail phải]
//   Rail = HĐ cần xử lý · Cập nhật chi nhánh · KCN cần ghé (+ thẻ theo vai trò)
//   KCN Grid = accordion dưới cùng. Win/Loss đã dời sang CRM.
// Mỗi dữ liệu chỉ hiển thị ở MỘT nơi — feed là nguồn việc duy nhất, rail là radar theo dõi.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FileText, Send, FileClock, Phone, MapPin, ChevronDown, ChevronRight, Search,
  Settings, SlidersHorizontal, ZoomIn, ZoomOut, RotateCcw, TrendingUp, Wallet, Building2, Users,
  AlertTriangle, CalendarClock, X, Plus, ArrowRight, Calculator, PieChart,
} from 'lucide-react';
import { MyWorkFeed, type FeedStats } from '../components/workspace/MyWorkFeed';
import { KCNGridSection } from '../components/workspace/KCNGridSection';
import { BulkLaborModal } from '../components/workspace/BulkLaborModal';
import { GiaoViecModal } from '../components/workspace/GiaoViecModal';
import { QuoteModal } from '../components/workspace/QuoteModal';
import { PayrollCalculatorModal } from '../components/workspace/PayrollCalculatorModal';
import { CostPlanModal } from '../components/workspace/CostPlanModal';
import { BranchHistoryFields } from '../components/workspace/BranchHistoryFields';
import { CARD, POPOVER, BTN_PRIMARY, BTN_SECONDARY, BTN_TINTED, BTN_ICON, FIELD, INPUT, TINT, ICON_TILE, DOT } from '../components/workspace/wsTheme';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useBranchData } from '../hooks/useBranchData';
import { usePersistedState } from '../hooks/usePersistedState';
import type { Client, FinanceRecord, CRMPipelineEntry, CRMProduct, Page, KCNSummary, Branch } from '../lib/types';
import { ROLE_LABELS, CRM_STAGES } from '../lib/constants';
import { formatDate, daysUntil } from '../lib/format';
import { branchOf, resolveBranchByLegacyText } from '../lib/branchRef';

interface WorkspaceProps {
  clients: Client[];
  finance: FinanceRecord[];
  pipeline: CRMPipelineEntry[];
  products: CRMProduct[];
  onNavigate: (page: Page) => void;
  onClientUpdate: (client: Client) => void;
  toast: (msg: string) => void;
}

// ---- Tuỳ chỉnh hiển thị ----
type SectionKey = 'quick_actions' | 'rail_hd' | 'rail_cn' | 'rail_kcn' | 'kcn_grid' | 'lich_su' | 'alerts' | 'prospects';

const SECTION_LABELS: Record<SectionKey, string> = {
  quick_actions: 'Thao tác nhanh',
  rail_hd: 'HĐ cần xử lý (rail)',
  rail_cn: 'Cập nhật chi nhánh (rail)',
  rail_kcn: 'KCN cần ghé thăm (rail)',
  kcn_grid: 'Bảng KCN Grid',
  lich_su: 'Lịch sử hoàn thành',
  alerts: 'Thông báo theo vai trò',
  prospects: 'Prospects cần follow-up',
};

const DEFAULT_ORDER: SectionKey[] = ['quick_actions', 'rail_hd', 'rail_cn', 'rail_kcn', 'kcn_grid', 'lich_su', 'alerts', 'prospects'];

interface WorkspaceLayout { order: SectionKey[]; hidden: SectionKey[]; fontScale: number }
const DEFAULT_LAYOUT: WorkspaceLayout = { order: DEFAULT_ORDER, hidden: [], fontScale: 1 };

function sectionAvailable(key: SectionKey, role: string): boolean {
  if (key === 'prospects') return role === 'kinhdoanh';
  if (key === 'alerts') return role === 'admin' || role === 'ketoan' || role === 'bdh';
  return true;
}

const FONT_MIN = 0.8, FONT_MAX = 1.3, FONT_STEP = 0.05;

function todayStr() { return new Date().toISOString().split('T')[0]; }

// ---- Khối giao diện dùng chung trong trang (phong cách Apple — xem wsTheme.ts) ----
function RailCard({ title, icon, tile, count, action, children }: {
  title: string; icon: React.ReactNode; tile: keyof typeof ICON_TILE; count?: number; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className={`${CARD} overflow-hidden`} aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-6 h-6 rounded-[7px] flex items-center justify-center text-white shrink-0 ${ICON_TILE[tile]}`}>{icon}</span>
          <h3 className="text-[14px] font-semibold text-[#1D1D1F] tracking-[-0.01em] truncate">{title}</h3>
          {count !== undefined && count > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-black/[0.05] text-[11px] font-semibold text-[#6E6E73] tabular-nums">{count}</span>
          )}
        </div>
        {action}
      </div>
      <div className="pb-1.5">{children}</div>
    </section>
  );
}

/** Dòng trong danh sách kiểu iOS: vạch ngăn thụt lề, dòng đầu không có vạch. */
const ROW = 'relative flex items-center gap-3 px-4 py-2.5 before:absolute before:left-4 before:right-0 before:top-0 before:h-px before:bg-black/[0.06] first:before:hidden';
const ROW_HOVER = 'hover:bg-black/[0.025] cursor-pointer transition-colors';

const RailEmpty = ({ children }: { children: React.ReactNode }) => (
  <div className="px-4 py-4 text-center text-[13px] text-[#86868B]">{children}</div>
);

/** Công tắc kiểu iOS. */
function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
      className={`relative w-[42px] h-[26px] rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-[#34C759]' : 'bg-black/[0.12]'}`}>
      <span className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-transform duration-200 ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

/** Popover cài đặt ngưỡng nhỏ (dùng cho 2 thẻ rail). */
function ThresholdPopover({ label, value, onChange, hint, onClose }: {
  label: string; value: number; onChange: (v: number) => void; hint?: React.ReactNode; onClose: () => void;
}) {
  return (
    <div className={`absolute right-0 top-full mt-1.5 z-20 p-3 w-56 ${POPOVER}`}>
      <label className="text-[12px] font-medium text-[#6E6E73] mb-1.5 block">{label}</label>
      <input type="number" min={1} value={value} onChange={e => onChange(Math.max(1, Number(e.target.value) || 1))}
        className={`w-full text-[13px] px-2.5 py-1.5 ${INPUT}`} />
      {hint && <div className="text-[11.5px] text-[#86868B] mt-2 leading-relaxed">{hint}</div>}
      <button onClick={onClose} className={`${BTN_PRIMARY} mt-2.5 w-full h-8 text-[13px]`}>Xong</button>
    </div>
  );
}

export default function Workspace({ clients, pipeline, products, onNavigate, onClientUpdate, toast }: WorkspaceProps) {
  const { user } = useAuth();
  const { branches } = useBranchData();

  // Việc tạo tự động (tái ký HĐ) gắn luôn chi nhánh để khỏi phải vào sửa tay từng việc.
  const branchIdOfClient = (c: Client) => branchOf(c, branches)?.id ?? null;

  const [layout, setLayout] = usePersistedState<WorkspaceLayout>('lgvn_workspace_layout_v2', DEFAULT_LAYOUT);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hidden = (k: SectionKey) => layout.hidden.includes(k);

  // ---- Liên lạc giữa Workspace ↔ feed ----
  const [feedStats, setFeedStats] = useState<FeedStats>({ overdue: 0, today: 0, doneThisWeek: 0, renewalClientIds: [] });
  const handleStats = useCallback((s: FeedStats) => setFeedStats(s), []);
  const renewalIds = useMemo(() => new Set(feedStats.renewalClientIds), [feedStats.renewalClientIds]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [quickAddSignal, setQuickAddSignal] = useState(0);

  // ---- Mobile: 2 segment ----
  const [mobileTab, setMobileTab] = useState<'viec' | 'theodoi'>('viec');

  // ---- Modals thao tác nhanh ----
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [showCostPlan, setShowCostPlan] = useState(false);
  const [showGiaoViec, setShowGiaoViec] = useState(false);
  const [showBulkLabor, setShowBulkLabor] = useState(false);
  const [showPayrollCalc, setShowPayrollCalc] = useState(false);

  // ---- Rail: HĐ cần xử lý ----
  const [contractThreshold, setContractThreshold] = usePersistedState('lgvn_contract_threshold_days', 17);
  const [showContractSettings, setShowContractSettings] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [creatingRenewal, setCreatingRenewal] = useState<string | null>(null);
  const [selectedContractIds, setSelectedContractIds] = useState<Set<string>>(new Set());
  const [savingBatch, setSavingBatch] = useState(false);

  // Quy tắc bản cũ: khách đã có việc tái ký đang chạy thì ẨN khỏi danh sách gợi ý
  const contractSuggests = useMemo(() =>
    clients
      .filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended' && !renewalIds.has(c.id))
      .map(c => ({ client: c, daysLeft: daysUntil(c.contract_end) }))
      .filter((x): x is { client: Client; daysLeft: number } => x.daysLeft !== null && x.daysLeft <= contractThreshold)
      .sort((a, b) => a.daysLeft - b.daysLeft),
  [clients, contractThreshold, renewalIds]);

  // Quy tắc bản cũ: hiện đủ danh sách ứng viên ngay khi mở, gõ tìm chỉ để lọc thêm — không bắt buộc gõ mới hiện
  const manualCandidates = useMemo(() => {
    const base = clients
      .filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended' && !renewalIds.has(c.id))
      .filter(c => !contractSuggests.some(s => s.client.id === c.id));
    const q = manualSearch.trim().toLowerCase();
    return (q ? base.filter(c => c.name.toLowerCase().includes(q)) : base).slice(0, 8);
  }, [clients, manualSearch, renewalIds, contractSuggests]);

  function toggleContractSelect(clientId: string) {
    setSelectedContractIds(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId); else next.add(clientId);
      return next;
    });
  }

  async function createRenewalTask(client: Client) {
    if (!user || creatingRenewal) return;
    setCreatingRenewal(client.id);
    const daysLeft = daysUntil(client.contract_end);
    const { error } = await supabase.from('work_tasks').insert({
      user_id: user.id,
      client_id: client.id,
      title: `Tái ký HĐ — ${client.name}`,
      task_type: 'Tái ký HĐ',
      due_date: todayStr(),
      priority: daysLeft !== null && daysLeft <= 0 ? 'high' : 'medium',
      branch_id: branchIdOfClient(client),
      status: 'in_progress',
      doc_status: 'dang_soan',
    });
    setCreatingRenewal(null);
    if (!error) {
      setRefreshToken(t => t + 1);
      setShowManualAdd(false);
      setManualSearch('');
      toast(`Đã tạo việc tái ký cho ${client.name}`);
    }
  }

  // Quy tắc bản cũ (saveSelectedTasks): chọn nhiều khách rồi lưu hàng loạt 1 lần
  async function saveBatchRenewalTasks() {
    if (!user || selectedContractIds.size === 0) return;
    setSavingBatch(true);
    const today = todayStr();
    const toInsert = contractSuggests
      .filter(s => selectedContractIds.has(s.client.id))
      .map(s => ({
        user_id: user.id,
        client_id: s.client.id,
        title: `Tái ký HĐ — ${s.client.name}`,
        task_type: 'Tái ký HĐ',
        due_date: today,
        priority: s.daysLeft <= 0 ? 'high' : 'medium',
        branch_id: branchIdOfClient(s.client),
        status: 'in_progress',
        doc_status: 'dang_soan',
      }));
    const { error } = await supabase.from('work_tasks').insert(toInsert);
    setSavingBatch(false);
    if (!error) {
      setRefreshToken(t => t + 1);
      toast(`Đã tạo ${toInsert.length} việc tái ký`);
      setSelectedContractIds(new Set());
    }
  }

  // ---- Rail: Cập nhật chi nhánh ----
  const [visitThreshold, setVisitThreshold] = usePersistedState('lgvn_visit_threshold_days', 7);
  const [showVisitSettings, setShowVisitSettings] = useState(false);
  const [branchActivity, setBranchActivity] = useState<Record<string, string>>({});
  const [openBranchPanel, setOpenBranchPanel] = useState<Branch | null>(null);

  // morning_priorities.target_name = `Chi nhánh ${tên}`. Các phiên GHI TRƯỚC ĐÂY dùng
  // tên chi nhánh cũ (branches.region), phiên mới dùng tên chuẩn (branches.name). Ta ĐỌC
  // cả hai key rồi lấy mốc mới nhất — lịch sử cũ vẫn tính, và không phải viết lại bảng
  // nhật ký. Chỉ lúc GHI mới dùng tên chuẩn, nên key cũ tự tắt dần.
  const branchKey = (b: Branch) => b.name;
  const branchKeysLegacy = (b: Branch) =>
    [b.name, b.region].filter(Boolean).map(n => `Chi nhánh ${n}`) as string[];

  useEffect(() => {
    const names = branches.flatMap(branchKeysLegacy);
    if (!names.length) return;
    supabase.from('morning_priorities').select('target_name, priority_date').in('target_name', names)
      .order('priority_date', { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const today = todayStr();
        const map: Record<string, string> = {};
        for (const row of data) {
          if (!row.target_name || row.priority_date > today) continue;
          if (!map[row.target_name] || row.priority_date > map[row.target_name]) map[row.target_name] = row.priority_date;
        }
        setBranchActivity(map);
      });
  }, [branches]);

  const visitSuggests = useMemo(() => branches.map(b => {
    // Mốc ghé gần nhất = mới nhất giữa key tên chuẩn và key tên cũ.
    const last = branchKeysLegacy(b)
      .map(k => branchActivity[k])
      .filter(Boolean)
      .sort()
      .pop();
    const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    return { branch: b, daysSince };
  }).sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999)),
  [branches, branchActivity]);

  function visitDotColor(daysSince: number | null) {
    if (daysSince === null || daysSince > 2 * visitThreshold) return DOT.red;
    if (daysSince > visitThreshold) return DOT.orange;
    return DOT.green;
  }

  function visitColor(daysSince: number | null) {
    if (daysSince === null || daysSince > 2 * visitThreshold) return TINT.red;
    if (daysSince > visitThreshold) return TINT.orange;
    return TINT.green;
  }

  function openBranchProfile(branch: Branch) {
    setOpenBranchPanel(branch);
  }

  // Ghi nhận được lưu ngay trong panel (BranchHistoryFields) — ở đây chỉ dời mốc "liên hệ gần
  // nhất" của rail, và chỉ dời tới (ghi bù một ngày cũ không làm chi nhánh trông như lâu chưa ghé).
  function onBranchVisitSaved(branch: Branch, date: string) {
    if (date > todayStr()) return;
    const k = `Chi nhánh ${branchKey(branch)}`;
    setBranchActivity(prev => (prev[k] && prev[k] >= date ? prev : { ...prev, [k]: date }));
  }

  // ---- Rail: KCN cần ghé + accordion KCN Grid ----
  const [kcnSummary, setKcnSummary] = useState<KCNSummary[]>([]);
  const [kcnOpen, setKcnOpen] = useState(false);
  const kcnSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from('kcn_summary').select('*').then(({ data }) => { if (data) setKcnSummary(data as KCNSummary[]); });
  }, [refreshToken]);

  const kcnRail = useMemo(() => kcnSummary
    .filter(z => z.client_count > 0)
    .sort((a, b) => (b.days_since_visit ?? 999) - (a.days_since_visit ?? 999))
    .slice(0, 5),
  [kcnSummary]);

  function openKcnGrid() {
    setKcnOpen(true);
    setMobileTab('theodoi');
    setTimeout(() => {
      const el = kcnSectionRef.current;
      if (el) {
        const scroller = el.closest('.overflow-y-auto');
        if (scroller) scroller.scrollTo({ top: el.offsetTop - 20, behavior: 'smooth' });
      }
    }, 100);
  }

  // ---- Thẻ theo vai trò ----
  const [branchRegion, setBranchRegion] = useState<string | null>(null);
  useEffect(() => {
    if (!user || user.role !== 'bdh') return;
    supabase.from('managers').select('region').eq('name', user.full_name).maybeSingle()
      .then(({ data }) => setBranchRegion((data as { region: string | null } | null)?.region || null));
  }, [user]);

  const unpaidClients = useMemo(() => clients.filter(c => c.client_type === 'active' && !c.paid_this_month), [clients]);
  const alertClients = useMemo(() => clients.filter(c => c.client_type === 'active' && (c.status === 'warn' || c.status === 'danger')), [clients]);
  const staleProspects = useMemo(() => pipeline.filter(p => {
    if (p.stage === 'hop-tac') return false;
    const d = daysUntil(p.last_contact);
    return d === null || d > 14;
  }).slice(0, 6), [pipeline]);
  // Quy tắc bản cũ: cửa sổ cố định 30 ngày, KHÔNG loại trừ khách đã có việc tái ký (khác rail HĐ cần xử lý)
  const expiringList30 = useMemo(() =>
    clients
      .filter(c => c.client_type === 'active' && c.cooperation_status !== 'suspended')
      .map(c => ({ client: c, daysLeft: daysUntil(c.contract_end) }))
      .filter((x): x is { client: Client; daysLeft: number } => x.daysLeft !== null && x.daysLeft >= 0 && x.daysLeft <= 30)
      .sort((a, b) => a.daysLeft - b.daysLeft),
  [clients]);

  // branchRegion lấy từ managers.region (text — có thể là tên cũ hoặc tên chuẩn).
  // Quy về chi nhánh rồi mới lọc khách hàng theo branch_id.
  const branchExpiring = useMemo(() => {
    const br = resolveBranchByLegacyText(branchRegion, branches);
    if (!br) return [];
    return expiringList30.filter(x => branchOf(x.client, branches)?.id === br.id);
  }, [expiringList30, branchRegion, branches]);

  const adjustFont = (delta: number) =>
    setLayout(prev => ({ ...prev, fontScale: Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round((prev.fontScale + delta) * 100) / 100)) }));
  const toggleHidden = (key: SectionKey) =>
    setLayout(prev => ({ ...prev, hidden: prev.hidden.includes(key) ? prev.hidden.filter(k => k !== key) : [...prev.hidden, key] }));

  if (!user) return null;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 11) return 'Chào buổi sáng';
    if (h < 14) return 'Chào buổi trưa';
    if (h < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  })();

  const roleCard = (): React.ReactNode => {
    if (hidden('alerts') && hidden('prospects')) return null;
    if (user.role === 'admin' && !hidden('alerts')) {
      if (!alertClients.length) return null;
      return (
        <RailCard title="Thông báo hợp đồng" tile="red" icon={<AlertTriangle size={13} />} count={alertClients.length}>
          <div className="flex flex-col">
            {alertClients.slice(0, 5).map(c => (
              <div key={c.id} onClick={() => onNavigate('clients')} className={`${ROW} ${ROW_HOVER} justify-between`}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#1D1D1F] truncate">{c.name}</div>
                  <div className="text-[11.5px] text-[#86868B]">HĐ hết: {formatDate(c.contract_end)}</div>
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${c.status === 'danger' ? TINT.red : TINT.orange}`}>
                  {c.status === 'danger' ? 'Khẩn cấp' : 'Sắp hết'}
                </span>
              </div>
            ))}
          </div>
        </RailCard>
      );
    }
    if (user.role === 'ketoan' && !hidden('alerts')) {
      return (
        <RailCard title="KH chưa thanh toán tháng này" tile="orange" icon={<Wallet size={13} />} count={unpaidClients.length}>
          <div className="flex flex-col">
            {unpaidClients.length === 0 ? (
              <RailEmpty>Tất cả đã thanh toán</RailEmpty>
            ) : unpaidClients.slice(0, 6).map(c => (
              <div key={c.id} onClick={() => onNavigate('finance')} className={`${ROW} ${ROW_HOVER} justify-between`}>
                <div className="text-[13px] font-medium text-[#1D1D1F] truncate">{c.name}</div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${TINT.orange}`}>Chưa TT</span>
              </div>
            ))}
          </div>
        </RailCard>
      );
    }
    if (user.role === 'bdh' && !hidden('alerts') && branchExpiring.length > 0) {
      return (
        <RailCard title="HĐ sắp hết hạn (chi nhánh)" tile="orange" icon={<CalendarClock size={13} />} count={branchExpiring.length}>
          <div className="flex flex-col">
            {branchExpiring.slice(0, 6).map(({ client: c, daysLeft }) => (
              <div key={c.id} className={`${ROW} justify-between`}>
                <div className="text-[13px] font-medium text-[#1D1D1F] truncate">{c.name}</div>
                <span className="text-[12px] text-[#B25000] shrink-0 tabular-nums">{formatDate(c.contract_end)} · {daysLeft} ngày</span>
              </div>
            ))}
          </div>
        </RailCard>
      );
    }
    if (user.role === 'kinhdoanh' && !hidden('prospects')) {
      if (!staleProspects.length) return null;
      return (
        <RailCard title="Prospects cần follow-up" tile="indigo" icon={<TrendingUp size={13} />} count={staleProspects.length}
          action={<button onClick={() => onNavigate('crm-pipeline')} className="text-[12.5px] text-[#0066CC] hover:underline inline-flex items-center gap-0.5">Pipeline <ChevronRight size={13} /></button>}>
          <div className="flex flex-col">
            {staleProspects.map(p => {
              const stageInfo = CRM_STAGES.find(s => s.id === p.stage);
              return (
                <div key={p.id} onClick={() => onNavigate('crm-pipeline')} className={`${ROW} ${ROW_HOVER} justify-between`}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[#1D1D1F] truncate">{p.company_name}</div>
                    <div className="text-[11.5px] text-[#86868B]">LH gần nhất: {p.last_contact ? formatDate(p.last_contact) : 'Chưa'}</div>
                  </div>
                  {stageInfo && <span className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${stageInfo.color}`}>{stageInfo.label}</span>}
                </div>
              );
            })}
          </div>
        </RailCard>
      );
    }
    return null;
  };

  const dateLine = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  const heroStats = [
    { label: 'Quá hạn', short: 'Quá hạn', value: feedStats.overdue, color: feedStats.overdue > 0 ? 'text-[#FF3B30]' : 'text-[#1D1D1F]' },
    { label: 'Hôm nay', short: 'Hôm nay', value: feedStats.today, color: 'text-[#0071E3]' },
    { label: 'HĐ cần xử lý', short: 'Cần tái ký', value: contractSuggests.length, color: contractSuggests.length > 0 ? 'text-[#FF9500]' : 'text-[#1D1D1F]' },
    { label: 'Xong tuần này', short: 'Xong tuần', value: feedStats.doneThisWeek, color: 'text-[#248A3D]' },
  ];
  const quickActions: { label: string; icon: React.ReactNode; tile: keyof typeof ICON_TILE; onClick: () => void; primary?: boolean }[] = [
    { label: 'Tính bảng lương', icon: <Calculator size={16} />, tile: 'blue', onClick: () => setShowPayrollCalc(true), primary: true },
    { label: 'Tạo báo giá', icon: <FileText size={16} />, tile: 'orange', onClick: () => setShowQuoteModal(true) },
    { label: 'Phương án giá', icon: <PieChart size={16} />, tile: 'purple', onClick: () => setShowCostPlan(true) },
    { label: 'Giao việc', icon: <Send size={15} />, tile: 'green', onClick: () => setShowGiaoViec(true) },
    { label: 'Ghi nhận LĐ', icon: <Users size={16} />, tile: 'teal', onClick: () => setShowBulkLabor(true) },
  ];

  return (
    <>
      {/* ==== HERO — tiêu đề lớn kiểu Apple + 4 số liệu ==== */}
      <header className="flex items-end justify-between gap-x-4 gap-y-3 flex-wrap px-4 md:px-8 pt-4 md:pt-6 pb-3 md:pb-4 bg-[#F5F5F7] border-b border-black/[0.06]">
        <div className="min-w-0">
          <div className="text-[11.5px] md:text-[12px] font-semibold uppercase tracking-[0.06em] text-[#86868B]">
            {dateLine} · {ROLE_LABELS[user.role] || user.role}
          </div>
          <h1 className="text-[24px] md:text-[30px] font-semibold tracking-[-0.025em] leading-[1.15] text-[#1D1D1F] mt-0.5">
            {greeting}, {user.full_name}
          </h1>
        </div>
        <div className="flex items-center gap-2 md:gap-2.5 w-full md:w-auto">
          <div className="grid grid-cols-4 gap-2 flex-1 md:flex-none">
            {heroStats.map(s => (
              <div key={s.label} className={`${CARD} min-w-0 px-2.5 md:px-3.5 py-2 md:min-w-[92px]`}>
                <div className={`text-[20px] md:text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-[10.5px] md:text-[11.5px] text-[#86868B] mt-1 truncate" title={s.label}><span className="md:hidden">{s.short}</span><span className="hidden md:inline">{s.label}</span></div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className={`hidden md:inline-flex h-9 px-3.5 text-[13px] shrink-0 ${settingsOpen ? BTN_TINTED : BTN_SECONDARY}`}
          >
            <SlidersHorizontal size={14} /> Tuỳ chỉnh
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto bg-[#F5F5F7] px-3 md:px-8 pt-3 md:pt-5 pb-8" style={{ zoom: layout.fontScale }}>
        {/* ==== Tuỳ chỉnh ==== */}
        {settingsOpen && (
          <div className={`${CARD} mb-4 md:mb-5`}>
            <div className="flex items-center justify-between gap-2 px-4 md:px-5 pt-4 pb-2">
              <h3 className="text-[15px] font-semibold text-[#1D1D1F] tracking-[-0.01em]">Tuỳ chỉnh bàn làm việc</h3>
              <button onClick={() => setLayout(DEFAULT_LAYOUT)} className="inline-flex items-center gap-1 text-[13px] text-[#0066CC] hover:underline">
                <RotateCcw size={12} /> Khôi phục mặc định
              </button>
            </div>
            <div className="grid md:grid-cols-[220px_1fr] gap-5 px-4 md:px-5 pb-5">
              <div>
                <div className="text-[12px] text-[#86868B] mb-2">Cỡ chữ</div>
                <div className="inline-flex items-center rounded-[10px] bg-black/[0.05] p-[2px]">
                  <button onClick={() => adjustFont(-FONT_STEP)} disabled={layout.fontScale <= FONT_MIN} title="Nhỏ hơn"
                    className="w-10 h-8 rounded-[8px] flex items-center justify-center text-[#1D1D1F] hover:bg-white hover:shadow-sm disabled:opacity-30 transition"><ZoomOut size={15} /></button>
                  <span className="w-14 text-center text-[13px] font-medium text-[#1D1D1F] tabular-nums">{Math.round(layout.fontScale * 100)}%</span>
                  <button onClick={() => adjustFont(FONT_STEP)} disabled={layout.fontScale >= FONT_MAX} title="Lớn hơn"
                    className="w-10 h-8 rounded-[8px] flex items-center justify-center text-[#1D1D1F] hover:bg-white hover:shadow-sm disabled:opacity-30 transition"><ZoomIn size={15} /></button>
                </div>
              </div>
              <div>
                <div className="text-[12px] text-[#86868B] mb-2">Hiển thị các mục</div>
                <div className="rounded-[12px] bg-[#F5F5F7] grid sm:grid-cols-2">
                  {DEFAULT_ORDER.filter(k => sectionAvailable(k, user.role)).map(key => (
                    <div key={key} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-black/[0.05]">
                      <span className={`flex-1 text-[13px] ${hidden(key) ? 'text-[#86868B]' : 'text-[#1D1D1F]'}`}>{SECTION_LABELS[key]}</span>
                      <Switch on={!hidden(key)} onToggle={() => toggleHidden(key)} label={SECTION_LABELS[key]} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==== Segmented control (mobile / màn hẹp) ==== */}
        <div className="xl:hidden flex bg-[#767680]/[0.12] rounded-[10px] p-[2px] mb-3">
          {([['viec', 'Việc của tôi'], ['theodoi', 'Theo dõi']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={`flex-1 text-[13px] py-1.5 rounded-[8px] text-[#1D1D1F] transition ${mobileTab === key ? 'bg-white font-semibold shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]' : 'font-medium'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ==== THAO TÁC NHANH ==== */}
        {!hidden('quick_actions') && (
          <div className={`${mobileTab === 'viec' ? 'grid' : 'hidden'} xl:grid grid-cols-2 sm:grid-cols-5 gap-2 md:gap-3 mb-4 md:mb-5`}>
            {quickActions.map(a => (
              <button key={a.label} onClick={a.onClick}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-[14px] text-left active:scale-[0.98] transition ${a.primary
                  ? 'bg-[#0071E3] text-white hover:bg-[#0077ED] shadow-[0_8px_20px_-8px_rgba(0,113,227,0.7)]'
                  : 'bg-white text-[#1D1D1F] shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_6px_16px_-6px_rgba(0,0,0,0.14)]'}`}>
                <span className={`w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 text-white ${a.primary ? 'bg-white/20' : ICON_TILE[a.tile]}`}>{a.icon}</span>
                <span className="text-[13px] font-medium leading-tight">{a.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* ==== FEED + RAIL ==== */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 md:gap-5 items-start">
          {/* Cột chính: feed hợp nhất */}
          <div className={`${mobileTab === 'viec' ? 'block' : 'hidden'} xl:block min-w-0`}>
            <MyWorkFeed
              clients={clients}
              pipelineEntries={pipeline}
              products={products}
              branches={branches}
              onClientUpdate={onClientUpdate}
              toast={toast}
              onStatsChange={handleStats}
              refreshToken={refreshToken}
              quickAddSignal={quickAddSignal}
              hideHistory={hidden('lich_su')}
            />
          </div>

          {/* Rail phải: radar theo dõi */}
          <div className={`${mobileTab === 'theodoi' ? 'flex' : 'hidden'} xl:flex flex-col gap-4`}>
            {!hidden('rail_hd') && (
              <RailCard
                title="HĐ cần xử lý" tile="orange" icon={<FileClock size={13} />} count={contractSuggests.length}
                action={
                  <div className="flex items-center gap-1">
                    <div className="relative">
                      <button onClick={() => setShowContractSettings(v => !v)} title="Ngưỡng cảnh báo" className={BTN_ICON}><Settings size={14} /></button>
                      {showContractSettings && (
                        <ThresholdPopover label="Báo khi HĐ còn ≤ (ngày)" value={contractThreshold} onChange={setContractThreshold} onClose={() => setShowContractSettings(false)} />
                      )}
                    </div>
                    <button onClick={() => { setShowManualAdd(v => !v); setManualSearch(''); }} className={`${BTN_TINTED} h-7 px-2.5 text-[12px]`}>
                      <Plus size={12} /> Thủ công
                    </button>
                  </div>
                }
              >
                {showManualAdd && (
                  <div className="px-4 pb-2.5">
                    <div className={`flex items-center gap-1.5 px-2.5 h-8 ${FIELD}`}>
                      <Search size={13} className="text-[#86868B] shrink-0" />
                      <input autoFocus placeholder="Tìm công ty..." value={manualSearch} onChange={e => setManualSearch(e.target.value)}
                        className="flex-1 min-w-0 bg-transparent text-[13px] text-[#1D1D1F] placeholder:text-[#AEAEB2] focus:outline-none" />
                    </div>
                    {manualCandidates.length > 0 ? (
                      <div className="mt-1.5 flex flex-col max-h-40 overflow-y-auto rounded-[10px] bg-[#F5F5F7]">
                        {manualCandidates.map(c => (
                          <button key={c.id} onClick={() => createRenewalTask(c)} disabled={!!creatingRenewal}
                            className="flex items-center gap-1.5 px-3 py-2 text-left hover:bg-black/[0.04] border-b border-black/[0.05] last:border-b-0 transition">
                            <span className="text-[13px] text-[#1D1D1F] truncate flex-1">{c.name}</span>
                            <ArrowRight size={13} className="text-[#AEAEB2] shrink-0" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[12px] text-[#86868B] text-center py-2">Không tìm thấy</div>
                    )}
                  </div>
                )}
                {/* Quy tắc bản cũ: chọn nhiều khách rồi lưu hàng loạt 1 lần */}
                {selectedContractIds.size > 0 && (
                  <div className="flex items-center justify-between mx-4 mb-2 pl-3 pr-1 py-1 rounded-full bg-[#0071E3]/10">
                    <span className="text-[12.5px] font-medium text-[#0066CC]">Đã chọn {selectedContractIds.size}</span>
                    <button onClick={saveBatchRenewalTasks} disabled={savingBatch} className={`${BTN_PRIMARY} h-7 px-3 text-[12px]`}>
                      {savingBatch ? 'Đang lưu…' : 'Tạo việc cho tất cả'}
                    </button>
                  </div>
                )}
                <div className="flex flex-col max-h-72 overflow-y-auto">
                  {contractSuggests.length === 0 ? (
                    <RailEmpty>Không có HĐ gần hết hạn</RailEmpty>
                  ) : contractSuggests.map(({ client: c, daysLeft }) => {
                    const isSel = selectedContractIds.has(c.id);
                    return (
                      <div key={c.id} onClick={() => toggleContractSelect(c.id)}
                        className={`${ROW} cursor-pointer transition-colors ${isSel ? 'bg-[#0071E3]/[0.06]' : 'hover:bg-black/[0.025]'}`}>
                        <input type="checkbox" checked={isSel} onClick={e => e.stopPropagation()} onChange={() => toggleContractSelect(c.id)} className="shrink-0 w-4 h-4 accent-[#0071E3]" />
                        <span className={`w-2 h-2 rounded-full shrink-0 ${daysLeft <= 7 ? DOT.red : DOT.orange}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-[#1D1D1F] truncate">{c.name}</div>
                          <div className={`text-[11.5px] tabular-nums ${daysLeft <= 0 ? 'text-[#D70015]' : 'text-[#86868B]'}`}>
                            {formatDate(c.contract_end)} · {daysLeft <= 0 ? 'đã hết hạn' : `còn ${daysLeft} ngày`}
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); createRenewalTask(c); }} disabled={creatingRenewal === c.id}
                          className={`${BTN_TINTED} h-7 px-2.5 text-[12px] shrink-0`}>
                          {creatingRenewal === c.id ? '…' : <><Plus size={12} /> Việc</>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </RailCard>
            )}

            {!hidden('rail_cn') && (
              <RailCard
                title="Cập nhật chi nhánh" tile="indigo" icon={<Building2 size={13} />}
                action={
                  <div className="relative">
                    <button onClick={() => setShowVisitSettings(v => !v)} title="Cài đặt ngưỡng cảnh báo" className={BTN_ICON}><Settings size={14} /></button>
                    {showVisitSettings && (
                      <ThresholdPopover
                        label="Ngưỡng nhắc liên hệ (ngày)" value={visitThreshold} onChange={setVisitThreshold} onClose={() => setShowVisitSettings(false)}
                        hint={<>≤ {visitThreshold} ngày: xanh · {visitThreshold}–{2 * visitThreshold} ngày: cam · &gt; {2 * visitThreshold} ngày: đỏ</>}
                      />
                    )}
                  </div>
                }
              >
                <div className="flex flex-col max-h-72 overflow-y-auto">
                  {visitSuggests.length === 0 ? (
                    <RailEmpty>Chưa có dữ liệu</RailEmpty>
                  ) : visitSuggests.map(s => (
                    <div key={s.branch.id} onClick={() => openBranchProfile(s.branch)} className={`${ROW} ${ROW_HOVER}`}>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${visitDotColor(s.daysSince)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-[#1D1D1F] truncate">{s.branch.name}</div>
                        <div className="text-[11.5px] text-[#86868B] flex items-center gap-1"><Phone size={10} />Gọi điện / nhắn tin hỏi thăm</div>
                      </div>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 tabular-nums ${visitColor(s.daysSince)}`}>
                        {s.daysSince === null ? 'Chưa liên hệ' : `${s.daysSince} ngày`}
                      </span>
                      <ChevronRight size={14} className="text-[#C7C7CC] shrink-0 -mr-1" />
                    </div>
                  ))}
                </div>
              </RailCard>
            )}

            {!hidden('rail_kcn') && (
              <RailCard title="KCN cần ghé thăm" tile="teal" icon={<MapPin size={13} />}
                action={<button onClick={openKcnGrid} className="text-[12.5px] text-[#0066CC] hover:underline inline-flex items-center gap-0.5">KCN Grid <ChevronRight size={13} /></button>}>
                <div className="flex flex-col">
                  {kcnRail.length === 0 ? (
                    <RailEmpty>Chưa có dữ liệu</RailEmpty>
                  ) : kcnRail.map(z => (
                    <div key={z.id} onClick={openKcnGrid} className={`${ROW} ${ROW_HOVER} justify-between`}>
                      <div className="text-[13px] font-medium text-[#1D1D1F] truncate">{z.name}</div>
                      <span className={`text-[12px] font-medium shrink-0 tabular-nums ${(z.days_since_visit ?? 999) >= 21 ? 'text-[#D70015]' : 'text-[#B25000]'}`}>
                        {z.days_since_visit === null ? 'Chưa ghé' : `${z.days_since_visit} ngày`}
                      </span>
                    </div>
                  ))}
                </div>
              </RailCard>
            )}

            {roleCard()}
          </div>
        </div>

        {/* ==== KCN GRID — accordion ==== */}
        {!hidden('kcn_grid') && (
          <div ref={kcnSectionRef} className={`${mobileTab === 'theodoi' ? 'block' : 'hidden'} xl:block mt-4 md:mt-5 ${CARD} overflow-hidden`}>
            <button onClick={() => setKcnOpen(v => !v)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-black/[0.02] transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-6 h-6 rounded-[7px] flex items-center justify-center text-white shrink-0 ${ICON_TILE.teal}`}><MapPin size={13} /></span>
                <span className="text-[14px] font-semibold text-[#1D1D1F] tracking-[-0.01em] truncate">KCN Grid</span>
                <span className="hidden sm:inline text-[13px] text-[#86868B] truncate">Theo dõi khai thác khu công nghiệp</span>
              </div>
              <ChevronDown size={16} className={`text-[#86868B] shrink-0 transition-transform duration-200 ${kcnOpen ? 'rotate-180' : ''}`} />
            </button>
            {kcnOpen && (
              <div className="border-t border-black/[0.06]">
                <KCNGridSection toast={toast} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* FAB mobile: thêm việc nhanh */}
      <button
        onClick={() => { setMobileTab('viec'); setQuickAddSignal(s => s + 1); }}
        className="md:hidden fixed right-4 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 w-12 h-12 rounded-full bg-[#0071E3] text-white shadow-[0_10px_24px_-6px_rgba(0,113,227,0.6)] flex items-center justify-center active:scale-95 transition-transform"
        title="Thêm việc"
      >
        <Plus size={22} />
      </button>

      {/* ==== Panel hồ sơ chi nhánh ==== */}
      {openBranchPanel && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-end z-50" onClick={() => setOpenBranchPanel(null)}>
          <div className="bg-[#F5F5F7] h-full w-full max-w-2xl shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white/85 backdrop-blur-xl border-b border-black/[0.06] px-4 md:px-5 py-3 flex items-center gap-2 z-10">
              <span className={`w-8 h-8 rounded-[9px] flex items-center justify-center text-white shrink-0 ${ICON_TILE.indigo}`}><Building2 size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold text-[#1D1D1F] tracking-[-0.01em] truncate">{openBranchPanel.name}</div>
                <div className="text-[12.5px] text-[#86868B] flex items-center gap-x-2 flex-wrap">
                  {openBranchPanel.manager_name && <span>Quản lý: <span className="text-[#3A3A3C]">{openBranchPanel.manager_name}</span></span>}
                  {openBranchPanel.phone && (
                    <a href={`tel:${openBranchPanel.phone}`} className="inline-flex items-center gap-1 text-[#0066CC] hover:underline"><Phone size={11} />{openBranchPanel.phone}</a>
                  )}
                </div>
              </div>
              <button onClick={() => setOpenBranchPanel(null)} title="Đóng" className="w-8 h-8 rounded-full bg-black/[0.05] text-[#6E6E73] hover:bg-black/[0.08] hover:text-[#1D1D1F] flex items-center justify-center transition shrink-0"><X size={16} /></button>
            </div>
            <div className="p-3 md:p-5">
              <BranchHistoryFields key={openBranchPanel.id} branch={openBranchPanel} onSaved={date => onBranchVisitSaved(openBranchPanel, date)} />
            </div>
          </div>
        </div>
      )}

      {/* ==== Modals thao tác nhanh ==== */}
      {showQuoteModal && <QuoteModal clients={clients} toast={toast} onClose={() => setShowQuoteModal(false)} />}
      {showCostPlan && <CostPlanModal clients={clients} pipeline={pipeline} branches={branches} toast={toast} onClose={() => setShowCostPlan(false)} />}
      {showGiaoViec && (
        <GiaoViecModal
          clients={clients}
          branches={branches}
          toast={toast}
          onClose={() => setShowGiaoViec(false)}
          onCreated={() => setRefreshToken(t => t + 1)}
        />
      )}
      {showBulkLabor && <BulkLaborModal clients={clients} toast={toast} onClose={() => setShowBulkLabor(false)} />}
      {showPayrollCalc && <PayrollCalculatorModal clients={clients} toast={toast} onClose={() => setShowPayrollCalc(false)} />}
    </>
  );
}
