// Vẽ ảnh 360° KHÔNG cần WebGL (máy tắt tăng tốc đồ hoạ / GPU bị trình duyệt chặn — Chrome 2025+ không còn WebGL chạy bằng
// phần mềm). Tính từng điểm ảnh bằng CPU theo ĐÚNG phép chiếu của lib/pano/sphere.ts (như shader WebGL) nên nét vẽ / ghim
// vẫn khớp. Đang kéo: vẽ nhanh ở độ phân giải thấp; dừng tay 0,15 s: vẽ lại nét (nội suy song tuyến).
import type { PanoView } from '../../lib/pano/sphere';
import type { Coverage, PanoDrawer } from './panoGL';

const RAD = Math.PI / 180;
const BG = 0xff1f1c1c; // ABGR (little-endian) của #1C1C1F
/** Đang kéo: số điểm ảnh tính / khung hình (~10 ms trên máy thường) */
const FAST_PIXELS = 220_000;
const IDLE_MS = 150;

export class PanoSoftRenderer implements PanoDrawer {
  private ctx: CanvasRenderingContext2D;
  private src: Uint32Array | null = null;
  private sw = 0;
  private sh = 0;
  private cov: Coverage = { haov: 360, vaov: 180, voffset: 0 };
  private idle: ReturnType<typeof setTimeout> | null = null;
  private lastView: PanoView | null = null;
  private lastDpr = 1;
  private drawnFull = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Trình duyệt không vẽ được ảnh (canvas 2D).');
    this.ctx = ctx;
  }

  setImage(img: HTMLImageElement, cov: Coverage, mobile: boolean) {
    // Ảnh nguồn thu về tối đa 4096 px (điện thoại 2048) — đủ nét cho cách vẽ này, đỡ tốn bộ nhớ
    const maxW = mobile ? 2048 : 4096;
    const k = Math.min(1, maxW / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('Trình duyệt không đọc được ảnh (canvas 2D).');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    this.src = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer);
    this.sw = w; this.sh = h;
    this.cov = cov;
    this.drawnFull = false;
  }

  render(v: PanoView, dpr: number) {
    this.lastView = v;
    this.lastDpr = dpr;
    if (!this.src) { this.paint(v, 0.25, false); return; }
    // Lần đầu: vẽ nét luôn. Sau đó: vẽ nhanh ngay, dừng tay mới vẽ nét.
    if (!this.drawnFull) { this.drawnFull = true; this.paint(v, this.fullScale(dpr), true); return; }
    const fast = Math.min(1, Math.sqrt(FAST_PIXELS / Math.max(1, v.w * v.h)));
    this.paint(v, fast, false);
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.lastView) this.paint(this.lastView, this.fullScale(this.lastDpr), true);
    }, IDLE_MS);
  }

  private fullScale(dpr: number) { return Math.min(dpr, 1.25); }

  private paint(v: PanoView, scale: number, smooth: boolean) {
    const bw = Math.max(1, Math.round(v.w * scale)), bh = Math.max(1, Math.round(v.h * scale));
    if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
    const out = this.ctx.createImageData(bw, bh);
    const o32 = new Uint32Array(out.data.buffer);
    const src = this.src;
    if (!src) { o32.fill(BG); this.ctx.putImageData(out, 0, 0); return; }
    const sw = this.sw, sh = this.sh;
    const f = (bw / 2) / Math.tan((v.hfov * RAD) / 2);
    const cp = Math.cos(v.pitch * RAD), sp = Math.sin(v.pitch * RAD);
    const cy = Math.cos(v.yaw * RAD), sy = Math.sin(v.yaw * RAD);
    const haov = this.cov.haov * RAD, vaov = this.cov.vaov * RAD, voff = this.cov.voffset * RAD;
    const full = this.cov.haov >= 359.5;
    const uScale = sw / haov, vScale = sh / vaov;
    const uOff = sw / 2, vOff = sh / 2;
    let k = 0;
    for (let j = 0; j < bh; j++) {
      // Tia camera (x phải, y lên, z trước) — xoay pitch chỉ phụ thuộc hàng
      const py = bh / 2 - j - 0.5;
      const y1 = py * cp + f * sp;
      const z1 = -py * sp + f * cp;
      for (let i = 0; i < bw; i++, k++) {
        const px = i + 0.5 - bw / 2;
        const x2 = px * cy + z1 * sy;
        const z2 = -px * sy + z1 * cy;
        const lon = Math.atan2(x2, z2);
        const lat = Math.atan2(y1, Math.sqrt(x2 * x2 + z2 * z2));
        let u = lon * uScale + uOff;
        const t = vOff - (lat - voff) * vScale;
        if (!full && (u < 0 || u >= sw)) { o32[k] = BG; continue; }
        if (t < 0 || t >= sh) { o32[k] = BG; continue; }
        if (full) { u %= sw; if (u < 0) u += sw; }
        if (!smooth) { o32[k] = src[(t | 0) * sw + (u | 0)]; continue; }
        // Nội suy song tuyến (vòng qua mép −180/180 khi ảnh trọn 360°)
        const u0 = Math.floor(u - 0.5), t0 = Math.max(0, Math.min(sh - 1, Math.floor(t - 0.5)));
        const fu = u - 0.5 - u0, ft = t - 0.5 - Math.floor(t - 0.5);
        const t1 = Math.min(sh - 1, t0 + 1);
        const ua = full ? (u0 + sw) % sw : Math.max(0, u0), ub = full ? (u0 + 1) % sw : Math.min(sw - 1, u0 + 1);
        const a = src[t0 * sw + ua], b = src[t0 * sw + ub], c = src[t1 * sw + ua], d = src[t1 * sw + ub];
        const w00 = (1 - fu) * (1 - ft), w10 = fu * (1 - ft), w01 = (1 - fu) * ft, w11 = fu * ft;
        const r = (a & 255) * w00 + (b & 255) * w10 + (c & 255) * w01 + (d & 255) * w11;
        const gg = ((a >>> 8) & 255) * w00 + ((b >>> 8) & 255) * w10 + ((c >>> 8) & 255) * w01 + ((d >>> 8) & 255) * w11;
        const bl = ((a >>> 16) & 255) * w00 + ((b >>> 16) & 255) * w10 + ((c >>> 16) & 255) * w01 + ((d >>> 16) & 255) * w11;
        o32[k] = 0xff000000 | ((bl + 0.5) << 16) | ((gg + 0.5) << 8) | (r + 0.5);
      }
    }
    this.ctx.putImageData(out, 0, 0);
  }

  dispose() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.src = null;
  }
}

