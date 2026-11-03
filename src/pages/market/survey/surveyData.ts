// Dữ liệu nền cho chế độ Khảo sát KCN: khách hàng (cả tiềm năng), thẻ CRM Pipeline, cài đặt hiển thị.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { MarketLead } from '../../../lib/types';
import { buildSurveyCompanies, type SurveyCompany } from '../../../lib/kcnSurvey/companies';

export interface SurveyClient {
  id: string;
  name: string;
  client_type: 'prospect' | 'active';
  cooperation_status?: 'active' | 'suspended' | null;
  branch_id?: string | null;
  manager?: string | null;
  industrial_zones?: string[] | null;
  lat: number | null;
  lng: number | null;
  industry?: string | null;
  wage_min?: number | null;
  wage_max?: number | null;
  contract_start?: string | null;
  phone?: string | null;
}

export interface SurveyPipeline {
  id: string;
  company_name: string;
  client_id: string | null;
  stage: string;
  sub_status?: string | null;
  rating?: string | null;
  worker_estimate?: number | null;
  workers_seasonal?: number | null;
  workers_permanent?: number | null;
  last_contact?: string | null;
  notes?: string | null;
  zone_sites?: Record<string, { lat: number | null; lng: number | null } | null> | null;
  contacts?: { name: string; phone: string | null } | null;
  crm_products?: { name: string } | null;
}

// Cột mới (migration 100 / 134 / 186 / 187) có thể chưa chạy trên DB → thử từ đầy đủ tới tối thiểu
const CLIENT_COLS = [
  'id, name, client_type, cooperation_status, branch_id, manager, industrial_zones, lat, lng, industry, wage_min, wage_max, contract_start, phone',
  'id, name, client_type, branch_id, manager, industrial_zones, lat, lng',
];
const PIPELINE_COLS = [
  'id, company_name, client_id, stage, sub_status, rating, worker_estimate, workers_seasonal, workers_permanent, last_contact, notes, zone_sites, contacts!crm_pipeline_contact_id_fkey(name, phone), crm_products(name)',
  'id, company_name, client_id, stage, sub_status, rating, worker_estimate, last_contact, notes, contacts!crm_pipeline_contact_id_fkey(name, phone), crm_products(name)',
  'id, company_name, client_id, stage',
];

/** Thử lần lượt các bộ cột, bộ nào chạy được thì dùng. */
async function selectFirstWorking<T>(table: string, variants: readonly string[], activeOnly = false): Promise<T[]> {
  let lastErr: unknown = null;
  for (const cols of variants) {
    const base = supabase.from(table).select(cols);
    const { data, error } = await (activeOnly ? base.is('archived_at', null) : base);
    if (!error) return (data ?? []) as unknown as T[];
    lastErr = error;
  }
  throw lastErr;
}

export function useSurveyData(marketLeads: readonly MarketLead[]) {
  const [clients, setClients] = useState<SurveyClient[]>([]);
  const [pipeline, setPipeline] = useState<SurveyPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.allSettled([
      selectFirstWorking<SurveyClient>('clients', CLIENT_COLS, true),
      selectFirstWorking<SurveyPipeline>('crm_pipeline', PIPELINE_COLS),
    ]);
    if (c.status === 'fulfilled') setClients(c.value);
    if (p.status === 'fulfilled') setPipeline(p.value);
    const errs = [c, p].filter(r => r.status === 'rejected').map(r => ((r as PromiseRejectedResult).reason as { message?: string })?.message ?? 'lỗi');
    setError(errs.length ? errs.join(' · ') : null);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const companies = useMemo<SurveyCompany[]>(() => buildSurveyCompanies({
    clients: clients.map(c => ({ id: c.id, name: c.name, client_type: c.client_type, cooperation_status: c.cooperation_status ?? null, lat: c.lat, lng: c.lng })),
    pipeline: pipeline.map(p => ({ id: p.id, company_name: p.company_name, client_id: p.client_id, stage: p.stage, zone_sites: p.zone_sites ?? null })),
    leads: marketLeads.map(l => ({ id: l.id, company_name: l.company_name, crm_id: l.crm_id ?? null, lat: l.lat ?? null, lng: l.lng ?? null })),
  }), [clients, pipeline, marketLeads]);

  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const pipelineById = useMemo(() => new Map(pipeline.map(p => [p.id, p])), [pipeline]);
  const leadById = useMemo(() => new Map(marketLeads.map(l => [l.id, l])), [marketLeads]);

  return { companies, clientById, pipelineById, leadById, loading, error, reload };
}

// ── Cài đặt (nhớ theo máy) ───────────────────────────────────────────────────
export interface SurveyPrefs {
  /** Mức zoom khi bám theo vị trí */
  followZoom: number;
  /** Tự zoom kiểu dẫn đường: chạy nhanh nhìn xa, đi chậm nhìn gần, sắp tới chỗ rẽ thì canh vừa chỗ rẽ */
  smartZoom: boolean;
  /** Hướng bản đồ khi bám theo vị trí: xoay theo hướng đi (giống Google Maps) hay hướng Bắc luôn ở trên */
  mapOrientation: 'heading' | 'north';
  /** Bán kính nhận diện công ty đang đi ngang (m) */
  radiusM: number;
  showOldTracks: boolean;
  /** Tô đường chưa đi (tải mạng đường OSM) */
  showRoads: boolean;
  /** Tính cả đường nhánh / nội bộ (highway=service) */
  includeService: boolean;
  /** Bán kính vùng tải đường quanh KCN (m) */
  areaRadiusM: number;
  /** Chỉ tính đường nằm trong ranh giới KCN trên OSM (bỏ đường khu dân cư xung quanh) */
  clipToZone: boolean;
  labels: boolean;
  satellite: boolean;
  keepAwake: boolean;
  vibrate: boolean;
  showPhotos: boolean;
  /** Bỏ điểm GPS sai số lớn hơn (m) */
  maxAccuracy: number;
  /** Mũi tên vị trí xoay theo la bàn điện thoại khi đứng yên / đi chậm */
  compass: boolean;
  /** Âm thanh dẫn đường: tắt hẳn · chỉ tiếng bíp báo chỗ rẽ · đọc to bằng giọng nói */
  navSound: NavSound;
  /** Dẫn đường ưu tiên đoạn có nhà máy hai bên (đường trống để sau) — chỉ ở kiểu "Đoạn gần nhất" */
  navPreferFactories: boolean;
  /** Kiểu dẫn đường: 1 lộ trình đi 1 lượt hết đường chưa đi (ít lặp) · từng đoạn gần nhất */
  navStrategy: NavStrategy;
  /** Giao diện gọn (bản đồ rộng, chức năng gom vào nút nổi): tự bật khi xoay ngang · luôn bật · tắt */
  compactMode: CompactMode;
  /** Giao diện gọn: nút luôn hiện ở mép phải (các chức năng khác nằm trong nút nổi) */
  pinned: QuickActionId[];
  /** Vị trí nút nổi: mép trái / phải + độ cao (0..1 chiều cao màn hình) */
  assistive: { side: 'left' | 'right'; y: number };
  /** Thu gọn ô chú thích màu đường (giao diện thường) */
  legendCollapsed: boolean;
  /** Ghi âm khảo sát: lọc tạp âm (gió, tiếng xe), làm rõ giọng nói */
  voiceEnhance: boolean;
  /** Màu đường cần đi (chưa đi) */
  roadTodo: RoadTodoColor;
  /** Màu đường đã đi */
  roadDone: RoadDoneColor;
}

export type NavSound = 'off' | 'beep' | 'voice';
export type NavStrategy = 'tour' | 'nearest';
export type CompactMode = 'auto' | 'always' | 'never';
/** Chức năng gắn được lên mép phải ở giao diện gọn */
export type QuickActionId = 'photo' | 'voice' | 'library' | 'pause' | 'finish' | 'nav' | 'todo' | 'zoom' | 'fit' | 'satellite' | 'legend' | 'history' | 'settings';
export const QUICK_ACTION_IDS: QuickActionId[] = ['photo', 'voice', 'library', 'pause', 'finish', 'nav', 'todo', 'zoom', 'fit', 'satellite', 'legend', 'history', 'settings'];
export const NAV_SOUND_LABEL: Record<NavSound, string> = { off: 'Tắt hẳn', beep: 'Chỉ tiếng bíp', voice: 'Giọng đọc' };
/** Nút loa trên băng dẫn đường: bấm lần lượt Tắt → Bíp → Giọng đọc → Tắt */
export const nextNavSound = (s: NavSound): NavSound => (s === 'off' ? 'beep' : s === 'beep' ? 'voice' : 'off');

/** Màu đường chưa đi: strong = có nhà máy (đường trục), mid = có nhà máy (đường nhánh), light = đường trống (nét đứt). */
export const ROAD_TODO_COLORS = {
  orange: { label: 'Cam', strong: '#EA580C', mid: '#F97316', light: '#FDBA74', lightMain: '#FB923C' },
  red: { label: 'Đỏ', strong: '#B91C1C', mid: '#DC2626', light: '#FCA5A5', lightMain: '#F87171' },
  pink: { label: 'Hồng', strong: '#BE185D', mid: '#DB2777', light: '#F9A8D4', lightMain: '#F472B6' },
  yellow: { label: 'Vàng', strong: '#A16207', mid: '#CA8A04', light: '#FDE047', lightMain: '#FACC15' },
} as const;
export const ROAD_DONE_COLORS = {
  green: { label: 'Xanh lá', color: '#16A34A' },
  teal: { label: 'Xanh ngọc', color: '#0D9488' },
  gray: { label: 'Xám', color: '#475569' },
  black: { label: 'Đen', color: '#111827' },
} as const;
export type RoadTodoColor = keyof typeof ROAD_TODO_COLORS;
export type RoadDoneColor = keyof typeof ROAD_DONE_COLORS;

export const DEFAULT_SURVEY_PREFS: SurveyPrefs = {
  followZoom: 17, smartZoom: true, mapOrientation: 'heading', radiusM: 150, showOldTracks: true, showRoads: true, includeService: false,
  areaRadiusM: 2000, clipToZone: true, labels: true, satellite: false, keepAwake: true, vibrate: true, showPhotos: true, maxAccuracy: 35,
  compass: true, navSound: 'voice', navPreferFactories: true, roadTodo: 'orange', roadDone: 'green', voiceEnhance: true,
  navStrategy: 'tour', compactMode: 'auto', pinned: ['photo', 'voice'], assistive: { side: 'right', y: 0 }, legendCollapsed: false,
};

const PREFS_KEY = 'lgvn_kcn_survey_prefs_v1';

/** Đọc cài đặt đã lưu: thêm giá trị mặc định cho mục mới, đổi kiểu cũ (navVoice bật/tắt → navSound), bỏ giá trị lạ. */
export function parseSurveyPrefs(raw: unknown): SurveyPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const p = { ...DEFAULT_SURVEY_PREFS, ...o } as SurveyPrefs & { navVoice?: unknown; autoZoom?: unknown };
  if (!('navSound' in o) && typeof o.navVoice === 'boolean') p.navSound = o.navVoice ? 'voice' : 'off';
  if (!['off', 'beep', 'voice'].includes(p.navSound)) p.navSound = DEFAULT_SURVEY_PREFS.navSound;
  if (!(p.roadTodo in ROAD_TODO_COLORS)) p.roadTodo = DEFAULT_SURVEY_PREFS.roadTodo;
  if (!(p.roadDone in ROAD_DONE_COLORS)) p.roadDone = DEFAULT_SURVEY_PREFS.roadDone;
  if (p.mapOrientation !== 'heading' && p.mapOrientation !== 'north') p.mapOrientation = DEFAULT_SURVEY_PREFS.mapOrientation;
  if (typeof p.smartZoom !== 'boolean') p.smartZoom = DEFAULT_SURVEY_PREFS.smartZoom;
  if (p.navStrategy !== 'tour' && p.navStrategy !== 'nearest') p.navStrategy = DEFAULT_SURVEY_PREFS.navStrategy;
  if (!['auto', 'always', 'never'].includes(p.compactMode)) p.compactMode = DEFAULT_SURVEY_PREFS.compactMode;
  p.pinned = Array.isArray(p.pinned) ? QUICK_ACTION_IDS.filter(id => (p.pinned as unknown[]).includes(id)) : [...DEFAULT_SURVEY_PREFS.pinned];
  const a = p.assistive as { side?: unknown; y?: unknown } | undefined;
  p.assistive = a && (a.side === 'left' || a.side === 'right') && typeof a.y === 'number' && Number.isFinite(a.y)
    ? { side: a.side, y: Math.max(0, Math.min(1, a.y)) } : { ...DEFAULT_SURVEY_PREFS.assistive };
  if (typeof p.legendCollapsed !== 'boolean') p.legendCollapsed = false;
  // "Tự zoom theo tốc độ" cũ (mặc định tắt) → thay bằng tự zoom kiểu dẫn đường (mặc định bật)
  delete p.navVoice;
  delete p.autoZoom;
  return p;
}

export function loadSurveyPrefs(): SurveyPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? parseSurveyPrefs(JSON.parse(raw)) : { ...DEFAULT_SURVEY_PREFS };
  } catch { return { ...DEFAULT_SURVEY_PREFS }; }
}
export function saveSurveyPrefs(p: SurveyPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* chế độ riêng tư */ }
}

/** Bỏ dấu + chữ thường để tìm tên công ty. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
