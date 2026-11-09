// ============================================================================
// Gợi ý ghép ĐƠN VỊ NGUỒN ↔ CÔNG TY theo 4 tiêu chí Tony chọn (09/11):
//   1. Ngành đào tạo khớp ngành công ty (35 điểm)  — ngành đào tạo gắn industries.id ↔ ngành của công ty.
//   2. Khoảng cách đường xe khách (25 điểm)         — trường tỉnh xa vẫn được ít điểm (SV ở lại KTX).
//   3. Kết quả các đợt trước (25 điểm)              — tỷ lệ đạt ở chính công ty đó, không có thì công ty cùng ngành.
//   4. Đúng mùa thực tập (15 điểm)                   — tháng SV đi thực tập trùng tháng cao điểm của ngành.
// Thiếu dữ liệu ở tiêu chí nào thì cho điểm "trung tính" (không phạt nặng) và ghi rõ lý do để người dùng bổ sung.
// ============================================================================
import { foldVn } from '../companyMatch';
import { haversineKm } from '../geo';
import type { SourceBatch } from './types';

export type ReasonTone = 'good' | 'warn' | 'bad' | 'muted';
export interface MatchReason { key: 'industry' | 'distance' | 'history' | 'season'; tone: ReasonTone; text: string }

export interface MatchCompany {
  type: 'client' | 'lead';
  id: string;
  name: string;
  industryId: string | null;
  industryName: string;
  zoneId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface MatchSource {
  id: string;
  lat: number | null;
  lng: number | null;
  /** Ngành công ty phù hợp của mọi ngành đào tạo (industries.id). */
  industryIds: ReadonlySet<string>;
  /** Tháng (1–12) có SV đi thực tập trong 12 tháng tới. */
  months: readonly number[];
}

export interface MatchRoute { distanceKm: number | null; durationMin: number | null }

export interface MatchContext {
  /** Mọi đợt (đã bỏ đợt xoá). */
  batches: readonly SourceBatch[];
  /** Ngành của công ty nhận trong 1 đợt (để tính "công ty cùng ngành"). */
  batchIndustry: (b: SourceBatch) => string | null;
  /** Lịch mùa vụ 12 tháng của ngành (industries.season_levels, 0 = chưa nhập). */
  seasonOf: (industryId: string) => readonly number[] | null;
}

export interface MatchResult {
  score: number;
  parts: { industry: number; distance: number; history: number; season: number };
  reasons: MatchReason[];
  /** Phút xe khách (đã tính hoặc ước tính). */
  durationMin: number | null;
  distanceKm: number | null;
  /** true = chưa tính đường thật, đang ước từ đường thẳng. */
  estimated: boolean;
}

export const MAX = { industry: 35, distance: 25, history: 25, season: 15 } as const;

const pct = (n: number) => `${Math.round(n * 100)}%`;
export const monthsLabel = (ms: readonly number[]) => ms.map(m => `T${m}`).join(', ');

/** Tổng gửi / đạt của các đợt (bỏ đợt huỷ, đợt chưa gửi ai). */
export function batchStats(batches: readonly SourceBatch[]): { count: number; sent: number; passed: number; rate: number | null } {
  let sent = 0;
  let passed = 0;
  let count = 0;
  for (const b of batches) {
    if (b.deleted_at || b.status === 'cancelled' || b.sent_count <= 0) continue;
    count += 1;
    sent += b.sent_count;
    passed += Math.min(b.passed_count, b.sent_count);
  }
  return { count, sent, passed, rate: sent > 0 ? passed / sent : null };
}

/** Phút xe khách ước từ đường thẳng khi chưa tính được đường thật (đường vòng ~1,3 lần, xe khách ~35 km/h). */
export function estimateBusMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): { km: number; min: number } {
  const km = haversineKm(a, b) * 1.3;
  return { km, min: (km / 35) * 60 };
}

function distancePart(min: number | null, noRoad: boolean, noCoords: boolean): { score: number; tone: ReasonTone; text: string } {
  if (noCoords) return { score: 8, tone: 'muted', text: 'Chưa có vị trí — dán link Google Maps để tính đường xe' };
  if (noRoad || min == null) return { score: 0, tone: 'bad', text: 'Không tìm được đường xe' };
  const t = Math.round(min);
  const dur = t < 60 ? `${t} phút` : `${Math.floor(t / 60)} giờ${t % 60 ? ` ${t % 60} phút` : ''}`;
  if (min <= 30) return { score: 25, tone: 'good', text: `Xe khách ~${dur} — rất gần` };
  if (min <= 60) return { score: 21, tone: 'good', text: `Xe khách ~${dur}` };
  if (min <= 90) return { score: 15, tone: 'warn', text: `Xe khách ~${dur}` };
  if (min <= 120) return { score: 10, tone: 'warn', text: `Xe khách ~${dur} — xa, cân nhắc xe đưa đón` };
  if (min <= 240) return { score: 5, tone: 'warn', text: `Xe khách ~${dur} — SV cần chỗ ở gần công ty` };
  return { score: 2, tone: 'bad', text: `Xe khách ~${dur} (tỉnh xa) — SV phải ở lại` };
}

export function scoreMatch(source: MatchSource, company: MatchCompany, route: MatchRoute | null, ctx: MatchContext): MatchResult {
  const reasons: MatchReason[] = [];

  // 1. Ngành
  let industry: number;
  if (!company.industryId) {
    industry = 12;
    reasons.push({ key: 'industry', tone: 'muted', text: company.industryName ? `Ngành "${company.industryName}" chưa có trong danh mục Ngành Nghề` : 'Công ty chưa ghi ngành' });
  } else if (source.industryIds.size === 0) {
    industry = 12;
    reasons.push({ key: 'industry', tone: 'muted', text: 'Trường chưa gắn ngành đào tạo với ngành công ty' });
  } else if (source.industryIds.has(company.industryId)) {
    industry = MAX.industry;
    reasons.push({ key: 'industry', tone: 'good', text: `Đào tạo đúng ngành ${company.industryName}` });
  } else {
    industry = 0;
    reasons.push({ key: 'industry', tone: 'bad', text: `Không có ngành đào tạo cho ${company.industryName}` });
  }

  // 2. Khoảng cách (đường xe khách)
  const hasCoords = source.lat != null && source.lng != null && company.lat != null && company.lng != null;
  let durationMin: number | null = null;
  let distanceKm: number | null = null;
  let estimated = false;
  let noRoad = false;
  if (hasCoords && route) {
    durationMin = route.durationMin;
    distanceKm = route.distanceKm;
    noRoad = route.distanceKm == null;
  } else if (hasCoords) {
    const e = estimateBusMinutes({ lat: source.lat!, lng: source.lng! }, { lat: company.lat!, lng: company.lng! });
    durationMin = e.min;
    distanceKm = e.km;
    estimated = true;
  }
  const d = distancePart(durationMin, noRoad, !hasCoords);
  reasons.push({ key: 'distance', tone: d.tone, text: estimated ? `${d.text} (ước tính, đang chờ tính đường)` : d.text });

  // 3. Kết quả các đợt trước
  const mine = ctx.batches.filter(b => b.source_id === source.id);
  const here = batchStats(mine.filter(b => (company.type === 'client' ? b.client_id : b.lead_id) === company.id));
  let history: number;
  if (here.rate != null) {
    history = Math.round(MAX.history * here.rate);
    reasons.push({ key: 'history', tone: here.rate >= 0.6 ? 'good' : here.rate >= 0.3 ? 'warn' : 'bad', text: `Đã gửi ${here.sent} SV vào công ty này, đạt ${here.passed} (${pct(here.rate)})` });
  } else {
    const same = company.industryId ? batchStats(mine.filter(b => ctx.batchIndustry(b) === company.industryId)) : { rate: null, sent: 0, passed: 0, count: 0 };
    if (same.rate != null) {
      history = Math.round(18 * same.rate);
      reasons.push({ key: 'history', tone: same.rate >= 0.6 ? 'good' : same.rate >= 0.3 ? 'warn' : 'bad', text: `Ở công ty cùng ngành: đạt ${same.passed}/${same.sent} (${pct(same.rate)})` });
    } else {
      history = 10;
      reasons.push({ key: 'history', tone: 'muted', text: 'Chưa có đợt nào để so' });
    }
  }

  // 4. Mùa thực tập ↔ mùa cao điểm của ngành
  let season: number;
  const levels = company.industryId ? ctx.seasonOf(company.industryId) : null;
  const hasSeason = !!levels && levels.some(v => v > 0);
  if (!source.months.length) {
    season = 5;
    reasons.push({ key: 'season', tone: 'muted', text: 'Chưa nhập lịch thực tập' });
  } else if (!hasSeason) {
    season = 8;
    reasons.push({ key: 'season', tone: 'muted', text: `SV đi thực tập ${monthsLabel(source.months)} · ngành chưa có lịch mùa vụ` });
  } else {
    const peak = source.months.filter(m => (levels![m - 1] ?? 0) >= 4);
    const normal = source.months.filter(m => (levels![m - 1] ?? 0) === 3);
    const peakAll = levels!.map((v, i) => (v >= 4 ? i + 1 : 0)).filter(Boolean);
    if (peak.length) {
      season = MAX.season;
      reasons.push({ key: 'season', tone: 'good', text: `SV đi ${monthsLabel(peak)} — đúng cao điểm ngành` });
    } else if (normal.length) {
      season = 9;
      reasons.push({ key: 'season', tone: 'warn', text: `SV đi ${monthsLabel(normal)} — nhu cầu ngành bình thường` });
    } else {
      season = 2;
      reasons.push({ key: 'season', tone: 'bad', text: `Lệch mùa: SV đi ${monthsLabel(source.months)}${peakAll.length ? `, ngành cao điểm ${monthsLabel(peakAll)}` : ''}` });
    }
  }

  return {
    score: industry + d.score + history + season,
    parts: { industry, distance: d.score, history, season },
    reasons, durationMin, distanceKm, estimated,
  };
}

/** Tìm ngành trong danh mục theo tên (bỏ dấu, hoa/thường). */
export function industryIdByName(name: string | null | undefined, industries: readonly { id: string; name: string }[]): string | null {
  const k = foldVn(name ?? '').replace(/\s+/g, ' ').trim();
  if (!k) return null;
  return industries.find(i => foldVn(i.name).replace(/\s+/g, ' ').trim() === k)?.id ?? null;
}

/** Màu theo điểm (thang 100). */
export function scoreTone(score: number): ReasonTone {
  return score >= 70 ? 'good' : score >= 45 ? 'warn' : 'bad';
}
