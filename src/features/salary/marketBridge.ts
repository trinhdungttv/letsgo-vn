// Cầu nối giữa engine mới và bảng lương NCC bên Thị trường (clients.market_suppliers /
// market_leads.suppliers).
//
// ĐÂY LÀ NƠI DUY NHẤT được phép quy đổi đơn vị ca 12h. Bên Thị trường số tiền ca 12h là ĐƠN GIÁ
// BÌNH QUÂN/GIỜ (quy ước cũ), engine mới dùng TIỀN CẢ CA (xem đầu wageRows.ts). Nhân/chia 12 rải
// rác ở component là cách chắc chắn nhất để một hôm nào đó quên mất một chỗ.
import { toLegacyEntryAmount, fromLegacyEntryAmount, wageRowOf } from './wageRows';
import { deriveShr } from './salaryEngine';
import type { WageTableRow, RevenueResult } from './salaryEngine';
import type { WageCode, AllowanceLine } from './types';
import {
  pickPayrollInputFromWageDetail, allowancesFromWageDetail, type WageFieldMapping,
} from '../../lib/payroll/rateCard';

/** Bảng 14 dòng (đơn vị MỚI) → wage_detail để ghi sang Thị trường (đơn vị CŨ). */
export function wageDetailFromTable(
  table: WageTableRow[],
  fields: WageFieldMapping[],
  workdaysPerMonth: number,
  allowances: Record<string, number>,
  previous: Record<string, number> = {},
): Record<string, number> {
  const byCode = new Map(table.map(r => [r.code, r.fullPrice]));
  const out: Record<string, number> = { ...previous };
  for (const f of fields) {
    const amount = f.payrollInputType ? byCode.get(f.payrollInputType) : undefined;
    if (amount != null) {
      out[f.name] = Math.round(toLegacyEntryAmount(amount, f.payrollInputType!, workdaysPerMonth));
    }
  }
  // Trường nào không phải đơn giá giờ và không có trong `allowances` thì GIỮ NGUYÊN số cũ ở
  // `previous` — ghi đè bằng 0 sẽ xoá mất khoản người dùng đã nhập bên Thị trường.
  for (const [name, amount] of Object.entries(allowances)) {
    if (amount > 0) out[name] = Math.round(amount);
  }
  return out;
}

/** Giá KHÁCH TRẢ theo từng dòng → wage_detail_client (cũng theo đơn vị CŨ). */
export function clientWageDetailFromRevenue(
  revenue: RevenueResult,
  fields: WageFieldMapping[],
  workdaysPerMonth: number,
  allowances: Record<string, number>,
): Record<string, number> {
  const byCode = new Map(revenue.rows.map(r => [r.code, r.customerUnitPrice]));
  const out: Record<string, number> = {};
  for (const f of fields) {
    if (!f.payrollInputType) continue;
    const v = byCode.get(f.payrollInputType);
    // Chưa khai giá thì BỎ QUA, không ghi 0 — 0đ và "chưa khai" là hai chuyện khác nhau.
    if (v != null && v > 0) {
      out[f.name] = Math.round(toLegacyEntryAmount(v, f.payrollInputType, workdaysPerMonth));
    }
  }
  for (const [name, amount] of Object.entries(allowances)) {
    if (amount > 0) out[name] = Math.round(amount);
  }
  return out;
}

/** Chiều ngược lại: bảng lương NCC đã lưu → mã + số tiền theo đơn vị MỚI, kèm SHR suy ra. */
export function pickEntryFromWageDetail(
  wageDetail: Record<string, number> | null | undefined,
  fields: WageFieldMapping[],
  workdaysPerMonth: number,
  priorDayOt = false,
): { code: WageCode; amount: number; fieldName: string; shrPay: number } | null {
  const picked = pickPayrollInputFromWageDetail(wageDetail, fields);
  if (!picked) return null;
  const amount = fromLegacyEntryAmount(picked.value, picked.type, workdaysPerMonth);
  return {
    code: picked.type,
    amount,
    fieldName: picked.fieldName,
    shrPay: deriveShr(picked.type, amount, workdaysPerMonth, { priorDayOt }),
  };
}

/** Các khoản còn lại trong bảng lương NCC = phụ cấp. Mặc định coi khách trả bao nhiêu thì NLĐ
 *  nhận bấy nhiêu — đúng giả định cũ; muốn giữ lại một phần thì sửa ô "Ta trả NLĐ". */
export function allowanceLinesFromWageDetail(
  wageDetail: Record<string, number> | null | undefined,
  fields: WageFieldMapping[],
): AllowanceLine[] {
  return Object.entries(allowancesFromWageDetail(wageDetail, fields)).map(([name, amount], i) => ({
    id: `al_mkt_${i}_${name}`,
    name,
    customerPays: amount,
    weOweWorker: amount,
    taxable: false,
  }));
}

/** Đơn giá của 1 dòng theo đơn vị CŨ — dùng khi cần hiện số khớp với bên Thị trường. */
export const legacyUnitLabelOf = (code: WageCode, workdaysPerMonth: number): string => {
  const row = wageRowOf(code);
  if (row.unit !== 'shift12h') return '';
  return `≈ ${Math.round(toLegacyEntryAmount(1, code, workdaysPerMonth) * 100) / 100}× khi ghi sang Thị trường`;
};
