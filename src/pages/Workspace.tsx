// src/pages/Workspace.tsx — «Bàn làm việc»
// Bố cục theo demo đã duyệt (docs/workspace_mockup.html):
//   Hero (chào + 4 stat) → quick actions → [Feed «Việc của tôi» | Rail phải]
//   Rail = HĐ cần xử lý · Cập nhật chi nhánh · KCN cần ghé (+ thẻ theo vai trò)
//   KCN Grid = accordion dưới cùng. Win/Loss đã dời sang CRM.
// Mỗi dữ liệu chỉ hiển thị ở MỘT nơi — feed là nguồn việc duy nhất, rail là radar theo dõi.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FileText, Send, ClipboardList, FileWarning, Phone, MapPin, ChevronDown,
  Settings, Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw, TrendingUp, Wallet,
  AlertTriangle, CalendarClock, X, Plus, ArrowRight, Calculator,
} from 'lucide-react';
import { MyWorkFeed, type FeedStats } from '../components/workspace/MyWorkFeed';
import { KCNGridSection } from '../components/workspace/KCNGridSection';
import { BulkLaborModal } from '../components/workspace/BulkLaborModal';
import { GiaoViecModal } from '../components/workspace/GiaoViecModal';
import { QuoteModal } from '../components/workspace/QuoteModal';
import { PayrollCalculatorModal } from '../components/workspace/PayrollCalculatorModal';
import { BranchHistoryFields, recordBranchUpdateSession } from '../components/workspace/BranchHistoryFields';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { queueGoogleSync } from '../lib/googleSync';
import { useBranchData } from '../hooks/useBranchData';
import { usePersistedState } from '../hooks/usePersistedState';
import type { Client, FinanceRecord, CRMPipelineEntry, CRMProduct, Page, KCNSummary, Branch } from '../lib/types';
import { ROLE_LABELS, CRM_STAGES } from '../lib/constants';
import { formatDate, daysUntil } from '../lib/format';

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

function RailCard({ title, icon, count, action, children }: {
  title: string; icon: React.ReactNode; count?: number; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-[12px] font-extrabold text-[#0c2340]">
          {icon}{title}
          {count !== undefined && count > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-px rounded-full bg-amber-50 text-amber-700 border border-amber-200">{count}</span>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function Workspace({ clients, pipeline, products, onNavigate, onClientUpdate, toast }: WorkspaceProps) {
  const { user, token } = useAuth();
  const { branches, updateBranch } = useBranchData();

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
      kcn: client.industrial_zones?.[0] || null,
      status: 'in_progress',
      doc_status: 'dang_soan',
    });
    setCreatingRenewal(null);
    if (!error) {
      setRefreshToken(t => t + 1);
      setShowManualAdd(false);
      setManualSearch('');
      toast(`Đã tạo việc tái ký cho ${client.name}`);
      queueGoogleSync(token);
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
        kcn: s.client.industrial_zones?.[0] || null,
        status: 'in_progress',
        doc_status: 'dang_soan',
      }));
    const { error } = await supabase.from('work_tasks').insert(toInsert);
    setSavingBatch(false);
    if (!error) {
      setRefreshToken(t => t + 1);
      toast(`Đã tạo ${toInsert.length} việc tái ký`);
      setSelectedContractIds(new Set());
      queueGoogleSync(token);
    }
  }

  // ---- Rail: Cập nhật chi nhánh ----
  const [visitThreshold, setVisitThreshold] = usePersistedState('lgvn_visit_threshold_days', 7);
  const [showVisitSettings, setShowVisitSettings] = useState(false);
  const [branchActivity, setBranchActivity] = useState<Record<string, string>>({});
  const [openBranchPanel, setOpenBranchPanel] = useState<Branch | null>(null);
  const [panelForm, setPanelForm] = useState<Partial<Branch>>({});
  const [panelRecordDate, setPanelRecordDate] = useState(todayStr());
  const [panelSaving, setPanelSaving] = useState(false);

  // Lịch sử phiên được lưu với target_name = `Chi nhánh ${region}`; fallback sang name khi chưa có region
  const branchKey = (b: Branch) => b.region || b.name;

  useEffect(() => {
    const names = branches.map(b => `Chi nhánh ${branchKey(b)}`);
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
    const last = branchActivity[`Chi nhánh ${branchKey(b)}`];
    const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    return { branch: b, daysSince };
  }).sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999)),
  [branches, branchActivity]);

  function visitDotColor(daysSince: number | null) {
    if (daysSince === null || daysSince > 2 * visitThreshold) return 'bg-red-500';
    if (daysSince > visitThreshold) return 'bg-amber-400';
    return 'bg-green-500';
  }

  function visitColor(daysSince: number | null) {
    if (daysSince === null || daysSince > 2 * visitThreshold) return 'bg-red-50 text-red-700 border-red-200';
    if (daysSince > visitThreshold) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-green-50 text-green-700 border-green-200';
  }

  function openBranchProfile(branch: Branch) {
    setOpenBranchPanel(branch);
    setPanelForm(branch);
    setPanelRecordDate(todayStr());
  }

  async function savePanelBranch() {
    if (!openBranchPanel || !user) return;
    setPanelSaving(true);
    const fields = {
      status_note: panelForm.status_note ?? null,
      difficulties: panelForm.difficulties ?? null,
      opportunities: panelForm.opportunities ?? null,
    };
    try {
      await updateBranch(openBranchPanel.id, fields);
      const key = branchKey(openBranchPanel);
      await recordBranchUpdateSession(user.id, key, fields, panelRecordDate);
      setBranchActivity(prev => ({ ...prev, [`Chi nhánh ${key}`]: panelRecordDate }));
      setOpenBranchPanel(null);
    } catch (e) {
      alert('Lỗi khi lưu: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPanelSaving(false);
    }
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

  const branchExpiring = useMemo(() =>
    branchRegion
      ? expiringList30.filter(x => x.client.region === branchRegion)
      : [],
  [expiringList30, branchRegion]);

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
        <RailCard title="Thông báo hợp đồng" icon={<AlertTriangle size={13} className="text-[#888]" />} count={alertClients.length}>
          <div className="flex flex-col">
            {alertClients.slice(0, 5).map(c => (
              <div key={c.id} onClick={() => onNavigate('clients')} className="flex items-center justify-between gap-2 px-3.5 py-2 border-t border-[#F0EFEB] hover:bg-[#F9F9F7] cursor-pointer">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-[#333] truncate">{c.name}</div>
                  <div className="text-[10.5px] text-[#999]">HĐ hết: {formatDate(c.contract_end)}</div>
                </div>
                <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full shrink-0 ${c.status === 'danger' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
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
        <RailCard title="KH chưa thanh toán tháng này" icon={<Wallet size={13} className="text-[#888]" />} count={unpaidClients.length}>
          <div className="flex flex-col">
            {unpaidClients.length === 0 ? (
              <div className="text-[12px] text-[#999] py-3 text-center border-t border-[#F0EFEB]">Tất cả đã thanh toán</div>
            ) : unpaidClients.slice(0, 6).map(c => (
              <div key={c.id} onClick={() => onNavigate('finance')} className="flex items-center justify-between gap-2 px-3.5 py-2 border-t border-[#F0EFEB] hover:bg-[#F9F9F7] cursor-pointer">
                <div className="text-[12px] font-semibold text-[#333] truncate">{c.name}</div>
                <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0">Chưa TT</span>
              </div>
            ))}
          </div>
        </RailCard>
      );
    }
    if (user.role === 'bdh' && !hidden('alerts') && branchExpiring.length > 0) {
      return (
        <RailCard title="HĐ sắp hết hạn (chi nhánh)" icon={<CalendarClock size={13} className="text-[#888]" />} count={branchExpiring.length}>
          <div className="flex flex-col">
            {branchExpiring.slice(0, 6).map(({ client: c, daysLeft }) => (
              <div key={c.id} className="flex items-center justify-between gap-2 px-3.5 py-2 border-t border-[#F0EFEB]">
                <div className="text-[12px] font-semibold text-[#333] truncate">{c.name}</div>
                <span className="text-[10.5px] text-amber-700 shrink-0">{formatDate(c.contract_end)} ({daysLeft} ngày)</span>
              </div>
            ))}
          </div>
        </RailCard>
      );
    }
    if (user.role === 'kinhdoanh' && !hidden('prospects')) {
      if (!staleProspects.length) return null;
      return (
        <RailCard title="Prospects cần follow-up" icon={<TrendingUp size={13} className="text-[#888]" />} count={staleProspects.length}
          action={<button onClick={() => onNavigate('crm-pipeline')} className="text-[10.5px] text-blue-600 hover:underline">Pipeline →</button>}>
          <div className="flex flex-col">
            {staleProspects.map(p => {
              const stageInfo = CRM_STAGES.find(s => s.id === p.stage);
              return (
                <div key={p.id} onClick={() => onNavigate('crm-pipeline')} className="flex items-center justify-between gap-2 px-3.5 py-2 border-t border-[#F0EFEB] hover:bg-[#F9F9F7] cursor-pointer">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-[#333] truncate">{p.company_name}</div>
                    <div className="text-[10.5px] text-[#999]">LH gần nhất: {p.last_contact ? formatDate(p.last_contact) : 'Chưa'}</div>
                  </div>
                  {stageInfo && <span className={`text-[9.5px] px-2 py-0.5 rounded-full border shrink-0 ${stageInfo.color}`}>{stageInfo.label}</span>}
                </div>
              );
            })}
          </div>
        </RailCard>
      );
    }
    return null;
  };

  return (
    <>
      {/* ==== HERO ==== */}
      <div className="flex items-end justify-between px-4 md:px-6 py-3.5 md:py-4 border-b border-[#E8E7E2] bg-white gap-3 flex-wrap">
        <div>
          <h1 className="text-[17px] md:text-[19px] font-extrabold text-[#0c2340]">{greeting}, {user.full_name} 👋</h1>
          <div className="text-[11.5px] text-[#999] mt-0.5">
            {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} · {ROLE_LABELS[user.role] || user.role}
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="grid grid-cols-4 gap-1.5 md:gap-2">
            {[
              { label: 'quá hạn', value: feedStats.overdue, color: feedStats.overdue > 0 ? 'text-red-600' : 'text-[#333]' },
              { label: 'hôm nay', value: feedStats.today, color: 'text-blue-600' },
              { label: 'HĐ cần xử lý', value: contractSuggests.length, color: 'text-[#333]' },
              { label: 'xong tuần này', value: feedStats.doneThisWeek, color: 'text-emerald-600' },
            ].map(s => (
              <div key={s.label} className="text-right px-2.5 md:px-3.5 py-1.5 rounded-[10px] border border-[#E8E7E2] bg-[#FBFAF7] min-w-[68px] md:min-w-[86px]">
                <div className={`text-[17px] md:text-[19px] font-bold leading-tight ${s.color}`}>{s.value}</div>
                <div className="text-[9px] md:text-[10px] text-[#999] whitespace-nowrap">{s.label}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className={`hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition shrink-0 ${settingsOpen ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            <Settings size={14} /> Tuỳ chỉnh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-5" style={{ zoom: layout.fontScale }}>
        {/* ==== Cài đặt ==== */}
        {settingsOpen && (
          <div className="mb-4 bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-4">
            <div>
              <div className="text-[12px] font-semibold text-[#333] mb-2">Cỡ chữ / không gian làm việc</div>
              <div className="flex items-center gap-2">
                <button onClick={() => adjustFont(-FONT_STEP)} disabled={layout.fontScale <= FONT_MIN} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition"><ZoomOut size={14} /></button>
                <span className="text-[12.5px] text-[#555] w-12 text-center">{Math.round(layout.fontScale * 100)}%</span>
                <button onClick={() => adjustFont(FONT_STEP)} disabled={layout.fontScale >= FONT_MAX} className="w-8 h-8 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition"><ZoomIn size={14} /></button>
                <button onClick={() => setLayout(DEFAULT_LAYOUT)} className="ml-2 inline-flex items-center gap-1 text-[11.5px] text-[#999] hover:text-blue-600 transition"><RotateCcw size={12} /> Khôi phục mặc định</button>
              </div>
            </div>
            <div>
              <div className="text-[12px] font-semibold text-[#333] mb-2">Hiển thị / ẩn các mục</div>
              <div className="space-y-1">
                {DEFAULT_ORDER.filter(k => sectionAvailable(k, user.role)).map(key => {
                  const isHidden = hidden(key);
                  return (
                    <div key={key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[#F0EFEA] transition ${isHidden ? 'opacity-50 bg-[#fafafa]' : 'bg-[#FAFAF8]'} hover:bg-[#F4F4F1]`}>
                      <span className="flex-1 text-[12px] text-[#333]">{SECTION_LABELS[key]}</span>
                      <button onClick={() => toggleHidden(key)} className="text-[#999] hover:text-blue-600 transition shrink-0" title={isHidden ? 'Hiện' : 'Ẩn'}>
                        {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ==== Segment mobile ==== */}
        <div className="xl:hidden flex bg-[#EBE9E1] rounded-[10px] p-[3px] mb-3">
          {([['viec', 'Việc của tôi'], ['theodoi', 'Theo dõi']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={`flex-1 text-[12px] py-1.5 rounded-lg transition ${mobileTab === key ? 'bg-white text-[#0c2340] font-extrabold shadow-sm' : 'text-[#666] font-semibold'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ==== QUICK ACTIONS ==== */}
        {!hidden('quick_actions') && (
          <div className={`${mobileTab === 'viec' ? 'grid' : 'hidden'} xl:grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4`}>
            <button onClick={() => setShowPayrollCalc(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 border border-blue-600 text-[12px] font-semibold text-white hover:bg-blue-700 transition-colors">
              <Calculator size={14} /> Tính bảng lương
            </button>
            {[
              { label: 'Tạo báo giá', icon: <FileText size={14} />, onClick: () => setShowQuoteModal(true) },
              { label: 'Giao việc', icon: <Send size={14} />, onClick: () => setShowGiaoViec(true) },
              { label: 'Ghi nhận LĐ', icon: <ClipboardList size={14} />, onClick: () => setShowBulkLabor(true) },
            ].map(a => (
              <button key={a.label} onClick={a.onClick}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#E8E7E2] bg-white text-[12px] font-medium text-[#333] hover:border-blue-300 hover:bg-blue-50 transition-colors">
                {a.icon}{a.label}
              </button>
            ))}
          </div>
        )}

        {/* ==== FEED + RAIL ==== */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
          {/* Cột chính: feed hợp nhất */}
          <div className={`${mobileTab === 'viec' ? 'block' : 'hidden'} xl:block min-w-0`}>
            <MyWorkFeed
              clients={clients}
              pipelineEntries={pipeline}
              products={products}
              onClientUpdate={onClientUpdate}
              toast={toast}
              onStatsChange={handleStats}
              refreshToken={refreshToken}
              quickAddSignal={quickAddSignal}
              hideHistory={hidden('lich_su')}
            />
          </div>

          {/* Rail phải: radar theo dõi */}
          <div className={`${mobileTab === 'theodoi' ? 'flex' : 'hidden'} xl:flex flex-col gap-3`}>
            {!hidden('rail_hd') && (
              <RailCard
                title="HĐ cần xử lý" icon={<FileWarning size={13} className="text-[#888]" />} count={contractSuggests.length}
                action={
                  <div className="flex items-center gap-1.5">
                    <div className="relative">
                      <button onClick={() => setShowContractSettings(v => !v)} title="Ngưỡng cảnh báo" className="text-[#bbb] hover:text-blue-600 transition-colors"><Settings size={12} /></button>
                      {showContractSettings && (
                        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-[#E8E7E2] rounded-lg shadow-lg p-2.5 w-44">
                          <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">HĐ còn ≤ (ngày)</label>
                          <input type="number" min={1} value={contractThreshold}
                            onChange={e => setContractThreshold(Math.max(1, Number(e.target.value) || 1))}
                            className="text-[11.5px] border border-[#E8E7E2] rounded-md px-2 py-1 bg-white w-full focus:outline-none focus:border-blue-400" />
                          <button onClick={() => setShowContractSettings(false)} className="mt-1.5 text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium w-full">Đóng</button>
                        </div>
                      )}
                    </div>
                    <button onClick={() => { setShowManualAdd(v => !v); setManualSearch(''); }} className="text-[10px] px-1.5 py-0.5 rounded-md border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 transition">+ Thủ công</button>
                  </div>
                }
              >
                {showManualAdd && (
                  <div className="px-3 pb-2">
                    <input autoFocus placeholder="Tìm công ty..." value={manualSearch} onChange={e => setManualSearch(e.target.value)}
                      className="w-full text-[11.5px] px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50/50 focus:outline-none focus:border-blue-400" />
                    {manualCandidates.length > 0 ? (
                      <div className="mt-1 flex flex-col gap-0.5 max-h-36 overflow-y-auto">
                        {manualCandidates.map(c => (
                          <button key={c.id} onClick={() => createRenewalTask(c)} disabled={!!creatingRenewal}
                            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-white border border-[#E8E7E2] hover:border-blue-300 text-left">
                            <span className="text-[11.5px] font-medium text-[#111] truncate flex-1">{c.name}</span>
                            <ArrowRight size={11} className="text-[#bbb] shrink-0" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#bbb] text-center py-2">Không tìm thấy</div>
                    )}
                  </div>
                )}
                {/* Quy tắc bản cũ: chọn nhiều khách rồi lưu hàng loạt 1 lần */}
                {selectedContractIds.size > 0 && (
                  <div className="flex items-center justify-between mx-3 mb-2 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                    <span className="text-[11px] text-blue-700">Đã chọn {selectedContractIds.size}</span>
                    <button onClick={saveBatchRenewalTasks} disabled={savingBatch}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition">
                      {savingBatch ? '...' : 'Lưu tất cả'}
                    </button>
                  </div>
                )}
                <div className="flex flex-col max-h-72 overflow-y-auto">
                  {contractSuggests.length === 0 ? (
                    <div className="text-[12px] text-[#999] py-3 text-center border-t border-[#F0EFEB]">Không có HĐ gần hết hạn</div>
                  ) : contractSuggests.map(({ client: c, daysLeft }) => {
                    const isSel = selectedContractIds.has(c.id);
                    return (
                      <div key={c.id} onClick={() => toggleContractSelect(c.id)}
                        className={`flex items-center justify-between gap-2 px-3.5 py-2 border-t border-[#F0EFEB] cursor-pointer transition-colors ${isSel ? 'bg-blue-50' : 'hover:bg-[#F9F9F7]'}`}>
                        <div className="min-w-0 flex items-center gap-2">
                          <input type="checkbox" checked={isSel} onClick={e => e.stopPropagation()} onChange={() => toggleContractSelect(c.id)} className="shrink-0 accent-blue-600" />
                          <span className={`w-2 h-2 rounded-full shrink-0 ${daysLeft <= 0 ? 'bg-red-500' : daysLeft <= 7 ? 'bg-red-400' : 'bg-amber-400'}`} />
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-[#333] truncate">{c.name}</div>
                            <div className="text-[10.5px] text-[#999]">
                              {formatDate(c.contract_end)} · {daysLeft <= 0 ? 'đã hết hạn' : `còn ${daysLeft} ngày`}
                            </div>
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); createRenewalTask(c); }} disabled={creatingRenewal === c.id}
                          className="text-[10px] font-semibold px-2 py-1 rounded-md border border-blue-300 text-blue-600 bg-blue-50 hover:bg-blue-100 transition shrink-0 disabled:opacity-40">
                          {creatingRenewal === c.id ? '...' : '+ Việc'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </RailCard>
            )}

            {!hidden('rail_cn') && (
              <RailCard
                title="Cập nhật chi nhánh" icon={<Phone size={13} className="text-[#888]" />}
                action={
                  <div className="relative">
                    <button onClick={() => setShowVisitSettings(v => !v)} title="Cài đặt ngưỡng cảnh báo" className="text-[#bbb] hover:text-blue-600 transition-colors"><Settings size={12} /></button>
                    {showVisitSettings && (
                      <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-[#E8E7E2] rounded-lg shadow-lg p-2.5 w-52">
                        <label className="text-[10px] font-medium text-[#888] uppercase tracking-wide mb-1 block">Ngưỡng (số ngày)</label>
                        <input type="number" min={1} value={visitThreshold}
                          onChange={e => setVisitThreshold(Math.max(1, Number(e.target.value) || 1))}
                          className="text-[11.5px] border border-[#E8E7E2] rounded-md px-2 py-1 bg-white text-[#333] focus:outline-none focus:border-blue-400 w-full" />
                        <div className="text-[10px] text-[#aaa] mt-1.5 leading-relaxed">
                          ≤ {visitThreshold} ngày: xanh · {visitThreshold}-{2 * visitThreshold} ngày: cam · &gt;{2 * visitThreshold} ngày: đỏ
                        </div>
                        <button onClick={() => setShowVisitSettings(false)} className="mt-1.5 text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 w-full">Đóng</button>
                      </div>
                    )}
                  </div>
                }
              >
                <div className="flex flex-col max-h-64 overflow-y-auto">
                  {visitSuggests.length === 0 ? (
                    <div className="text-[12px] text-[#999] py-3 text-center border-t border-[#F0EFEB]">Chưa có dữ liệu</div>
                  ) : visitSuggests.map(s => (
                    <div key={s.branch.id} onClick={() => openBranchProfile(s.branch)}
                      className="flex items-center gap-2 px-3.5 py-2 border-t border-[#F0EFEB] hover:bg-[#F9F9F7] cursor-pointer">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${visitDotColor(s.daysSince)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-[#333] truncate">{s.branch.name}</div>
                        <div className="text-[10px] text-[#888] mt-0.5 flex items-center gap-1"><Phone size={10} />Gọi điện / nhắn tin hỏi thăm</div>
                      </div>
                      <span className={`text-[9.5px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${visitColor(s.daysSince)}`}>
                        {s.daysSince === null ? 'Chưa liên hệ' : `${s.daysSince} ngày chưa LH`}
                      </span>
                    </div>
                  ))}
                </div>
              </RailCard>
            )}

            {!hidden('rail_kcn') && (
              <RailCard title="KCN cần ghé thăm" icon={<MapPin size={13} className="text-[#888]" />}
                action={<button onClick={openKcnGrid} className="text-[10.5px] text-blue-600 hover:underline">Mở KCN Grid →</button>}>
                <div className="flex flex-col">
                  {kcnRail.length === 0 ? (
                    <div className="text-[12px] text-[#999] py-3 text-center border-t border-[#F0EFEB]">Chưa có dữ liệu</div>
                  ) : kcnRail.map(z => (
                    <div key={z.id} onClick={openKcnGrid} className="flex items-center justify-between gap-2 px-3.5 py-2 border-t border-[#F0EFEB] hover:bg-[#F9F9F7] cursor-pointer">
                      <div className="text-[12px] font-semibold text-[#333] truncate">{z.name}</div>
                      <span className={`text-[10.5px] font-semibold shrink-0 ${(z.days_since_visit ?? 999) >= 21 ? 'text-red-600' : 'text-amber-600'}`}>
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
          <div ref={kcnSectionRef} className={`${mobileTab === 'theodoi' ? 'block' : 'hidden'} xl:block mt-4 bg-white border border-[#E8E7E2] rounded-[12px] overflow-hidden`}>
            <button onClick={() => setKcnOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-2.5 bg-[#F9F9F7] text-left">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#333]">
                <MapPin size={14} className="text-[#888]" />
                KCN Grid — theo dõi khai thác khu công nghiệp
              </div>
              <ChevronDown size={15} className={`text-[#999] transition-transform ${kcnOpen ? 'rotate-180' : ''}`} />
            </button>
            {kcnOpen && (
              <div className="border-t border-[#E8E7E2]">
                <KCNGridSection toast={toast} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* FAB mobile: thêm việc nhanh */}
      <button
        onClick={() => { setMobileTab('viec'); setQuickAddSignal(s => s + 1); }}
        className="md:hidden fixed right-4 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 w-12 h-12 rounded-full bg-blue-600 text-white shadow-[0_8px_20px_rgba(29,78,216,0.4)] flex items-center justify-center active:scale-95 transition-transform"
        title="Thêm việc"
      >
        <Plus size={22} />
      </button>

      {/* ==== Panel hồ sơ chi nhánh ==== */}
      {openBranchPanel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-50" onClick={() => setOpenBranchPanel(null)}>
          <div className="bg-white h-full w-full max-w-md shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#E8E7E2] px-4 py-3 flex items-center gap-2 z-10">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[#111] truncate">{openBranchPanel.name}</div>
                <div className="text-[11px] text-[#888] mt-0.5">
                  {openBranchPanel.manager_name && `Quản lý: ${openBranchPanel.manager_name}`}
                  {openBranchPanel.phone && ` · ${openBranchPanel.phone}`}
                </div>
              </div>
              <button onClick={() => setOpenBranchPanel(null)} className="text-[#999] hover:text-[#333] transition-colors shrink-0"><X size={18} /></button>
            </div>
            <div className="p-4">
              <BranchHistoryFields branch={panelForm as Branch} onChange={fields => setPanelForm(prev => ({ ...prev, ...fields }))} recordDate={panelRecordDate} onRecordDateChange={setPanelRecordDate} />
              <button onClick={savePanelBranch} disabled={panelSaving}
                className="mt-3 w-full text-[12px] px-3 py-2 rounded-md bg-blue-600 text-white font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors">
                {panelSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==== Modals thao tác nhanh ==== */}
      {showQuoteModal && <QuoteModal clients={clients} toast={toast} onClose={() => setShowQuoteModal(false)} />}
      {showGiaoViec && (
        <GiaoViecModal
          clients={clients}
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
