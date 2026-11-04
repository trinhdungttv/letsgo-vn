// Nhớ chỗ đang mở của Ghi chú nhanh (localStorage của từng máy, riêng từng người): thẻ / cửa sổ nào đang mở, khu
// Ghi chú / Sơ đồ tư duy, nhóm Tất cả / Lưu trữ / Đã xoá, mục đang chọn → tải lại trang / vào lại thì mở đúng chỗ cũ.
// Từng sơ đồ tư duy nhớ thêm: Sơ đồ / Dàn ý, tab khung bên phải, khung nhìn (kéo / phóng), chủ đề đang chọn.
import type { NoteView, NotesTab } from './types';

export interface WinPlace {
  selectedId: string | null;
  tab: NotesTab;
  section: NoteView;
}
export type OpenPlace = { kind: 'card'; id: string; anchorY: number } | ({ kind: 'window' } & WinPlace);
export interface LastPlace {
  /** đang mở gì lúc rời trang (null = không mở gì) */
  open: OpenPlace | null;
  /** lần cuối ở đâu trong cửa sổ danh sách — bấm ☰ mở lại đúng chỗ này */
  win: WinPlace;
}

export const DEFAULT_WIN: WinPlace = { selectedId: null, tab: 'all', section: 'text' };
export const DEFAULT_PLACE: LastPlace = { open: null, win: DEFAULT_WIN };

const TABS: readonly NotesTab[] = ['all', 'archive', 'trash'];
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function parseWin(raw: unknown): WinPlace {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    selectedId: str(r.selectedId),
    tab: TABS.includes(r.tab as NotesTab) ? (r.tab as NotesTab) : 'all',
    section: r.section === 'mindmap' ? 'mindmap' : 'text',
  };
}

/** Đọc lại bản đã lưu — giá trị lạ / bản hỏng thì về mặc định, không làm hỏng app. */
export function parsePlace(raw: unknown): LastPlace {
  if (!raw || typeof raw !== 'object') return DEFAULT_PLACE;
  const r = raw as Record<string, unknown>;
  const o = (r.open ?? null) as Record<string, unknown> | null;
  let open: OpenPlace | null = null;
  if (o && o.kind === 'card' && str(o.id)) {
    open = { kind: 'card', id: String(o.id), anchorY: Number.isFinite(o.anchorY) ? Number(o.anchorY) : 132 };
  } else if (o && o.kind === 'window') {
    open = { kind: 'window', ...parseWin(o) };
  }
  return { open, win: parseWin(r.win) };
}

const placeKey = (userId: string) => `qn-last-place:${userId}`;

export function loadPlace(userId: string): LastPlace {
  try {
    return parsePlace(JSON.parse(localStorage.getItem(placeKey(userId)) ?? 'null'));
  } catch {
    return DEFAULT_PLACE;
  }
}

export function savePlace(userId: string, p: LastPlace): void {
  try { localStorage.setItem(placeKey(userId), JSON.stringify(p)); } catch { /* máy chặn lưu — chỉ nhớ trong phiên */ }
}

// ── Từng sơ đồ tư duy ──

export type MapPanel = 'style' | 'map' | 'marker' | 'note';
export interface MapUi {
  mode: 'map' | 'outline';
  panel: MapPanel | null;
  view?: { x: number; y: number; z: number };
  sel?: string;
  /** lúc lưu — để chỉ giữ các sơ đồ mở gần đây */
  t: number;
}

const MAP_KEY = 'qn-map-ui';
const MAP_MAX = 40;
const PANELS: readonly MapPanel[] = ['style', 'map', 'marker', 'note'];

export function parseMapUi(raw: unknown): Record<string, MapUi> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, MapUi> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = (v ?? {}) as Record<string, unknown>;
    const view = (r.view ?? null) as Record<string, unknown> | null;
    const okView = !!view && [view.x, view.y, view.z].every(Number.isFinite) && Number(view.z) > 0;
    out[id] = {
      mode: r.mode === 'outline' ? 'outline' : 'map',
      panel: PANELS.includes(r.panel as MapPanel) ? (r.panel as MapPanel) : null,
      ...(okView ? { view: { x: Number(view!.x), y: Number(view!.y), z: Number(view!.z) } } : {}),
      ...(str(r.sel) ? { sel: String(r.sel) } : {}),
      t: Number(r.t) || 0,
    };
  }
  return out;
}

/** Ghi nhớ 1 sơ đồ, chỉ giữ MAP_MAX sơ đồ mở gần nhất. */
export function rememberMapUi(all: Record<string, MapUi>, id: string, ui: MapUi, max = MAP_MAX): Record<string, MapUi> {
  const next = { ...all, [id]: ui };
  const ids = Object.keys(next);
  if (ids.length <= max) return next;
  ids.sort((a, b) => next[b].t - next[a].t).slice(max).forEach(k => { delete next[k]; });
  return next;
}

let mapUiCache: Record<string, MapUi> | null = null;

export function getMapUi(id: string): MapUi | null {
  if (!mapUiCache) {
    try { mapUiCache = parseMapUi(JSON.parse(localStorage.getItem(MAP_KEY) ?? 'null')); } catch { mapUiCache = {}; }
  }
  return mapUiCache[id] ?? null;
}

export function putMapUi(id: string, ui: Omit<MapUi, 't'>): void {
  getMapUi(id);
  mapUiCache = rememberMapUi(mapUiCache ?? {}, id, { ...ui, t: Date.now() });
  try { localStorage.setItem(MAP_KEY, JSON.stringify(mapUiCache)); } catch { /* chỉ nhớ trong phiên */ }
}
