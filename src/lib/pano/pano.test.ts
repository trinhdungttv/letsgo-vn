import { describe, expect, it } from 'vitest';
import {
  angleBetween, bearingDeg, centroid, compassAt, coverageFromSize, dirName, dirOf, distanceM, fmtDistance, fromCam, pathMidpoint,
  placeInPano, project, projectPath, sphOf, toCam, unproject, wrapYaw, type PanoView,
} from './sphere';
import { readPanoMeta, imageSize } from './imageMeta';
import { autoPick, classifyPanoLink, driveFileId, extractPhotoCandidates, googleImageBase, targetSize } from './links';
import { nextShapeLabel, sanitizeShapes } from './annotations';

const view = (o: Partial<PanoView> = {}): PanoView => ({ yaw: 0, pitch: 0, hfov: 90, w: 1000, h: 600, ...o });
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('sphere', () => {
  it('wrapYaw về (-180, 180]', () => {
    expect(wrapYaw(190)).toBe(-170);
    expect(wrapYaw(-190)).toBe(170);
    expect(wrapYaw(180)).toBe(180);
    expect(wrapYaw(720)).toBe(0);
  });

  it('dirOf / sphOf ngược nhau', () => {
    for (const p of [{ yaw: 0, pitch: 0 }, { yaw: 90, pitch: 10 }, { yaw: -135, pitch: -45 }, { yaw: 179, pitch: 80 }]) {
      const q = sphOf(dirOf(p));
      near(q.yaw, p.yaw); near(q.pitch, p.pitch);
    }
  });

  it('toCam / fromCam ngược nhau, tâm màn hình = hướng đang nhìn', () => {
    const v = view({ yaw: 37, pitch: -12 });
    const d = dirOf({ yaw: 37, pitch: -12 });
    const c = toCam(d, v);
    near(c[0], 0); near(c[1], 0); near(c[2], 1);
    const back = fromCam(c, v);
    near(back[0], d[0]); near(back[1], d[1]); near(back[2], d[2]);
  });

  it('chiếu: tâm, phải, trên, sau lưng', () => {
    const v = view();
    const c = project({ yaw: 0, pitch: 0 }, v)!;
    near(c.x, 500); near(c.y, 300);
    // hfov 90 → yaw 45 nằm đúng mép phải
    near(project({ yaw: 45, pitch: 0 }, v)!.x, 1000);
    expect(project({ yaw: 0, pitch: 20 }, v)!.y).toBeLessThan(300);
    expect(project({ yaw: 180, pitch: 0 }, v)).toBeNull();
  });

  it('unproject khớp project (cả khi đã xoay / ngẩng)', () => {
    const v = view({ yaw: -120, pitch: 35, hfov: 70 });
    for (const p of [{ yaw: -120, pitch: 35 }, { yaw: -100, pitch: 40 }, { yaw: -140, pitch: 20 }]) {
      const s = project(p, v)!;
      const q = unproject(s.x, s.y, v);
      near(q.yaw, p.yaw, 1e-6); near(q.pitch, p.pitch, 1e-6);
    }
  });

  it('projectPath cắt phần sau lưng', () => {
    const v = view();
    // đường từ trước mặt ra sau lưng → còn 1 đoạn, điểm cuối bị cắt
    const runs = projectPath([{ yaw: 0, pitch: 0 }, { yaw: 30, pitch: 0 }, { yaw: 150, pitch: 0 }], v, false);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
    // vùng hoàn toàn sau lưng → không vẽ
    expect(projectPath([{ yaw: 170, pitch: 0 }, { yaw: -170, pitch: 0 }, { yaw: 180, pitch: 20 }], v, true)).toHaveLength(0);
    // vùng trước mặt → nguyên vẹn
    const area = projectPath([{ yaw: -10, pitch: -5 }, { yaw: 10, pitch: -5 }, { yaw: 0, pitch: 10 }], v, true);
    expect(area[0]).toHaveLength(3);
  });

  it('tâm vùng, giữa đường', () => {
    const c = centroid([{ yaw: -10, pitch: 0 }, { yaw: 10, pitch: 0 }]);
    near(c.yaw, 0); near(c.pitch, 0);
    // qua đường nối -180/180 vẫn đúng
    const w = centroid([{ yaw: 170, pitch: 0 }, { yaw: -170, pitch: 0 }]);
    near(Math.abs(w.yaw), 180);
    const m = pathMidpoint([{ yaw: 0, pitch: 0 }, { yaw: 10, pitch: 0 }, { yaw: 30, pitch: 0 }]);
    near(m.yaw, 15, 1e-6);
    near(angleBetween({ yaw: 0, pitch: 0 }, { yaw: 90, pitch: 0 }), 90);
  });

  it('phương vị / khoảng cách / vị trí trong ảnh', () => {
    const a = { lat: 10.9, lng: 106.7 };
    near(bearingDeg(a, { lat: 11, lng: 106.7 }), 0, 1e-6);
    near(bearingDeg(a, { lat: 10.9, lng: 106.8 }), 90, 0.1);
    near(distanceM(a, { lat: 11, lng: 106.7 }), 11_119.5, 1);
    // tâm ảnh hướng Đông (90°) → công ty phía Bắc nằm bên trái 90°
    near(placeInPano(0, 500, 90, 0).yaw, -90);
    // chụp từ flycam 100 m, cách 100 m → nhìn xuống 45°
    near(placeInPano(0, 100, 0, 100).pitch, -45);
    expect(compassAt(-90, 90)).toBe(0);
    expect(dirName(50)).toBe('Đông Bắc');
    expect(dirName(359, true)).toBe('B');
    expect(fmtDistance(347)).toBe('350 m');
    expect(fmtDistance(1530)).toBe('1,5 km');
  });

  it('góc phủ theo tỉ lệ ảnh', () => {
    expect(coverageFromSize(6000, 3000)).toEqual({ haov: 360, vaov: 180, voffset: 0 });
    expect(coverageFromSize(8000, 2000)).toEqual({ haov: 360, vaov: 90, voffset: 0 });
    expect(coverageFromSize(3000, 3000)).toEqual({ haov: 180, vaov: 180, voffset: 0 });
  });
});

// ── File JPEG giả có EXIF GPS + XMP GPano + SOF ──────────────────────────────
function buildJpeg(opts: { xmp?: string; gps?: boolean; w?: number; h?: number }): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  const seg = (marker: number, payload: number[]) => {
    const len = payload.length + 2;
    bytes.push(0xff, marker, len >> 8, len & 0xff, ...payload);
  };
  const str = (s: string) => Array.from(s, c => c.charCodeAt(0));
  if (opts.gps) {
    const t = new Uint8Array(178);
    const dv = new DataView(t.buffer);
    t.set(str('II'), 0); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
    const entry = (at: number, tag: number, type: number, count: number, value: number) => {
      dv.setUint16(at, tag, true); dv.setUint16(at + 2, type, true); dv.setUint32(at + 4, count, true); dv.setUint32(at + 8, value, true);
    };
    dv.setUint16(8, 2, true); entry(10, 0x8769, 4, 1, 38); entry(22, 0x8825, 4, 1, 76);
    dv.setUint16(38, 1, true); entry(40, 0x9003, 2, 20, 56);
    t.set(str('2026:11:10 09:30:15\0'), 56);
    dv.setUint16(76, 4, true);
    entry(78, 1, 2, 2, 0); t.set(str('N\0'), 86);
    entry(90, 2, 5, 3, 130);
    entry(102, 3, 2, 2, 0); t.set(str('E\0'), 110);
    entry(114, 4, 5, 3, 154);
    const rat = (at: number, vals: [number, number][]) => vals.forEach(([n, d], k) => { dv.setUint32(at + k * 8, n, true); dv.setUint32(at + k * 8 + 4, d, true); });
    rat(130, [[10, 1], [58, 1], [30, 1]]);
    rat(154, [[106, 1], [40, 1], [1200, 100]]);
    seg(0xe1, [...str('Exif\0\0'), ...t]);
  }
  if (opts.xmp) seg(0xe1, [...str('http://ns.adobe.com/xap/1.0/\0'), ...str(opts.xmp)]);
  const w = opts.w ?? 6080, h = opts.h ?? 3040;
  seg(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  bytes.push(0xff, 0xda, 0, 2, 0xff, 0xd9);
  return new Uint8Array(bytes);
}

describe('imageMeta', () => {
  it('đọc cỡ ảnh, GPS, giờ chụp', () => {
    const m = readPanoMeta(buildJpeg({ gps: true }));
    expect(m.width).toBe(6080);
    expect(m.height).toBe(3040);
    near(m.lat!, 10.975, 1e-6);
    near(m.lng!, 106.67, 1e-6);
    expect(m.takenAt).toBe('2026-11-10T09:30:15');
  });

  it('đọc GPano dạng thuộc tính', () => {
    const xmp = '<x:xmpmeta><rdf:Description GPano:ProjectionType="equirectangular" GPano:PoseHeadingDegrees="30.0" GPano:FullPanoWidthPixels="8000" GPano:FullPanoHeightPixels="4000" GPano:CroppedAreaImageWidthPixels="8000" GPano:CroppedAreaImageHeightPixels="4000" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/></x:xmpmeta>';
    const m = readPanoMeta(buildJpeg({ xmp, w: 8000, h: 4000 }));
    expect(m.isPano).toBe(true);
    expect(m.heading).toBe(30);
    expect(m.haov).toBe(360);
    expect(m.vaov).toBe(180);
    expect(m.voffset).toBe(0);
  });

  it('đọc GPano dạng thẻ + ảnh cắt (toàn cảnh điện thoại)', () => {
    const xmp = '<GPano:ProjectionType>equirectangular</GPano:ProjectionType><GPano:FullPanoWidthPixels>8000</GPano:FullPanoWidthPixels><GPano:FullPanoHeightPixels>4000</GPano:FullPanoHeightPixels><GPano:CroppedAreaImageWidthPixels>4000</GPano:CroppedAreaImageWidthPixels><GPano:CroppedAreaImageHeightPixels>1000</GPano:CroppedAreaImageHeightPixels><GPano:CroppedAreaLeftPixels>2000</GPano:CroppedAreaLeftPixels><GPano:CroppedAreaTopPixels>1500</GPano:CroppedAreaTopPixels>';
    const m = readPanoMeta(buildJpeg({ xmp, w: 4000, h: 1000 }));
    expect(m.haov).toBe(180);
    expect(m.vaov).toBe(45);
    expect(m.voffset).toBe(0);
    expect(m.heading).toBeUndefined();
  });

  it('file không phải ảnh / hỏng → rỗng, không lỗi', () => {
    expect(readPanoMeta(new Uint8Array([1, 2, 3]))).toEqual({});
    expect(readPanoMeta(buildJpeg({ gps: true }).slice(0, 40)).lat).toBeUndefined();
  });

  it('cỡ ảnh PNG', () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 4096);
    new DataView(png.buffer).setUint32(20, 2048);
    expect(imageSize(png)).toEqual({ width: 4096, height: 2048 });
  });
});

describe('links', () => {
  it('nhận dạng Google Photos / Drive / ảnh', () => {
    expect(classifyPanoLink('https://photos.app.goo.gl/AbCdEf123')?.kind).toBe('gphotos');
    expect(classifyPanoLink('Xem ảnh: https://photos.google.com/share/AF1Qip?key=abc nhé')?.url).toBe('https://photos.google.com/share/AF1Qip?key=abc');
    const d = classifyPanoLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing');
    expect(d).toEqual({ kind: 'gdrive', url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing', driveId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345' });
    expect(driveFileId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
    expect(classifyPanoLink('https://drive.google.com/drive/folders')).toBeNull();
    expect(classifyPanoLink('https://lh3.googleusercontent.com/pw/AP1abc=w2048-h1024')?.kind).toBe('gimage');
    expect(classifyPanoLink('https://example.com/a.jpg')?.kind).toBe('url');
    expect(classifyPanoLink('http://example.com/a.jpg')).toBeNull();
    expect(classifyPanoLink('không có link')).toBeNull();
  });

  it('bóc ảnh từ trang chia sẻ Google Photos', () => {
    const html = 'x["https://lh3.googleusercontent.com/pw/AP1Gcz_abc-1",8000,4000,null]y["https://lh3.googleusercontent.com/pw/AP1Gcz_abc-1",8000,4000]["https://lh3.googleusercontent.com/pw/AP1Gcz_def",4032,3024]["https://lh3.googleusercontent.com/a/avatar",96,96]';
    const c = extractPhotoCandidates(html);
    expect(c.map(x => x.url)).toEqual(['https://lh3.googleusercontent.com/pw/AP1Gcz_abc-1', 'https://lh3.googleusercontent.com/pw/AP1Gcz_def']);
    expect(autoPick(c)?.width).toBe(8000);
    expect(autoPick([c[1], { ...c[1], url: 'x' }])).toBeNull();
    expect(googleImageBase('https://lh3.googleusercontent.com/pw/AP1abc=w2048-h1024-no')).toBe('https://lh3.googleusercontent.com/pw/AP1abc');
    expect(targetSize(11968, 5984)).toEqual({ w: 6144, h: 3072 });
    expect(targetSize(4000, 2000)).toEqual({ w: 4000, h: 2000 });
  });
});

describe('annotations', () => {
  it('lọc dữ liệu hỏng, kẹp toạ độ', () => {
    const s = sanitizeShapes([
      { id: 'a', kind: 'area', label: 'Cty A', note: '', color: '#1D7BF2', pts: [{ yaw: 0, pitch: 0 }, { yaw: 10, pitch: 0 }, { yaw: 5, pitch: 5 }] },
      { id: 'a', kind: 'line', label: 'L', note: '', color: 'red', pts: [{ yaw: 370, pitch: 100 }, { yaw: 0, pitch: 0 }] },
      { kind: 'area', pts: [{ yaw: 0, pitch: 0 }] },
      { kind: 'label', pts: [{ yaw: 'x', pitch: 0 }] },
      null,
    ]);
    expect(s).toHaveLength(2);
    expect(s[1].id).not.toBe('a');
    expect(s[1].color).toBe('#1D7BF2');
    expect(s[1].pts[0]).toEqual({ yaw: 10, pitch: 90 });
  });

  it('gợi ý tên tiếp theo', () => {
    expect(nextShapeLabel([], 'area')).toBe('Cty 1');
    expect(nextShapeLabel([], 'line')).toBe('Đường 1');
    const shapes = sanitizeShapes([{ kind: 'area', label: 'Lô C5', pts: [{ yaw: 0, pitch: 0 }, { yaw: 1, pitch: 0 }, { yaw: 1, pitch: 1 }] }]);
    expect(nextShapeLabel(shapes, 'label')).toBe('Lô C6');
  });
});
