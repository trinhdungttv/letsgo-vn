// KHO ĐẦU MỤC: danh mục các loại dòng để chọn khi bấm "Thêm dòng" (bảng giá) / "Thêm khoản" (bảng chi phí) — khỏi đặt tên /
// tính lại mỗi lần, và là MÃ QUY CHIẾU chung (QuoteRowCfg.catalogId, CostLine.catalogId) để so sánh cùng hạng mục giữa các dự án.
//   • Kho CÓ SẴN (catalogData.ts): bộ danh mục chuẩn chia 5 nhóm; mục nào dùng được ở bảng chi phí thì có `cost`.
//   • Kho CỦA CÔNG TY: mục tự thêm + mục có sẵn đã sửa / ẩn / sắp lại (app_settings, không cần migration).
import { supabase } from '../supabase';
import { INSURANCE_CAP_MONTHLY, newLine, newLineId } from './engine';
import { cleanCalc, rowCatalogRef } from './quoteSheet';
import {
  BUILTIN_BY_ID, BUILTIN_CATALOG, CATALOG_GROUPS, LEGACY_BUILTIN, builtinRefByName, foldName, normName as norm,
  type CatalogCost, type CatalogGroup, type CatalogItem,
} from './catalogData';
import type { CostLine, QuoteRowCfg, QuoteSheet, RowCalc } from './types';

export {
  BUILTIN_CATALOG, CATALOG_GROUPS, CATALOG_GROUP_LABEL, CATALOG_GROUP_SHORT, COST_SECTION_LABEL, builtinRefByName, foldName,
  type CatalogCost, type CatalogGroup, type CatalogItem, type CostSection,
} from './catalogData';


/** Nhóm đoán theo tên (mục tự thêm ở kho cũ, dán nhiều mục). */
export function guessGroup(name: string): CatalogGroup {
  const f = ` ${foldName(name)} `;
  if (/ bhxh | bhyt | bhtn| bao hiem | kham suc khoe | doc hai /.test(f)) return 'insurance';
  if (/ thuong | phi dich vu | dong phuc | tru luong | khau tru | hoa hong | chia se loi nhuan /.test(f)) return 'fee';
  if (/ phu cap | ho tro | tien an | xang xe /.test(f)) return 'allowance';
  if (/ tang ca | chu nhat | le | tet /.test(f)) return 'overtime';
  if (/ luong | ca | gio | boc xep | san pham | khoan /.test(f)) return 'wage';
  return 'allowance';
}

/** Mã quy chiếu của 1 mục kho (mục có sẵn đã sửa vẫn mang mã gốc). */
export const catalogRef = (it: CatalogItem): string => it.builtinId ?? it.id;

/** Mục kho → dòng bảng giá mới (nhập tay: giá mặc định của mục; tự tính: để trống giá, hệ thống tự tính). Gắn sẵn mã danh mục. */
export function rowFromCatalog(it: CatalogItem): QuoteRowCfg {
  return {
    id: newLineId(), kind: 'custom', name: it.name, unit: it.unit, hidden: false,
    override: it.calc ? null : it.price ?? 0,
    catalogId: catalogRef(it),
    ...(it.calc ? { calc: it.calc } : {}),
    ...(it.i18n && (it.i18n.zh || it.i18n.en) ? { i18n: it.i18n } : {}),
  };
}

/** Dòng bảng giá → mục kho (để "Lưu vào kho"). */
export function catalogFromRow(r: QuoteRowCfg): CatalogItem {
  return {
    id: `c-${newLineId()}`, group: guessGroup(r.name), name: r.name.trim(), unit: r.unit, custom: true,
    ...(r.calc ? { calc: r.calc } : { price: r.override ?? 0 }),
    ...(r.i18n && (r.i18n.zh || r.i18n.en) ? { i18n: r.i18n } : {}),
  };
}

/** Bảng giá đã có dòng này chưa (cùng mã danh mục, hoặc cùng tên — không phân biệt hoa/thường & khoảng trắng). */
export const sheetHasItem = (q: QuoteSheet, it: CatalogItem) =>
  q.rows.some(r => !r.hidden && (rowCatalogRef(r, q.perHour) === catalogRef(it) || norm(r.name) === norm(it.name)));

/** Mã + tên các dòng ĐANG HIỆN của bảng giá (đã tính: dòng bảo hiểm / phí DV chỉ tính khi thật sự hiện) — cho bộ chọn. */
export interface UsedRows { refs: Set<string>; names: Set<string> }
export const usedRows = (rows: { ref: string | null; name: string; hidden: boolean }[]): UsedRows => {
  const vis = rows.filter(r => !r.hidden);
  return { refs: new Set(vis.map(r => r.ref).filter((x): x is string => !!x)), names: new Set(vis.map(r => norm(r.name))) };
};
export const isUsed = (u: UsedRows, it: CatalogItem) => u.refs.has(catalogRef(it)) || u.names.has(norm(it.name));

/**
 * Thêm 1 mục kho vào bảng giá. Mục ứng với 1 dòng chuẩn đang ẩn (vd tăng ca Lễ Tết) → hiện lại dòng chuẩn đó (giá tự tính đúng
 * theo cài đặt tăng ca của bảng) thay vì thêm 1 dòng trùng; còn lại thêm dòng mới gắn sẵn mã danh mục.
 */
export function addCatalogItem(q: QuoteSheet, it: CatalogItem): QuoteSheet {
  const ref = catalogRef(it);
  const std = q.rows.find(r => r.kind !== 'custom' && r.hidden && rowCatalogRef(r, q.perHour) === ref);
  if (std) return { ...q, rows: q.rows.map(r => (r.id === std.id ? { ...r, hidden: false } : r)) };
  return { ...q, rows: [...q.rows, rowFromCatalog(it)] };
}

/** Kho gộp: của công ty (đúng thứ tự đã sắp) + mục có sẵn chưa có trong kho công ty (cùng tên thì bản của công ty thắng). */
export function mergedCatalog(mine: CatalogItem[]): CatalogItem[] {
  const names = new Set(mine.map(m => norm(m.name)));
  const ids = new Set(mine.map(m => m.builtinId).filter(Boolean));
  return [...mine, ...BUILTIN_CATALOG.filter(b => !ids.has(b.id) && !names.has(norm(b.name)))];
}

/** Mục hiện trong bộ chọn "Thêm dòng" (bỏ mục đã ẩn). */
export const pickerCatalog = (mine: CatalogItem[]): CatalogItem[] => mergedCatalog(mine).filter(i => !i.hidden);

/** Tìm mục theo mã quy chiếu (kể cả mục có sẵn bị kho công ty che vì trùng tên). */
export const findCatalogItem = (items: CatalogItem[], ref: string | null | undefined): CatalogItem | undefined =>
  ref ? items.find(i => catalogRef(i) === ref) ?? BUILTIN_BY_ID.get(ref) : undefined;

/** Mục có sẵn gốc của 1 mục đã sửa (để so / khôi phục mặc định). */
export const builtinOf = (it: CatalogItem): CatalogItem | undefined => BUILTIN_BY_ID.get(it.builtinId ?? it.id);

const contentKey = (it: CatalogItem) => JSON.stringify([it.group, it.name, it.unit, it.i18n?.zh ?? '', it.i18n?.en ?? '', it.calc ?? null, it.calc ? null : it.price ?? 0, cleanCost(it.cost)]);
/** Mục có sẵn đã bị sửa nội dung (tên, nhóm, đơn vị, bản dịch, cách tính, giá, cách dùng ở bảng chi phí) so với bản gốc. */
export const isEditedBuiltin = (it: CatalogItem): boolean => { const b = builtinOf(it); return !!b && contentKey(b) !== contentKey(it); };

/**
 * Mục → dạng lưu. Mục có sẵn CHƯA SỬA chỉ lưu mã + cờ ẩn + vị trí (lần sau nâng cấp bộ danh mục thì tự nhận tên/bản dịch mới);
 * mục có sẵn đã sửa lưu đủ + builtinId; mục tự thêm đánh dấu custom.
 */
export function toStored(it: CatalogItem): CatalogItem {
  const b = builtinOf(it);
  if (b && (!it.name || !isEditedBuiltin(it))) return { id: b.id, builtinId: b.id, group: b.group, name: '', unit: '', hidden: !!it.hidden };
  const out: Omit<CatalogItem, 'cost'> & { v?: number; cost?: CatalogCost | null } = { ...it, v: STORE_V, cost: cleanCost(it.cost) };
  delete out.aliases; delete out.std;
  if (b) return { ...out, builtinId: b.id, custom: false, hidden: !!it.hidden } as CatalogItem;
  delete out.builtinId;
  return { ...out, custom: true } as CatalogItem;
}

const pctTxt = (c: number) => `${Math.round(c * 1000) / 10}%`;
const BASE_TXT: Record<RowCalc['base'], string> = {
  none: '', day: 'giá ca ngày', night: 'giá ca đêm', dayHour: 'giá 1 giờ ca ngày', nightHour: 'giá 1 giờ ca đêm', insSalary: '',
};
/** Mô tả cách tính bằng lời: "giá ca đêm + 4 giờ × 200%" / "10.5% lương đóng BHXH" / "nhập tay". */
export function describeCalc(c: RowCalc | undefined): string {
  if (!c) return 'nhập tay';
  if (c.base === 'insSalary') return `${pctTxt(c.coef)} lương đóng BHXH`;
  const base = BASE_TXT[c.base];
  if (!(c.hours > 0 && c.coef > 0)) return base ? `bằng ${base}` : '0';
  return `${base ? `${base} + ` : ''}${c.hours} giờ × ${pctTxt(c.coef)}`;
}

/**
 * Dán nhiều mục một lúc: mỗi dòng 1 mục — "Tên | Đơn vị | Giá" (đơn vị, giá không bắt buộc; ngăn bằng | hoặc Tab hoặc ;).
 * Bỏ dòng trống, bỏ trùng tên (so với `existing` và trong chính danh sách dán). Nhóm đoán theo tên.
 */
export function parseBulkItems(text: string, existing: CatalogItem[] = []): CatalogItem[] {
  const seen = new Set(existing.flatMap(e => [e.name, ...(e.aliases ?? [])]).map(norm));
  const out: CatalogItem[] = [];
  for (const line of text.split('\n')) {
    const [name = '', unit = '', price = ''] = line.split(/\s*[|\t;]\s*/);
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n || seen.has(norm(n))) continue;
    seen.add(norm(n));
    const digits = price.replace(/\D/g, '');
    out.push({ id: `c-${newLineId()}`, group: guessGroup(n), name: n, unit: unit.trim() || 'VNĐ/ngày', price: digits ? Number(digits) : 0, custom: true });
  }
  return out;
}

/** Tìm trong kho — không cần gõ dấu, bỏ dấu câu, mọi từ gõ vào phải có mặt (không cần đúng thứ tự). */
export function searchCatalog(items: CatalogItem[], q: string): CatalogItem[] {
  const words = foldName(q).split(' ').filter(Boolean);
  if (!words.length) return items;
  return items.filter(i => {
    const hay = ` ${foldName(`${i.name} ${i.hint ?? ''} ${(i.aliases ?? []).join(' ')}`)} `;
    return words.every(w => hay.includes(w));
  });
}

// ── Gợi ý mục danh mục cho dòng của bảng giá cũ (chuyển đổi để có mã quy chiếu chung) ──

/** Từ quá chung, gần như mục nào cũng có — tính nhẹ khi so tên */
const GENERIC = new Set(['luong', 'phu', 'cap', 'ho', 'tro', 'ca', 'ngay', 'thuong', 'chi', 'phi', 'tien', 'lam', 'viec', 'va', 'cho', 'theo', 'cua', 'tu', 'len', 'vnd', 'nguoi', 'thang', 'muc', 'khoan']);
const weight = (t: string) => (GENERIC.has(t) ? 0.3 : 1);
interface Feat { tokens: Set<string>; night: boolean; sun: boolean; hol: boolean; ot: boolean; hours: string | null }
function feat(name: string): Feat {
  const f = ` ${foldName(name)} `;
  return {
    tokens: new Set(f.trim().split(' ').filter(Boolean)),
    night: / dem /.test(f), sun: / chu nhat | cn /.test(f), hol: / le | tet /.test(f), ot: / tang ca | lam them /.test(f),
    hours: (/ (\d{1,2})h /.exec(f) ?? [])[1] ?? null,
  };
}
function similarity(a: Feat, b: Feat): number {
  let inter = 0, wa = 0, wb = 0, strong = false;
  for (const t of a.tokens) { wa += weight(t); if (b.tokens.has(t)) { inter += weight(t); if (!GENERIC.has(t)) strong = true; } }
  for (const t of b.tokens) wb += weight(t);
  if (!wa || !wb) return 0;
  let s = 0.5 * (inter / (wa + wb - inter)) + 0.5 * (inter / Math.min(wa, wb));
  for (const k of ['night', 'sun', 'hol', 'ot'] as const) {
    if (a[k] !== b[k]) s -= 0.25;
    else if (a[k]) { s += 0.1; strong = true; }
  }
  if (a.hours && b.hours) { s += a.hours === b.hours ? 0.2 : -0.35; if (a.hours === b.hours) strong = true; }
  return strong ? s : Math.min(s, 0.3);
}

export interface CatalogSuggestion { item: CatalogItem; score: number }
/** Điểm tối thiểu để tự chọn sẵn gợi ý (người dùng vẫn xác nhận / đổi trước khi áp dụng) */
export const SUGGEST_MIN = 0.5;

/**
 * Gợi ý mục danh mục cho 1 dòng bảng giá: trùng tên / tên cũ → chắc chắn; cùng công thức tự tính → rất gần;
 * còn lại so từ khoá (bỏ dấu) + đặc điểm ca đêm / Chủ nhật / Lễ Tết / tăng ca / số giờ. Trả tối đa `limit` mục, điểm cao trước.
 */
export function suggestCatalog(row: Pick<QuoteRowCfg, 'name' | 'calc'>, items: CatalogItem[], limit = 3): CatalogSuggestion[] {
  const name = row.name.trim();
  if (!name) return [];
  const fa = feat(name);
  const exact = (it: CatalogItem) => [it.name, ...(it.aliases ?? [])].some(n => foldName(n) === foldName(name));
  const sameCalc = (it: CatalogItem) => !!row.calc && !!it.calc && JSON.stringify(cleanCalc(row.calc)) === JSON.stringify(cleanCalc(it.calc));
  const out = items.map(item => {
    if (exact(item)) return { item, score: 2 };
    const s = Math.max(similarity(fa, feat(item.name)), ...(item.aliases ?? []).map(a => similarity(fa, feat(a))));
    return { item, score: s + (sameCalc(item) ? 0.4 : 0) };
  }).filter(x => x.score > 0.2);
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Giá theo mã danh mục của 1 bảng giá (dòng đang hiện) — nền cho so sánh cùng hạng mục giữa các dự án. */
export function pricesByCatalog(rows: { ref: string | null; price: number; unit: string; hidden: boolean }[]): Record<string, { price: number; unit: string }> {
  const out: Record<string, { price: number; unit: string }> = {};
  for (const r of rows) if (!r.hidden && r.ref && !(r.ref in out)) out[r.ref] = { price: r.price, unit: r.unit };
  return out;
}

// ── Bảng chi phí (bước 1) dùng chung danh mục ──

/** Làm sạch cách dùng ở bảng chi phí; null = không dùng ở bước 1. */
export function cleanCost(raw: unknown): CatalogCost | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<CatalogCost>;
  if (c.section !== 'worker' && c.section !== 'compliance' && c.section !== 'other') return null;
  const value = Math.max(0, Number(c.value) || 0);
  if (c.mode === 'percent') return { section: c.section, mode: 'percent', base: c.base === 'base_wage' ? 'base_wage' : 'insurable', value: Math.min(1000, value) };
  if (c.mode === 'leave') return { section: c.section, mode: 'leave', value: Math.min(30, value) || 12 };
  return { section: c.section, mode: 'fixed', unit: c.unit === 'day' ? 'day' : 'month', value, ...(c.insurable && c.section === 'worker' ? { insurable: true } : {}) };
}

/** Mô tả cách 1 mục vào bảng chi phí: "nhập số · đ/tháng · tính vào lương đóng BHXH" / "21,5% lương đóng BHXH". */
export function describeCost(c: CatalogCost | null | undefined): string {
  if (!c) return 'không dùng ở bảng chi phí';
  if (c.mode === 'percent') return `${String(c.value ?? 0).replace('.', ',')}% ${c.base === 'base_wage' ? 'lương cơ bản' : 'lương đóng BHXH'}`;
  if (c.mode === 'leave') return `${c.value ?? 12} ngày phép/năm`;
  return `nhập số · ${c.unit === 'day' ? 'đ/công' : 'đ/tháng'}${c.value ? ` · mặc định ${Math.round(c.value).toLocaleString('vi-VN')}` : ''}${c.insurable ? ' · tính vào lương đóng BHXH' : ''}`;
}

/**
 * Mã danh mục của 1 khoản chi phí: dòng lương cơ bản / phí dịch vụ / phép năm tự gắn theo vai trò; còn lại lấy mã đã gắn,
 * không thì tự gắn khi tên trùng đúng tên (hoặc tên cũ) của mục có sẵn — nên phương án cũ dựng từ gợi ý vẫn có mã.
 */
export function costLineRef(l: Pick<CostLine, 'name' | 'catalogId' | 'isBaseWage' | 'isServiceFee' | 'mode'>): string | null {
  if (l.isBaseWage) return 'b-base-wage';
  if (l.isServiceFee) return 'b-svc-fee';
  return l.catalogId || (l.mode === 'leave' ? 'b-annual-leave' : null) || builtinRefByName(l.name);
}
/** Khoản có vai trò cố định (lương cơ bản, phí dịch vụ) — mã tự gắn, không đổi tay. */
export const isStructuralLine = (l: Pick<CostLine, 'isBaseWage' | 'isServiceFee'>) => !!l.isBaseWage || !!l.isServiceFee;

/** Mục kho → khoản chi phí mới (đúng nhóm, cách tính mặc định, gắn sẵn mã). */
export function lineFromCatalog(it: CatalogItem): CostLine {
  const c = cleanCost(it.cost) ?? { section: 'other' as const, mode: 'fixed' as const, unit: 'month' as const, value: 0 };
  return newLine({
    name: it.name, group: c.section, paidToWorker: c.section === 'worker', mode: c.mode,
    unit: c.mode === 'fixed' ? c.unit ?? 'month' : 'day', value: c.value ?? 0,
    ...(c.mode === 'percent' ? { base: c.base ?? 'insurable', ...(c.base !== 'base_wage' ? { cap: INSURANCE_CAP_MONTHLY } : {}) } : {}),
    ...(c.insurable ? { insurable: true } : {}),
    note: it.hint ?? '', catalogId: catalogRef(it),
  });
}

/** Khoản chi phí tự đặt → mục kho mới của công ty (để "Lưu vào kho"): giữ nhóm, cách tính, số mặc định của khoản. */
export function catalogFromCostLine(l: CostLine): CatalogItem {
  const section = l.paidToWorker ? 'worker' : l.group === 'compliance' ? 'compliance' : 'other';
  const cost = cleanCost({ section, mode: l.mode, unit: l.unit, base: l.base, value: l.value, insurable: l.insurable });
  return {
    id: `c-${newLineId()}`, group: guessGroup(l.name), name: l.name.trim(), custom: true, price: 0,
    unit: l.mode === 'fixed' && l.unit === 'day' ? 'VNĐ/công' : 'VNĐ/người/tháng',
    ...(cost ? { cost } : {}),
  };
}

/** Mục dùng được ở bảng chi phí (có `cost`), theo nhóm — KHÔNG phụ thuộc cờ ẩn của bảng giá. */
export const costCatalog = (items: CatalogItem[], section?: CatalogCost['section']): CatalogItem[] =>
  items.filter(i => i.cost && (!section || i.cost.section === section));

/** Mã + tên các khoản đang có ở bảng chi phí — mục đã có thì mờ đi ở bộ chọn. */
export const usedCostLines = (lines: CostLine[]): UsedRows =>
  ({ refs: new Set(lines.map(costLineRef).filter((x): x is string => !!x)), names: new Set(lines.map(l => norm(l.name))) });

/** Gắn mã danh mục cho các khoản chi phí (chuyển đổi phương án cũ) — số tiền, cách tính giữ nguyên; tick đổi tên thì lấy tên danh mục. */
export function applyCostCatalogMap(lines: CostLine[], map: Record<string, string | null>, items: CatalogItem[], renameIds: string[] = []): CostLine[] {
  return lines.map(l => {
    if (isStructuralLine(l) || !(l.id in map)) return l;
    const ref = map[l.id];
    const next: CostLine = { ...l };
    if (ref) next.catalogId = ref; else delete next.catalogId;
    const it = ref && renameIds.includes(l.id) ? findCatalogItem(items, ref) : undefined;
    if (it) next.name = it.name;
    return next;
  });
}

/**
 * KHÁCH TRẢ 2 LẦN: khoản đã tính vào giá ca 8h ở bảng chi phí (không thu riêng) mà bảng giá còn 1 dòng riêng có giá cho
 * cùng hạng mục (cùng mã danh mục, hoặc cùng tên). Dòng giá 0 coi như ghi chú, không tính.
 */
export function doubleBilled(lines: CostLine[], rows: { id: string; kind: string; name: string; ref: string | null; price: number; hidden: boolean }[]): { rowId: string; lineId: string }[] {
  const out: { rowId: string; lineId: string }[] = [];
  const inPrice = lines.filter(l => !l.billSeparately && !isStructuralLine(l));
  for (const r of rows) {
    if (r.kind !== 'custom' || r.hidden || r.price <= 0) continue;
    const l = inPrice.find(x => { const ref = costLineRef(x); return (!!ref && ref === r.ref) || (!!r.name.trim() && norm(x.name) === norm(r.name)); });
    if (l) out.push({ rowId: r.id, lineId: l.id });
  }
  return out;
}

/** Chi phí theo mã danh mục của 1 phương án (đ/công, đ/tháng) — nền so sánh cùng khoản giữa các dự án. */
export function costByCatalog(lines: CostLine[], amounts: Record<string, { daily: number; monthly: number }>): Record<string, { daily: number; monthly: number }> {
  const out: Record<string, { daily: number; monthly: number }> = {};
  for (const l of lines) {
    const ref = costLineRef(l), a = amounts[l.id];
    if (!ref || !a) continue;
    const cur = out[ref] ?? { daily: 0, monthly: 0 };
    out[ref] = { daily: cur.daily + a.daily, monthly: cur.monthly + a.monthly };
  }
  return out;
}

// ── Lưu / đọc kho của công ty ──

/** Đời dữ liệu kho: 2 = đã chia 5 nhóm (đời 1 có nhóm shift / allowance / other → đoán lại theo tên) */
const STORE_V = 2;

/** Đọc kho của công ty từ JSON đã lưu (có thể hỏng / thiếu / dạng cũ) — không bao giờ ném lỗi. */
export function parseCatalog(raw: string | null | undefined): CatalogItem[] {
  try {
    const arr = JSON.parse(raw ?? '[]');
    if (!Array.isArray(arr)) return [];
    const out: CatalogItem[] = [];
    const seen = new Set<string>();
    for (const x of arr.slice(0, 300)) {
      if (!x || typeof x !== 'object') continue;
      const b = typeof x.builtinId === 'string' ? BUILTIN_BY_ID.get(x.builtinId) : undefined;
      const name = typeof x.name === 'string' ? x.name.trim() : '';
      // Mục có sẵn: chỉ có mã (chưa sửa), hoặc bản sao nguyên vẹn của kho đời đầu → dùng bản mới của mục đó
      const legacy = b && LEGACY_BUILTIN[b.id];
      const untouchedLegacy = !!legacy && name === legacy[0] && (x.unit ?? '') === legacy[1]
        && JSON.stringify(cleanCalc(x.calc)) === JSON.stringify(b!.calc ? cleanCalc(b!.calc) : null) && (!!b!.calc || !Number(x.price));
      if (b && (!name || untouchedLegacy)) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        out.push({ ...b, builtinId: b.id, custom: false, hidden: typeof x.hidden === 'boolean' ? x.hidden : !!b.hidden });
        continue;
      }
      if (!name) continue;
      const c = cleanCalc(x.calc);
      const id = typeof x.id === 'string' && x.id ? x.id : `c-${newLineId()}`;
      if (seen.has(b?.id ?? id)) continue;
      seen.add(b?.id ?? id);
      const group: CatalogGroup = x.v === STORE_V && (CATALOG_GROUPS as string[]).includes(x.group) ? x.group : guessGroup(name);
      out.push({
        id, group, name, unit: typeof x.unit === 'string' && x.unit ? x.unit : 'VNĐ/ngày', custom: !b,
        ...(b ? { builtinId: b.id, ...(b.aliases ? { aliases: b.aliases } : {}), ...(b.std ? { std: b.std } : {}) } : {}),
        // Mục có sẵn luôn mang cờ ẩn rõ ràng (để bật lại được mục ẩn sẵn); mục tự thêm chỉ ghi khi ẩn
        ...(b ? { hidden: typeof x.hidden === 'boolean' ? x.hidden : !!b.hidden } : x.hidden ? { hidden: true } : {}),
        ...(c ? { calc: c } : { price: Math.max(0, Number(x.price) || 0) }),
        ...(typeof x.hint === 'string' && x.hint ? { hint: x.hint } : b?.hint ? { hint: b.hint } : {}),
        ...(x.i18n && (x.i18n.zh || x.i18n.en) ? { i18n: { zh: x.i18n.zh || undefined, en: x.i18n.en || undefined } } : {}),
        // Đời 2 ghi rõ (null = không dùng ở bảng chi phí); kho đời 1 chưa có trường này → mục có sẵn lấy mặc định
        ...(x.v === STORE_V ? (cleanCost(x.cost) ? { cost: cleanCost(x.cost)! } : {}) : b?.cost ? { cost: b.cost } : {}),
      });
    }
    return out;
  } catch { return []; }
}

/** Thêm / cập nhật 1 mục (cùng tên thì thay, GIỮ mã cũ để các dòng đã gắn mã đó không bị lạc). */
export function upsertCatalog(list: CatalogItem[], it: CatalogItem): CatalogItem[] {
  const old = list.find(x => norm(x.name) === norm(it.name));
  return [...list.filter(x => x !== old), { ...it, id: old?.id ?? it.id, ...(old?.builtinId ? { builtinId: old.builtinId } : {}), custom: !old?.builtinId }];
}

/** Mục kho cùng tên với dòng (để "Lưu vào kho" không tạo mục trùng — gắn luôn vào mục đã có). */
export const catalogItemNamed = (items: CatalogItem[], name: string): CatalogItem | undefined =>
  items.find(i => norm(i.name) === norm(name) || (i.aliases ?? []).some(a => norm(a) === norm(name)));

/**
 * Gắn mã danh mục cho các dòng tự đặt của bảng giá (chuyển đổi bảng giá cũ): `map` = mã dòng → mã danh mục (null = bỏ gắn).
 * Tên, đơn vị, giá đã báo GIỮ NGUYÊN; dòng trong `renameIds` đổi tên (và bản dịch nếu dòng chưa có) theo mục danh mục.
 */
export function applyCatalogMap(q: QuoteSheet, map: Record<string, string | null>, items: CatalogItem[], renameIds: string[] = []): QuoteSheet {
  return {
    ...q,
    rows: q.rows.map(r => {
      if (r.kind !== 'custom' || !(r.id in map)) return r;
      const ref = map[r.id];
      const next: QuoteRowCfg = { ...r };
      if (ref) next.catalogId = ref; else delete next.catalogId;
      const it = ref && renameIds.includes(r.id) ? findCatalogItem(items, ref) : undefined;
      if (it) { next.name = it.name; if (!r.i18n?.zh && !r.i18n?.en && it.i18n) next.i18n = it.i18n; }
      return next;
    }),
  };
}

/** Lựa chọn ban đầu khi chuyển đổi 1 dòng: mã đã gắn, không thì gợi ý đủ chắc (điểm ≥ SUGGEST_MIN), không thì để trống. */
export function initialCatalogChoice(row: { name: string; calc?: RowCalc; catalogId?: string }, items: CatalogItem[]): { ref: string | null; suggested: boolean; exact?: boolean } {
  if (row.catalogId) return { ref: row.catalogId, suggested: false };
  const best = suggestCatalog(row, items, 1)[0];
  if (!best || best.score < SUGGEST_MIN) return { ref: null, suggested: false };
  // Trùng đúng tên / tên cũ của mục → gần như chắc chắn
  return { ref: catalogRef(best.item), suggested: true, ...(best.score >= 2 ? { exact: true } : {}) };
}
export const removeFromCatalog = (list: CatalogItem[], id: string): CatalogItem[] => list.filter(x => x.id !== id);

export const CATALOG_KEY = 'cost_plan_row_catalog';

export async function loadCatalog(): Promise<CatalogItem[]> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', CATALOG_KEY).maybeSingle();
  return parseCatalog((data as { value: string | null } | null)?.value);
}

export async function saveCatalog(list: CatalogItem[]): Promise<void> {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: CATALOG_KEY, value: JSON.stringify(list.map(toStored)), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
