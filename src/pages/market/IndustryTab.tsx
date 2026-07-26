import { useEffect, useMemo, useRef, useState } from 'react';
import { Doughnut, Bar, Bubble } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, PointElement, Tooltip, Legend,
} from 'chart.js';
import { Plus, ArrowLeft, Loader2, Check, Factory, X, Users, Building2, Coins, Eye, Landmark, TrendingUp, FileText, ScrollText, FileDown, Settings } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning';
import type {
  Industry, Client, MarketLead, MarketSurvey, Competitor,
  IndustryTerm, IndustryPosition, IndustryMetric, IndustryValueChainItem,
} from '../../lib/types';
import type { MarketTab } from '../Market';
import IndustryTerms from './IndustryTerms';
import IndustrySeasonality, { SEASON_LEVELS } from './IndustrySeasonality';
import IndustryMatrix from './IndustryMatrix';
import IndustryPositions from './IndustryPositions';
import IndustryRetention from './IndustryRetention';
import IndustryMetrics from './IndustryMetrics';
import IndustryValueChain from './IndustryValueChain';
import IndustryBattlecards from './IndustryBattlecards';
import IndustryCheatSheetModal from './IndustryCheatSheetModal';
import { buildIndustryBriefMd } from '../../utils/industryMdExport';
import { downloadMarkdown } from '../../utils/clientMdExport';
import RichTextEditor from './RichTextEditor';
import { htmlToPlainText } from '../../lib/htmlText';

const emptySeason = () => Array(12).fill(0) as number[];
const emptyNotes = () => Array(12).fill('') as string[];

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, Tooltip, Legend);

const CHART_COLORS = ['#1D4ED8', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5', '#0D9488', '#9333EA'];

// Bật/tắt từng biểu đồ tổng quan ở dashboard ngành — lưu localStorage, không cần migration.
// Mặc định chỉ bật "Tổng LĐ theo ngành" (giá trị cao, ít rối mắt nhất), 3 cái còn lại tắt sẵn.
interface DashChartSettings {
  workersBar: boolean;
  seasonHeatmap: boolean;
  opportunityMatrix: boolean;
  turnoverBar: boolean;
}
const DASH_SETTINGS_KEY = 'market_industry_dash_settings';
const DEFAULT_DASH_SETTINGS: DashChartSettings = { workersBar: true, seasonHeatmap: false, opportunityMatrix: false, turnoverBar: false };
const loadDashSettings = (): DashChartSettings => {
  try {
    const raw = localStorage.getItem(DASH_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_DASH_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_DASH_SETTINGS };
};

const turnoverColor = (r: number) => r >= 15 ? '#DC2626' : r >= 8 ? '#D97706' : '#059669';

interface Props {
  clients: Client[];
  marketLeads: MarketLead[];
  marketSurveys: MarketSurvey[];
  competitors: Competitor[];
  goTab: (tab: MarketTab, zone?: string) => void;
  toast: (msg: string) => void;
}

interface IndustryStats {
  clientCount: number;
  leadCount: number;
  workers: number;
  wageMin: number | null;
  wageMax: number | null;
  competitorCount: number;
}

export default function IndustryTab({ clients, marketLeads, marketSurveys, competitors, goTab, toast }: Props) {
  const [list, setList] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const parseHashIndex = () => {
    const parts = window.location.hash.replace('#/', '').split('/');
    const raw = parts[0] === 'market' && parts[1] === 'industry' ? parts[2] : undefined;
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  };
  const [selectedId, setSelectedIdRaw] = useState<string | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(parseHashIndex);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [dashSettings, setDashSettings] = useState<DashChartSettings>(loadDashSettings);
  const [showDashSettings, setShowDashSettings] = useState(false);
  useEffect(() => { localStorage.setItem(DASH_SETTINGS_KEY, JSON.stringify(dashSettings)); }, [dashSettings]);
  const [form, setForm] = useState<Partial<Industry> | null>(null);
  // Vừa quay lại trang ngành đã có dữ liệu từ trước — thao tác ĐẦU TIÊN làm đổi giá trị phải
  // xác nhận lại (đề phòng lỡ tay); xác nhận 1 lần thì mở khoá, không hỏi lại tới khi rời trang.
  const [lockedSnapshot, setLockedSnapshot] = useState(false);
  const [confirmEditAction, setConfirmEditAction] = useState<{ run: () => void } | null>(null);
  const [editResetKey, setEditResetKey] = useState(0);
  const guard = (run: () => void) => {
    if (lockedSnapshot) setConfirmEditAction({ run });
    else run();
  };

  // Tự động lưu — gõ/click xong 700ms không thao tác gì thêm là tự ghi DB, không cần bấm nút
  // "Lưu" nữa. skipAutosaveRef chặn việc tự lưu ngay lúc vừa nạp dữ liệu ngành (form mới set).
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  useBeforeUnloadWarning(saveStatus === 'pending' || saveStatus === 'saving');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<Partial<Industry> | null>(null);
  formRef.current = form;
  const skipAutosaveRef = useRef(true);

  const persist = async (data: Partial<Industry>) => {
    if (!selected) return;
    setSaveStatus('saving');
    const updates = {
      overview: data.overview?.trim() || null,
      policy_notes: data.policy_notes?.trim() || null,
      tax_notes: data.tax_notes?.trim() || null,
      trend_notes: data.trend_notes?.trim() || null,
      season_levels: data.season_levels ?? emptySeason(),
      season_notes: data.season_notes ?? emptyNotes(),
      turnover_rate: data.turnover_rate ?? null,
      quit_stage: data.quit_stage || null,
      quit_stages: data.quit_stages ?? [],
      quit_reasons: data.quit_reasons ?? [],
      quit_reason_notes: data.quit_reason_notes ?? {},
      retention_actions: data.retention_actions?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('industries').update(updates).eq('id', selected.id);
    if (error) { setSaveStatus('idle'); toast('Lỗi: ' + error.message); return; }
    setList(prev => prev.map(i => i.id === selected.id ? { ...i, ...updates } : i));
    setSaveStatus('saved');
  };

  const flushPendingSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (formRef.current) persist(formRef.current);
    }
  };

  const load = async () => {
    const { data, error } = await supabase.from('industries').select('*').order('name');
    if (!error && data) setList(data as Industry[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Khôi phục ngành đang xem từ URL hash sau khi danh sách tải xong (VD: F5 trang chi tiết ngành).
  useEffect(() => {
    if (pendingIndex != null && list.length) {
      const item = list[pendingIndex];
      if (item) setSelectedIdRaw(item.id);
      setPendingIndex(null);
    }
  }, [pendingIndex, list]);

  const setSelectedId = (id: string | null) => {
    setSelectedIdRaw(id);
    const idx = id ? list.findIndex(i => i.id === id) : -1;
    const hash = idx >= 0 ? `#/market/industry/${idx}` : '#/market/industry';
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  };

  const selected = list.find(i => i.id === selectedId) || null;

  useEffect(() => {
    flushPendingSave();
    skipAutosaveRef.current = true;
    if (selected) {
      const snapshot = {
        overview: selected.overview ?? '',
        policy_notes: selected.policy_notes ?? '',
        tax_notes: selected.tax_notes ?? '',
        trend_notes: selected.trend_notes ?? '',
        season_levels: selected.season_levels?.length === 12 ? [...selected.season_levels] : emptySeason(),
        season_notes: selected.season_notes?.length === 12 ? [...selected.season_notes] : emptyNotes(),
        turnover_rate: selected.turnover_rate ?? null,
        quit_stage: selected.quit_stage ?? null,
        quit_stages: selected.quit_stages ?? [],
        quit_reasons: selected.quit_reasons ?? [],
        quit_reason_notes: selected.quit_reason_notes ?? {},
        retention_actions: selected.retention_actions ?? '',
      };
      setForm(snapshot);
      setLockedSnapshot(!!(
        snapshot.overview || snapshot.policy_notes || snapshot.tax_notes || snapshot.trend_notes ||
        snapshot.turnover_rate != null || snapshot.quit_stage || snapshot.quit_stages.length > 0 || snapshot.quit_reasons.length > 0 ||
        snapshot.retention_actions || snapshot.season_levels.some(v => v > 0) || snapshot.season_notes.some(Boolean)
      ));
      setConfirmEditAction(null);
    } else { setForm(null); setLockedSnapshot(false); setConfirmEditAction(null); }
    setSaveStatus('idle');
    const t = setTimeout(() => { skipAutosaveRef.current = false; }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Gõ/click xong 700ms không đổi gì thêm là tự lưu — không cần bấm nút "Lưu".
  useEffect(() => {
    if (skipAutosaveRef.current || !form) return;
    setSaveStatus('pending');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveTimerRef.current = null; persist(form); }, 700);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const handleBack = () => {
    flushPendingSave();
    setSelectedId(null);
  };

  // Tổng hợp tự động theo ngành từ dữ liệu đã có: KH đang hợp tác, dự án đang tìm hiểu,
  // tổng LĐ, khoảng lương (khảo sát + lương ghi trên KH/dự án), số đối thủ đang phục vụ
  // ngành này (đối thủ không gắn ngành trực tiếp — suy qua danh sách công ty họ cung cấp).
  const statsByIndustry = useMemo(() => {
    const map = new Map<string, IndustryStats>();
    const get = (name: string): IndustryStats => {
      let s = map.get(name);
      if (!s) { s = { clientCount: 0, leadCount: 0, workers: 0, wageMin: null, wageMax: null, competitorCount: 0 }; map.set(name, s); }
      return s;
    };
    const feedWage = (s: IndustryStats, min: number | null | undefined, max: number | null | undefined) => {
      if (min != null) s.wageMin = s.wageMin == null ? min : Math.min(s.wageMin, min);
      if (max != null) s.wageMax = s.wageMax == null ? max : Math.max(s.wageMax, max);
    };

    const companyIndustry = new Map<string, string>();
    for (const c of clients) {
      if (!c.industry) continue;
      const s = get(c.industry);
      s.clientCount += 1;
      s.workers += c.current_workers ?? 0;
      feedWage(s, c.wage_min, c.wage_max);
      companyIndustry.set(c.name.trim().toLowerCase(), c.industry);
    }
    for (const l of marketLeads) {
      if (!l.industry) continue;
      const s = get(l.industry);
      s.leadCount += 1;
      feedWage(s, l.wage_min, l.wage_max);
      companyIndustry.set(l.company_name.trim().toLowerCase(), l.industry);
    }
    for (const sv of marketSurveys) {
      if (!sv.industry) continue;
      feedWage(get(sv.industry), sv.wage_unskilled_min, sv.wage_skilled_max ?? sv.wage_unskilled_max);
    }
    for (const comp of competitors) {
      const inds = new Set<string>();
      for (const supplied of comp.supplying_for ?? []) {
        const ind = companyIndustry.get(supplied.trim().toLowerCase());
        if (ind) inds.add(ind);
      }
      for (const ind of inds) get(ind).competitorCount += 1;
    }
    return map;
  }, [clients, marketLeads, marketSurveys, competitors]);

  const fmtTr = (v: number | null) => v != null ? (v / 1_000_000).toFixed(1) : null;
  const wageRange = (s?: IndustryStats) => {
    if (!s || (s.wageMin == null && s.wageMax == null)) return null;
    return `${fmtTr(s.wageMin) ?? '—'}–${fmtTr(s.wageMax) ?? '—'}tr`;
  };

  // Dữ liệu biểu đồ trang chính — chỉ tính ngành có hoạt động, xếp giảm dần theo số KH.
  const chartData = useMemo(() => {
    const rows = [...statsByIndustry.entries()]
      .filter(([, s]) => s.clientCount > 0 || s.leadCount > 0)
      .sort((a, b) => (b[1].clientCount + b[1].leadCount) - (a[1].clientCount + a[1].leadCount));
    return {
      labels: rows.map(([name]) => name),
      clientCounts: rows.map(([, s]) => s.clientCount),
      leadCounts: rows.map(([, s]) => s.leadCount),
      workers: rows.map(([, s]) => s.workers),
    };
  }, [statsByIndustry]);

  // Đề xuất #1 — Tổng LĐ theo ngành, mọi ngành đã tạo (kể cả 0 LĐ), xếp giảm dần.
  const workersChartData = useMemo(() => {
    return [...list]
      .map(ind => ({ name: ind.name, workers: statsByIndustry.get(ind.name)?.workers ?? 0 }))
      .sort((a, b) => b.workers - a.workers);
  }, [list, statsByIndustry]);

  // Đề xuất #3 — Ma trận cơ hội: X = dự án tìm hiểu, Y = KH hợp tác, kích thước = số đối thủ.
  const matrixData = useMemo(() => {
    return list.map((ind, i) => {
      const s = statsByIndustry.get(ind.name);
      return {
        name: ind.name,
        x: s?.leadCount ?? 0,
        y: s?.clientCount ?? 0,
        r: Math.max(6, (s?.competitorCount ?? 0) * 3 + 6),
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    });
  }, [list, statsByIndustry]);

  // Đề xuất #4 — Tỷ lệ nghỉ việc, chỉ ngành đã nhập turnover_rate, xếp giảm dần.
  const turnoverChartData = useMemo(() => {
    return list
      .filter((ind): ind is Industry & { turnover_rate: number } => ind.turnover_rate != null)
      .sort((a, b) => b.turnover_rate - a.turnover_rate);
  }, [list]);

  const totals = useMemo(() => {
    let clientTotal = 0, leadTotal = 0, workerTotal = 0;
    for (const s of statsByIndustry.values()) {
      clientTotal += s.clientCount;
      leadTotal += s.leadCount;
      workerTotal += s.workers;
    }
    return { clientTotal, leadTotal, workerTotal };
  }, [statsByIndustry]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) { toast('Nhập tên ngành nghề'); return; }
    setSaving(true);
    const { data, error } = await supabase.from('industries').insert({ name }).select().single();
    setSaving(false);
    if (error) { toast('Lỗi: ' + error.message); return; }
    setList(prev => [...prev, data as Industry].sort((a, b) => a.name.localeCompare(b.name, 'vi')));
    setShowAdd(false);
    setNewName('');
    setSelectedId(data.id);
    toast('Đã tạo ngành nghề: ' + name);
  };

  // Xuất tài liệu chuẩn bị gặp khách — lấy thuật ngữ mới nhất từ DB rồi gom mọi dữ liệu ngành.
  const handleExport = async () => {
    if (!selected) return;
    setExporting(true);
    const [termsRes, posRes, metRes, chainRes] = await Promise.all([
      supabase.from('industry_terms').select('*').or(`industry_id.eq.${selected.id},industry_id.is.null`).order('term'),
      supabase.from('industry_positions').select('*').eq('industry_id', selected.id).order('sort_order'),
      supabase.from('industry_metrics').select('*').eq('industry_id', selected.id).order('period'),
      supabase.from('industry_value_chain').select('*').eq('industry_id', selected.id).order('created_at'),
    ]);
    const md = buildIndustryBriefMd({
      industry: { ...selected, ...form },
      terms: (termsRes.data ?? []) as IndustryTerm[],
      positions: (posRes.data ?? []) as IndustryPosition[],
      metrics: (metRes.data ?? []) as IndustryMetric[],
      valueChain: (chainRes.data ?? []) as IndustryValueChainItem[],
      clients, marketLeads, competitors,
    });
    downloadMarkdown(`Chuan-bi-gap-khach_${selected.name.replace(/[^\p{L}\d]+/gu, '-')}.md`, md);
    setExporting(false);
    toast('Đã xuất tài liệu ngành: ' + selected.name);
  };

  if (loading) return <div className="text-[12px] text-[#999] text-center py-8">Đang tải...</div>;

  // ── HỒ SƠ CHI TIẾT 1 NGÀNH ──
  if (selected && form) {
    const st = statsByIndustry.get(selected.name);
    const indClients = clients.filter(c => c.industry === selected.name);
    const indLeads = marketLeads.filter(l => l.industry === selected.name);
    const workerRows = indClients.filter(c => (c.current_workers ?? 0) > 0)
      .sort((a, b) => (b.current_workers ?? 0) - (a.current_workers ?? 0)).slice(0, 12);

    const noteSection = (
      key: 'overview' | 'policy_notes' | 'tax_notes' | 'trend_notes',
      label: string, hint: string, icon: React.ReactNode, accent: string,
    ) => (
      <div className={`bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden border-l-[3px] ${accent}`}>
        <div className="px-4 py-2.5 border-b border-[#F0EEE9] flex items-center gap-1.5 text-[12.5px] font-semibold text-[#111]">{icon} {label}</div>
        <RichTextEditor
          key={`${key}-${editResetKey}`}
          value={form[key] || ''}
          onChange={html => guard(() => setForm(f => ({ ...f, [key]: html })))}
          placeholder={hint}
        />
      </div>
    );

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleBack} className="p-1.5 rounded-lg border border-[#E8E7E2] hover:bg-[#F9F9F7]"><ArrowLeft size={14} /></button>
          <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0"><Factory size={14} /></div>
          <div>
            <div className="text-[13px] font-semibold text-[#111]">{selected.name}</div>
            <div className="text-[10.5px] text-[#999]">Hồ sơ ngành · quá khứ → hiện tại → tương lai</div>
          </div>
          <div className="ml-auto flex items-center gap-1 text-[11.5px] text-[#999]">
            {(saveStatus === 'pending' || saveStatus === 'saving') && <><Loader2 size={12} className="animate-spin" /> Đang lưu…</>}
            {saveStatus === 'saved' && <><Check size={12} className="text-emerald-600" /> Đã lưu</>}
          </div>
          <button onClick={() => setShowCheatSheet(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#E8E7E2] text-[#444] hover:bg-[#F9F9F7] transition">
            <FileDown size={13} /> Chuẩn bị gặp khách
          </button>
        </div>

        <div className="grid grid-cols-5 gap-2">
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Users size={10} /> KH hợp tác</div><div className="text-[16px] font-medium text-emerald-700">{st?.clientCount ?? 0}</div></div>
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Building2 size={10} /> Dự án tìm hiểu</div><div className="text-[16px] font-medium text-blue-700">{st?.leadCount ?? 0}</div></div>
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Users size={10} /> Tổng LĐ</div><div className="text-[16px] font-medium">{(st?.workers ?? 0).toLocaleString('vi-VN')}</div></div>
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Coins size={10} /> Khoảng lương</div><div className="text-[16px] font-medium">{wageRange(st) ?? '—'}</div></div>
          <div className="bg-[#F9F9F7] rounded-lg px-3 py-2"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Eye size={10} /> Đối thủ</div><div className="text-[16px] font-medium text-red-600">{st?.competitorCount ?? 0}</div></div>
        </div>

        <IndustrySeasonality
          levels={form.season_levels ?? emptySeason()}
          notes={form.season_notes ?? emptyNotes()}
          onChange={(season_levels, season_notes) => guard(() => setForm(f => ({ ...f, season_levels, season_notes })))}
        />

        <IndustryMatrix industryName={selected.name} clients={clients} marketLeads={marketLeads} competitors={competitors} />

        <IndustryPositions industryId={selected.id} toast={toast} />

        <IndustryRetention
          turnoverRate={form.turnover_rate ?? null}
          quitStages={form.quit_stages ?? []}
          quitReasons={form.quit_reasons ?? []}
          quitReasonNotes={form.quit_reason_notes ?? {}}
          retentionActions={form.retention_actions ?? null}
          onChange={patch => guard(() => setForm(f => ({ ...f, ...patch })))}
        />

        <IndustryBattlecards industryId={selected.id} toast={toast} />

        <IndustryMetrics industryId={selected.id} toast={toast} />

        <IndustryValueChain industryId={selected.id} toast={toast} />

        {workerRows.length > 0 && (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111] mb-2">Lao động theo công ty trong ngành</div>
            <div style={{ height: Math.max(95, workerRows.length * 19) }}>
              <Bar
                data={{
                  labels: workerRows.map(c => c.name),
                  datasets: [{ data: workerRows.map(c => c.current_workers ?? 0), backgroundColor: '#1D4ED8', borderRadius: 4, barThickness: 10 }],
                }}
                options={{
                  indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { ticks: { font: { size: 10 } }, grid: { color: '#F0EEE9' } },
                    y: { ticks: { font: { size: 10.5 } }, grid: { display: false } },
                  },
                }}
              />
            </div>
          </div>
        )}

        {(indClients.length > 0 || indLeads.length > 0) && (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center justify-between">
              <div className="text-[12.5px] font-semibold text-[#111]">Công ty thuộc ngành này</div>
              <button onClick={() => goTab('leads')} className="text-[11px] text-blue-600 hover:underline">Mở Công ty / Dự án →</button>
            </div>
            <div className="p-3 flex flex-wrap gap-1.5">
              {indClients.map(c => (
                <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">{c.name}</span>
              ))}
              {indLeads.map(l => (
                <span key={l.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700">{l.company_name}</span>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {noteSection('overview', 'Đánh giá tổng quan thị trường', 'Quy mô ngành, đặc điểm lao động, tình hình hiện tại, đánh giá chung từ thị trường…', <FileText size={13} className="text-blue-600" />, 'border-l-blue-500')}
          {noteSection('policy_notes', 'Chính sách & FDI', 'Chính sách FDI, quy định lao động, nghị định mới, thay đổi ảnh hưởng tới ngành…', <Landmark size={13} className="text-violet-600" />, 'border-l-violet-500')}
          {noteSection('tax_notes', 'Thuế & tác động', 'Thuế XNK, ưu đãi thuế, thay đổi thuế suất, tác động chi phí lên các công ty trong ngành…', <ScrollText size={13} className="text-amber-600" />, 'border-l-amber-500')}
          {noteSection('trend_notes', 'Xu hướng & dự báo tương lai', 'Xu hướng tuyển dụng, dịch chuyển đơn hàng, tự động hoá, dự báo tăng/giảm nhu cầu LĐ…', <TrendingUp size={13} className="text-emerald-600" />, 'border-l-emerald-500')}
        </div>

        <IndustryTerms industryId={selected.id} industryName={selected.name} toast={toast} />

        {selected.updated_at && (
          <div className="px-3 py-1.5 bg-[#F9F9F7] rounded-lg text-[11px] text-[#aaa]">Cập nhật: {new Date(selected.updated_at).toLocaleDateString('vi-VN')}</div>
        )}

        {showCheatSheet && (
          <IndustryCheatSheetModal
            industry={{ ...selected, ...form }}
            wageRangeText={wageRange(st)}
            exporting={exporting}
            onDownloadFull={handleExport}
            onClose={() => setShowCheatSheet(false)}
            toast={toast}
          />
        )}

        {confirmEditAction && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-[12px] w-full max-w-sm p-5 shadow-xl">
              <div className="text-[13.5px] font-semibold text-[#111]">Xác nhận thay đổi</div>
              <div className="text-[12px] text-[#666] mt-1.5">Ngành "{selected.name}" đã có dữ liệu được lưu. Bạn có chắc muốn thay đổi? Xác nhận xong sẽ không hỏi lại nữa tới khi rời trang.</div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => { setConfirmEditAction(null); setEditResetKey(k => k + 1); }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-50"
                >Huỷ</button>
                <button
                  onClick={() => { confirmEditAction.run(); setLockedSnapshot(false); setConfirmEditAction(null); }}
                  className="flex-1 px-3 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF]"
                >Xác nhận</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── TRANG CHÍNH: DASHBOARD NGÀNH NGHỀ ──
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[12.5px] font-medium text-[#111]">Ngành nghề</div>
          <div className="text-[11px] text-[#888]">Dashboard thị trường theo ngành · click ngành để xem hồ sơ chi tiết</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative shrink-0">
            <button onClick={() => setShowDashSettings(v => !v)} className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition ${showDashSettings ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-[#E8E7E2] text-[#666] hover:bg-[#F9F9F7]'}`}>
              <Settings size={13} /> Tuỳ chọn hiển thị
            </button>
            {showDashSettings && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDashSettings(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-20 w-[270px] max-w-[calc(100vw-2rem)] bg-white border border-[#E8E7E2] rounded-[12px] shadow-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[12.5px] font-semibold text-[#111]">Biểu đồ tổng quan</div>
                    <button onClick={() => setShowDashSettings(false)} className="p-1 hover:bg-gray-100 rounded"><X size={13} /></button>
                  </div>
                  <div className="text-[10.5px] text-[#999]">Bật/tắt để đỡ rối mắt — lựa chọn được nhớ trên trình duyệt này.</div>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                      <input type="checkbox" checked={dashSettings.workersBar} onChange={e => setDashSettings(s => ({ ...s, workersBar: e.target.checked }))} />
                      Tổng lao động theo ngành
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                      <input type="checkbox" checked={dashSettings.seasonHeatmap} onChange={e => setDashSettings(s => ({ ...s, seasonHeatmap: e.target.checked }))} />
                      Bản đồ nhiệt mùa vụ (ngành × 12 tháng)
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                      <input type="checkbox" checked={dashSettings.opportunityMatrix} onChange={e => setDashSettings(s => ({ ...s, opportunityMatrix: e.target.checked }))} />
                      Ma trận cơ hội ngành
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-[#444] cursor-pointer">
                      <input type="checkbox" checked={dashSettings.turnoverBar} onChange={e => setDashSettings(s => ({ ...s, turnoverBar: e.target.checked }))} />
                      Tỷ lệ nghỉ việc theo ngành
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
            <Plus size={13} /> Thêm ngành nghề
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] px-3.5 py-2.5"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Factory size={10} /> Ngành nghề</div><div className="text-[18px] font-semibold">{list.length}</div></div>
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] px-3.5 py-2.5"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Users size={10} /> KH đang hợp tác</div><div className="text-[18px] font-semibold text-emerald-700">{totals.clientTotal}</div></div>
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] px-3.5 py-2.5"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Building2 size={10} /> Dự án tìm hiểu</div><div className="text-[18px] font-semibold text-blue-700">{totals.leadTotal}</div></div>
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] px-3.5 py-2.5"><div className="text-[10.5px] text-[#888] flex items-center gap-1"><Users size={10} /> Tổng LĐ theo ngành</div><div className="text-[18px] font-semibold">{totals.workerTotal.toLocaleString('vi-VN')}</div></div>
      </div>

      {chartData.labels.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111] mb-2">Tỷ lệ khách hàng theo ngành</div>
            <div style={{ height: 160 }} className="flex justify-center">
              <Doughnut
                data={{
                  labels: chartData.labels,
                  datasets: [{
                    data: chartData.clientCounts,
                    backgroundColor: chartData.labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
                    borderWidth: 2, borderColor: '#fff',
                  }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false, cutout: '58%',
                  plugins: {
                    legend: { position: 'right', labels: { font: { size: 10.5 }, boxWidth: 10, boxHeight: 10 } },
                  },
                }}
              />
            </div>
          </div>
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111] mb-2">KH & dự án theo ngành</div>
            <div style={{ height: 160 }}>
              <Bar
                data={{
                  labels: chartData.labels,
                  datasets: [
                    { label: 'KH hợp tác', data: chartData.clientCounts, backgroundColor: '#059669', borderRadius: 4 },
                    { label: 'Dự án tìm hiểu', data: chartData.leadCounts, backgroundColor: '#1D4ED8', borderRadius: 4 },
                  ],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { position: 'top', labels: { font: { size: 10.5 }, boxWidth: 10, boxHeight: 10 } } },
                  scales: {
                    x: { ticks: { font: { size: 10 }, maxRotation: 40, minRotation: 0 }, grid: { display: false } },
                    y: { ticks: { font: { size: 10 }, stepSize: 1 }, grid: { color: '#F0EEE9' } },
                  },
                }}
              />
            </div>
          </div>
        </div>
      )}

      {dashSettings.workersBar && list.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
          <div className="text-[12.5px] font-semibold text-[#111] mb-2">Tổng lao động theo ngành</div>
          <div style={{ height: Math.max(120, workersChartData.length * 30) }}>
            <Bar
              data={{
                labels: workersChartData.map(r => r.name),
                datasets: [{ data: workersChartData.map(r => r.workers), backgroundColor: '#1D4ED8', borderRadius: 4, barThickness: 14 }],
              }}
              options={{
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { font: { size: 10 } }, grid: { color: '#F0EEE9' } },
                  y: { ticks: { font: { size: 10.5 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
      )}

      {dashSettings.seasonHeatmap && list.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2 flex-wrap">
            <div className="text-[12.5px] font-semibold text-[#111]">Bản đồ nhiệt mùa vụ · ngành × 12 tháng</div>
            <div className="ml-auto flex items-center gap-2">
              {SEASON_LEVELS.slice(1).map(l => (
                <span key={l.v} className="inline-flex items-center gap-1 text-[10px] text-[#888]">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.dot }} /> {l.label}
                </span>
              ))}
            </div>
          </div>
          <div className="p-3 overflow-x-auto">
            <table className="w-full text-[10.5px]" style={{ borderSpacing: '3px', borderCollapse: 'separate' }}>
              <thead>
                <tr>
                  <th className="text-left font-normal text-[#999] pr-2"></th>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <th key={i} className="font-normal text-[#999] text-center w-8">T{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map(ind => {
                  const levels = ind.season_levels?.length === 12 ? ind.season_levels : emptySeason();
                  return (
                    <tr key={ind.id}>
                      <td className="text-[#444] font-medium pr-2 whitespace-nowrap">{ind.name}</td>
                      {levels.map((v, i) => {
                        const L = SEASON_LEVELS[v] ?? SEASON_LEVELS[0];
                        return <td key={i} title={L.label} className={`rounded ${L.bg} text-center py-1.5`}>{v || ''}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dashSettings.opportunityMatrix && list.length > 0 && (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
          <div className="text-[12.5px] font-semibold text-[#111] mb-2">Ma trận cơ hội ngành</div>
          <div className="text-[10.5px] text-[#999] mb-2">Trục ngang: dự án tìm hiểu · Trục dọc: KH hợp tác · Kích thước chấm: số đối thủ</div>
          <div style={{ height: 240 }}>
            <Bubble
              data={{
                datasets: [{
                  data: matrixData.map(d => ({ x: d.x, y: d.y, r: d.r })),
                  backgroundColor: matrixData.map(d => d.color + 'CC'),
                  borderColor: matrixData.map(d => d.color),
                  borderWidth: 1.5,
                }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: (ctx) => {
                    const d = matrixData[ctx.dataIndex];
                    return `${d.name}: ${d.x} dự án · ${d.y} KH · đối thủ ~${Math.round((d.r - 6) / 3)}`;
                  } } },
                },
                scales: {
                  x: { title: { display: true, text: 'Dự án tìm hiểu', font: { size: 10 } }, ticks: { font: { size: 10 }, stepSize: 1, precision: 0 }, grid: { color: '#F0EEE9' } },
                  y: { title: { display: true, text: 'KH hợp tác', font: { size: 10 } }, ticks: { font: { size: 10 }, stepSize: 1, precision: 0 }, grid: { color: '#F0EEE9' } },
                },
              }}
            />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {matrixData.map(d => (
              <span key={d.name} className="inline-flex items-center gap-1 text-[10px] text-[#888]">
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} /> {d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {dashSettings.turnoverBar && (
        turnoverChartData.length > 0 ? (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
            <div className="text-[12.5px] font-semibold text-[#111] mb-2">Tỷ lệ nghỉ việc theo ngành (%/tháng)</div>
            <div style={{ height: 200 }}>
              <Bar
                data={{
                  labels: turnoverChartData.map(i => i.name),
                  datasets: [{
                    data: turnoverChartData.map(i => i.turnover_rate),
                    backgroundColor: turnoverChartData.map(i => turnoverColor(i.turnover_rate)),
                    borderRadius: 4,
                  }],
                }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { ticks: { font: { size: 10 }, maxRotation: 30 }, grid: { display: false } },
                    y: { ticks: { font: { size: 10 }, callback: (v) => v + '%' }, grid: { color: '#F0EEE9' } },
                  },
                }}
              />
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10.5px] text-[#888] flex-wrap">
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" /> Dưới 8% · thấp</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-600" /> 8–15% · trung bình</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-600" /> Từ 15% · cao</span>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 text-[11.5px] text-[#999] text-center">
            Chưa có ngành nào nhập tỷ lệ nghỉ việc — vào từng ngành, mục "Hồ sơ giữ chân lao động" để nhập.
          </div>
        )
      )}

      <div className="grid grid-cols-3 gap-3">
        {list.map(ind => {
          const st = statsByIndustry.get(ind.name);
          return (
            <div key={ind.id} onClick={() => setSelectedId(ind.id)} className="bg-white border border-[#E8E7E2] rounded-[10px] p-3 cursor-pointer hover:border-blue-300 transition">
              <div className="flex items-center gap-1.5">
                <Factory size={13} className="text-[#999]" />
                <div className="text-[12.5px] font-medium text-[#111]">{ind.name}</div>
              </div>
              <div className="text-[11px] text-[#888] mt-1.5 line-clamp-2">
                {htmlToPlainText(ind.overview || ind.policy_notes || ind.trend_notes || ind.tax_notes) || 'Chưa có ghi chú'}
              </div>
              <div className="flex justify-between text-[10.5px] text-[#888] mt-2 pt-2 border-t border-[#F0EEE9]">
                <span className="inline-flex items-center gap-1"><Users size={10} /> {st?.clientCount ?? 0} KH</span>
                <span className="inline-flex items-center gap-1"><Building2 size={10} /> {st?.leadCount ?? 0} dự án</span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><Coins size={10} /> {wageRange(st) ?? '—'}</span>
              </div>
              {ind.updated_at && <div className="text-[10px] text-[#bbb] mt-1.5">Cập nhật {new Date(ind.updated_at).toLocaleDateString('vi-VN')}</div>}
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="col-span-3 text-center py-8 text-[12px] text-[#aaa]">Chưa có ngành nghề nào. Bấm "Thêm ngành nghề" để bắt đầu.</div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-sm p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111]">Thêm ngành nghề</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="VD: Sản xuất nội thất"
              className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600">Hủy</button>
              <button onClick={handleAdd} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Tạo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
