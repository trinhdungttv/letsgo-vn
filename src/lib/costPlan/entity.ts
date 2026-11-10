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
  /** true = dùng logo RIÊNG đã tải ở đây cho giấy tờ, kể cả khi Pháp lý đã có logo. Mặc định: logo của Pháp lý. */
  logoOwn?: boolean;
  /** Đầu trang mặc định của pháp nhân (cỡ / vị trí logo, chữ đầu trang, tiêu đề) — danh sách vào cổng dùng khi buổi họp chưa chỉnh riêng. */
  header?: HeaderLayout;
}
export const DEFAULT_LAYOUT: StampLayout = { sigScale: 1, sigDx: 0, sigDy: 0, sealScale: 1, sealDx: 0, sealDy: 0, sealOnTop: true, sigInk: 0.5, sealInk: 0.5 };

const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const SCALE_RANGE = { min: 0.4, max: 2 };
export const OFFSET_RANGE = { min: -150, max: 150 };

/**
 * ĐẦU TRANG giấy tờ: logo + khối chữ đầu trang (tên công ty · địa chỉ · điện thoại) + tiêu đề lớn.
 * Đơn vị dịch chuyển = px của file Excel (bản xem trước / PDF tự thu theo tỉ lệ trang) để Excel và PDF giống nhau.
 *   logoScale  cỡ logo (1 = khung chuẩn 143×100 px của mẫu)    logoDx / logoDy  dời logo sang phải / xuống dưới
 *   headScale  cỡ chữ đầu trang                                 headAlign        căn chữ đầu trang trong vùng bên phải logo
 *   headDx     thụt chữ vào (bội số 9 px = 1 nấc thụt lề Excel)  headDy           đẩy khối chữ xuống
 *   titleScale cỡ tiêu đề lớn                                   titleDy          khoảng cách thêm phía trên tiêu đề
 */
export interface HeaderLayout {
  logoScale: number; logoDx: number; logoDy: number;
  headScale: number; headAlign: 'left' | 'center' | 'right'; headDx: number; headDy: number;
  titleScale: number; titleDy: number;
}
export const DEFAULT_HEADER: HeaderLayout = { logoScale: 1, logoDx: 0, logoDy: 0, headScale: 1, headAlign: 'left', headDx: 0, headDy: 0, titleScale: 1, titleDy: 0 };
export const HEADER_RANGE = {
  logoScale: { min: 0.5, max: 2.5 }, logoDx: { min: -12, max: 1600 }, logoDy: { min: -6, max: 120 },
  headScale: { min: 0.7, max: 1.5 }, headDx: { min: 0, max: 450 }, headDy: { min: 0, max: 60 },
  titleScale: { min: 0.6, max: 1.4 }, titleDy: { min: -10, max: 60 },
} as const;
/** 1 nấc thụt lề của Excel ≈ 9 px */
export const INDENT_PX = 9;

/** Đọc cấu hình đầu trang (thiếu / sai → null = dùng mặc định). */
export function normalizeHeader(raw: unknown): HeaderLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const d = DEFAULT_HEADER, R = HEADER_RANGE;
  const n = (k: keyof typeof R) => clamp(r[k], R[k].min, R[k].max, d[k] as number);
  return {
    logoScale: n('logoScale'), logoDx: n('logoDx'), logoDy: n('logoDy'),
    headScale: n('headScale'), headAlign: r.headAlign === 'center' || r.headAlign === 'right' ? r.headAlign : 'left',
    headDx: Math.round(n('headDx') / INDENT_PX) * INDENT_PX, headDy: n('headDy'),
    titleScale: n('titleScale'), titleDy: n('titleDy'),
  };
}
export const sameHeader = (a: HeaderLayout, b: HeaderLayout) => (Object.keys(DEFAULT_HEADER) as (keyof HeaderLayout)[]).every(k => a[k] === b[k]);

export function normalizeLayout(raw: unknown): StampLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LAYOUT;
  const out: StampLayout = {
    sigScale: clamp(r.sigScale, SCALE_RANGE.min, SCALE_RANGE.max, d.sigScale), sigDx: clamp(r.sigDx, OFFSET_RANGE.min, OFFSET_RANGE.max, 0), sigDy: clamp(r.sigDy, OFFSET_RANGE.min, OFFSET_RANGE.max, 0),
    sealScale: clamp(r.sealScale, SCALE_RANGE.min, SCALE_RANGE.max, d.sealScale), sealDx: clamp(r.sealDx, OFFSET_RANGE.min, OFFSET_RANGE.max, 0), sealDy: clamp(r.sealDy, OFFSET_RANGE.min, OFFSET_RANGE.max, 0),
    sealOnTop: r.sealOnTop === false ? false : true,
    sigInk: clamp(r.sigInk, 0, 1, d.sigInk), sealInk: clamp(r.sealInk, 0, 1, d.sealInk),                       // thiếu / không rõ → ký trước, đóng dấu sau
  };
  if (r.logoOwn === true) out.logoOwn = true;
  const h = normalizeHeader(r.header);
  if (h) out.header = h;
  return out;
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

/** 1 dòng bảng quote_entities như RPC quote_entity_list trả về — nay chỉ là "bộ ký/dấu" của 1 pháp nhân. */
export interface StampRow {
  id: string;
  label: string;
  data: CompanyProfileData;
  layout: StampLayout;
  logo: string | null;
  signature: string | null;
  seal: string | null;
  has_signature: boolean;
  has_seal: boolean;
  sort_order: number;
  updated_by_name: string | null;
  updated_at: string | null;
  /** Pháp nhân bên Pháp lý (legal_entities.id) — migration 219; chưa chạy → luôn null */
  legal_entity_id?: string | null;
}

/** Thông tin pháp nhân lấy từ Pháp lý (legal_entities) — chỉ những cột giấy tờ cần. */
export interface LegalEntityLite {
  id: string; name: string; short_name: string; tax_code: string; address: string; phone: string; email: string; website: string;
  legal_rep: string; legal_rep_title: string; status: string; logo_url: string | null; quote_entity_id: string | null; color: string;
}

/**
 * PHÁP NHÂN dùng cho giấy tờ (báo giá, danh sách vào cổng) = thông tin của Pháp lý + bộ ký/dấu (quote_entities).
 * id = id bên Pháp lý (pháp nhân có trong Pháp lý) hoặc id bộ ký/dấu (pháp nhân cũ chưa có trong Pháp lý).
 * Giấy tờ cũ còn lưu id bộ ký/dấu → luôn tìm bằng `findEntity` (khớp cả id lẫn stamp_id).
 */
export interface QuoteEntity {
  id: string;
  /** Tên ngắn hiện trên nút chọn: tên viết tắt ở Pháp lý → tên công ty bỏ "Công ty TNHH/Cổ phần…" */
  label: string;
  /** Thông tin in lên giấy tờ — đã gộp: Pháp lý trước, thiếu thì lấy dữ liệu cũ */
  data: CompanyProfileData;
  layout: StampLayout;
  logo: string | null;
  /** Chỉ admin nhận được ảnh chữ ký / con dấu từ danh sách; người khác lấy qua quote_entity_stamp (có báo admin) */
  signature: string | null;
  seal: string | null;
  has_signature: boolean;
  has_seal: boolean;
  sort_order: number;
  updated_by_name: string | null;
  updated_at: string | null;
  /** id dòng quote_entities (null = chưa có bộ ký/dấu — lưu lần đầu sẽ tạo) */
  stamp_id: string | null;
  /** id bên Pháp lý (null = pháp nhân cũ, chưa có trong Pháp lý) */
  legal_id: string | null;
  legal: LegalEntityLite | null;
  /** Giá trị đang lưu ở quote_entities (để lưu lại không ghi đè bằng dữ liệu Pháp lý) */
  own: { label: string; data: CompanyProfileData; logo: string | null };
  /** Logo đang dùng lấy từ đâu */
  logo_source: 'legal' | 'own' | null;
}

/** Tìm pháp nhân theo id đã lưu trong giấy tờ — khớp id mới (Pháp lý) hoặc id bộ ký/dấu cũ. */
export function findEntity<T extends Pick<QuoteEntity, 'id' | 'stamp_id'>>(list: readonly T[], id: string | null | undefined): T | null {
  if (!id) return null;
  return list.find(e => e.id === id) ?? list.find(e => e.stamp_id === id) ?? null;
}

/** Pháp nhân mặc định cho 1 báo giá: đúng cái đã chọn cho báo giá đó → cái dùng lần trước → cái đầu tiên. */
export function pickEntity(list: QuoteEntity[], chosenId: string | null | undefined, lastId: string | null | undefined): QuoteEntity | null {
  return findEntity(list, chosenId) ?? findEntity(list, lastId) ?? list[0] ?? null;
}
