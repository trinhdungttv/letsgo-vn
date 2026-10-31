import { describe, it, expect } from 'vitest';
import { normalizeQuoteInfo, standardLines, lineTotal, lineKind, quoteInfoIsEmpty, emptyQuoteInfo } from './quoteInfo';

describe('quoteInfo', () => {
  it('chuẩn hoá giá trị null / thiếu trường về dạng đầy đủ', () => {
    expect(normalizeQuoteInfo(null)).toEqual(emptyQuoteInfo());
    const q = normalizeQuoteInfo({ tax_code: '0312', lines: [{ label: 'Phổ thông', wage: 300000 }] });
    expect(q.tax_code).toBe('0312');
    expect(q.address).toBe('');
    expect(q.lines[0]).toMatchObject({ label: 'Phổ thông', wage: 300000, fee: null, unit: 'ngày công', workers: '' });
    expect(q.lines[0].id).toBeTruthy();
  });
  it('3 dòng chuẩn theo tab Báo giá tự động', () => {
    expect(standardLines().map(l => l.label)).toEqual(['Phổ thông', 'Tay nghề', 'Kỹ thuật viên']);
  });
  it('giá báo = lương + phí dịch vụ, ô trống tính là 0', () => {
    const [l] = standardLines();
    expect(lineTotal({ ...l, wage: 300000, fee: 25000 })).toBe(325000);
    expect(lineTotal({ ...l, wage: 300000, fee: null })).toBe(300000);
  });
  it('nhận biết thông tin báo giá còn trống', () => {
    expect(quoteInfoIsEmpty(emptyQuoteInfo())).toBe(true);
    expect(quoteInfoIsEmpty({ ...emptyQuoteInfo(), lines: standardLines() })).toBe(false);
  });
  it('báo giá giới thiệu: giá báo = phí / người; "cả hai" theo từng dòng; dữ liệu cũ = cho thuê', () => {
    const [l] = standardLines();
    const line = { ...l, wage: 8_000_000, fee: 2_000_000 };
    expect(lineKind({ service: 'recruitment' }, line)).toBe('recruitment');
    expect(lineTotal(line, 'recruitment')).toBe(2_000_000);
    expect(lineKind({ service: 'both' }, { ...line, kind: 'recruitment' })).toBe('recruitment');
    expect(lineKind({ service: 'both' }, line)).toBe('leasing');
    expect(lineKind({}, { ...line, kind: 'recruitment' })).toBe('leasing');
    expect(normalizeQuoteInfo({ lines: [] }).service).toBeUndefined();
  });
});
