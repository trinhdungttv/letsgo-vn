import type { CalcData, MonthKey } from './calc/types';
import { computeMonth } from './calc/pl';
import { monthLabel } from './calc/months';
import { toCsv } from './calc/csv';

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** CSV báo cáo P&L theo tháng (BOM UTF-8 để Excel đọc tiếng Việt). */
export function buildPLCsv(data: CalcData, months: MonthKey[]): string {
  const rows: (string | number)[][] = [[
    'Tháng', 'Doanh thu (VNĐ)', 'Tiền thuê (VNĐ)', 'Phụ phí điện + xe (VNĐ)', 'Thuê MBT (VNĐ)', 'Thuê TS4 (VNĐ)',
    'Vận hành (VNĐ)', 'Dự kiến PS (VNĐ)', 'Tổng CP (VNĐ)', 'Lợi nhuận (VNĐ)', 'Biên %',
  ]];
  for (const m of months) {
    const x = computeMonth(data, m);
    rows.push([
      monthLabel(m), Math.round(x.revenue), Math.round(x.rentRevenue), Math.round(x.feeRevenue), Math.round(x.mbt),
      Math.round(x.ts4), Math.round(x.opex), Math.round(x.forecast), Math.round(x.cost), Math.round(x.profit),
      x.revenue > 0 ? (x.margin * 100).toFixed(1) : '0',
    ]);
  }
  return toCsv(rows);
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
