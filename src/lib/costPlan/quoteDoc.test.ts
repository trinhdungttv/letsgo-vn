import { describe, it, expect } from 'vitest';
import { computePlan, DEFAULT_SETTINGS, newLine } from './engine';
import { dateLong, dateShort, defaultDoc, docFileName, docIssues, normalizeDoc, normalizeProfile, resolveDoc, suggestNumber, type CompanyProfileData, type QuoteDoc } from './quoteDoc';
import { defaultQuoteSheet } from './quoteSheet';
import type { PlanData } from './types';

const plan = (quote?: Partial<ReturnType<typeof defaultQuoteSheet>>): PlanData => ({
  settings: { ...DEFAULT_SETTINGS, taxOption: 'none' }, notes: '', quote: quote ? { ...defaultQuoteSheet(), ...quote } : null,
  lines: [
    newLine({ name: 'Lương cơ bản', unit: 'day', value: 250_000, paidToWorker: true, isBaseWage: true, group: 'worker' }),
    newLine({ name: 'Phụ cấp độc hại', unit: 'day', value: 40_000, paidToWorker: true, group: 'worker' }),
    newLine({ name: 'BHXH (DN đóng 21,5%)', unit: 'day', value: 60_000, group: 'compliance' }),
    newLine({ name: 'Phí dịch vụ', unit: 'day', value: 74_000, isServiceFee: true, group: 'service' }),
  ],
});
const profile: CompanyProfileData = { name: "CÔNG TY TNHH LET'S GO VN", address: '12 Nguyễn Ái Quốc, Biên Hòa, Đồng Nai', taxCode: '3601234567', phone: '0251 123 456', email: 'sales@letsgo.vn', website: 'letsgo.vn', signerName: 'Nguyễn Văn A', signerTitle: 'Giám đốc', place: 'Biên Hòa' };
const TODAY = new Date(2026, 9, 3);
const mk = (lang: QuoteDoc['lang'], over: Partial<QuoteDoc> = {}): QuoteDoc => ({ ...defaultDoc(TODAY, { name: 'Công ty ABC' }, lang), number: 'BG-20261003-123', ...over });
const view = (doc: QuoteDoc, p = plan()) => resolveDoc(doc, p, computePlan(p), profile, { industry: 'Hóa chất' });

describe('mặc định', () => {
  it('ngày hôm nay, hiệu lực +30 ngày, số báo giá đúng dạng', () => {
    const d = defaultDoc(TODAY);
    expect(d.date).toBe('2026-10-03'); expect(d.validUntil).toBe('2026-11-02');
    expect(suggestNumber(TODAY, 7)).toBe('BG-20261003-7');
  });
  it('lấy sẵn thông tin khách từ hồ sơ CRM (kể cả ngày hiệu lực & điều khoản thanh toán)', () => {
    const d = defaultDoc(TODAY, { name: 'ABC', address: 'KCN X', taxCode: '123', attn: 'Chị Lan', phone: '09', validUntil: '2026-12-31', payment: 'Chuyển khoản 30 ngày' });
    expect(d.customer).toEqual({ name: 'ABC', attn: 'Chị Lan', address: 'KCN X', taxCode: '123', phone: '09', mobile: '', email: '' });
    expect(d.validUntil).toBe('2026-12-31'); expect(d.payment).toBe('Chuyển khoản 30 ngày');
  });
  it('đọc dữ liệu rác không lỗi', () => {
    expect(normalizeDoc(null)).toBeNull();
    expect(normalizeDoc({ lang: 'xx', customer: 5 })!.lang).toBe('vi');
    expect(normalizeProfile(null).name).toBe('');
  });
});

describe('3 phiên bản ngôn ngữ', () => {
  it('Tiếng Việt: chỉ có dòng chính', () => {
    const v = view(mk('vi'));
    expect(v.title).toEqual({ a: 'BẢNG BÁO GIÁ DỊCH VỤ' });
    expect(v.rows[0].name).toEqual({ a: 'Lương ngày làm việc 8 tiếng' });
    expect(v.rows[0].unit).toEqual({ a: 'VNĐ/ngày' });
    expect(v.labels.s2).toEqual({ a: 'Bảng giá dịch vụ' });
    expect(v.notes.every(n => n.b === undefined)).toBe(true);
  });
  it('Việt–Trung: Việt trên, Trung dưới (đúng chữ trên bảng báo giá thật)', () => {
    const v = view(mk('zh'));
    expect(v.title).toEqual({ a: 'BẢNG BÁO GIÁ DỊCH VỤ', b: '服务报价单' });
    expect(v.rows.map(r => r.name.b)).toEqual(['8小时工作日工资', '8小时夜班工作日工资', '加班工资每天增加1小时', '夜班加班费1小时', '周日加班1小时', '周日加班费1小时夜班']);
    expect(v.rows[0].unit).toEqual({ a: 'VNĐ/ngày', b: '越南盾/天' });
    expect(v.labels.thPrice.b).toBe('单价（越南盾）');
    expect(v.notes[0]).toEqual({ a: 'Báo giá chưa bao gồm thuế VAT.', b: '报价不含增值税（VAT）。' });
  });
  it('Anh–Việt: Anh trên, Việt dưới', () => {
    const v = view(mk('en'));
    expect(v.title).toEqual({ a: 'SERVICE QUOTATION', b: 'BẢNG BÁO GIÁ DỊCH VỤ' });
    expect(v.rows[0].name).toEqual({ a: 'Daily wage (8 working hours)', b: 'Lương ngày làm việc 8 tiếng' });
    expect(v.rows[0].unit.a).toBe('VND/day');
    expect(v.rows[3].name.a).toBe('Overtime pay per hour - weekday night');
    expect(v.notes[0].a).toBe('Prices exclude VAT.');
  });
  it('đổi ngôn ngữ KHÔNG đổi số tiền', () => {
    expect(['vi', 'zh', 'en'].map(l => view(mk(l as QuoteDoc['lang'])).rows.map(r => r.price))).toEqual([
      [424_000, 499_000, 46_875, 62_500, 62_500, 84_375], [424_000, 499_000, 46_875, 62_500, 62_500, 84_375], [424_000, 499_000, 46_875, 62_500, 62_500, 84_375],
    ]);
  });
  it('tên dòng người dùng tự sửa thì giữ nguyên ở mọi ngôn ngữ (không dịch bậy)', () => {
    const q = defaultQuoteSheet(); q.rows[0].name = 'Công nhật vận hành máy';
    for (const l of ['vi', 'zh', 'en'] as const) expect(view(mk(l), plan(q)).rows[0].name).toEqual({ a: 'Công nhật vận hành máy' });
  });
  it('dòng tuỳ chỉnh (vd phụ cấp cơm) hiện đúng', () => {
    const q = defaultQuoteSheet(); q.rows.push({ id: 'c', kind: 'custom', name: 'Phụ cấp cơm trưa', unit: 'VNĐ/ngày', override: 30_000, hidden: false });
    const r = (rows => rows[rows.length - 1])(view(mk('zh'), plan(q)).rows);
    expect(r.name).toEqual({ a: 'Phụ cấp cơm trưa' }); expect(r.price).toBe(30_000); expect(r.no).toBe(7);
  });
  it('dòng lễ/Tết ẩn mặc định → không có trong tài liệu; hiện lại thì có kèm bản dịch', () => {
    expect(view(mk('zh')).rows).toHaveLength(6);
    const q = defaultQuoteSheet(); q.rows.forEach(r => { r.hidden = false; });
    const rows = view(mk('zh'), plan(q)).rows;
    expect(rows).toHaveLength(8); expect(rows[6].name.b).toBe('节假日加班1小时');
  });
});

describe('nội dung tài liệu', () => {
  it('ngày dài theo từng ngôn ngữ', () => {
    expect(dateLong('vi', '2026-10-03')).toEqual({ a: 'ngày 03 tháng 10 năm 2026' });
    expect(dateLong('zh', '2026-10-03')).toEqual({ a: 'ngày 03 tháng 10 năm 2026', b: '2026年10月03日' });
    expect(dateLong('en', '2026-10-03')).toEqual({ a: 'October 3, 2026', b: 'ngày 03 tháng 10 năm 2026' });
    expect(dateShort('2026-10-03')).toBe('03/10/2026');
  });
  it('nơi ký + ngày', () => {
    expect(view(mk('vi')).placeDate.a).toBe('Biên Hòa, ngày 03 tháng 10 năm 2026');
    expect(view(mk('zh')).placeDate.b).toBe('Biên Hòa，2026年10月03日');
    expect(view(mk('vi', { place: 'TP.HCM' })).placeDate.a).toBe('TP.HCM, ngày 03 tháng 10 năm 2026');
  });
  it('đầu trang công ty: địa chỉ, MST, liên hệ; thiếu tên thì dùng Let’s Go VN', () => {
    const v = view(mk('vi'));
    expect(v.company.name).toBe("CÔNG TY TNHH LET'S GO VN");
    expect(v.company.lines).toEqual(['12 Nguyễn Ái Quốc, Biên Hòa, Đồng Nai', 'Mã số thuế: 3601234567', 'Điện thoại: 0251 123 456  ·  sales@letsgo.vn  ·  letsgo.vn']);
    const p = plan();
    expect(resolveDoc(mk('vi'), p, computePlan(p), normalizeProfile({}), {}).company.name).toBe("Let's Go VN");
  });
  it('khối khách hàng: chỉ hiện ô có dữ liệu', () => {
    const v = view(mk('vi', { customer: { name: 'ABC', attn: '', address: 'KCN X', taxCode: '', phone: '09', mobile: '', email: '' } }));
    expect(v.customer.rows.map(r => r.label.a)).toEqual(['Địa chỉ', 'Điện thoại']);
  });
  it('câu mở đầu / kết / nội dung dịch vụ mặc định theo ngôn ngữ, sửa tay thì dùng bản sửa', () => {
    expect(view(mk('vi')).intro.a).toBe("CÔNG TY TNHH LET'S GO VN xin trân trọng gửi tới Quý Công ty bảng báo giá dịch vụ cung ứng lao động như sau:");   // không lặp "Công ty Công ty"
    const p0 = plan();
    expect(resolveDoc(mk('vi'), p0, computePlan(p0), { ...profile, name: 'Let\'s Go VN' }, {}).intro.a).toMatch(/^Công ty Let's Go VN xin trân trọng/);
    expect(view(mk('en')).intro.a).toContain('is pleased to submit');
    expect(view(mk('zh')).intro.b).toContain('谨向贵公司');
    expect(view(mk('vi', { intro: 'Kính gửi anh chị bảng giá.' })).intro).toEqual({ a: 'Kính gửi anh chị bảng giá.' });
    expect(view(mk('vi')).serviceLines[1].a).toBe('Công việc: lao động phổ thông trong ngành Hóa chất.');
    expect(view(mk('vi', { serviceLines: 'Dòng 1\n\n  Dòng 2  ' })).serviceLines.map(l => l.a)).toEqual(['Dòng 1', 'Dòng 2']);
  });
  it('ghi chú: giữ mặc định đã dịch; user sửa thì dùng bản sửa; điều khoản thanh toán thêm vào cuối', () => {
    const q = defaultQuoteSheet(); q.generalNotes = 'Giá chưa gồm cơm.\nGiá chưa gồm VAT.';
    expect(view(mk('zh'), plan(q)).notes.map(n => n.a)).toEqual(['Giá chưa gồm cơm.', 'Giá chưa gồm VAT.']);
    const v = view(mk('en', { payment: 'Chuyển khoản trong 30 ngày' }));
    expect(v.notes[v.notes.length - 1].a).toBe('Payment: Chuyển khoản trong 30 ngày');
    expect(v.notes).toHaveLength(4);
  });
  it('câu "Bao gồm: …" đặt dưới bảng (không dùng ô gộp); bản Anh đổi tiền tố thành "Includes:"', () => {
    expect(view(mk('vi')).includedNote).toBe('Bao gồm: phụ cấp độc hại, BHXH, phí dịch vụ.');
    expect(view(mk('en')).includedNote).toBe('Includes: phụ cấp độc hại, BHXH, phí dịch vụ.');
    const q = defaultQuoteSheet(); q.includedNote = 'Đã gồm mọi chi phí.';
    expect(view(mk('zh'), plan(q)).includedNote).toBe('Đã gồm mọi chi phí.');
    q.includedNote = '';
    expect(view(mk('vi'), plan(q)).includedNote).toBe('');
  });
  it('hiệu lực & người ký (mặc định từ hồ sơ công ty, sửa riêng cho từng báo giá được)', () => {
    expect(view(mk('vi', { validUntil: '2026-11-02' })).validText!.a).toBe('Báo giá có hiệu lực đến: 02/11/2026');
    expect(view(mk('vi', { validUntil: '' })).validText).toBeNull();
    expect(view(mk('vi')).signer).toMatchObject({ name: 'Nguyễn Văn A', role: 'Giám đốc' });
    expect(view(mk('vi', { signerName: 'Trần B', signerTitle: 'Phó giám đốc' })).signer).toMatchObject({ name: 'Trần B', role: 'Phó giám đốc' });
  });
});

describe('nhắc kiểm tra trước khi xuất', () => {
  const issues = (doc: QuoteDoc, p = plan(), pr = profile, o = { sign: false, seal: false }) => docIssues(doc, view(doc, p), pr, o);
  it('đủ thông tin → không có cảnh báo', () => expect(issues(mk('vi'))).toEqual([]));
  it('thiếu tên khách → lỗi', () => expect(issues(mk('vi', { customer: { name: '', attn: '', address: '', taxCode: '', phone: '', mobile: '', email: '' } })).some(i => i.level === 'error' && /tên khách/.test(i.text))).toBe(true));
  it('giá bằng 0 → lỗi', () => {
    const q = defaultQuoteSheet(); q.rows[2].override = 0;
    expect(issues(mk('vi'), plan(q)).some(i => i.level === 'error' && /bằng 0/.test(i.text))).toBe(true);
  });
  it('thiếu địa chỉ/MST công ty và tên công ty → nhắc', () => {
    const t = issues(mk('vi'), plan(), normalizeProfile({})).map(i => i.text).join('|');
    expect(t).toMatch(/tên công ty/); expect(t).toMatch(/địa chỉ hoặc mã số thuế/);
  });
  it('hết hiệu lực trước ngày báo giá → nhắc', () => expect(issues(mk('vi', { validUntil: '2026-09-01' })).some(i => /sớm hơn/.test(i.text))).toBe(true));
  it('chèn chữ ký/dấu mà chưa có tên người đại diện → nhắc', () => {
    const noSigner = { ...profile, signerName: '' };
    const p = plan();
    const v = resolveDoc(mk('vi'), p, computePlan(p), noSigner, {});
    expect(docIssues(mk('vi'), v, noSigner, { sign: true, seal: false }).some(i => /người đại diện/.test(i.text))).toBe(true);
    expect(docIssues(mk('vi'), v, noSigner, { sign: false, seal: false }).some(i => /người đại diện/.test(i.text))).toBe(false);
  });
});

describe('tên file', () => {
  it('bỏ dấu, gọn, có số báo giá', () => expect(docFileName(view(mk('vi', { customer: { name: 'CÔNG TY TNHH Đồ Gỗ Việt', attn: '', address: '', taxCode: '', phone: '', mobile: '', email: '' } })))).toBe('Bao-gia-CONG-TY-TNHH-Do-Go-Viet-BG-20261003-123.pdf'));
  it('chưa có tên khách vẫn ra tên hợp lệ', () => expect(docFileName(view(mk('vi', { customer: { name: '', attn: '', address: '', taxCode: '', phone: '', mobile: '', email: '' } })))).toBe('Bao-gia-BG-20261003-123.pdf'));
});
