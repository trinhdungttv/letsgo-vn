// Chia sẻ Khảo sát KCN cho người ngoài: link ngắn #/ks/<mã> + mã 4 số (migration 209).
// Phần thuần (mã PIN, link, soạn tin Zalo, nhóm KCN theo tỉnh) có test; phần gọi DB đi qua RPC — bảng bị khoá với anon.
import { supabase } from '../supabase';
import { provinceKey, provinceLabel } from './province';
import { groupChunks, type TrackChunk } from './api';
import type { TrackSegment } from './track';

export const SURVEY_SHARE_HINT = 'Chưa chạy migration 209 (Chia sẻ khảo sát) trên Supabase — chạy file 20261106100000_209_kcn_survey_shares.sql rồi thử lại';
export const SURVEY_SHARE_LODGING_HINT = 'Chưa chạy migration 222 (Chia sẻ kèm nhà trọ) trên Supabase — chạy file 20261112100000_222_kcn_survey_share_lodgings.sql rồi thử lại, hoặc bỏ chọn "Nhà trọ"';
export const SURVEY_SHARE_FOLLOW_HINT = 'Chưa chạy migration 227 (Tự cập nhật / Chốt số liệu link chia sẻ) trên Supabase — chạy file 20261113140000_227_kcn_survey_share_follow.sql rồi thử lại';

function fail(err: { message?: string; code?: string } | null, hint = SURVEY_SHARE_HINT): never {
  const msg = err?.message ?? 'Lỗi không xác định';
  if (err?.code === 'PGRST202' || err?.code === '42883' || /could not find the function|schema cache/i.test(msg)) throw new Error(hint);
  throw new Error(msg);
}

async function rpc<T>(fn: string, args: Record<string, unknown>, hint?: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, hint);
  return data as T;
}

// ── Link + mã ────────────────────────────────────────────────────────────────
export const SURVEY_SHARE_PREFIX = '#/ks/';

/** https://<tên miền>/#/ks/K7M4QX */
export const surveyShareUrl = (code: string, origin = window.location.origin) => `${origin}/${SURVEY_SHARE_PREFIX}${code}`;

/** "#/ks/K7M4QX" → "K7M4QX"; không phải link khảo sát → null. */
export function parseSurveyShareHash(hash: string): string | null {
  const m = /^#\/ks\/([A-Za-z0-9]{4,12})\/?$/.exec(hash);
  return m ? m[1].toUpperCase() : null;
}

/** Mã 4 số ngẫu nhiên (crypto), giữ cả số 0 đứng đầu. Tránh dãy dễ đoán như 0000 / 1234 / 1111. */
export function randomPin(rand: (max: number) => number = cryptoInt): string {
  for (let i = 0; i < 20; i++) {
    const pin = String(rand(10000)).padStart(4, '0');
    if (!isWeakPin(pin)) return pin;
  }
  return '7304';
}
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  return ['0123', '1234', '2345', '3456', '4567', '5678', '6789', '9876', '8765', '7654', '6543', '5432', '4321', '3210'].includes(pin);
}
function cryptoInt(max: number): number {
  const b = new Uint32Array(1);
  // loại phần dư để các số đều xác suất
  const limit = Math.floor(0x100000000 / max) * max;
  do { crypto.getRandomValues(b); } while (b[0] >= limit);
  return b[0] % max;
}

// ── Thời hạn ─────────────────────────────────────────────────────────────────
export const EXPIRY_OPTIONS: { days: number | null; label: string }[] = [
  { days: 1, label: '1 ngày' },
  { days: 3, label: '3 ngày' },
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: null, label: 'Không giới hạn' },
];
export const DEFAULT_EXPIRY_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, '0');
export const fmtVnDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const fmtVnDateTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())} ${fmtVnDate(d)}`;

/** Trạng thái hiển thị của 1 link trong danh sách */
export function shareState(s: { revoked: boolean; expires_at: string | null }, now = Date.now()): 'active' | 'expired' | 'revoked' {
  if (s.revoked) return 'revoked';
  if (s.expires_at && new Date(s.expires_at).getTime() < now) return 'expired';
  return 'active';
}

// ── Nhóm KCN theo tỉnh (để chọn nhanh cả tỉnh) ───────────────────────────────
export interface ShareZone {
  id: string; name: string; location: string | null; photos: number; trips: number;
  /** số nhà trọ đã khảo sát trong KCN (migration 221) */
  lodgings?: number;
}
export interface ProvinceGroup { key: string; label: string; zones: ShareZone[] }

/** Gộp KCN theo tỉnh; tỉnh nhiều KCN lên trước, "Chưa ghi tỉnh" xuống cuối. */
export function groupZonesByProvince(zones: readonly ShareZone[]): ProvinceGroup[] {
  const by = new Map<string, ProvinceGroup>();
  for (const z of zones) {
    const key = provinceKey(z.location);
    const g = by.get(key) ?? { key, label: key ? provinceLabel(z.location) : 'Chưa ghi tỉnh', zones: [] };
    g.zones.push(z);
    by.set(key, g);
  }
  const out = [...by.values()];
  out.forEach(g => g.zones.sort((a, b) => a.name.localeCompare(b.name, 'vi')));
  return out.sort((a, b) => Number(!a.key) - Number(!b.key) || b.zones.length - a.zones.length || a.label.localeCompare(b.label, 'vi'));
}

// ── Khảo sát sau này: tự cập nhật / chốt số liệu (migration 227) ─────────────
/** Khoá đặc biệt trong follow_provinces: mọi KCN, kể cả KCN khảo sát sau này */
export const FOLLOW_ALL = '*';

/**
 * Tỉnh được "theo dõi" khi link tự cập nhật: tỉnh nào chọn đủ mọi KCN trong danh sách (chạm tên tỉnh) thì KCN mới
 * của tỉnh đó sau này cũng tự vào link. Chọn tất cả → [FOLLOW_ALL]. '' = nhóm "Chưa ghi tỉnh".
 * Khoá giống hệt provinceKey() — server so bằng ks_province_key (migration 227).
 */
export function followKeys(zones: readonly ShareZone[], selected: ReadonlySet<string>): string[] {
  if (!zones.length) return [];
  if (zones.every(z => selected.has(z.id))) return [FOLLOW_ALL];
  return groupZonesByProvince(zones).filter(g => g.zones.every(z => selected.has(z.id))).map(g => g.key);
}

/** Tên hiển thị của các tỉnh đang theo dõi ("Bình Dương", "KCN chưa ghi tỉnh"); FOLLOW_ALL → ['mọi KCN'] */
export function followLabels(zones: readonly ShareZone[], keys: readonly string[]): string[] {
  if (keys.includes(FOLLOW_ALL)) return ['mọi KCN'];
  const groups = new Map(groupZonesByProvince(zones).map(g => [g.key, g.label]));
  return keys.map(k => (k ? groups.get(k) ?? k : 'KCN chưa ghi tỉnh'));
}

/** Ô đã tick khi mở "Sửa phạm vi" 1 link: KCN đã lưu + mọi KCN của tỉnh đang theo dõi (chỉ KCN có trong danh sách). */
export function scopeSelection(zones: readonly ShareZone[], s: { zone_ids: readonly string[]; follow_provinces?: readonly string[] | null; data_until?: string | null }): Set<string> {
  const follow = s.data_until ? [] : s.follow_provinces ?? [];
  const all = follow.includes(FOLLOW_ALL);
  const ids = new Set(s.zone_ids);
  return new Set(zones.filter(z => all || ids.has(z.id) || follow.includes(provinceKey(z.location))).map(z => z.id));
}

/** Mô tả ngắn chế độ của 1 link trong danh sách đã chia sẻ */
export function scopeModeText(zones: readonly ShareZone[], s: { follow_provinces?: readonly string[] | null; data_until?: string | null }): string {
  if (s.data_until) return `chốt số liệu đến ${fmtVnDateTime(new Date(s.data_until))}`;
  const keys = s.follow_provinces ?? [];
  if (!keys.length) return 'tự cập nhật KCN đã chọn';
  return keys.includes(FOLLOW_ALL) ? 'tự cập nhật mọi KCN' : `tự cập nhật, theo cả ${followLabels(zones, keys).join(', ')}`;
}

/** Tên tỉnh (đã bỏ trùng, không có "Chưa ghi tỉnh") của các KCN được chọn */
export function provincesOf(zones: readonly ShareZone[], selected: ReadonlySet<string>): string[] {
  const names = new Set<string>();
  for (const z of zones) if (selected.has(z.id) && provinceKey(z.location)) names.add(provinceLabel(z.location));
  return [...names].sort((a, b) => a.localeCompare(b, 'vi'));
}

// ── Tin nhắn Zalo ────────────────────────────────────────────────────────────
export interface ShareMessageInput {
  url: string;
  pin: string;
  /** Tên KCN được chia sẻ */
  zoneNames: readonly string[];
  provinces: readonly string[];
  /** ISO hoặc null = không giới hạn */
  expiresAt: string | null;
  /** Lời chào riêng, vd tên người nhận ("anh Nam"); trống = "anh/chị" */
  recipient?: string;
  /** Link có kèm nhà trọ đã khảo sát */
  lodgings?: boolean;
  /** true = link tự cập nhật khi có khảo sát mới; false = số liệu chốt đến dataUntil; không truyền = không nhắc */
  live?: boolean;
  dataUntil?: string | null;
}

const joinNames = (names: readonly string[], max = 6) =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} và ${names.length - max} KCN khác`;

/** Nội dung soạn sẵn để dán thẳng vào Zalo: nội dung chia sẻ + link + mã + hạn xem. */
export function buildShareMessage(i: ShareMessageInput): string {
  const who = i.recipient?.trim() || 'anh/chị';
  const where = i.provinces.length ? ` (${i.provinces.join(', ')})` : '';
  const lines = [
    `Chào ${who}, Let's Go VN gửi ${who} dữ liệu khảo sát ${i.zoneNames.length} KCN${where}:`,
    joinNames(i.zoneNames),
    '',
    `🔗 Link xem: ${i.url}`,
    `🔑 Mã xem: ${i.pin}`,
    i.expiresAt ? `⏳ Xem được đến hết ngày ${fmtVnDate(new Date(i.expiresAt))}` : '⏳ Link không giới hạn thời gian',
    ...(i.live === true ? ['🔄 Link tự cập nhật khi có khảo sát mới — mở lại link là thấy'] : []),
    ...(i.live === false && i.dataUntil ? [`📌 Số liệu khảo sát tính đến ${fmtVnDate(new Date(i.dataUntil))}`] : []),
    '',
    `Mở link, nhập mã 4 số (như mở khoá iPhone) là xem được ảnh chỉ tiêu tuyển dụng${i.lodgings ? ', các chuyến khảo sát và nhà trọ quanh KCN (giá, số phòng, khoảng cách tới công ty)' : ' và các chuyến khảo sát'}. ${who === 'anh/chị' ? 'Anh/chị' : who[0].toUpperCase() + who.slice(1)} có thắc mắc cứ nhắn lại em nhé.`,
  ];
  return lines.join('\n');
}

// ── Gọi DB (người đang đăng nhập) ────────────────────────────────────────────
export interface SurveyShareRow {
  id: string; code: string; label: string; zone_ids: string[]; provinces: string[];
  expires_at: string | null; revoked: boolean; open_count: number; last_opened_at: string | null;
  locked_until: string | null; created_by_name: string; created_at: string;
  /** Migration 222 — chưa chạy thì không có (coi như false) */
  include_lodgings?: boolean;
  show_landlord?: boolean;
  /** Migration 227 — tỉnh đang theo dõi (FOLLOW_ALL = mọi KCN) + mốc chốt số liệu (null = tự cập nhật) */
  follow_provinces?: string[];
  data_until?: string | null;
}

export async function listSurveyShares(token: string): Promise<SurveyShareRow[]> {
  return (await rpc<SurveyShareRow[] | null>('survey_share_list', { p_token: token })) ?? [];
}

export async function createSurveyShare(token: string, a: {
  label: string; zoneIds: string[]; provinces: string[]; pin: string; days: number | null;
  /** kèm nhà trọ (migration 222) + có hiện tên / SĐT chủ nhà */
  lodgings?: boolean; showLandlord?: boolean;
  /** Migration 227: tỉnh theo dõi khi tự cập nhật (followKeys) / chốt số liệu tại lúc tạo */
  follow?: string[]; freeze?: boolean;
}) {
  const args: Record<string, unknown> = {
    p_token: token, p_label: a.label, p_zone_ids: a.zoneIds, p_provinces: a.provinces, p_pin: a.pin, p_days: a.days,
  };
  // Chỉ gửi tham số mới khi có dùng → chưa chạy 222 / 227 thì link thường vẫn tạo được như cũ
  if (a.lodgings) { args.p_include_lodgings = true; args.p_show_landlord = !!a.showLandlord; }
  const follow = a.freeze ? [] : a.follow ?? [];
  if (a.freeze) args.p_freeze = true;
  if (follow.length) args.p_follow_provinces = follow;
  const hint = a.freeze || follow.length ? SURVEY_SHARE_FOLLOW_HINT : a.lodgings ? SURVEY_SHARE_LODGING_HINT : undefined;
  return rpc<{ ok: true; id: string; code: string; expires_at: string | null; data_until?: string | null }>('survey_share_create', args, hint);
}

/** Sửa link đã gửi: KCN, tự cập nhật / chốt số liệu, nhà trọ, tên người nhận — link và mã 4 số giữ nguyên (migration 227). */
export async function updateSurveyShareScope(token: string, id: string, a: {
  label: string; zoneIds: string[]; provinces: string[]; follow: string[]; freeze: boolean; lodgings: boolean; showLandlord: boolean;
}) {
  return rpc<{ ok: true; code: string; data_until: string | null }>('survey_share_update_scope', {
    p_token: token, p_id: id, p_label: a.label, p_zone_ids: a.zoneIds, p_provinces: a.provinces,
    p_follow_provinces: a.freeze ? [] : a.follow, p_freeze: a.freeze,
    p_include_lodgings: a.lodgings, p_show_landlord: a.lodgings && a.showLandlord,
  }, SURVEY_SHARE_FOLLOW_HINT);
}

/** Đặt mã mới (và gia hạn nếu setExpiry) — mở lại được cả link đã hết hạn / thu hồi. */
export async function updateSurveyShare(token: string, id: string, pin: string, opt: { setExpiry: boolean; days: number | null }) {
  return rpc<{ ok: true; code: string; expires_at: string | null }>('survey_share_update', {
    p_token: token, p_id: id, p_pin: pin, p_set_expiry: opt.setExpiry, p_days: opt.days,
  });
}

export async function revokeSurveyShare(token: string, id: string): Promise<void> {
  await rpc<void>('survey_share_revoke', { p_token: token, p_id: id });
}

// ── Gọi DB (người ngoài, mã link + PIN) ──────────────────────────────────────
export type SurveyShareFail = 'not_found' | 'expired' | 'locked' | 'wrong_pin';

export interface SharedZone { id: string; name: string; location: string | null }
export interface SharedTrip {
  id: string; zone_id: string | null; zone_name: string; title: string | null; started_at: string; ended_at: string | null;
  distance_m: number; road_coverage: number | null; passed_count: number;
}
export interface SharedPhoto {
  id: string; trip_id: string | null; zone_id: string | null; zone_name: string; lat: number; lng: number; taken_at: string;
  url: string; thumb_url: string | null; width: number | null; height: number | null;
  company_name: string; positions: string; headcount: number | null; wage_text: string; note: string;
  annotations: import('./markup').PhotoMark[] | null;
  /** Migration 210; bản cũ của hàm chia sẻ không trả → coi như thực địa */
  survey_kind?: 'field' | 'online';
  verified_at?: string | null;
}
export interface SharedSurvey {
  label: string; provinces: string[]; expires_at: string | null;
  zones: SharedZone[]; trips: SharedTrip[]; photos: SharedPhoto[];
  /** Nhà trọ (migration 222): null / không có = link không kèm nhà trọ. Dòng thô → đọc bằng normLodging. */
  lodgings?: Record<string, unknown>[] | null;
  /** Link có cho xem tên + SĐT chủ nhà không */
  show_landlord?: boolean;
  /** Migration 227: mốc chốt số liệu (null / không có = tự cập nhật); follows = có theo dõi cả tỉnh / mọi KCN */
  data_until?: string | null;
  follows?: boolean;
}

export type OpenSurveyShareResult =
  | ({ ok: true } & SharedSurvey)
  | { ok: false; reason: SurveyShareFail; seconds?: number; remaining?: number };

export const openSurveyShare = (code: string, pin: string, count = true) =>
  rpc<OpenSurveyShareResult>('survey_share_open', { p_code: code, p_pin: pin, p_count: count });

export type SharedTracksResult =
  | { ok: true; chunks: TrackChunk[] }
  | { ok: false; reason: SurveyShareFail; seconds?: number; remaining?: number };

/** Vết GPS của các chuyến (chỉ chuyến thuộc KCN link cho phép, tối đa 60) → tripId → các đoạn đường (migration 211). */
export async function loadSharedTracks(code: string, pin: string, tripIds: readonly string[]): Promise<Map<string, TrackSegment[]>> {
  if (!tripIds.length) return new Map();
  const r = await rpc<SharedTracksResult>('survey_share_tracks', { p_code: code, p_pin: pin, p_trip_ids: tripIds });
  if (!r.ok) throw new Error(r.reason === 'expired' ? 'Link đã hết hạn' : 'Không tải được lộ trình');
  return groupChunks(r.chunks);
}
