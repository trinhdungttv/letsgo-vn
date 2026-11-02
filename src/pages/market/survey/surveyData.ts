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
}

export const DEFAULT_SURVEY_PREFS: SurveyPrefs = {
  followZoom: 17, autoZoom: false, radiusM: 150, showOldTracks: true, showRoads: true, includeService: false,
  areaRadiusM: 2000, clipToZone: true, labels: true, satellite: false, keepAwake: true, vibrate: true, showPhotos: true, maxAccuracy: 35,
};

const PREFS_KEY = 'lgvn_kcn_survey_prefs_v1';

export function loadSurveyPrefs(): SurveyPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_SURVEY_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_SURVEY_PREFS };
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
