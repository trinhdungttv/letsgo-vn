// Bảng chỉ tiêu nhà máy × tháng: dựng ma trận Kế hoạch vs Thực tế + đọc bảng dán từ Excel/PDF.
// File thuần (không React, không DB).
import { foldVn } from './normalize';
import type { HireCount, RecruitPosition, RecruitSite, RecruitTarget, ScheduledCount } from './types';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Các tháng từ `from` tới `to` (gồm cả 2 đầu), tối đa 36 tháng. Thiếu / sai → []. */
export function monthRange(from: string | null | undefined, to: string | null | undefined): string[] {
  if (!from || !MONTH_RE.test(from)) return [];
  const end = to && MONTH_RE.test(to) && to >= from ? to : from;
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  while (out.length < 36) {
    const cur = `${y}-${String(m).padStart(2, '0')}`;
    out.push(cur);
    if (cur >= end) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** '2026-11' → 'T11/26' (như bảng KH gửi). */
export const monthLabel = (month: string): string => {
  const [y, m] = month.split('-');
  return `T${Number(m)}/${y.slice(2)}`;
};

/** Tháng của 1 ngày 'YYYY-MM-DD'. */
export const monthOf = (date: string | null | undefined): string | null => (date && date.length >= 7 ? date.slice(0, 7) : null);

export interface PlanCell {
  target: number;
  /** có ô nào KH đã xác nhận */
  confirmed: boolean;
  started: number;
  /** đã hẹn ngày nhận việc trong tháng (đang Chờ nhận việc) */
  scheduled: number;
}

export interface PlanRow {
  siteId: string;
  siteName: string;
  cells: Record<string, PlanCell>;
  total: PlanCell;
}

export interface PlanMatrix {
  months: string[];
  rows: PlanRow[];
  totals: Record<string, PlanCell>;
  grand: PlanCell;
  /** chỉ tiêu của các vị trí khảo sát (chưa xác nhận nhu cầu) — KHÔNG cộng vào tổng */
  surveyQty: number;
}

const emptyCell = (): PlanCell => ({ target: 0, confirmed: false, started: 0, scheduled: 0 });
const add = (a: PlanCell, b: PlanCell): PlanCell => ({
  target: a.target + b.target,
  confirmed: a.confirmed || b.confirmed,
  started: a.started + b.started,
  scheduled: a.scheduled + b.scheduled,
});

/**
 * Ma trận Kế hoạch vs Thực tế của 1 dự án. `positionId`: undefined = mọi vị trí; null = chỉ phần
 * "chưa chia vị trí"; id = 1 vị trí. Người đi làm ở tháng ngoài khoảng dự án vẫn được cộng vào cột tổng.
 */
export function buildPlanMatrix(input: {
  months: string[];
  sites: RecruitSite[];
  positions: RecruitPosition[];
  targets: RecruitTarget[];
  hires: HireCount[];
  scheduled?: ScheduledCount[];
  positionId?: string | null;
}): PlanMatrix {
  const { months, sites, positions, targets, hires, scheduled = [], positionId } = input;
  const survey = new Set(positions.filter(p => !p.confirmed).map(p => p.id));
  const posMatch = (pid: string | null) => positionId === undefined || pid === positionId;

  let surveyQty = 0;
  const rows: PlanRow[] = sites.map(site => {
    const cells: Record<string, PlanCell> = Object.fromEntries(months.map(m => [m, emptyCell()]));
    const total = emptyCell();
    for (const t of targets) {
      if (t.site_id !== site.id || t.status === 'cancelled' || !posMatch(t.position_id)) continue;
      if (t.position_id && survey.has(t.position_id)) { surveyQty += t.qty; continue; }
      const c = cells[t.month];
      if (c) { c.target += t.qty; c.confirmed ||= t.status === 'confirmed'; }
      total.target += t.qty;
      total.confirmed ||= t.status === 'confirmed';
    }
    for (const h of hires) {
      if (h.site_id !== site.id || !posMatch(h.position_id)) continue;
      if (cells[h.month]) cells[h.month].started += h.started;
      total.started += h.started;
    }
    for (const s of scheduled) {
      if (s.site_id !== site.id || !posMatch(s.position_id)) continue;
      if (cells[s.month]) cells[s.month].scheduled += s.n;
      total.scheduled += s.n;
    }
    return { siteId: site.id, siteName: site.name, cells, total };
  });

  const totals: Record<string, PlanCell> = Object.fromEntries(months.map(m => [m, rows.reduce((acc, r) => add(acc, r.cells[m]), emptyCell())]));
  const grand = rows.reduce((acc, r) => add(acc, r.total), emptyCell());
  return { months, rows, totals, grand, surveyQty };
}

/** % hoàn thành (0–100+), null khi không có chỉ tiêu. */
export const pct = (done: number, target: number): number | null => (target > 0 ? Math.round((done / target) * 100) : null);
/** "37%" — có làm nhưng chưa tới 1% thì "<1%" (đừng hiện 0% khi đã có người đi làm). */
export const pctText = (done: number, target: number): string => {
  const p = pct(done, target);
  if (p === null) return '';
  return p === 0 && done > 0 ? '<1%' : `${p}%`;
};

/** Màu ô theo tiến độ: tháng đã qua mà thiếu = đỏ; tháng hiện tại = theo % ; tương lai = xám. */
export function cellTone(cell: PlanCell, month: string, currentMonth: string): 'done' | 'behind' | 'progress' | 'future' | 'none' {
  if (cell.target <= 0) return cell.started > 0 ? 'done' : 'none';
  if (cell.started >= cell.target) return 'done';
  if (month < currentMonth) return 'behind';
  if (month === currentMonth) return 'progress';
  return 'future';
}

// ── Đọc bảng chỉ tiêu dán vào (Excel / PDF / Word) ─────────────────────────
export interface ParsedPlan {
  months: string[];
  cells: { siteId: string; siteName: string; month: string; qty: number }[];
  unknownSites: string[];
  warnings: string[];
}

/** Số kiểu VN: "1.024" / "1,024" → 1024; "—", "-", "" → 0; không phải số → null. */
export function parseQty(token: string): number | null {
  const t = token.trim();
  if (t === '' || /^[—–\-−.]+$/.test(t)) return 0;
  if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(t)) return null;
  return Number(t.replace(/[.,]/g, ''));
}

/** Tháng trong dòng tiêu đề: "T11 /26", "T1/27", "11/2026", "Tháng 12/2026", "2026-11". */
export function parseHeaderMonths(line: string): string[] {
  const out: string[] = [];
  const re = /(?:T|Th[áa]ng\s*)?(\d{1,2})\s*\/\s*(\d{4}|\d{2})(?!\d)|(\d{4})-(\d{2})/gi;
  for (const m of line.matchAll(re)) {
    let y: number, mo: number;
    if (m[3]) { y = Number(m[3]); mo = Number(m[4]); }
    else { mo = Number(m[1]); y = Number(m[2].length === 2 ? `20${m[2]}` : m[2]); }
    if (mo >= 1 && mo <= 12) out.push(`${y}-${String(mo).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Đọc bảng dán vào. Có dòng tiêu đề chứa tháng thì theo tiêu đề; không có thì dùng `fallbackMonths`
 * (các tháng của dự án) theo thứ tự cột. Tên nhà máy so khớp không dấu với danh sách nhà máy của dự án.
 * Dòng "Tổng" bỏ qua; cột "Tổng" cuối dùng để đối chiếu (lệch thì báo).
 */
export function parsePlanGrid(text: string, sites: Pick<RecruitSite, 'id' | 'name'>[], fallbackMonths: string[]): ParsedPlan {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\u00a0/g, ' ').trim()).filter(Boolean);
  let months: string[] = [];
  let hasTotal = false;
  let noMonths = false;
  const warnings: string[] = [];
  const cells: ParsedPlan['cells'] = [];
  const unknownSites: string[] = [];
  const siteKeys = sites
    .map(s => ({ site: s, key: foldVn(s.name).split(/\s+/).filter(Boolean) }))
    .sort((a, b) => b.key.length - a.key.length);

  for (const line of lines) {
    const headerMonths = parseHeaderMonths(line);
    if (headerMonths.length >= 2) {
      months = headerMonths;
      // có cột "Tổng" sau tháng cuối?
      const afterLast = foldVn(line).split(/\d{1,2}\s*\/\s*\d{2,4}|\d{4}-\d{2}/).pop() ?? '';
      hasTotal = /tong|total/.test(afterLast);
      continue;
    }
    const tokens = line.split(/\s+/).filter(Boolean);
    const folded = tokens.map(t => foldVn(t));
    if (/^(tong|total)$/.test(folded[0] ?? '')) continue;
    const useMonths = months.length ? months : fallbackMonths;
    if (!useMonths.length) { noMonths = true; continue; }

    // Tách tên nhà máy: ưu tiên khớp tên có sẵn ở đầu dòng; không khớp thì lấy phần trước các cột số cuối.
    const hit = siteKeys.find(k => k.key.length > 0 && k.key.length < tokens.length && k.key.every((w, i) => folded[i] === w));
    let nameTokens: string[];
    let valueTokens: string[];
    if (hit) {
      nameTokens = tokens.slice(0, hit.key.length);
      valueTokens = tokens.slice(hit.key.length);
    } else {
      const want = useMonths.length + (hasTotal ? 1 : 0);
      if (tokens.length <= want) continue;
      nameTokens = tokens.slice(0, tokens.length - want);
      valueTokens = tokens.slice(tokens.length - want);
    }
    const nums = valueTokens.map(parseQty);
    if (nums.every(n => n === null)) continue; // dòng chữ (ghi chú, tiêu đề phụ)
    if (nums.some(n => n === null) || nums.length < useMonths.length) {
      warnings.push(`Dòng "${line}" không đọc được số`);
      continue;
    }
    const site = hit?.site ?? null;
    if (!site) { unknownSites.push(nameTokens.join(' ')); continue; }
    const qtys = nums.slice(0, useMonths.length) as number[];
    useMonths.forEach((m, i) => cells.push({ siteId: site.id, siteName: site.name, month: m, qty: qtys[i] }));
    if (nums.length > useMonths.length) {
      const total = nums[useMonths.length] as number;
      const sum = qtys.reduce((s, n) => s + n, 0);
      if (total !== sum) warnings.push(`${site.name}: cột Tổng ghi ${total.toLocaleString('vi-VN')} nhưng cộng các tháng = ${sum.toLocaleString('vi-VN')}`);
    }
  }
  if (!cells.length && noMonths) warnings.push('Chưa có tháng: dán kèm dòng tiêu đề (T11/26 …) hoặc đặt "Từ tháng – Đến tháng" cho dự án');
  return { months: months.length ? months : fallbackMonths, cells, unknownSites, warnings };
}
