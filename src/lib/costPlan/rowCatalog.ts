// KHO ĐẦU MỤC của Bảng giá: danh mục các loại dòng báo giá để chọn khi bấm "Thêm dòng" — khỏi đặt tên / tính lại mỗi lần.
// Mỗi khách muốn báo các đầu mục khác nhau (ca đêm 12 tiếng, Lễ-Tết 8 tiếng, Chủ nhật, các loại phụ cấp…).
//   • Kho CÓ SẴN (BUILTIN_CATALOG): dòng tự tính theo lương (số giờ × hệ số luật), có sẵn bản dịch Trung / Anh.
//   • Kho CỦA CÔNG TY: dòng người dùng tự đặt rồi "Lưu vào kho" (app_settings, không cần migration).
import { supabase } from '../supabase';
import { OT_DAY_HOLIDAY, OT_DAY_SUNDAY, OT_DAY_WEEKDAY, OT_NIGHT_HOLIDAY, OT_NIGHT_SUNDAY, OT_NIGHT_WEEKDAY_NOPRIOR } from '../payroll/coefficients';
import { newLineId } from './engine';
import { cleanCalc } from './quoteSheet';
import type { QuoteRowCfg, QuoteSheet, RowCalc } from './types';

export type CatalogGroup = 'shift' | 'allowance' | 'other';
export const CATALOG_GROUP_LABEL: Record<CatalogGroup, string> = {
  shift: 'Ca làm việc & ngày lễ', allowance: 'Phụ cấp & khoản khác', other: 'Khác',
};

export interface CatalogItem {
  id: string;
  group: CatalogGroup;
  name: string;
  unit: string;
  i18n?: { zh?: string; en?: string };
  /** Có = dòng tự tính theo lương; không = nhập tay (giá mặc định ở `price`) */
  calc?: RowCalc;
  price?: number;
  /** Mô tả ngắn hiện trong danh sách */
  hint?: string;
  /** Do công ty tự thêm (xoá được). Mục có sẵn thì chỉ ẩn được. */
  custom?: boolean;
  /** Mục có sẵn đã được lưu lại sau khi sửa: trỏ về mục gốc (để "Khôi phục mặc định" và không bị nạp trùng) */
  builtinId?: string;
  /** Ẩn khỏi bộ chọn "Thêm dòng" (vẫn còn trong màn Quản lý) */
  hidden?: boolean;
}

const calc = (base: RowCalc['base'], hours: number, coef: number): RowCalc => ({ base, hours, coef });

export const BUILTIN_CATALOG: CatalogItem[] = [
  // ── Ca làm việc ──
  { id: 'b-day12', group: 'shift', name: 'Lương ca ngày 12 tiếng', unit: 'VNĐ/ngày', calc: calc('day', 4, OT_DAY_WEEKDAY), hint: '8 giờ + 4 giờ tăng ca 150%',
    i18n: { zh: '12小时白班工资', en: 'Daily wage (12 working hours)' } },
  { id: 'b-night12', group: 'shift', name: 'Lương ca đêm 12 tiếng', unit: 'VNĐ/ngày (ca đêm)', calc: calc('night', 4, OT_NIGHT_WEEKDAY_NOPRIOR), hint: 'ca đêm 8 giờ + 4 giờ tăng ca đêm 200%',
    i18n: { zh: '12小时夜班工资', en: 'Daily wage (12 working hours) - night shift' } },
  { id: 'b-sun8', group: 'shift', name: 'Lương Chủ nhật ca ngày 8 tiếng', unit: 'VNĐ/ngày', calc: calc('none', 8, OT_DAY_SUNDAY), hint: '8 giờ × 200%',
    i18n: { zh: '周日8小时白班工资', en: 'Sunday daily wage (8 hours)' } },
  { id: 'b-sun8n', group: 'shift', name: 'Lương Chủ nhật ca đêm 8 tiếng', unit: 'VNĐ/ngày (ca đêm)', calc: calc('none', 8, OT_NIGHT_SUNDAY), hint: '8 giờ × 270%',
    i18n: { zh: '周日8小时夜班工资', en: 'Sunday daily wage (8 hours) - night shift' } },
  { id: 'b-hol8', group: 'shift', name: 'Lương ngày Lễ, Tết ca ngày 8 tiếng', unit: 'VNĐ/ngày', calc: calc('none', 8, OT_DAY_HOLIDAY), hint: '8 giờ × 300%',
    i18n: { zh: '节假日8小时白班工资', en: 'Public holiday daily wage (8 hours)' } },
  { id: 'b-hol8n', group: 'shift', name: 'Lương ngày Lễ, Tết ca đêm 8 tiếng', unit: 'VNĐ/ngày (ca đêm)', calc: calc('none', 8, OT_NIGHT_HOLIDAY), hint: '8 giờ × 390%',
    i18n: { zh: '节假日8小时夜班工资', en: 'Public holiday daily wage (8 hours) - night shift' } },
  { id: 'b-ot2', group: 'shift', name: 'Lương tăng ca ngày thường 2 tiếng', unit: 'VNĐ/2 giờ', calc: calc('none', 2, OT_DAY_WEEKDAY), hint: '2 giờ × 150%',
    i18n: { zh: '平日加班2小时工资', en: 'Weekday overtime (2 hours)' } },
  { id: 'b-ot4', group: 'shift', name: 'Lương tăng ca ngày thường 4 tiếng', unit: 'VNĐ/4 giờ', calc: calc('none', 4, OT_DAY_WEEKDAY), hint: '4 giờ × 150%',
    i18n: { zh: '平日加班4小时工资', en: 'Weekday overtime (4 hours)' } },
  // ── Phụ cấp & khoản khác ──
  { id: 'b-nightallow', group: 'allowance', name: 'Phụ cấp ca đêm', unit: 'VNĐ/ngày', calc: calc('none', 8, 0.3), hint: '30% lương ngày — làm đêm tối thiểu +30%',
    i18n: { zh: '夜班津贴', en: 'Night shift allowance' } },
  { id: 'b-meal', group: 'allowance', name: 'Phụ cấp cơm', unit: 'VNĐ/suất', price: 0, hint: 'nhập tay', i18n: { zh: '餐费补贴', en: 'Meal allowance' } },
  { id: 'b-travel', group: 'allowance', name: 'Phụ cấp xăng xe', unit: 'VNĐ/ngày', price: 0, hint: 'nhập tay', i18n: { zh: '交通补贴', en: 'Transport allowance' } },
  { id: 'b-attend', group: 'allowance', name: 'Phụ cấp chuyên cần', unit: 'VNĐ/ngày', price: 0, hint: 'nhập tay', i18n: { zh: '全勤津贴', en: 'Attendance allowance' } },
  { id: 'b-toxic', group: 'allowance', name: 'Phụ cấp độc hại', unit: 'VNĐ/ngày', price: 0, hint: 'nhập tay', i18n: { zh: '有毒有害津贴', en: 'Hazard allowance' } },
  { id: 'b-housing', group: 'allowance', name: 'Phụ cấp nhà ở', unit: 'VNĐ/tháng', price: 0, hint: 'nhập tay', i18n: { zh: '住房补贴', en: 'Housing allowance' } },
  { id: 'b-uniform', group: 'other', name: 'Đồng phục, bảo hộ lao động', unit: 'VNĐ/người', price: 0, hint: 'nhập tay', i18n: { zh: '工服及劳保用品', en: 'Uniform & PPE' } },
];

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Mục kho → dòng bảng giá mới (nhập tay: giá mặc định của mục; tự tính: để trống giá, hệ thống tự tính). */
export function rowFromCatalog(it: CatalogItem): QuoteRowCfg {
  return {
    id: newLineId(), kind: 'custom', name: it.name, unit: it.unit, hidden: false,
    override: it.calc ? null : it.price ?? 0,
    ...(it.calc ? { calc: it.calc } : {}),
    ...(it.i18n && (it.i18n.zh || it.i18n.en) ? { i18n: it.i18n } : {}),
  };
}

/** Dòng bảng giá → mục kho (để "Lưu vào kho"). */
export function catalogFromRow(r: QuoteRowCfg): CatalogItem {
  return {
    id: `c-${newLineId()}`, group: r.calc ? 'shift' : 'allowance', name: r.name.trim(), unit: r.unit, custom: true,
    ...(r.calc ? { calc: r.calc } : { price: r.override ?? 0 }),
    ...(r.i18n && (r.i18n.zh || r.i18n.en) ? { i18n: r.i18n } : {}),
  };
}

/** Bảng giá đã có dòng này chưa (cùng tên, không phân biệt hoa/thường & khoảng trắng). */
export const sheetHasItem = (q: QuoteSheet, it: CatalogItem) => q.rows.some(r => norm(r.name) === norm(it.name));

/** Kho gộp: có sẵn + của công ty (cùng tên thì bản của công ty thắng — họ đã tự chỉnh). */
export function mergedCatalog(mine: CatalogItem[]): CatalogItem[] {
  const names = new Set(mine.map(m => norm(m.name)));
  const ids = new Set(mine.map(m => m.builtinId).filter(Boolean));
  return [...mine, ...BUILTIN_CATALOG.filter(b => !ids.has(b.id) && !names.has(norm(b.name)))];
}

/** Mục hiện trong bộ chọn "Thêm dòng" (bỏ mục đã ẩn). */
export const pickerCatalog = (mine: CatalogItem[]): CatalogItem[] => mergedCatalog(mine).filter(i => !i.hidden);

/** Mục có sẵn gốc của 1 mục đã sửa (để so / khôi phục mặc định). */
export const builtinOf = (it: CatalogItem): CatalogItem | undefined => BUILTIN_CATALOG.find(b => b.id === (it.builtinId ?? it.id));

/** Mục → dạng lưu: mục có sẵn đã sửa giữ builtinId; mục tự thêm đánh dấu custom. */
export function toStored(it: CatalogItem): CatalogItem {
  const b = builtinOf(it);
  return { ...it, ...(b ? { builtinId: b.id, custom: false } : { custom: true }) };
}

/** Mô tả cách tính bằng lời: "ca đêm 8h + 4 giờ × 200%" / "nhập tay". */
export function describeCalc(c: RowCalc | undefined): string {
  if (!c) return 'nhập tay';
  const base = c.base === 'day' ? 'giá ca ngày + ' : c.base === 'night' ? 'giá ca đêm + ' : '';
  return `${base}${c.hours} giờ × ${Math.round(c.coef * 1000) / 10}%`;
}

/**
 * Dán nhiều mục một lúc: mỗi dòng 1 mục — "Tên | Đơn vị | Giá" (đơn vị, giá không bắt buộc; ngăn bằng | hoặc Tab hoặc ;).
 * Bỏ dòng trống, bỏ trùng tên (so với `existing` và trong chính danh sách dán).
 */
export function parseBulkItems(text: string, existing: CatalogItem[] = []): CatalogItem[] {
  const seen = new Set(existing.map(e => norm(e.name)));
  const out: CatalogItem[] = [];
  for (const line of text.split('\n')) {
    const [name = '', unit = '', price = ''] = line.split(/\s*[|\t;]\s*/);
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n || seen.has(norm(n))) continue;
    seen.add(norm(n));
    const digits = price.replace(/\D/g, '');
    out.push({ id: `c-${newLineId()}`, group: 'allowance', name: n, unit: unit.trim() || 'VNĐ/ngày', price: digits ? Number(digits) : 0, custom: true });
  }
  return out;
}

/** Tìm trong kho — không cần gõ dấu, bỏ dấu câu, mọi từ gõ vào phải có mặt (không cần đúng thứ tự). */
export function searchCatalog(items: CatalogItem[], q: string): CatalogItem[] {
  const fold = (s: string) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ');
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return items;
  return items.filter(i => { const hay = ` ${fold(`${i.name} ${i.hint ?? ''}`)} `; return words.every(w => hay.includes(w)); });
}

/** Đọc kho của công ty từ JSON đã lưu (có thể hỏng / thiếu) — không bao giờ ném lỗi. */
export function parseCatalog(raw: string | null | undefined): CatalogItem[] {
  try {
    const arr = JSON.parse(raw ?? '[]');
    if (!Array.isArray(arr)) return [];
    const out: CatalogItem[] = [];
    for (const x of arr.slice(0, 200)) {
      const name = typeof x?.name === 'string' ? x.name.trim() : '';
      if (!name) continue;
      const c = cleanCalc(x.calc);
      const bid = typeof x.builtinId === 'string' && BUILTIN_CATALOG.some(b => b.id === x.builtinId) ? x.builtinId : undefined;
      out.push({
        id: typeof x.id === 'string' ? x.id : `c-${newLineId()}`, group: x.group === 'shift' || x.group === 'other' ? x.group : 'allowance',
        name, unit: typeof x.unit === 'string' && x.unit ? x.unit : 'VNĐ/ngày', custom: !bid,
        ...(bid ? { builtinId: bid } : {}),
        ...(x.hidden ? { hidden: true } : {}),
        ...(c ? { calc: c } : { price: Math.max(0, Number(x.price) || 0) }),
        ...(x.i18n && (x.i18n.zh || x.i18n.en) ? { i18n: { zh: x.i18n.zh || undefined, en: x.i18n.en || undefined } } : {}),
      });
    }
    return out;
  } catch { return []; }
}

/** Thêm / cập nhật 1 mục (cùng tên thì thay). */
export const upsertCatalog = (list: CatalogItem[], it: CatalogItem): CatalogItem[] =>
  [...list.filter(x => norm(x.name) !== norm(it.name)), { ...it, custom: true }];
export const removeFromCatalog = (list: CatalogItem[], id: string): CatalogItem[] => list.filter(x => x.id !== id);

export const CATALOG_KEY = 'cost_plan_row_catalog';

export async function loadCatalog(): Promise<CatalogItem[]> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', CATALOG_KEY).maybeSingle();
  return parseCatalog((data as { value: string | null } | null)?.value);
}

export async function saveCatalog(list: CatalogItem[]): Promise<void> {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: CATALOG_KEY, value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
