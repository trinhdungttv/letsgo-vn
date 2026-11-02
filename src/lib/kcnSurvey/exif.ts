// Đọc toạ độ GPS + giờ chụp trong EXIF của ảnh JPEG — dùng khi chọn ảnh CÓ SẴN trong máy (chụp bằng camera
// thường lúc trước) để ghim đúng chỗ chụp thay vì chỗ đang đứng. Ảnh HEIC / ảnh đã bị bỏ thông tin vị trí
// (iPhone thường bỏ khi chọn qua trình duyệt) → null, app dùng vị trí hiện tại.

export interface ExifInfo {
  lat: number | null;
  lng: number | null;
  /** DateTimeOriginal theo giờ máy ảnh (không có múi giờ) — 'YYYY-MM-DDTHH:mm:ss' */
  takenAt: string | null;
}

/** Đọc EXIF từ phần đầu file JPEG (APP1 nằm ở đầu file nên 256 KB là đủ). */
export function readExif(buf: ArrayBuffer): ExifInfo | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return null;
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 /* Exif */ && v.getUint16(off + 8) === 0) {
      return readTiff(v, off + 10, Math.min(v.byteLength, off + 2 + size));
    }
    if (marker === 0xffda) return null; // tới phần dữ liệu ảnh mà chưa thấy EXIF
    off += 2 + size;
  }
  return null;
}

function readTiff(v: DataView, start: number, end: number): ExifInfo | null {
  if (start + 8 > end) return null;
  const order = v.getUint16(start);
  const le = order === 0x4949; // 'II'
  if (!le && order !== 0x4d4d) return null;
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const inRange = (o: number, n: number) => start + o >= start && start + o + n <= end;

  /** Đọc 1 IFD → map tag → { type, count, valueOffset (tương đối TIFF) } */
  const readIfd = (ifdOff: number) => {
    const tags = new Map<number, { type: number; count: number; at: number }>();
    if (!inRange(ifdOff, 2)) return tags;
    const n = u16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (!inRange(e, 12)) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const bytes = count * ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 1);
      tags.set(tag, { type, count, at: bytes <= 4 ? e + 8 : u32(e + 8) });
    }
    return tags;
  };
  const ascii = (t?: { count: number; at: number }) => {
    if (!t || !inRange(t.at, t.count)) return null;
    let s = '';
    for (let i = 0; i < t.count; i++) {
      const c = v.getUint8(start + t.at + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const rationals = (t?: { type: number; count: number; at: number }) => {
    if (!t || t.type !== 5 || !inRange(t.at, t.count * 8)) return null;
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const num = u32(t.at + i * 8), den = u32(t.at + i * 8 + 4);
      out.push(den ? num / den : 0);
    }
    return out;
  };

  const ifd0 = readIfd(u32(4));
  let lat: number | null = null, lng: number | null = null, takenAt: string | null = null;

  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const gps = readIfd(gpsPtr.type === 4 ? u32(gpsPtr.at) : gpsPtr.at);
    const dms = (r: number[] | null) => (r && r.length >= 3 ? r[0] + r[1] / 60 + r[2] / 3600 : null);
    const la = dms(rationals(gps.get(0x0002)));
    const lo = dms(rationals(gps.get(0x0004)));
    const laRef = ascii(gps.get(0x0001));
    const loRef = ascii(gps.get(0x0003));
    if (la != null && lo != null && (la !== 0 || lo !== 0)) {
      lat = laRef === 'S' ? -la : la;
      lng = loRef === 'W' ? -lo : lo;
    }
  }

  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const exif = readIfd(exifPtr.type === 4 ? u32(exifPtr.at) : exifPtr.at);
    const raw = ascii(exif.get(0x9003)) ?? ascii(ifd0.get(0x0132));
    const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m) takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }

  if (lat == null && takenAt == null) return null;
  return { lat, lng, takenAt };
}

/** Đọc EXIF của file ảnh người dùng chọn (chỉ JPEG). */
export async function readFileExif(file: Blob): Promise<ExifInfo | null> {
  if (file.type && !/jpe?g/i.test(file.type)) return null;
  try {
    return readExif(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}
