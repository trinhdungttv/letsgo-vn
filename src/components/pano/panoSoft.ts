// Vẽ ảnh 360° KHÔNG cần WebGL (máy tắt tăng tốc đồ hoạ / GPU bị trình duyệt chặn — Chrome 2025+ không còn WebGL chạy bằng
// phần mềm). Tính từng điểm ảnh bằng CPU theo ĐÚNG phép chiếu của lib/pano/sphere.ts (như shader WebGL) nên nét vẽ / ghim
// vẫn khớp. Đang kéo: vẽ nhanh ở độ phân giải thấp; dừng tay 0,15 s: vẽ lại nét (nội suy song tuyến) ở đúng mật độ màn hình
// (devicePixelRatio, trần SOFT_SHARP_PX) — chia thành nhiều lượt ~12 ms nên không khựng, xong mới hiện một lần.
// Ảnh nguồn giữ cỡ gốc (trần SOFT_SRC_BUDGET; iPhone / iPad theo giới hạn khung vẽ, thu theo nấc ½ — xem lib/pano/quality.ts).
import type { PanoView } from '../../lib/pano/sphere';
import { CANVAS_MAX_PX, SOFT_SHARP_PX, SOFT_SRC_BUDGET, isIOSWebKit, textureScale } from '../../lib/pano/quality';
import { drawScaled, type Coverage, type PanoDrawer } from './panoGL';

const RAD = Math.PI / 180;
const BG = 0xff1f1c1c; // ABGR (little-endian) của #1C1C1F
/** Đang kéo: số điểm ảnh tính / khung hình (~10 ms trên máy thường) */
const FAST_PIXELS = 220_000;
const IDLE_MS = 150;
/** Mỗi lượt vẽ nét chạy tối đa ~12 ms rồi nhường cho trình duyệt. */
const SLICE_MS = 12;

export class PanoSoftRenderer implements PanoDrawer {
  private ctx: CanvasRenderingContext2D;
  private src: Uint32Array | null = null;
  private sw = 0;
  private sh = 0;
  private cov: Coverage = { haov: 360, vaov: 180, voffset: 0 };
  private idle: ReturnType<typeof setTimeout> | null = null;
  private job: ReturnType<typeof setTimeout> | null = null;
  /** Khung hình đã vẽ nét xong (khỏi vẽ lại khi không đổi gì). */
  private sharpKey: string | null = null;
  private drawnSharp = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Trình duyệt không vẽ được ảnh (canvas 2D).');
    this.ctx = ctx;
  }

  setImage(img: HTMLImageElement, cov: Coverage, budgetPx: number) {
    const ios = isIOSWebKit();
    // Ảnh nguồn phải đọc qua canvas 2D → iPhone không vượt ~16,7 MP; máy tính giữ nguyên ảnh lưu (≤ 6144 px)
    const budget = Math.min(budgetPx, ios ? CANVAS_MAX_PX : SOFT_SRC_BUDGET);
    const k = textureScale(img.naturalWidth, img.naturalHeight, { maxTex: 16384, budgetPx: budget, halvesOnly: ios });
    const c = drawScaled(img, k, true);
    const g = c?.getContext('2d', { willReadFrequently: true });
    if (!c || !g) throw new Error('Trình duyệt không đọc được ảnh (canvas 2D).');
    this.src = new Uint32Array(g.getImageData(0, 0, c.width, c.height).data.buffer);
    this.sw = c.width; this.sh = c.height;
    this.cov = cov;
    this.sharpKey = null;
    this.drawnSharp = false;
  }

  render(v: PanoView, dpr: number) {
    this.cancel();
    if (!this.src) { this.paint(v, 0.25); return; }
    // Mật độ vẽ nét: đúng dpr màn hình, khung quá to thì hạ cho vừa SOFT_SHARP_PX (không dưới 1)
    const sharp = Math.min(dpr, Math.max(1, Math.sqrt(SOFT_SHARP_PX / Math.max(1, v.w * v.h))));
    const key = `${v.yaw}|${v.pitch}|${v.hfov}|${v.w}|${v.h}|${sharp}`;
    if (key === this.sharpKey) return;
    this.sharpKey = null;
    this.paint(v, Math.min(1, Math.sqrt(FAST_PIXELS / Math.max(1, v.w * v.h))));
    // Lần đầu vẽ nét ngay; sau đó chờ dừng tay
    this.idle = setTimeout(() => { this.idle = null; this.paintSharp(v, sharp, key); }, this.drawnSharp ? IDLE_MS : 0);
  }

  /** Vẽ nhanh (lấy điểm gần nhất) ngay trong lượt này. */
  private paint(v: PanoView, scale: number) {
    const bw = Math.max(1, Math.round(v.w * scale)), bh = Math.max(1, Math.round(v.h * scale));
    if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
    const out = this.ctx.createImageData(bw, bh);
    const o32 = new Uint32Array(out.data.buffer);
    if (!this.src) o32.fill(BG);
    else this.fill(o32, v, bw, bh, 0, bh, false);
    this.ctx.putImageData(out, 0, 0);
  }

  /** Vẽ nét (nội suy song tuyến) chia nhiều lượt; xong cả khung mới đổi cỡ canvas + hiện một lần (không nháy). */
  private paintSharp(v: PanoView, scale: number, key: string) {
    const bw = Math.max(1, Math.round(v.w * scale)), bh = Math.max(1, Math.round(v.h * scale));
    const out = this.ctx.createImageData(bw, bh);
    const o32 = new Uint32Array(out.data.buffer);
    let row = 0;
    const step = () => {
      this.job = null;
      if (!this.src) return;
      const t0 = performance.now();
      while (row < bh && performance.now() - t0 < SLICE_MS) {
        const end = Math.min(bh, row + 8);
        this.fill(o32, v, bw, bh, row, end, true);
        row = end;
      }
      if (row < bh) { this.job = setTimeout(step, 0); return; }
      if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
      this.ctx.putImageData(out, 0, 0);
      this.sharpKey = key;
      this.drawnSharp = true;
    };
    step();
  }

  /** Tính các hàng [j0, j1) của khung bw × bh. */
  private fill(o32: Uint32Array, v: PanoView, bw: number, bh: number, j0: number, j1: number, smooth: boolean) {
    const src = this.src!;
    const sw = this.sw, sh = this.sh;
    const f = (bw / 2) / Math.tan((v.hfov * RAD) / 2);
    const cp = Math.cos(v.pitch * RAD), sp = Math.sin(v.pitch * RAD);
    const cy = Math.cos(v.yaw * RAD), sy = Math.sin(v.yaw * RAD);
    const haov = this.cov.haov * RAD, vaov = this.cov.vaov * RAD, voff = this.cov.voffset * RAD;
    const full = this.cov.haov >= 359.5;
    const uScale = sw / haov, vScale = sh / vaov;
    const uOff = sw / 2, vOff = sh / 2;
    let k = j0 * bw;
    for (let j = j0; j < j1; j++) {
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
  }

  private cancel() {
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    if (this.job != null) { clearTimeout(this.job); this.job = null; }
  }

  dispose() {
    this.cancel();
    this.src = null;
  }
}
