import { describe, it, expect } from 'vitest';
import { planPnlPush, settlementLabel } from './pnlPush';
import { applyUrl, parseApplyHash, qrSvg } from './publicLink';
import { buildXlsx, safeFileName } from './exportXlsx';

describe('Ghi đối soát vào P&L Dự án', () => {
  const pnl = { id: 'p', client_id: 'c', month: '2026-12', revenue: 0, total_man_days: 0 };
  it('P&L trống → chỉ thêm dòng GTLD', () => {
    const r = planPnlPush(pnl, [], 6_500_000, 'GT');
    expect(r.preserve).toBeNull();
    expect(r.line).toMatchObject({ amount: 6_500_000, service_type: 'recruitment', sort_order: 0, man_days: 0 });
    expect(r.newRevenue).toBe(6_500_000);
  });
  it('doanh thu nhập tay chưa tách dòng → giữ thành dòng Cho thuê lao động rồi cộng dồn', () => {
    const r = planPnlPush({ ...pnl, revenue: 300_000_000, total_man_days: 1200 }, [], 6_500_000, 'GT');
    expect(r.preserve).toMatchObject({ label: 'Cho thuê lao động', amount: 300_000_000, man_days: 1200, service_type: 'leasing' });
    expect(r.line.sort_order).toBe(1);
    expect(r.newRevenue).toBe(306_500_000);
  });
  it('đã có dòng hoá đơn → cộng vào tổng các dòng (không lấy revenue cũ)', () => {
    const r = planPnlPush({ ...pnl, revenue: 999 }, [{ id: 'a', amount: 100, man_days: 1, sort_order: 0 }, { id: 'b', amount: 50, man_days: 0, sort_order: 1 }], 10, 'GT');
    expect(r.preserve).toBeNull();
    expect(r.line.sort_order).toBe(2);
    expect(r.newRevenue).toBe(160);
  });
  it('nhãn dòng doanh thu', () => {
    expect(settlementLabel('Co-Herent', '2026-12', 2)).toBe('Giới thiệu lao động — Co-Herent T12/26 (2 người)');
  });
});

describe('Link ứng tuyển công khai', () => {
  it('đọc mã + CTV từ hash', () => {
    expect(parseApplyHash('#/apply/ab3k9z')).toEqual({ code: 'AB3K9Z', ref: null });
    expect(parseApplyHash('#/apply/AB3K9Z/d0000000-0000-0000-0000-000000000001')).toEqual({ code: 'AB3K9Z', ref: 'd0000000-0000-0000-0000-000000000001' });
    expect(parseApplyHash('#/recruit/plan')).toBeNull();
    expect(parseApplyHash('#/apply/ABC')).toBeNull();
  });
  it('dựng link', () => {
    expect(applyUrl('AB3K9Z', null, 'https://app.letsgo.vn')).toBe('https://app.letsgo.vn/#/apply/AB3K9Z');
    expect(applyUrl('AB3K9Z', 'x-y', 'https://a')).toBe('https://a/#/apply/AB3K9Z/x-y');
  });
  it('mã QR là SVG', () => {
    const svg = qrSvg('https://app.letsgo.vn/#/apply/AB3K9Z');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
  });
  it('tên file bỏ dấu', () => {
    expect(safeFileName('Đối soát phí Co-Herent 2026-12')).toBe('Doi soat phi Co-Herent 2026-12');
  });
});

describe('Xuất Excel', () => {
  it('dựng file có tiêu đề, bảng, dòng tổng, định dạng tiền', async () => {
    const buf = await buildXlsx([{ name: 'Đối soát', title: ['BẢNG ĐỐI SOÁT', 'Khách: Co-Herent'], headers: ['STT', 'Họ tên', 'Phí (đ)'],
      rows: [[1, 'Nguyễn Văn A', 2_500_000], [2, 'Trần Thị B', 2_500_000]], total: ['', 'TỔNG', 5_000_000], moneyCols: [2] }]);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Đối soát')!;
    expect(ws.getCell('A1').value).toBe('BẢNG ĐỐI SOÁT');
    expect(ws.getCell('B4').value).toBe('Họ tên');       // 2 dòng tiêu đề + 1 dòng trống → bảng ở dòng 4
    expect(ws.getCell('B5').value).toBe('Nguyễn Văn A');
    expect(ws.getCell('C7').value).toBe(5_000_000);
    expect(ws.getColumn(3).numFmt).toBe('#,##0');
  });
});
