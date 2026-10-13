// MẪU BẢNG GIÁ CHUNG — danh mục dòng báo giá cố định cho cả công ty (tên, đơn vị, thứ tự, dòng ẩn/hiện, bản dịch, ghi chú,
// cách báo giá…), để mỗi phương án mới không phải gõ lại tên. Lưu ở app_settings (key/value, đã có) → không cần migration.
//
// Mẫu KHÔNG giữ giá của các dòng tự tính (giá đó theo từng phương án); dòng nhập tay (vd phụ cấp cơm) giữ giá làm mặc định.
import { supabase } from '../supabase';
import { newLineId } from './engine';
import { normalizeQuoteSheet, setPerHour } from './quoteSheet';
import type { QuoteRowCfg, QuoteSheet } from './types';

export const SHEET_TEMPLATE_KEY = 'cost_plan_quote_template';

export interface SheetTemplate {
  sheet: QuoteSheet;
  savedAt: string;
  savedBy: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Bảng giá của 1 phương án → mẫu chung: bỏ giá các dòng tự tính, bỏ cột thợ (theo từng dự án), bỏ ô "Bao gồm" (theo bước 1). */
export function sheetToTemplate(q: QuoteSheet): QuoteSheet {
  const n = normalizeQuoteSheet(q);
  return {
    ...n,
    rows: n.rows.map(r => ({
      id: r.kind === 'custom' ? r.id : `std-${r.kind}`, kind: r.kind, name: r.name, unit: r.unit, hidden: !!r.hidden,
      override: r.kind === 'custom' && !r.calc ? r.override ?? 0 : null,
      ...(r.i18n ? { i18n: r.i18n } : {}),
      ...(r.calc ? { calc: r.calc } : {}),
    })),
    includedNote: null,
    skilled: null,
    ordered: true,
  };
}

/**
 * Áp mẫu chung vào bảng giá. Không có `current` (phương án mới) → đúng như mẫu.
 * Có `current` (phương án đang soạn): tên / đơn vị / thứ tự / ẩn hiện / bản dịch / ghi chú / cách báo theo mẫu, nhưng GIỮ giá đã ghi
 * tay của phương án (dòng tự tính khớp theo loại, dòng nhập tay khớp theo tên); dòng nhập tay chỉ phương án này có thì giữ ở cuối.
 */
export function sheetFromTemplate(tplIn: QuoteSheet, currentIn?: QuoteSheet | null): QuoteSheet {
  const tpl = normalizeQuoteSheet(tplIn);
  // Đơn vị giá khác nhau thì quy đổi giá ghi tay của phương án sang đơn vị của mẫu trước khi gộp
  const current = currentIn ? setPerHour(normalizeQuoteSheet(currentIn), !!tpl.perHour) : null;
  const curStd = new Map(current?.rows.filter(r => r.kind !== 'custom').map(r => [r.kind, r]) ?? []);
  const curCustom = current?.rows.filter(r => r.kind === 'custom') ?? [];
  const usedCustom = new Set<string>();
  const rows: QuoteRowCfg[] = tpl.rows.map(r => {
    if (r.kind !== 'custom') {
      const c = curStd.get(r.kind);
      return { ...r, id: c?.id ?? r.id, override: c?.override ?? null, overrideSkilled: c?.overrideSkilled ?? null };
    }
    const c = curCustom.find(x => !usedCustom.has(x.id) && norm(x.name) === norm(r.name));
    if (c) usedCustom.add(c.id);
    return { ...r, id: c?.id ?? newLineId(), override: c?.override ?? (r.calc ? null : r.override ?? 0), overrideSkilled: c?.overrideSkilled ?? null };
  });
  const extra = curCustom.filter(x => !usedCustom.has(x.id));
  return {
    ...tpl,
    rows: [...rows, ...extra],
    includedNote: current?.includedNote ?? null,
    skilled: current?.skilled ?? null,
    ordered: true,
  };
}

/** Dòng nhập tay của mẫu mà bảng hiện tại chưa có — để gợi ý ở menu "Thêm dòng". */
export function templateCustomRowsMissing(tpl: QuoteSheet | null | undefined, current: QuoteSheet): QuoteRowCfg[] {
  if (!tpl) return [];
  const have = new Set(current.rows.filter(r => r.kind === 'custom').map(r => norm(r.name)));
  return normalizeQuoteSheet(tpl).rows.filter(r => r.kind === 'custom' && r.name.trim() && !have.has(norm(r.name)));
}

export function parseSheetTemplate(raw: string | null | undefined): SheetTemplate | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SheetTemplate>;
    if (!o || typeof o !== 'object' || !o.sheet) return null;
    return { sheet: normalizeQuoteSheet(o.sheet), savedAt: String(o.savedAt ?? ''), savedBy: o.savedBy ?? null };
  } catch { return null; }
}

export async function loadSheetTemplate(): Promise<SheetTemplate | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', SHEET_TEMPLATE_KEY).maybeSingle();
  return parseSheetTemplate((data as { value: string | null } | null)?.value);
}

export async function saveSheetTemplate(q: QuoteSheet, savedBy: string | null): Promise<SheetTemplate> {
  const t: SheetTemplate = { sheet: sheetToTemplate(q), savedAt: new Date().toISOString(), savedBy };
  const { error } = await supabase.from('app_settings')
    .upsert({ key: SHEET_TEMPLATE_KEY, value: JSON.stringify(t), updated_at: t.savedAt }, { onConflict: 'key' });
  if (error) throw error;
  return t;
}
