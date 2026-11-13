// Đo đường đi qua nhiều điểm trên Bản đồ Thị trường (nút «Đo khoảng cách»), kiểu chỉ đường Google Maps:
// A → B → C …, kéo để đổi thứ tự, xuất phát từ vị trí hiện tại.
//   • đường xe máy thật (Valhalla — cùng máy định tuyến với Khảo sát KCN) → hỏng thì đường ô tô (OSRM) → hỏng nữa thì chỉ còn chim bay
//   • phần thuần (đổi chỗ, chỗ thả khi kéo, chữ cái, định dạng thời gian) có test ở measureRoute.test.ts
import type { LatLng } from '../../lib/geo';
import { decodePolyline6 } from '../../lib/kcnSurvey/planStopsApi';

/** Giá trị đặc biệt của 1 điểm dừng = vị trí hiện tại của điện thoại / máy tính */
export const MY_LOCATION = '__me';
/** Tối đa 10 điểm như Google Maps (Valhalla nhận 20 / lượt nên 1 lượt gọi là đủ) */
export const MAX_STOPS = 10;

export interface MultiRoute {
  /** Đường vẽ: Valhalla trả 1 đường / chặng; OSRM trả 1 đường cho cả lộ trình */
  lines: [number, number][][];
  /** Mỗi chặng giữa 2 điểm liền nhau */
  legs: { km: number; sec: number }[];
  km: number;
  sec: number;
  mode: 'motorcycle' | 'car';
}

// ── Phần thuần ──────────────────────────────────────────────────────────────
export const stopLetter = (i: number) => String.fromCharCode(65 + (i % 26));

/** Màu chữ cái: đầu xanh lá, cuối đỏ, giữa xanh dương (giống ghim trên bản đồ) */
export const stopColor = (i: number, n: number) => (i === 0 ? '#16A34A' : i === n - 1 ? '#DC2626' : '#2563EB');

/** Dời phần tử ở `from` sang vị trí `to` (trả mảng mới) */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, it);
  return out;
}

/**
 * Đang kéo 1 dòng: `mids` = toạ độ y giữa của các dòng KHÁC (theo thứ tự đang hiện, đã bỏ dòng đang kéo),
 * `y` = vị trí ngón tay → chỉ số chèn mới = số dòng khác nằm phía trên ngón tay.
 */
export function dropIndex(mids: readonly number[], y: number): number {
  let n = 0;
  for (const m of mids) if (m < y) n++;
  return n;
}

/** 25 phút · 1 giờ 5 phút · 2 giờ */
export function fmtDuration(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function fmtKm(km: number) {
  return km < 10 ? km.toFixed(1) : Math.round(km).toString();
}

// ── Gọi máy định tuyến ──────────────────────────────────────────────────────
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';

/** fetch có hạn chờ — máy chủ bản đồ công cộng có lúc treo hẳn */
async function fetchT(url: string, init: RequestInit, signal: AbortSignal, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true });
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}

async function viaValhalla(pts: readonly LatLng[], signal: AbortSignal): Promise<MultiRoute | null> {
  try {
    const res = await fetchT(`${VALHALLA_URL}/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: pts.map(p => ({ lat: p.lat, lon: p.lng })), costing: 'motorcycle', units: 'kilometers' }),
    }, signal, 12_000);
    if (!res.ok) return null;
    const data = await res.json() as { trip?: { summary?: { length: number; time: number }; legs?: { shape: string; summary?: { length: number; time: number } }[] } };
    const legs = data.trip?.legs;
    if (!legs?.length || legs.length !== pts.length - 1) return null;
    return {
      lines: legs.map(l => decodePolyline6(l.shape)),
      legs: legs.map(l => ({ km: l.summary?.length ?? 0, sec: l.summary?.time ?? 0 })),
      km: data.trip?.summary?.length ?? legs.reduce((s, l) => s + (l.summary?.length ?? 0), 0),
      sec: data.trip?.summary?.time ?? legs.reduce((s, l) => s + (l.summary?.time ?? 0), 0),
      mode: 'motorcycle',
    };
  } catch { return null; }
}

async function viaOsrm(pts: readonly LatLng[], signal: AbortSignal): Promise<MultiRoute | null> {
  try {
    const coords = pts.map(p => `${p.lng},${p.lat}`).join(';');
    const res = await fetchT(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`, {}, signal, 12_000);
    if (!res.ok) return null;
    const data = await res.json() as { routes?: { distance: number; duration: number; geometry?: { coordinates?: [number, number][] }; legs?: { distance: number; duration: number }[] }[] };
    const r = data.routes?.[0];
    if (!r?.geometry?.coordinates?.length) return null;
    return {
      lines: [r.geometry.coordinates.map(c => [c[1], c[0]] as [number, number])],
      legs: (r.legs ?? []).map(l => ({ km: l.distance / 1000, sec: l.duration })),
      km: r.distance / 1000,
      sec: r.duration,
      mode: 'car',
    };
  } catch { return null; }
}

/** Đường đi qua `pts` theo đúng thứ tự. null = không gọi được máy nào (chỉ còn chim bay). */
export async function multiRoute(pts: readonly LatLng[], signal: AbortSignal): Promise<MultiRoute | null> {
  if (pts.length < 2) return null;
  const v = await viaValhalla(pts, signal);
  if (v || signal.aborted) return v;
  return viaOsrm(pts, signal);
}

/** Vị trí hiện tại 1 lần (không bám theo) */
export function getMyLocation(): Promise<{ lat: number; lng: number; acc: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Trình duyệt không hỗ trợ định vị')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      err => reject(new Error(err.code === 1 ? 'Bạn chưa cấp quyền định vị cho trình duyệt' : err.code === 3 ? 'Hết thời gian chờ GPS — thử lại ở chỗ thoáng' : err.message)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}
