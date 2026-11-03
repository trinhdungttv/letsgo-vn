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
  /** Tự zoom theo tốc độ: chạy nhanh nhìn xa, đi chậm nhìn gần */
  autoZoom: boolean;
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
  /** Dẫn đường ưu tiên đoạn có nhà máy hai bên (đường trống để sau) */
  navPreferFactories: boolean;
  /** Màu đường cần đi (chưa đi) */
  roadTodo: RoadTodoColor;
  /** Màu đường đã đi */
  roadDone: RoadDoneColor;
}

export type NavSound = 'off' | 'beep' | 'voice';
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
  followZoom: 17, autoZoom: false, radiusM: 150, showOldTracks: true, showRoads: true, includeService: false,
  areaRadiusM: 2000, clipToZone: true, labels: true, satellite: false, keepAwake: true, vibrate: true, showPhotos: true, maxAccuracy: 35,
  compass: true, navSound: 'voice', navPreferFactories: true, roadTodo: 'orange', roadDone: 'green',
};

const PREFS_KEY = 'lgvn_kcn_survey_prefs_v1';

/** Đọc cài đặt đã lưu: thêm giá trị mặc định cho mục mới, đổi kiểu cũ (navVoice bật/tắt → navSound), bỏ giá trị lạ. */
export function parseSurveyPrefs(raw: unknown): SurveyPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const p = { ...DEFAULT_SURVEY_PREFS, ...o } as SurveyPrefs & { navVoice?: unknown };
  if (!('navSound' in o) && typeof o.navVoice === 'boolean') p.navSound = o.navVoice ? 'voice' : 'off';
  if (!['off', 'beep', 'voice'].includes(p.navSound)) p.navSound = DEFAULT_SURVEY_PREFS.navSound;
  if (!(p.roadTodo in ROAD_TODO_COLORS)) p.roadTodo = DEFAULT_SURVEY_PREFS.roadTodo;
  if (!(p.roadDone in ROAD_DONE_COLORS)) p.roadDone = DEFAULT_SURVEY_PREFS.roadDone;
  delete p.navVoice;
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

/** Zoom theo tốc độ (m/s): > 11 (≈ 40 km/h) nhìn xa, < 3 (đi bộ / dừng xem cổng) nhìn gần. */
export function zoomForSpeed(speed: number | null, base: number): number {
  if (speed == null) return base;
  if (speed > 11) return Math.max(14, base - 2);
  if (speed > 5) return Math.max(15, base - 1);
  if (speed < 1.5) return Math.min(19, base + 1);
  return base;
}

/** Bỏ dấu + chữ thường để tìm tên công ty. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
