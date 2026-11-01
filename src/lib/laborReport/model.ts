// ─────────────────────────────────────────────────────────────────────────────
// Báo cáo tổng quan lao động toàn hệ thống — BỘ TÍNH SỐ LIỆU (thuần, không gọi DB).
//
// Cùng một kết quả dùng cho cả bản PDF lẫn bản Markdown, nên mọi con số chỉ tính ở đây.
//
// Quy tắc (khớp các màn hình đang có):
//   • Nhãn tuần "TmWn" KHÔNG mang năm → suy năm từ created_at (lệch > 6 tháng thì ±1 năm),
//     rồi quy về Thứ 2 của tuần lịch thật. Nhờ vậy cửa sổ báo cáo được phép vắt qua năm.
//   • Số thật đã nhập luôn được tính (lịch sử lao động bất biến, kể cả khi KH ngưng sau đó).
//   • KH chưa nhập tuần/tháng đó → tạm lấy số gần nhất phía trước (ƯỚC TÍNH, có đánh dấu),
//     chỉ khi KH còn hợp tác trong tháng đó (isActiveInMonth: tháng chứa ngày ngưng vẫn tính).
//   • Số chốt tháng = số của tuần muộn nhất có nhập trong tháng (giống getMonthLast).
//   • Chi nhánh của KH tại từng tháng tra theo client_branch_history (chuyển chi nhánh thì
//     số cũ vẫn thuộc chi nhánh cũ); chưa có lịch sử → chi nhánh hiện tại (branch_id).
//   • Khu vực = tỉnh/thành của KCN (market_zones.location); KCN chưa có tỉnh → tỉnh của
//     chi nhánh. Tên tỉnh được chuẩn hoá ("TP. Đồng Nai" = "Đồng Nai").
// ─────────────────────────────────────────────────────────────────────────────
import type { Branch } from '../types';
import { weekInfoOf, mondayOf, laborEntryWeekKey } from '../format';
import { branchOf, resolveBranchByLegacyText } from '../branchRef';
import { isActiveInMonth } from '../../utils/suspension';
import { zoneKey } from '../zoneMatch';

// ─── Dữ liệu vào ─────────────────────────────────────────────────────────────

export interface LrClient {
  id: string;
  name: string;
  branch_id: string | null;
  region: string | null;
  industrial_zones: string[] | null;
  min_workers: number | null;
  service_type?: string | null;
  cooperation_status?: 'active' | 'suspended' | null;
  suspended_from?: string | null;
  suspended_at?: string | null;
}
export interface LrLaborEntry { client_id: string; week_label: string; count: number; created_at: string }
export interface LrBranchHistory { client_id: string; branch_id?: string | null; branch_name: string | null; effective_from: string }
export interface LrZone { name: string; location: string | null }

export interface LrInput {
  clients: LrClient[];
  labor: LrLaborEntry[];
  branches: Branch[];
  zones: LrZone[];
  branchHistory: LrBranchHistory[];
  now?: Date;
}

export type LrScope = { kind: 'all' } | { kind: 'branch'; id: string } | { kind: 'area'; key: string };

export interface LrOptions {
  /** Thứ 2 của tuần chốt báo cáo ('YYYY-MM-DD'); mặc định tuần hiện tại. */
  anchorWeek?: string;
  /** Số tuần trong biểu đồ theo tuần (mặc định 13 = 1 quý). */
  weeks?: number;
  /** Số tháng tối đa trong biểu đồ theo tháng (mặc định 12; tự cắt tháng đầu chưa có dữ liệu). */
  months?: number;
  scope?: LrScope;
}

// ─── Kết quả ─────────────────────────────────────────────────────────────────

export interface LrPeriod {
  key: string;        // tuần: Thứ 2 'YYYY-MM-DD' · tháng: 'YYYY-MM'
  label: string;      // "T10W5" · "T10/2026"
  short: string;      // nhãn trục ngắn: "T10W5" · "T10"
  range: string;      // "26/10–31/10" · "Tháng 10/2026"
  total: number | null;
  /** Số KH có số THẬT trong kỳ / số KH đóng góp vào tổng. */
  actualClients: number;
  contributingClients: number;
  coverage: number;   // actualClients / contributingClients (0..1)
}

export interface LrGroupRow {
  key: string;
  name: string;
  weekly: number[];
  monthly: number[];
  cur: number;        // tuần chốt
  prevWeek: number;
  curMonth: number;
  prevMonth: number;
  dWeek: number;
  dWeekPct: number | null;
  dMonth: number;
  dMonthPct: number | null;
  share: number;      // tỷ trọng trong tổng tuần chốt (0..1)
  clients: number;    // số KH có LĐ > 0 ở tuần chốt
}

export interface LrClientRow {
  id: string;
  name: string;
  branch: string;
  area: string;
  kcn: string;
  cur: number | null;
  curEstimated: boolean;
  prevWeek: number | null;
  curMonth: number | null;
  prevMonth: number | null;
  dWeek: number | null;
  dMonth: number | null;
  /** Số chốt các tháng trong cửa sổ (khớp `months`). */
  monthly: (number | null)[];
  minWorkers: number;
  lastActualLabel: string | null;
  weeksStale: number | null;
}

export interface LrBridge {
  start: number;
  newClients: number;
  increase: number;
  decrease: number;
  lost: number;
  end: number;
  newList: { name: string; value: number }[];
  lostList: { name: string; value: number }[];
}

export interface LrKpis {
  total: number | null;
  prevWeek: number | null;
  dWeek: number | null;
  dWeekPct: number | null;
  fourWeeksAgo: number | null;
  d4Week: number | null;
  d4WeekPct: number | null;
  curMonth: number | null;
  prevMonth: number | null;
  dMonth: number | null;
  dMonthPct: number | null;
  firstMonth: number | null;
  dFirstMonth: number | null;
  dFirstMonthPct: number | null;
  activeClients: number;
  avgPerClient: number | null;
  branchCount: number;
  areaCount: number;
  peak: { label: string; value: number } | null;
  trough: { label: string; value: number } | null;
  commitTotal: number;
  commitMet: number;
  commitGap: number;
  coverage: number;
  actualClients: number;
  contributingClients: number;
}

export interface LaborReport {
  generatedAt: Date;
  scopeLabel: string;
  anchor: LrPeriod;
  anchorMonthLabel: string;
  prevMonthLabel: string | null;
  weeks: LrPeriod[];
  months: LrPeriod[];
  kpis: LrKpis;
  branches: LrGroupRow[];
  areas: LrGroupRow[];
  kcns: LrGroupRow[];
  clients: LrClientRow[];
  monthBridge: LrBridge | null;
  weekBridge: LrBridge | null;
  commitShortfall: { name: string; branch: string; cur: number; min: number; gap: number }[];
  stale: { name: string; branch: string; lastLabel: string; weeks: number; value: number }[];
  insights: string[];
  notes: string[];
}

// ─── Tiện ích thời gian ──────────────────────────────────────────────────────

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export function weekKeyOf(d: Date): string { return isoDate(mondayOf(d)); }

export function addWeeks(key: string, n: number): string {
  const d = parseIso(key);
  d.setDate(d.getDate() + n * 7);
  return isoDate(d);
}

/** Tháng ('YYYY-MM') mà tuần thuộc về — theo ngày Thứ 5 (cùng quy tắc nhãn TmWn). */
export function weekMonth(key: string): string {
  const info = weekInfoOf(parseIso(key));
  return `${info.year}-${pad2(info.month)}`;
}

export function weekLabel(key: string): string { return weekInfoOf(parseIso(key)).label; }

export function weekRange(key: string): string {
  const mon = parseIso(key);
  const sat = new Date(mon); sat.setDate(sat.getDate() + 5);
  return `${mon.getDate()}/${mon.getMonth() + 1}–${sat.getDate()}/${sat.getMonth() + 1}`;
}

export function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export const monthShort = (month: string) => `T${Number(month.split('-')[1])}/${month.split('-')[0]}`;

/** Thứ 2 của bản ghi lao động (suy năm từ created_at) — dùng chung với số LĐ hiện tại của app. */
export const entryWeekKey = laborEntryWeekKey;

// ─── Chuẩn hoá khu vực ───────────────────────────────────────────────────────

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

/** "TP. Đồng Nai" / "Đồng Nai" → cùng 1 khu vực. Trả { key, name } hoặc null. */
export function normalizeArea(raw: string | null | undefined): { key: string; name: string } | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const stripped = s.replace(/^(tp\.?|thành phố|tỉnh)\s*/i, '').trim();
  if (!stripped) return null;
  const key = fold(stripped);
  const name = key === 'ho chi minh' ? 'TP. Hồ Chí Minh' : stripped;
  return { key, name };
}

export const NO_BRANCH = { key: '__none', name: 'Chưa gán chi nhánh' };
export const NO_AREA = { key: '__none', name: 'Chưa xác định' };
export const NO_KCN = { key: '__none', name: 'Chưa gán KCN' };

// ─── Bộ tính chính ───────────────────────────────────────────────────────────

interface Val { v: number; est: boolean }

interface ClientCtx {
  c: LrClient;
  keys: string[];                 // các tuần có số thật, tăng dần
  counts: Map<string, number>;    // tuần → số thật
  area: { key: string; name: string };
  kcn: { key: string; name: string };
  history: LrBranchHistory[];     // tăng dần theo effective_from
}

export const pct = (d: number, base: number | null | undefined): number | null =>
  base != null && base > 0 ? (d / base) * 100 : null;

export function buildLaborReport(input: LrInput, opts: LrOptions = {}): LaborReport {
  const now = input.now ?? new Date();
  const scope: LrScope = opts.scope ?? { kind: 'all' };
  const anchorKey = opts.anchorWeek ?? weekKeyOf(now);
  const nWeeks = Math.max(4, Math.min(52, opts.weeks ?? 13));
  const nMonths = Math.max(2, Math.min(24, opts.months ?? 12));

  // ── Tra cứu chi nhánh / KCN ──
  const branchById = new Map(input.branches.map(b => [b.id, b]));
  const zoneLoc = new Map<string, string>();
  for (const z of input.zones) if (z.location && zoneKey(z.name)) zoneLoc.set(zoneKey(z.name), z.location);

  const histByClient = new Map<string, LrBranchHistory[]>();
  for (const h of input.branchHistory) (histByClient.get(h.client_id) ?? histByClient.set(h.client_id, []).get(h.client_id)!).push(h);
  for (const list of histByClient.values()) list.sort((a, b) => a.effective_from.localeCompare(b.effective_from));

  const branchRef = (b: Branch | null | undefined) => (b ? { key: b.id, name: b.name?.trim() || '—' } : NO_BRANCH);

  // ── Chuẩn bị từng khách hàng ──
  const ctxs: ClientCtx[] = [];
  const entriesByClient = new Map<string, { key: string; count: number; created: string }[]>();
  for (const e of input.labor) {
    const key = entryWeekKey(e);
    if (!key || !Number.isFinite(Number(e.count))) continue;
    (entriesByClient.get(e.client_id) ?? entriesByClient.set(e.client_id, []).get(e.client_id)!)
      .push({ key, count: Number(e.count), created: e.created_at });
  }
  for (const c of input.clients) {
    const list = entriesByClient.get(c.id);
    if (!list?.length) continue;
    // Trùng tuần → lấy bản nhập sau cùng.
    const best = new Map<string, { count: number; created: string }>();
    for (const x of list) {
      const cur = best.get(x.key);
      if (!cur || x.created > cur.created) best.set(x.key, { count: x.count, created: x.created });
    }
    const keys = [...best.keys()].sort();
    const counts = new Map(keys.map(k => [k, best.get(k)!.count]));

    let area: { key: string; name: string } | null = null;
    for (const z of c.industrial_zones ?? []) {
      const loc = zoneLoc.get(zoneKey(z));
      area = normalizeArea(loc);
      if (area) break;
    }
    if (!area) area = normalizeArea(branchOf(c, input.branches)?.location);
    const firstZone = (c.industrial_zones ?? []).map(z => z?.trim()).find(Boolean);
    ctxs.push({
      c, keys, counts,
      area: area ?? NO_AREA,
      kcn: firstZone ? { key: zoneKey(firstZone) || firstZone, name: firstZone } : NO_KCN,
      history: histByClient.get(c.id) ?? [],
    });
  }

  const branchAt = (x: ClientCtx, month: string) => {
    let applicable: LrBranchHistory | null = null;
    for (const h of x.history) if (h.effective_from <= month) applicable = h;
    if (applicable) {
      const b = (applicable.branch_id ? branchById.get(applicable.branch_id) : null)
        ?? resolveBranchByLegacyText(applicable.branch_name, input.branches);
      if (b) return branchRef(b);
    }
    return branchRef(branchOf(x.c, input.branches));
  };

  const inScope = (x: ClientCtx, month: string) => {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'branch') return branchAt(x, month).key === scope.id;
    return x.area.key === scope.key;
  };

  // Số của KH tại 1 tuần: số thật, hoặc số gần nhất trước đó (ước tính) nếu KH còn hợp tác tháng đó.
  const valueAtWeek = (x: ClientCtx, key: string): Val | null => {
    const actual = x.counts.get(key);
    if (actual !== undefined) return { v: actual, est: false };
    let last: string | null = null;
    for (const k of x.keys) { if (k < key) last = k; else break; }
    if (!last) return null;
    if (!isActiveInMonth(x.c, weekMonth(key))) return null;
    return { v: x.counts.get(last)!, est: true };
  };

  // Số chốt tháng: tuần muộn nhất có số thật trong tháng (không vượt tuần chốt); không có → số gần nhất trước đó.
  const valueAtMonth = (x: ClientCtx, month: string, cutoff: string): Val | null => {
    let inMonth: string | null = null, before: string | null = null;
    for (const k of x.keys) {
      if (k > cutoff) break;
      const km = weekMonth(k);
      if (km === month) inMonth = k;
      else if (km < month) before = k;
    }
    if (inMonth) return { v: x.counts.get(inMonth)!, est: false };
    if (!before || !isActiveInMonth(x.c, month)) return null;
    return { v: x.counts.get(before)!, est: true };
  };

  // ── Cửa sổ tuần ──
  const weekKeys = Array.from({ length: nWeeks }, (_, i) => addWeeks(anchorKey, i - nWeeks + 1));
  const anchorMonth = weekMonth(anchorKey);

  // ── Cửa sổ tháng (kết thúc ở tháng của tuần chốt) ──
  const lastWeekOfMonth = (month: string): string => {
    // Tuần cuối của tháng = tuần chứa ngày cuối tháng nếu Thứ 5 của nó còn trong tháng, ngược lại lùi 1 tuần.
    const [y, m] = month.split('-').map(Number);
    let k = weekKeyOf(new Date(y, m, 0));
    if (weekMonth(k) !== month) k = addWeeks(k, -1);
    return k < anchorKey ? k : anchorKey;
  };
  let monthKeys = Array.from({ length: nMonths }, (_, i) => shiftMonthKey(anchorMonth, i - nMonths + 1));

  type Agg = {
    total: number; any: boolean; actual: number; contributing: number;
    branch: Map<string, number>; area: Map<string, number>; kcn: Map<string, number>;
    perClient: Map<string, Val>;
  };
  const names = { branch: new Map<string, string>(), area: new Map<string, string>(), kcn: new Map<string, string>() };
  const aggregate = (month: string, pick: (x: ClientCtx) => Val | null): Agg => {
    const a: Agg = { total: 0, any: false, actual: 0, contributing: 0, branch: new Map(), area: new Map(), kcn: new Map(), perClient: new Map() };
    for (const x of ctxs) {
      if (!inScope(x, month)) continue;
      const val = pick(x);
      if (!val) continue;
      a.perClient.set(x.c.id, val);
      a.total += val.v; a.any = true; a.contributing++;
      if (!val.est) a.actual++;
      const br = branchAt(x, month);
      names.branch.set(br.key, br.name); names.area.set(x.area.key, x.area.name); names.kcn.set(x.kcn.key, x.kcn.name);
      a.branch.set(br.key, (a.branch.get(br.key) ?? 0) + val.v);
      a.area.set(x.area.key, (a.area.get(x.area.key) ?? 0) + val.v);
      a.kcn.set(x.kcn.key, (a.kcn.get(x.kcn.key) ?? 0) + val.v);
    }
    return a;
  };

  const weekAggs = weekKeys.map(k => aggregate(weekMonth(k), x => valueAtWeek(x, k)));
  let monthAggs = monthKeys.map(mo => aggregate(mo, x => valueAtMonth(x, mo, lastWeekOfMonth(mo))));
  // Bỏ các tháng đầu chưa có dữ liệu (tránh cột trống vô nghĩa), luôn giữ ≥ 2 tháng.
  const firstData = monthAggs.findIndex(a => a.any);
  if (firstData > 0) {
    const cut = Math.min(firstData, monthKeys.length - 2);
    monthKeys = monthKeys.slice(cut); monthAggs = monthAggs.slice(cut);
  }

  const toPeriod = (key: string, a: Agg, isWeek: boolean): LrPeriod => ({
    key,
    label: isWeek ? weekLabel(key) : monthShort(key),
    short: isWeek ? weekLabel(key) : `T${Number(key.split('-')[1])}`,
    range: isWeek ? weekRange(key) : `Tháng ${Number(key.split('-')[1])}/${key.split('-')[0]}`,
    total: a.any ? a.total : null,
    actualClients: a.actual,
    contributingClients: a.contributing,
    coverage: a.contributing ? a.actual / a.contributing : 0,
  });
  const weeks = weekKeys.map((k, i) => toPeriod(k, weekAggs[i], true));
  const months = monthKeys.map((k, i) => toPeriod(k, monthAggs[i], false));

  const W = weeks.length - 1, M = months.length - 1;
  const anchorAgg = weekAggs[W], prevWeekAgg = weekAggs[W - 1];
  const curMonthAgg = monthAggs[M], prevMonthAgg = M > 0 ? monthAggs[M - 1] : null;

  // ── Nhóm: chi nhánh / khu vực / KCN ──
  const groupRows = (dim: 'branch' | 'area' | 'kcn'): LrGroupRow[] => {
    const keys = new Set<string>();
    for (const a of [...weekAggs, ...monthAggs]) for (const [k, v] of a[dim]) if (v > 0) keys.add(k);
    const total = anchorAgg.total || 0;
    const rows = [...keys].map(key => {
      const weekly = weekAggs.map(a => a[dim].get(key) ?? 0);
      const monthly = monthAggs.map(a => a[dim].get(key) ?? 0);
      const cur = weekly[W], prevWeek = weekly[W - 1] ?? 0;
      const curMonth = monthly[M], prevMonth = M > 0 ? monthly[M - 1] : 0;
      let clients = 0;
      for (const x of ctxs) {
        const val = anchorAgg.perClient.get(x.c.id);
        if (!val || val.v <= 0) continue;
        const k = dim === 'branch' ? branchAt(x, anchorMonth).key : x[dim].key;
        if (k === key) clients++;
      }
      return {
        key, name: names[dim].get(key) ?? key, weekly, monthly, cur, prevWeek, curMonth, prevMonth,
        dWeek: cur - prevWeek, dWeekPct: pct(cur - prevWeek, prevWeek),
        dMonth: curMonth - prevMonth, dMonthPct: pct(curMonth - prevMonth, prevMonth),
        share: total > 0 ? cur / total : 0, clients,
      };
    });
    // Nhóm "chưa gán / chưa xác định" luôn xếp cuối.
    return rows.sort((a, b) => Number(a.key === '__none') - Number(b.key === '__none') || b.cur - a.cur || b.curMonth - a.curMonth || a.name.localeCompare(b.name, 'vi'));
  };
  const branches = groupRows('branch');
  const areas = groupRows('area');
  const kcns = groupRows('kcn');

  // ── Từng khách hàng ──
  const monthCutoffs = monthKeys.map(lastWeekOfMonth);
  const clientRows: LrClientRow[] = [];
  for (const x of ctxs) {
    if (!inScope(x, anchorMonth)) continue;
    const cur = valueAtWeek(x, anchorKey);
    const pw = valueAtWeek(x, weekKeys[W - 1]);
    const monthly = monthKeys.map((mo, i) => valueAtMonth(x, mo, monthCutoffs[i])?.v ?? null);
    if (!cur && monthly.every(v => v == null || v === 0)) continue;
    const cm = monthly[M], pm = M > 0 ? monthly[M - 1] : null;
    let lastActual: string | null = null;
    for (const k of x.keys) { if (k <= anchorKey) lastActual = k; else break; }
    clientRows.push({
      id: x.c.id, name: x.c.name, branch: branchAt(x, anchorMonth).name, area: x.area.name, kcn: x.kcn.name,
      cur: cur?.v ?? null, curEstimated: !!cur?.est,
      prevWeek: pw?.v ?? null, curMonth: cm, prevMonth: pm,
      dWeek: cur && pw ? cur.v - pw.v : null,
      dMonth: cm != null && pm != null ? cm - pm : null,
      monthly, minWorkers: Number(x.c.min_workers) || 0,
      lastActualLabel: lastActual ? `${weekLabel(lastActual)} (${weekRange(lastActual)})` : null,
      weeksStale: lastActual ? Math.round((parseIso(anchorKey).getTime() - parseIso(lastActual).getTime()) / (7 * 86400000)) : null,
    });
  }
  clientRows.sort((a, b) => a.branch.localeCompare(b.branch, 'vi') || (b.cur ?? 0) - (a.cur ?? 0) || a.name.localeCompare(b.name, 'vi'));
  const clientName = new Map(ctxs.map(x => [x.c.id, x.c.name]));

  // ── Cầu biến động: đầu kỳ → KH mới / tăng / giảm / KH về 0 → cuối kỳ ──
  const bridge = (prev: Agg | null | undefined, cur: Agg | null | undefined): LrBridge | null => {
    if (!prev || !cur || !prev.any || !cur.any) return null;
    const b: LrBridge = { start: prev.total, newClients: 0, increase: 0, decrease: 0, lost: 0, end: cur.total, newList: [], lostList: [] };
    const ids = new Set([...prev.perClient.keys(), ...cur.perClient.keys()]);
    for (const id of ids) {
      const p = prev.perClient.get(id)?.v ?? 0, c = cur.perClient.get(id)?.v ?? 0;
      if (p <= 0 && c > 0) { b.newClients += c; b.newList.push({ name: clientName.get(id) ?? '—', value: c }); }
      else if (p > 0 && c <= 0) { b.lost += p; b.lostList.push({ name: clientName.get(id) ?? '—', value: p }); }
      else if (c > p) b.increase += c - p;
      else if (c < p) b.decrease += p - c;
    }
    b.newList.sort((a, z) => z.value - a.value); b.lostList.sort((a, z) => z.value - a.value);
    return b;
  };
  const monthBridge = bridge(prevMonthAgg, curMonthAgg);
  const weekBridge = bridge(prevWeekAgg, anchorAgg);

  // ── Cam kết tối thiểu (min_workers) — không áp cho dịch vụ tuyển dụng ──
  const commitRows = clientRows.filter(r => r.minWorkers > 0 && r.cur != null && ctxs.find(x => x.c.id === r.id)?.c.service_type !== 'recruitment');
  const commitShortfall = commitRows
    .filter(r => (r.cur ?? 0) < r.minWorkers)
    .map(r => ({ name: r.name, branch: r.branch, cur: r.cur ?? 0, min: r.minWorkers, gap: r.minWorkers - (r.cur ?? 0) }))
    .sort((a, b) => b.gap - a.gap);

  // ── Dữ liệu cũ: KH đang được tính bằng số của ≥ 2 tuần trước ──
  const stale = clientRows
    .filter(r => r.curEstimated && r.weeksStale != null && r.weeksStale >= 2 && (r.cur ?? 0) > 0)
    .map(r => ({ name: r.name, branch: r.branch, lastLabel: r.lastActualLabel ?? '—', weeks: r.weeksStale!, value: r.cur ?? 0 }))
    .sort((a, b) => b.weeks - a.weeks || b.value - a.value);

  // ── KPI ──
  const total = weeks[W].total;
  const prevWeek = weeks[W - 1]?.total ?? null;
  const fourAgo = weeks[W - 4]?.total ?? null;
  const curMonth = months[M].total;
  const prevMonth = M > 0 ? months[M - 1].total : null;
  const firstMonth = months.find(m => m.total != null)?.total ?? null;
  const valued = weeks.filter(w => w.total != null) as (LrPeriod & { total: number })[];
  const peak = valued.length ? valued.reduce((a, b) => (b.total > a.total ? b : a)) : null;
  const trough = valued.length ? valued.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  const activeClients = clientRows.filter(r => (r.cur ?? 0) > 0).length;
  const diff = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null);

  const kpis: LrKpis = {
    total, prevWeek, dWeek: diff(total, prevWeek), dWeekPct: total != null ? pct(total - (prevWeek ?? 0), prevWeek) : null,
    fourWeeksAgo: fourAgo, d4Week: diff(total, fourAgo), d4WeekPct: total != null ? pct(total - (fourAgo ?? 0), fourAgo) : null,
    curMonth, prevMonth, dMonth: diff(curMonth, prevMonth), dMonthPct: curMonth != null ? pct(curMonth - (prevMonth ?? 0), prevMonth) : null,
    firstMonth, dFirstMonth: diff(curMonth, firstMonth), dFirstMonthPct: curMonth != null ? pct(curMonth - (firstMonth ?? 0), firstMonth) : null,
    activeClients,
    avgPerClient: activeClients && total != null ? total / activeClients : null,
    branchCount: branches.filter(b => b.cur > 0 && b.key !== '__none').length,
    areaCount: areas.filter(a => a.cur > 0 && a.key !== '__none').length,
    peak: peak ? { label: `${peak.label} (${peak.range})`, value: peak.total } : null,
    trough: trough ? { label: `${trough.label} (${trough.range})`, value: trough.total } : null,
    commitTotal: commitRows.length,
    commitMet: commitRows.length - commitShortfall.length,
    commitGap: commitShortfall.reduce((s, r) => s + r.gap, 0),
    coverage: weeks[W].coverage,
    actualClients: weeks[W].actualClients,
    contributingClients: weeks[W].contributingClients,
  };

  const scopeLabel = scope.kind === 'all'
    ? 'Toàn hệ thống'
    : scope.kind === 'branch'
      ? `Chi nhánh ${branchLabelById(input.branches, scope.id)}`
      : `Khu vực ${areas.find(a => a.key === scope.key)?.name ?? names.area.get(scope.key) ?? scope.key}`;

  const report: LaborReport = {
    generatedAt: now,
    scopeLabel,
    anchor: weeks[W],
    anchorMonthLabel: months[M].range,
    prevMonthLabel: M > 0 ? months[M - 1].range : null,
    weeks, months, kpis, branches, areas, kcns,
    clients: clientRows,
    monthBridge, weekBridge, commitShortfall, stale,
    insights: [],
    notes: [],
  };
  report.insights = buildInsights(report);
  report.notes = buildNotes(report, nWeeks);
  return report;
}

function branchLabelById(branches: Branch[], id: string): string {
  if (id === NO_BRANCH.key) return NO_BRANCH.name;
  return branches.find(b => b.id === id)?.name?.trim() || '—';
}

// ─── Định dạng số ────────────────────────────────────────────────────────────

export const fmtN = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('vi-VN'));
export const fmtSigned = (n: number | null | undefined) => (n == null ? '—' : n > 0 ? `+${fmtN(n)}` : n < 0 ? `−${fmtN(-n)}` : '0');
export const fmtPct = (p: number | null | undefined, digits = 1) => {
  if (p == null || !Number.isFinite(p)) return '—';
  const s = Math.abs(p).toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return p > 0.05 ? `+${s}%` : p < -0.05 ? `−${s}%` : `${s}%`;
};
export const fmtDateTime = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export const fmtShare = (s: number) => `${(s * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

// ─── Nhận định tự động (dùng chung PDF + MD) ─────────────────────────────────

function trendWord(d: number | null): string {
  if (d == null) return 'không đổi';
  return d > 0 ? 'tăng' : d < 0 ? 'giảm' : 'không đổi';
}

function buildInsights(r: LaborReport): string[] {
  const k = r.kpis;
  const out: string[] = [];
  if (k.total != null) {
    let s = `Tổng lao động tuần ${r.anchor.label} (${r.anchor.range}) đạt **${fmtN(k.total)} người**`;
    if (k.dWeek != null) s += k.dWeek === 0 ? ', không đổi so với tuần trước' : `, ${trendWord(k.dWeek)} ${fmtN(Math.abs(k.dWeek))} (${fmtPct(k.dWeekPct)}) so với tuần trước`;
    if (k.d4Week != null && k.d4Week !== 0) s += ` và ${trendWord(k.d4Week)} ${fmtN(Math.abs(k.d4Week))} (${fmtPct(k.d4WeekPct)}) so với 4 tuần trước`;
    out.push(s + '.');
  }
  if (k.curMonth != null && k.prevMonth != null && r.prevMonthLabel) {
    out.push(`${r.anchorMonthLabel} chốt **${fmtN(k.curMonth)}**, ${k.dMonth === 0 ? 'không đổi' : `${trendWord(k.dMonth)} ${fmtN(Math.abs(k.dMonth ?? 0))} (${fmtPct(k.dMonthPct)})`} so với ${r.prevMonthLabel.toLowerCase()}.`);
  }
  if (r.monthBridge && (r.monthBridge.newClients || r.monthBridge.lost)) {
    const b = r.monthBridge;
    const parts: string[] = [];
    if (b.newList.length) parts.push(`${b.newList.length} KH mới/chuyển đến mang thêm ${fmtN(b.newClients)} LĐ`);
    if (b.lostList.length) parts.push(`${b.lostList.length} KH về 0/ngưng làm mất ${fmtN(b.lost)} LĐ`);
    out.push(`Trong tháng: ${parts.join('; ')}; KH hiện hữu tăng ${fmtN(b.increase)} và giảm ${fmtN(b.decrease)}.`);
  }
  const movers = r.branches.filter(b => b.key !== '__none' && (b.curMonth > 0 || b.prevMonth > 0));
  const up = [...movers].sort((a, b) => b.dMonth - a.dMonth)[0];
  const down = [...movers].sort((a, b) => a.dMonth - b.dMonth)[0];
  if (up && up.dMonth > 0) out.push(`Chi nhánh tăng mạnh nhất trong tháng: **${up.name}** (${fmtSigned(up.dMonth)}, ${fmtPct(up.dMonthPct)}).`);
  if (down && down.dMonth < 0) out.push(`Chi nhánh giảm nhiều nhất trong tháng: **${down.name}** (${fmtSigned(down.dMonth)}, ${fmtPct(down.dMonthPct)}).`);
  const top = r.branches.filter(b => b.key !== '__none')[0];
  if (top && top.cur > 0) out.push(`Chi nhánh lớn nhất: **${top.name}** với ${fmtN(top.cur)} LĐ (${fmtShare(top.share)} toàn bộ).`);
  const areaTop = r.areas.filter(a => a.key !== '__none' && a.cur > 0);
  if (areaTop.length) {
    out.push(`Khu vực: ${areaTop.slice(0, 3).map(a => `${a.name} ${fmtShare(a.share)}`).join(' · ')}${areaTop.length > 3 ? ` · ${areaTop.length - 3} khu vực khác` : ''}.`);
  }
  if (k.peak && k.trough && k.peak.value !== k.trough.value) {
    out.push(`Trong ${r.weeks.length} tuần: cao nhất ${fmtN(k.peak.value)} ở ${k.peak.label}, thấp nhất ${fmtN(k.trough.value)} ở ${k.trough.label}.`);
  }
  if (k.commitTotal) {
    out.push(k.commitGap > 0
      ? `${k.commitMet}/${k.commitTotal} KH đạt mức cam kết tối thiểu; ${k.commitTotal - k.commitMet} KH còn thiếu tổng **${fmtN(k.commitGap)} LĐ**.`
      : `Toàn bộ ${k.commitTotal} KH có cam kết đều đạt mức lao động tối thiểu.`);
  }
  if (k.contributingClients) {
    const est = k.contributingClients - k.actualClients;
    out.push(est > 0
      ? `Độ phủ số liệu tuần chốt: ${k.actualClients}/${k.contributingClients} KH đã nhập số thật (${fmtShare(k.coverage)}); ${est} KH đang dùng số gần nhất.`
      : `Độ phủ số liệu tuần chốt: 100% KH đã nhập số thật.`);
  }
  return out;
}

function buildNotes(r: LaborReport, nWeeks: number): string[] {
  return [
    `Số tuần = tổng số lao động của các khách hàng trong tuần (Thứ 2 → Thứ 7). Cửa sổ ${nWeeks} tuần, kết thúc ở tuần chốt ${r.anchor.label} (${r.anchor.range}).`,
    'Số tháng = số của tuần muộn nhất có nhập trong tháng (số chốt tháng). Tháng của tuần lấy theo ngày Thứ 5 của tuần đó.',
    'KH chưa nhập số trong tuần/tháng → tạm dùng số gần nhất trước đó (ƯỚC TÍNH), chỉ khi KH còn hợp tác trong tháng đó. Điểm có dưới 50% KH nhập số thật được vẽ rỗng (○).',
    'KH ngưng hợp tác: vẫn tính tới hết tháng ngưng; số đã nhập trước đó giữ nguyên (lịch sử không bị xoá).',
    'Chi nhánh theo lịch sử chuyển chi nhánh của từng KH tại từng tháng; khu vực theo tỉnh/thành của KCN chính (chưa có thì theo tỉnh của chi nhánh).',
    'KH mới/chuyển đến = tháng trước 0 hoặc chưa có số, tháng này > 0. KH về 0/ngưng = tháng trước > 0, tháng này 0 hoặc đã ngưng.',
  ];
}

// ─── Danh sách tuần cho ô chọn "Tuần chốt" ──────────────────────────────────

export interface LrWeekOption { key: string; label: string; range: string; coverage: number; actual: number; contributing: number }

/** `n` tuần gần nhất (mới nhất trước) kèm độ phủ số thật — để người dùng chọn tuần chốt có đủ số liệu. */
export function weekOptions(input: LrInput, n = 26, scope?: LrScope): LrWeekOption[] {
  const now = input.now ?? new Date();
  const cur = weekKeyOf(now);
  const r = buildLaborReport(input, { anchorWeek: cur, weeks: Math.max(4, n), months: 2, scope });
  return [...r.weeks].reverse().map(w => ({
    key: w.key, label: w.label, range: w.range, coverage: w.coverage, actual: w.actualClients, contributing: w.contributingClients,
  }));
}

/** Danh sách khu vực (để chọn phạm vi báo cáo). */
export function areaOptions(input: LrInput): { key: string; name: string }[] {
  const r = buildLaborReport(input, { weeks: 4, months: 2 });
  return r.areas.filter(a => a.key !== '__none').map(a => ({ key: a.key, name: a.name }));
}
