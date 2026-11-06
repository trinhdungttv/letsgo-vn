// Khảo sát ONLINE (migration 210): ảnh tuyển dụng lấy trên mạng + vị trí công ty từ link Google Maps, không đi thực địa.
import { isValidVnLatLng, parseLatLngFromLink, type LatLng } from '../geo';

/** Tag hiện trên ảnh online chưa ai xác thực */
export const UNVERIFIED_TAG = 'Chưa xác thực';
/** Nhãn trong PDF / CSV (font PDF không có ký hiệu đặc biệt → ghi bằng chữ) */
export const ONLINE_PDF_TAG = '[Online - Chưa xác thực] ';
export const ONLINE_VERIFIED_PDF_TAG = '[Online - Đã xác thực] ';

/** Đọc toạ độ từ link Google Maps hoặc chữ "10.95, 106.84" dán thẳng. Không đọc được / ngoài Việt Nam → null. */
export function parsePosition(text: string): LatLng | null {
  const t = text.trim();
  if (!t) return null;
  const plain = /^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{2,3}(?:\.\d+)?)$/.exec(t);
  const p = plain ? { lat: +plain[1], lng: +plain[2] } : parseLatLngFromLink(t);
  return isValidVnLatLng(p) ? p : null;
}

export type KindFilter = 'all' | 'field' | 'online' | 'unverified';
export const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Mọi loại' },
  { id: 'field', label: 'Đi thực địa' },
  { id: 'online', label: 'Khảo sát online' },
  { id: 'unverified', label: 'Chưa xác thực' },
];

interface KindInfo { survey_kind: 'field' | 'online'; verified_at: string | null }
export const matchesKind = (p: KindInfo, f: KindFilter) =>
  f === 'all' || (f === 'field' ? p.survey_kind !== 'online' : f === 'online' ? p.survey_kind === 'online' : p.survey_kind === 'online' && !p.verified_at);

/** Nhãn cho PDF / CSV: '' với ảnh thực địa */
export const kindPdfTag = (p: KindInfo) => (p.survey_kind !== 'online' ? '' : p.verified_at ? ONLINE_VERIFIED_PDF_TAG : ONLINE_PDF_TAG);
