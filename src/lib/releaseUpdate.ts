// Logic thuần của popup "Có phiên bản mới" (không đụng DOM / mạng / localStorage — test được bằng vitest).
//
// Hai khái niệm:
//  • buildId   — mã MỖI LẦN deploy (commit SHA của Vercel hoặc timestamp build). Khác nhau = server có bản khác bản đang mở.
//  • releaseId — id của mục release note MỚI NHẤT (đầu danh sách src/lib/releaseNotes.ts). Dùng để biết "chức năng mới" là những mục nào.
// dist/version.json do vite.config.ts ghi lúc build: { buildId, builtAt, releaseId, notes }.

export interface ReleaseNote {
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  title?: string;
  /** Tên chức năng ngắn, tiếng Việt */
  features: string[];
}

export interface VersionInfo {
  buildId: string;
  builtAt: string | null;
  releaseId: string;
  /** Mới nhất trước */
  notes: ReleaseNote[];
}

export interface Dismissed {
  buildId: string;
  /** epoch ms lúc bấm "Để sau" */
  at: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Bản đang chạy là dev (không có mã build thật) → không bao giờ báo bản mới. */
export const DEV_BUILD_ID = 'dev';
/** "Để sau" xong thì lần nhắc lại sớm nhất sau chừng này (tab mở nhiều giờ vẫn được nhắc lại, nhưng không dồn dập). */
export const REMIND_AFTER_MS = 4 * 60 * 60 * 1000;
/** Không nhận ra mốc đã xem (mục cũ bị cắt khỏi danh sách) → chỉ lấy chừng này mục mới nhất thay vì cả danh sách. */
export const UNKNOWN_BASELINE_NOTES = 3;
/** version.json giữ tối đa chừng này mục (đủ để gộp nhiều bản bỏ lỡ). */
export const MAX_NOTES_IN_VERSION_FILE = 40;

/** Lọc dữ liệu release note: bỏ mục sai dạng / trùng id, cắt khoảng trắng, bỏ tên chức năng rỗng. Giữ nguyên thứ tự. */
export function cleanNotes(raw: unknown): ReleaseNote[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ReleaseNote[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id || seen.has(id)) continue;
    const date = typeof o.date === 'string' && DATE_RE.test(o.date) ? o.date : '';
    const features = Array.isArray(o.features)
      ? o.features.filter((f): f is string => typeof f === 'string').map(f => f.trim()).filter(Boolean)
      : [];
    if (features.length === 0) continue;
    seen.add(id);
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : undefined;
    out.push(title ? { id, date, title, features } : { id, date, features });
  }
  return out;
}

/** Đọc nội dung version.json. Sai dạng (vd bị trả về index.html) → null. */
export function parseVersionInfo(raw: unknown): VersionInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const buildId = typeof o.buildId === 'string' ? o.buildId.trim() : '';
  if (!buildId) return null;
  const notes = cleanNotes(o.notes);
  const releaseId = typeof o.releaseId === 'string' && o.releaseId.trim() ? o.releaseId.trim() : (notes[0]?.id ?? '');
  const builtAt = typeof o.builtAt === 'string' && o.builtAt ? o.builtAt : null;
  return { buildId, builtAt, releaseId, notes };
}

/** Server có bản khác bản đang chạy không? (mã nào rỗng / bản dev → không kết luận được → false) */
export function isNewBuild(runningBuildId: string, remoteBuildId: string): boolean {
  if (!runningBuildId || !remoteBuildId) return false;
  if (runningBuildId === DEV_BUILD_ID) return false;
  return runningBuildId !== remoteBuildId;
}

/** Các mục MỚI HƠN mốc `baselineId` (mốc không tính), mới nhất trước. Mốc rỗng → []. Mốc không có trong danh sách → vài mục mới nhất. */
export function notesNewerThan(notes: ReleaseNote[], baselineId: string | null | undefined): ReleaseNote[] {
  if (!baselineId) return [];
  const idx = notes.findIndex(n => n.id === baselineId);
  if (idx === 0) return [];
  if (idx < 0) return notes.slice(0, UNKNOWN_BASELINE_NOTES);
  return notes.slice(0, idx);
}

/** Trong 2 mốc, lấy mốc CŨ hơn (nằm sâu hơn trong danh sách) để không bỏ sót mục nào. Mốc không nhận ra coi như cũ nhất. */
export function olderBaseline(notes: ReleaseNote[], a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b || null;
  if (!b) return a;
  const pos = (id: string) => { const i = notes.findIndex(n => n.id === id); return i < 0 ? Infinity : i; };
  return pos(a) >= pos(b) ? a : b;
}

/** Có nên hiện popup "Có phiên bản mới" bây giờ không? `force` = đang gặp lỗi tải phần cũ → hiện dù đã bấm "Để sau". */
export function shouldPrompt(opts: { running: string; remote: string; dismissed: Dismissed | null; now: number; force?: boolean }): boolean {
  if (!isNewBuild(opts.running, opts.remote)) return false;
  if (opts.force) return true;
  const d = opts.dismissed;
  if (!d || d.buildId !== opts.remote) return true;
  return opts.now - d.at >= REMIND_AFTER_MS;
}

/** Lần mở app sau khi bản mới đã chạy: ghi nhận mốc đã xem + có nên báo "Đã cập nhật: …" không. */
export function planBootNotice(info: VersionInfo, lastSeen: string | null): { writeLastSeen: string | null; shown: ReleaseNote[] } {
  if (!info.releaseId) return { writeLastSeen: null, shown: [] };
  // Lần đầu dùng (chưa có mốc): chỉ ghi nhận, không báo
  if (lastSeen === null) return { writeLastSeen: info.releaseId, shown: [] };
  if (lastSeen === info.releaseId) return { writeLastSeen: null, shown: [] };
  return { writeLastSeen: info.releaseId, shown: notesNewerThan(info.notes, lastSeen) };
}

/** Gộp tên chức năng của nhiều mục (mới nhất trước), bỏ trùng tên; trả về tối đa `limit` tên + số tên còn lại. */
export function collectFeatures(notes: ReleaseNote[], limit = 8): { shown: string[]; more: number } {
  const all: string[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    for (const f of n.features) {
      if (seen.has(f)) continue;
      seen.add(f);
      all.push(f);
    }
  }
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/** '2026-10-26' → '26/10/2026' (sai dạng → chuỗi rỗng) */
export function formatReleaseDate(iso: string | null | undefined): string {
  const m = iso && DATE_RE.test(iso.slice(0, 10)) ? iso.slice(0, 10) : '';
  return m ? `${m.slice(8, 10)}/${m.slice(5, 7)}/${m.slice(0, 4)}` : '';
}

/** Giờ build (ISO, UTC) → ngày theo giờ Việt Nam dd/mm/yyyy (sai dạng → chuỗi rỗng). */
export function formatBuiltAt(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(t));
}

/** Đọc giá trị "Để sau" đã lưu; sai dạng → null. */
export function parseDismissed(raw: string | null): Dismissed | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { b?: unknown; t?: unknown };
    return typeof o.b === 'string' && o.b && typeof o.t === 'number' ? { buildId: o.b, at: o.t } : null;
  } catch {
    return null;
  }
}

export const serializeDismissed = (d: Dismissed): string => JSON.stringify({ b: d.buildId, t: d.at });
