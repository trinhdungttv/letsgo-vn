// Phương án giá — PHÁP NHÂN gửi báo giá (1 công ty có thể có 2–3 pháp nhân, mỗi pháp nhân có tên, MST, người đại diện,
// logo, chữ ký, con dấu riêng) và cách ĐẶT chữ ký + con dấu trong một khung (dùng chung cho PDF tự dựng, bản xem trước, và file Excel mẫu).
import type { CompanyProfileData } from './quoteDoc';

export const MAX_ENTITIES = 5;

/**
 * Căn chỉnh chữ ký / con dấu. Scale = hệ số phóng (1 = cỡ chuẩn), dx/dy = dịch (px) so với vị trí chuẩn.
 * Vị trí chuẩn kiểu văn bản Việt Nam: chữ ký ở giữa, con dấu tròn lệch trái và ĐÈ MỘT PHẦN lên chữ ký.
 */
export interface StampLayout {
  sigScale: number; sigDx: number; sigDy: number;
  sealScale: number; sealDx: number; sealDy: number;
  /** true (mặc định) = KÝ TRƯỚC, ĐÓNG DẤU SAU: con dấu nằm TRÊN chữ ký. false = chữ ký nằm trên con dấu. */
  sealOnTop: boolean;
  /** Mức LÀM RÕ + ĐẬM màu (0..1) cho ảnh chữ ký (mực xanh) / con dấu (mực đỏ) — ảnh scan nhạt, mờ thì tăng lên. 0 = giữ nguyên ảnh */
  sigInk: number; sealInk: number;
}
export const DEFAULT_LAYOUT: StampLayout = { sigScale: 1, sigDx: 0, sigDy: 0, sealScale: 1, sealDx: 0, sealDy: 0, sealOnTop: true, sigInk: 0.5, sealInk: 0.5 };

const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const SCALE_RANGE = { min: 0.4, max: 2 };
export const OFFSET_RANGE = { min: -150, max: 150 };

export function normalizeLayout(raw: unknown): StampLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LAYOUT;
  return {
    sigScale: clamp(r.sigScale, SCALE_RANGE.min, SCALE_RANGE.max, d.sigScale), sigDx: clamp(r.sigDx, OFFSET_RANGE.min, OFFSET_RANGE.max, 0), sigDy: clamp(r.sigDy, OFFSET_RANGE.min, OFFSET_RANGE.max, 0),
    sealScale: clamp(r.sealScale, SCALE_RANGE.min, SCALE_RANGE.max, d.sealScale), sealDx: clamp(r.sealDx, OFFSET_RANGE.min, OFFSET_RANGE.max, 0), sealDy: clamp(r.sealDy, OFFSET_RANGE.min, OFFSET_RANGE.max, 0),
    sealOnTop: r.sealOnTop === false ? false : true,
    sigInk: clamp(r.sigInk, 0, 1, d.sigInk), sealInk: clamp(r.sealInk, 0, 1, d.sealInk),                       // thiếu / không rõ → ký trước, đóng dấu sau
  };
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Khung chứa của chữ ký và con dấu trong 1 khung `box` (px, gốc ở góc trên-trái). Ảnh sẽ được vẽ "vừa khung" (object-fit: contain)
 * nên giữ đúng tỉ lệ. Chữ ký chiếm ~62% bề ngang, con dấu là hình vuông ~ chiều cao khung, tâm con dấu ở 30% bề ngang
 * (chữ ký ở 56%) → dấu đè lên khoảng 1/3 bên trái chữ ký.
 */
export function stampBoxes(layout: StampLayout, box: { w: number; h: number }): { sig: Rect; seal: Rect } {
  const L = normalizeLayout(layout);
  const sw = Math.min(box.w * 0.62, 190) * L.sigScale, sh = Math.min(box.h * 0.9, 90) * L.sigScale;
  const scx = box.w * 0.56 + L.sigDx, scy = box.h * 0.5 + L.sigDy;
  const s = Math.min(box.h * 1.05, 100) * L.sealScale;
  const ccx = box.w * 0.30 + L.sealDx, ccy = box.h * 0.5 + L.sealDy;
  return { sig: { x: scx - sw / 2, y: scy - sh / 2, w: sw, h: sh }, seal: { x: ccx - s / 2, y: ccy - s / 2, w: s, h: s } };
}

/** Kích thước ảnh PNG đọc thẳng từ data URL (không cần giải mã ảnh). null nếu không phải PNG hợp lệ. */
export function pngSize(dataUrl: string): { w: number; h: number } | null {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[1].slice(0, 48));       // 8 byte chữ ký + 4 độ dài + 4 "IHDR" + 8 byte rộng/cao
    if (bin.length < 24 || bin.charCodeAt(1) !== 0x50 || bin.slice(12, 16) !== 'IHDR') return null;
    const u32 = (o: number) => ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0;
    const w = u32(16), h = u32(20);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch { return null; }
}

/** Ảnh vừa khung `box` (giữ tỉ lệ, căn giữa) — dùng khi cần kích thước thật của ảnh trong khung (Excel). */
export function containIn(box: Rect, img: { w: number; h: number } | null): Rect {
  if (!img) return box;
  const k = Math.min(box.w / img.w, box.h / img.h);
  const w = img.w * k, h = img.h * k;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export interface QuoteEntity {
  id: string;
  /** Tên gọi nội bộ để chọn (vd "Let's Go VN – HCM") */
  label: string;
  data: CompanyProfileData;
  layout: StampLayout;
  logo: string | null;
  /** Chỉ admin nhận được ảnh chữ ký / con dấu */
  signature: string | null;
  seal: string | null;
  has_signature: boolean;
  has_seal: boolean;
  sort_order: number;
  updated_by_name: string | null;
  updated_at: string | null;
}

/** Pháp nhân mặc định cho 1 báo giá: đúng cái đã chọn cho báo giá đó → cái dùng lần trước → cái đầu tiên. */
export function pickEntity(list: QuoteEntity[], chosenId: string | null | undefined, lastId: string | null | undefined): QuoteEntity | null {
  return list.find(e => e.id === chosenId) ?? list.find(e => e.id === lastId) ?? list[0] ?? null;
}
