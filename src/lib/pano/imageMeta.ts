// Đọc thông tin nằm trong đầu file ảnh 360° — chỉ cần ~512 KB đầu file: cỡ ảnh, toạ độ GPS (EXIF), thời điểm chụp,
// hướng la bàn + góc phủ (XMP GPano — máy 360 Insta360 / Ricoh / điện thoại ghi sẵn), flycam DJI (XMP drone-dji: GPS,
// hướng thân máy bay, độ cao bay). Thuần hàm, chạy được cả ở máy chủ (api/pano-import.ts) lẫn trình duyệt (ảnh tải từ
// máy). Có test (pano.test.ts).
import { wrap360 } from './sphere';

export interface PanoMeta {
  width?: number;
  height?: number;
  lat?: number;
  lng?: number;
  /** Hướng la bàn của GIỮA ảnh (độ). */
  heading?: number;
  /** Hướng lấy từ đâu: GPano (máy 360 ghi), flycam DJI, hay EXIF GPSImgDirection. */
  headingFrom?: 'gpano' | 'dji' | 'exif';
  /** Độ cao máy ảnh so với chỗ cất cánh (m) — flycam DJI ghi RelativeAltitude. */
  heightM?: number;
  /** Tên máy chụp (vd "DJI Mini4 Pro") — chỉ để hiện cho người dùng. */
  device?: string;
  /** Góc phủ ngang / dọc (độ) và vĩ độ của giữa ảnh — chỉ có khi ảnh ghi GPano. */
  haov?: number;
  vaov?: number;
  voffset?: number;
  /** ISO, giờ máy ảnh (không múi giờ). */
  takenAt?: string;
  /** Ảnh có đánh dấu là ảnh cầu (GPano:ProjectionType = equirectangular). */
  isPano?: boolean;
}

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** Cỡ ảnh JPEG / PNG / WebP từ phần đầu file. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length > 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  return jpegSegments(b).size;
}

interface JpegScan { size: { width: number; height: number } | null; exif: Uint8Array | null; xmp: string }

function jpegSegments(b: Uint8Array): JpegScan {
  const out: JpegScan = { size: null, exif: null, xmp: '' };
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return out;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) break;
    const start = i + 4, end = Math.min(b.length, i + 2 + len);
    if (marker === 0xe1) {
      if (ascii(b, start, 6) === 'Exif\0\0' && !out.exif) out.exif = b.subarray(start + 6, end);
      else if (ascii(b, start, 29) === 'http://ns.adobe.com/xap/1.0/\0') out.xmp += ascii(b, start + 29, end - start - 29);
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && !out.size && end - start >= 5) {
      out.size = { height: (b[start + 1] << 8) | b[start + 2], width: (b[start + 3] << 8) | b[start + 4] };
    }
    i += 2 + len;
  }
  return out;
}

interface Tiff { dv: DataView; le: boolean }
const u16 = (t: Tiff, o: number) => t.dv.getUint16(o, t.le);
const u32 = (t: Tiff, o: number) => t.dv.getUint32(o, t.le);

/** Các mục của 1 IFD: tag → { type, count, valueOffset (vị trí ô giá trị) }. */
function readIfd(t: Tiff, off: number): Map<number, { type: number; count: number; at: number }> {
  const m = new Map<number, { type: number; count: number; at: number }>();
  if (off <= 0 || off + 2 > t.dv.byteLength) return m;
  const n = u16(t, off);
  for (let k = 0; k < n && k < 200; k++) {
    const e = off + 2 + k * 12;
    if (e + 12 > t.dv.byteLength) break;
    const type = u16(t, e + 2), count = u32(t, e + 4);
    const unit = type === 5 || type === 10 ? 8 : type === 3 ? 2 : type === 4 || type === 9 ? 4 : 1;
    const at = unit * count > 4 ? u32(t, e + 8) : e + 8;
    m.set(u16(t, e), { type, count, at });
  }
  return m;
}

function rationals(t: Tiff, at: number, count: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const o = at + k * 8;
    if (o + 8 > t.dv.byteLength) break;
    const num = u32(t, o), den = u32(t, o + 4);
    out.push(den ? num / den : NaN);
  }
  return out;
}

function tiffAscii(t: Tiff, at: number, count: number): string {
  let s = '';
  for (let k = 0; k < count && at + k < t.dv.byteLength; k++) {
    const c = t.dv.getUint8(at + k);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function readExif(exif: Uint8Array, meta: PanoMeta) {
  if (exif.length < 8) return;
  const dv = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
  const order = ascii(exif, 0, 2);
  if (order !== 'II' && order !== 'MM') return;
  const t: Tiff = { dv, le: order === 'II' };
  if (u16(t, 2) !== 42) return;
  const ifd0 = readIfd(t, u32(t, 4));
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const sub = readIfd(t, u32(t, exifPtr.at));
    const dt = sub.get(0x9003) ?? sub.get(0x9004);
    const m = dt && tiffAscii(t, dt.at, dt.count).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) meta.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  const gpsPtr = ifd0.get(0x8825);
  if (!gpsPtr) return;
  const gps = readIfd(t, u32(t, gpsPtr.at));
  const dms = (tag: number) => {
    const e = gps.get(tag);
    if (!e || e.type !== 5) return null;
    const [d, m, s] = rationals(t, e.at, Math.min(3, e.count));
    const v = (d ?? 0) + (m ?? 0) / 60 + (s ?? 0) / 3600;
    return Number.isFinite(v) ? v : null;
  };
  const ref = (tag: number) => { const e = gps.get(tag); return e ? tiffAscii(t, e.at, e.count).trim().toUpperCase() : ''; };
  const lat = dms(2), lng = dms(4);
  if (lat != null && lng != null && (lat !== 0 || lng !== 0)) {
    meta.lat = Math.round((ref(1) === 'S' ? -lat : lat) * 1e7) / 1e7;
    meta.lng = Math.round((ref(3) === 'W' ? -lng : lng) * 1e7) / 1e7;
  }
  const dir = gps.get(0x11);
  if (dir && dir.type === 5 && meta.heading == null) {
    const [h] = rationals(t, dir.at, 1);
    if (Number.isFinite(h)) { meta.heading = wrap360(h); meta.headingFrom = 'exif'; }
  }
}

/** Giá trị 1 thẻ XMP dạng thuộc tính `ns:Name="…"` hoặc dạng thẻ `<ns:Name>…</ns:Name>`. */
function xmpVal(xmp: string, ns: string, name: string): string | null {
  const m = xmp.match(new RegExp(`${ns}:${name}\\s*(?:=\\s*["']([^"']*)["']|>([^<]*)<)`));
  return m ? (m[1] ?? m[2] ?? '').trim() : null;
}
const gpano = (xmp: string, name: string) => xmpVal(xmp, 'GPano', name);
const xmpNum = (xmp: string, ns: string, name: string) => {
  const v = xmpVal(xmp, ns, name);
  const x = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Flycam DJI ghi GPS / hướng / độ cao vào XMP drone-dji (ảnh cầu ghép trong app DJI Fly KHÔNG có GPS ở EXIF).
 *  Hướng giữa ảnh cầu = FlightYawDegree (hướng thân máy bay): đã kiểm bằng vị trí mặt trời trên ảnh thật của Tony
 *  (DJI Mini 4 Pro, 19/12/2025 15:35) → mặt trời cho 324,9°, FlightYaw 324,7°, còn GimbalYaw lệch 15°.
 *  Ảnh thường (không phải ảnh cầu) thì giữa ảnh = hướng gimbal. */
function readDji(xmp: string, meta: PanoMeta) {
  if (!xmp.includes('drone-dji')) return;
  const lat = xmpNum(xmp, 'drone-dji', 'GpsLatitude');
  // Firmware cũ của DJI viết sai chính tả "GpsLongtitude"
  const lng = xmpNum(xmp, 'drone-dji', 'GpsLongitude') ?? xmpNum(xmp, 'drone-dji', 'GpsLongtitude');
  if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
    meta.lat = Math.round(lat * 1e7) / 1e7;
    meta.lng = Math.round(lng * 1e7) / 1e7;
  }
  const flight = xmpNum(xmp, 'drone-dji', 'FlightYawDegree'), gimbal = xmpNum(xmp, 'drone-dji', 'GimbalYawDegree');
  const yaw = meta.isPano ? flight ?? gimbal : gimbal ?? flight;
  if (meta.heading == null && yaw != null) {
    meta.heading = Math.round(wrap360(yaw) * 10) / 10;
    meta.headingFrom = 'dji';
  }
  const rel = xmpNum(xmp, 'drone-dji', 'RelativeAltitude');
  if (rel != null && rel > 3 && rel < 2000) meta.heightM = Math.round(rel);
  const name = xmpVal(xmp, 'drone-dji', 'ProductName');
  meta.device = name ? `DJI ${name}` : 'Flycam DJI';
}

function readXmp(xmp: string, meta: PanoMeta) {
  if (!xmp.includes('GPano')) return;
  const num = (n: string) => xmpNum(xmp, 'GPano', n);
  const proj = gpano(xmp, 'ProjectionType');
  if (proj && /equirectangular/i.test(proj)) meta.isPano = true;
  const fullW = num('FullPanoWidthPixels'), fullH = num('FullPanoHeightPixels');
  const cw = num('CroppedAreaImageWidthPixels'), ch = num('CroppedAreaImageHeightPixels');
  const left = num('CroppedAreaLeftPixels') ?? 0, top = num('CroppedAreaTopPixels') ?? 0;
  let centerYawOffset = 0;
  if (fullW && fullH && cw && ch && fullW > 0 && fullH > 0) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    meta.haov = r2(Math.min(360, (360 * cw) / fullW));
    meta.vaov = r2(Math.min(180, (180 * ch) / fullH));
    meta.voffset = r2(90 - ((top + ch / 2) / fullH) * 180);
    centerYawOffset = ((left + cw / 2) / fullW) * 360 - 180;
  }
  const head = num('PoseHeadingDegrees');
  if (head != null) {
    meta.heading = Math.round(wrap360(head + centerYawOffset) * 10) / 10;
    meta.headingFrom = 'gpano';
  }
}

/** Đọc mọi thông tin có được từ phần đầu file ảnh (thiếu gì thì bỏ trống). */
export function readPanoMeta(b: Uint8Array): PanoMeta {
  const meta: PanoMeta = {};
  const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
  if (isJpeg) {
    const scan = jpegSegments(b);
    if (scan.size) { meta.width = scan.size.width; meta.height = scan.size.height; }
    if (scan.xmp) { readXmp(scan.xmp, meta); readDji(scan.xmp, meta); }
    // EXIF đọc sau: GPS ở EXIF (nếu có) thắng GPS trong XMP DJI; hướng EXIF chỉ dùng khi chưa có
    if (scan.exif) {
      try { readExif(scan.exif, meta); } catch { /* EXIF hỏng → bỏ qua */ }
    }
  } else {
    const s = imageSize(b);
    if (s) { meta.width = s.width; meta.height = s.height; }
  }
  return meta;
}
