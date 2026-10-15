// Nhóm điểm, màu, icon và khung nhìn mặc định của bản đồ — dùng chung cho tab Bản đồ Thị trường
// (MapViewTab) và bản đồ nhỏ trong hồ sơ công ty (MiniMap), để hai nơi hiện giống hệt nhau.
import { supabase } from './supabase';

export type MapGroup = 'branch' | 'kcn' | 'client' | 'prospect' | 'lead';

export const MAP_GROUPS: { id: MapGroup; label: string; color: string }[] = [
  { id: 'branch', label: 'Chi nhánh', color: '#1D4ED8' },
  { id: 'kcn', label: 'Khu công nghiệp', color: '#D97706' },
  { id: 'client', label: 'KH đang hợp tác', color: '#059669' },
  { id: 'prospect', label: 'KH tiềm năng', color: '#7C3AED' },
  { id: 'lead', label: 'Công ty / Dự án', color: '#DB2777' },
];

export const MAP_GROUP_COLOR: Record<MapGroup, string> =
  Object.fromEntries(MAP_GROUPS.map(g => [g.id, g.color])) as Record<MapGroup, string>;

// Icon (emoji) mặc định cho từng loại — người dùng tự đổi ở tab Bản đồ (nút Cài đặt), lưu ở máy.
export const DEFAULT_GROUP_ICONS: Record<MapGroup, string> = {
  branch: '', kcn: '🏭', client: '', prospect: '', lead: '',
};
export const GROUP_ICONS_KEY = 'lgmap_group_icons_v1';

export function loadGroupIcons(): Record<MapGroup, string> {
  try {
    const raw = localStorage.getItem(GROUP_ICONS_KEY);
    if (!raw) return { ...DEFAULT_GROUP_ICONS };
    return { ...DEFAULT_GROUP_ICONS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_GROUP_ICONS };
  }
}

// Khung nhìn mặc định do người dùng tự đặt ở tab Bản đồ (Công cụ → Đặt view hiện tại làm mặc định).
export const DEFAULT_VIEW_KEY = 'lgmap_default_view';
export type SavedMapView = { center: [number, number]; zoom: number };
export function loadDefaultView(): SavedMapView | null {
  try {
    const raw = localStorage.getItem(DEFAULT_VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (Array.isArray(v.center) && v.center.length === 2 && typeof v.zoom === 'number') return v;
  } catch { /* ignore */ }
  return null;
}

// Vùng hoạt động chính (miền Nam) — khung nhìn khi chưa có khung tự đặt.
export const SOUTH_VN_BOUNDS: [[number, number], [number, number]] = [
  [8.2, 103.3],
  [14.6, 109.6],
];

export function escapeMapHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Một điểm trên bản đồ nhỏ — lấy từ đúng các bảng mà tab Bản đồ Thị trường vẽ. */
export interface MapContextPoint {
  id: string;
  group: MapGroup;
  name: string;
  lat: number;
  lng: number;
  /** market_leads.crm_id — để bỏ chính công ty đang mở khỏi lớp điểm xung quanh */
  crmId?: string | null;
}

// Nạp 1 lần rồi dùng lại; có thay đổi ở Thị trường (lgvn:market-changed) thì nạp lại lần sau.
let cache: Promise<MapContextPoint[]> | null = null;
if (typeof window !== 'undefined') window.addEventListener('lgvn:market-changed', () => { cache = null; });

export function fetchMapContextPoints(force = false): Promise<MapContextPoint[]> {
  if (!cache || force) {
    cache = (async () => {
      const [b, z, c, l] = await Promise.all([
        supabase.from('branches').select('id, name, short_name, lat, lng'),
        supabase.from('market_zones').select('id, name, lat, lng'),
        supabase.from('clients').select('id, name, client_type, lat, lng').is('archived_at', null),
        supabase.from('market_leads').select('id, company_name, crm_id, lat, lng'),
      ]);
      const pts: MapContextPoint[] = [];
      const ok = (r: { lat: number | null; lng: number | null }) => r.lat != null && r.lng != null;
      (b.data ?? []).filter(ok).forEach(r => pts.push({ id: r.id, group: 'branch', name: r.short_name || r.name, lat: r.lat, lng: r.lng }));
      (z.data ?? []).filter(ok).forEach(r => pts.push({ id: r.id, group: 'kcn', name: r.name, lat: r.lat, lng: r.lng }));
      (c.data ?? []).filter(ok).forEach(r => pts.push({ id: r.id, group: r.client_type === 'active' ? 'client' : 'prospect', name: r.name, lat: r.lat, lng: r.lng }));
      (l.data ?? []).filter(ok).forEach(r => pts.push({ id: r.id, group: 'lead', name: r.company_name, lat: r.lat, lng: r.lng, crmId: r.crm_id }));
      return pts;
    })().catch(() => { cache = null; return []; });
  }
  return cache;
}
