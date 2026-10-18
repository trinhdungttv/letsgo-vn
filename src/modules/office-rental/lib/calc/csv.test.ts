import { describe, expect, it } from 'vitest';
import { BOM, buildFeeCsvTemplate, parseCsv, parseFeeCsv, toCsv } from './csv';

const tenants = [
  { id: 't1', name: 'XHOME' },
  { id: 't2', name: 'Công ty A, B & C' },
  { id: 't3', name: 'Thịnh Phát' },
];

describe('parseCsv', () => {
  it('BOM, ngoặc kép, dấu phẩy & xuống dòng trong ô, CRLF', () => {
    const recs = parseCsv(`${BOM}a,b\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",z\n`);
    expect(recs).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['x, y', 'say "hi"'] },
      { line: 4, cells: ['multi\nline', 'z'] },
    ]);
  });
  it('toCsv → parseCsv khứ hồi', () => {
    const rows = [['Thang', 'Khach_hang'], ['2026-08', 'Công ty A, B & C'], ['2026-08', 'Có "ngoặc"']];
    expect(parseCsv(toCsv(rows)).map(r => r.cells)).toEqual(rows);
  });
});

describe('parseFeeCsv (5.7)', () => {
  it('nhiều tháng × nhiều khách, khớp tên không phân biệt hoa thường', () => {
    const csv = [
      'Thang,Khach_hang,Dien,Xe_may,O_to',
      '2026-07,xhome,"2,000,000",5,1',
      '2026-08,"công ty a, b & c",1500000,0,2',
      '2026-08,  THỊNH PHÁT ,,3,',
    ].join('\n');
    const r = parseFeeCsv(BOM + csv, tenants);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, month: '2026-07', tenantId: 't1', tenantName: 'XHOME', fee: { electricity: 2_000_000, moto: 5, car: 1 } },
      { line: 3, month: '2026-08', tenantId: 't2', tenantName: 'Công ty A, B & C', fee: { electricity: 1_500_000, moto: 0, car: 2 } },
      { line: 4, month: '2026-08', tenantId: 't3', tenantName: 'Thịnh Phát', fee: { electricity: 0, moto: 3, car: 0 } },
    ]);
  });
  it('dòng lỗi báo đúng số dòng + lý do, dòng hợp lệ vẫn nhập', () => {
    const csv = [
      'Thang,Khach_hang,Dien,Xe_may,O_to',
      '2026-8,XHOME,100,1,0',
      '2026-08,Không Tồn Tại,100,1,0',
      '2026-08,XHOME,-5,1,0',
      '2026-08,XHOME,abc,1.5,0',
      '2026-09,XHOME,100,1,0',
    ].join('\n');
    const r = parseFeeCsv(csv, tenants);
    expect(r.rows.map(x => x.line)).toEqual([6]);
    expect(r.errors.map(e => e.line)).toEqual([2, 3, 4, 5]);
    expect(r.errors[0].message).toMatch(/sai định dạng tháng/);
    expect(r.errors[1].message).toMatch(/không tìm thấy khách "Không Tồn Tại"/);
    expect(r.errors[2].message).toMatch(/âm/);
    expect(r.errors[3].message).toMatch(/không phải số nguyên/);
  });
  it('sai tiêu đề → từ chối cả file', () => {
    const r = parseFeeCsv('Month,Customer,Dien,Xe_may,O_to\n2026-08,XHOME,1,1,1', tenants);
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toMatchObject({ line: 1 });
  });
  it('trùng khách + tháng → lấy dòng sau, có cảnh báo', () => {
    const r = parseFeeCsv('Thang,Khach_hang,Dien,Xe_may,O_to\n2026-08,XHOME,1,0,0\n2026-08,XHOME,2,0,0', tenants);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].fee.electricity).toBe(2);
    expect(r.warnings[0].line).toBe(3);
  });
  it('file mẫu điền sẵn khách của tháng và đọc lại được', () => {
    const tpl = buildFeeCsvTemplate('2026-08', tenants, { t1: { electricity: 2_000_000, moto: 5, car: 1 } });
    expect(tpl.startsWith(BOM)).toBe(true);
    const r = parseFeeCsv(tpl, tenants);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].fee).toEqual({ electricity: 2_000_000, moto: 5, car: 1 });
    expect(r.rows[1].tenantName).toBe('Công ty A, B & C');
  });
});
