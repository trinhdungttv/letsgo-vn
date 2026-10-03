// Phương án giá — gợi ý "học" từ các phương án ĐÃ LƯU: cùng KCN + cùng ngành là sát nhất.
// Không có máy học gì ở đây: chỉ là so khớp tên ngành/KCN, rồi gom các khoản mục hay lặp lại.

import { computePlan, normalizePlanData } from './engine';
import { lineKey, normalizeText } from './presets';
import type { CostLine, CostPlanRow } from './types';

export type MatchLevel = 'zone_industry' | 'industry' | 'zone';

export const MATCH_LABEL: Record<MatchLevel, string> = {
  zone_industry: 'Cùng KCN + ngành',
  industry: 'Cùng ngành',
  zone: 'Cùng KCN',
};

const sameText = (a: string | null | undefined, b: string | null | undefined) => {
  const x = normalizeText(a), y = normalizeText(b);
  return !!x && x === y;
};

export interface PlanMatch { plan: CostPlanRow; level: MatchLevel }

const LEVEL_RANK: Record<MatchLevel, number> = { zone_industry: 0, industry: 1, zone: 2 };

/** Phương án đã lưu có liên quan tới (ngành, KCN) hiện tại. Mức khớp cao xếp trước; cùng mức: đã chốt trước, rồi mới sửa gần đây. */
export function matchPlans(
  plans: CostPlanRow[],
  q: { industry?: string | null; zone?: string | null; excludeId?: string | null },
  limit = 6,
): PlanMatch[] {
  const out: PlanMatch[] = [];
  for (const plan of plans) {
    if (plan.id === q.excludeId || plan.status === 'archived') continue;
    const si = sameText(plan.industry, q.industry);
    const sz = sameText(plan.zone_name, q.zone);
    const level: MatchLevel | null = si && sz ? 'zone_industry' : si ? 'industry' : sz ? 'zone' : null;
    if (level) out.push({ plan, level });
  }
  out.sort((a, b) =>
    LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
    || Number(b.plan.status === 'final') - Number(a.plan.status === 'final')
    || b.plan.updated_at.localeCompare(a.plan.updated_at));
  return out.slice(0, limit);
}

export interface LineSuggestion {
  key: string;
  /** Dòng mẫu (lấy từ phương án gần nhất có khoản này) — đã sẵn số tiền/công thức */
  line: CostLine;
  /** Số phương án CÙNG NGÀNH có khoản này */
  count: number;
  /** Trong đó số phương án cùng KCN */
  zoneCount: number;
  avgDaily: number;
  fromTitles: string[];
}

/**
 * Khoản mục các phương án cùng ngành hay dùng mà phương án hiện tại CHƯA có.
 * Bỏ qua dòng lương cơ bản / phí DV (luôn có sẵn, không phải "khoản thêm").
 */
export function suggestLines(
  plans: CostPlanRow[],
  q: { industry?: string | null; zone?: string | null; excludeId?: string | null; currentLines: CostLine[] },
  limit = 8,
): LineSuggestion[] {
  if (!normalizeText(q.industry)) return [];
  const have = new Set(q.currentLines.map(l => lineKey(l.name)));
  const groups = new Map<string, { line: CostLine; at: string; dailies: number[]; plans: Set<string>; zonePlans: Set<string>; titles: string[] }>();

  const pool = plans
    .filter(p => p.id !== q.excludeId && p.status !== 'archived' && sameText(p.industry, q.industry))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  for (const plan of pool) {
    const data = normalizePlanData(plan.data);
    const res = computePlan(data);
    const inZone = sameText(plan.zone_name, q.zone);
    for (const l of data.lines) {
      if (l.isBaseWage || l.isServiceFee) continue;
      const k = lineKey(l.name);
      if (!k || have.has(k)) continue;
      const daily = res.lines[l.id]?.daily ?? 0;
      let g = groups.get(k);
      if (!g) {
        g = { line: l, at: plan.updated_at, dailies: [], plans: new Set(), zonePlans: new Set(), titles: [] };
        groups.set(k, g);
      }
      // pool đã sắp mới → nhất → cũ, nên dòng mẫu đầu tiên gặp là của phương án gần nhất
      if (!g.plans.has(plan.id)) { g.plans.add(plan.id); g.titles.push(plan.title); }
      if (inZone) g.zonePlans.add(plan.id);
      if (daily > 0) g.dailies.push(daily);
    }
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      line: { ...g.line, id: Math.random().toString(36).slice(2, 10) },
      count: g.plans.size,
      zoneCount: g.zonePlans.size,
      avgDaily: g.dailies.length ? g.dailies.reduce((a, b) => a + b, 0) / g.dailies.length : 0,
      fromTitles: g.titles.slice(0, 3),
    }))
    .sort((a, b) => b.zoneCount - a.zoneCount || b.count - a.count || b.avgDaily - a.avgDaily)
    .slice(0, limit);
}

export interface RangeStat { n: number; min: number; avg: number; max: number }

const stat = (xs: number[]): RangeStat | null => {
  const v = xs.filter(x => Number.isFinite(x) && x > 0);
  if (!v.length) return null;
  return { n: v.length, min: Math.min(...v), avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) };
};

export interface Benchmark {
  quote: RangeStat | null;
  fee: RangeStat | null;
  baseWage: RangeStat | null;
  scope: 'zone_industry' | 'industry' | null;
}

/** Mặt bằng giá từ chính các phương án đã lưu — ưu tiên cùng KCN+ngành, nếu chưa có thì cùng ngành. */
export function benchmarkFromPlans(
  plans: CostPlanRow[],
  q: { industry?: string | null; zone?: string | null; excludeId?: string | null },
): Benchmark {
  const usable = plans.filter(p => p.id !== q.excludeId && p.status !== 'archived' && p.summary && sameText(p.industry, q.industry));
  const inZone = usable.filter(p => sameText(p.zone_name, q.zone));
  const scope = inZone.length ? 'zone_industry' as const : usable.length ? 'industry' as const : null;
  const pool = scope === 'zone_industry' ? inZone : usable;
  return {
    scope,
    quote: stat(pool.map(p => p.summary!.quoteDaily)),
    fee: stat(pool.map(p => p.summary!.serviceFeeDaily)),
    baseWage: stat(pool.map(p => p.summary!.baseWageMonthly)),
  };
}
