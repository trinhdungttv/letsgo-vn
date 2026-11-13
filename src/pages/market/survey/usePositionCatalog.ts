// Danh mục ngành nghề dùng chung cho mọi ô chọn ngành (chụp ảnh, ảnh online, xem lại ảnh) — tải 1 lần, sửa ở đâu
// thì mọi ô đang mở đều thấy ngay.
import { useEffect, useSyncExternalStore } from 'react';
import { listPositionCatalog, presetItems, type PositionItem } from '../../../lib/kcnSurvey/positionsApi';

interface CatalogState { items: PositionItem[]; missing: boolean; loaded: boolean }

let state: CatalogState = { items: presetItems(), missing: false, loaded: false };
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();

const emit = () => subs.forEach(f => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => state;

export function reloadPositionCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = listPositionCatalog()
    .then(r => { state = { items: r.items, missing: r.missing, loaded: true }; emit(); })
    .catch(() => { state = { ...state, loaded: true }; emit(); }) // lỗi mạng → giữ danh sách đang có
    .finally(() => { inflight = null; });
  return inflight;
}

export function usePositionCatalog() {
  const s = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => { if (!state.loaded) void reloadPositionCatalog(); }, []);
  return { ...s, reload: reloadPositionCatalog };
}
