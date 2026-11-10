import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../costPlan/quoteDoc';
import { DEFAULT_LAYOUT } from '../costPlan/entity';
import {
  buildGateDoc, buildGateRows, gateColumns, gateDateLine, gateFileName, gateIssues, guessPlace, isoToVn, resolvePlace, shortWeekday, visitWhen,
} from './gateList';
import { normalizeIdNumber, parseGender, parseMemberTable, parseVnDate, readXlsxTable } from './importMembers';
import { buildGateXlsx, signStartCol } from './gateXlsx';
import { normalizeGate, normalizeMeeting, normalizeMember, type MeetingMember } from './types';

const member = (p: Partial<MeetingMember>): MeetingMember => normalizeMember({
  id: 'm1', full_name: 'Nguyễn Thị Tâm', gender: 'Nữ', birth: '1983', id_number: '030183011915', id_issued_on: '2022-05-25',
  id_issued_by: 'CCSHCTTXH', address: 'Phường Hiệp Bình, TP. Hồ Chí Minh', title: 'Tổng Giám Đốc', ...p,
});
const TAM = member({});
const DUNG = member({
  id: 'm2', full_name: 'Trịnh Việt Dũng', gender: 'Nam', birth: '1993', id_number: '030093002317', id_issued_on: '2023-05-25',
  address: 'Phường Tam Bình, TP. Hồ Chí Minh', title: 'Giám đốc Kinh doanh',
});
const PROFILE = {
  ...emptyProfile(), name: "Công ty Cổ phần Let's Go VN", phone: '0926.42.3838',
  address: '273 Tổ 5, Khu phố 1, Phường Long Bình, TP Đồng Nai, Việt Nam', signerName: 'Nguyễn Thị Tâm',
};
const MEETING = normalizeMeeting({
  id: 'x', meet_date: '2026-11-11', meet_time: '08:30', company_name: 'TTI', location: 'KCN Long Đức', purpose: 'Họp giao ban',
  attendees: [{ id: 'm1', title: '' }, { id: 'm2', title: '' }],
});

describe('Danh sách vào cổng — dữ liệu', () => {
  it('giữ đúng thứ tự người tham dự, STT 2 chữ số, ngày cấp dd/mm/yyyy', () => {
    const rows = buildGateRows(MEETING, [DUNG, TAM]);
    expect(rows.map(r => [r.stt, r.name, r.gender, r.birth, r.idNumber, r.issuedOn, r.issuedBy, r.title])).toEqual([
      ['01', 'Nguyễn Thị Tâm', 'Nữ', '1983', '030183011915', '25/05/2022', 'CCSHCTTXH', 'Tổng Giám Đốc'],
      ['02', 'Trịnh Việt Dũng', 'Nam', '1993', '030093002317', '25/05/2023', 'CCSHCTTXH', 'Giám đốc Kinh doanh'],
    ]);
  });
  it('chức vụ riêng buổi họp thắng chức vụ hồ sơ; người đã bị bỏ khỏi danh sách thì bỏ qua', () => {
    const rows = buildGateRows({ attendees: [{ id: 'gone', title: '' }, { id: 'm2', title: 'Phó Tổng Giám đốc' }] }, [TAM, DUNG]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stt: '01', title: 'Phó Tổng Giám đốc' });
  });
  it('dòng ngày ký theo Nghị định 30: thêm số 0 cho ngày < 10 và tháng 1, 2', () => {
    expect(gateDateLine('Đồng Nai', '2026-11-10')).toBe('Đồng Nai, ngày 10 tháng 11 năm 2026');
    expect(gateDateLine('Đồng Nai', '2026-02-05')).toBe('Đồng Nai, ngày 05 tháng 02 năm 2026');
    expect(gateDateLine('Đồng Nai', '2026-03-05')).toBe('Đồng Nai, ngày 05 tháng 3 năm 2026');
    expect(gateDateLine('', '2026-12-25')).toBe('ngày 25 tháng 12 năm 2026');
  });
  it('đoán nơi ký từ địa chỉ pháp nhân', () => {
    expect(guessPlace(PROFILE.address)).toBe('Đồng Nai');
    expect(guessPlace('12 Lê Lợi, Quận 1, Thành phố Hồ Chí Minh')).toBe('Hồ Chí Minh');
    expect(guessPlace('KCN Nhơn Trạch, Tỉnh Đồng Nai')).toBe('Đồng Nai');
    expect(resolvePlace({}, { place: 'Biên Hòa', address: PROFILE.address })).toBe('Biên Hòa');
    expect(resolvePlace({ place: ' Long Thành ' }, { place: 'Biên Hòa', address: '' })).toBe('Long Thành');
    expect(resolvePlace({}, null)).toBe('');
  });
  it('tên file như công ty đặt (ngày = ngày họp)', () => {
    expect(gateFileName(MEETING, 'pdf')).toBe('Danh sách Đăng ký vào cổng TTI - 11.11.2026.pdf');
    expect(gateFileName({ meet_date: '2026-01-02', company_name: 'A/B: C' }, 'xlsx')).toBe('Danh sách Đăng ký vào cổng A B C - 02.01.2026.xlsx');
  });
  it('cột: 9 cột như mẫu, cột thêm đặt cuối; "Ngày sinh" khi có người ghi đủ ngày', () => {
    const rows = buildGateRows(MEETING, [TAM, DUNG]);
    expect(gateColumns(rows).map(c => c.label)).toEqual(
      ['STT', 'Họ và Tên', 'Giới tính', 'Năm sinh', 'Số CMND/CCCD', 'Ngày cấp', 'Nơi cấp', 'Địa chỉ thường trú', 'Chức vụ']);
    expect(gateColumns(rows, ['vehicle_plate', 'phone']).slice(-2).map(c => c.label)).toEqual(['Số điện thoại', 'Biển số xe']);
    const full = buildGateRows(MEETING, [member({ birth: '12/03/1983' }), DUNG]);
    expect(gateColumns(full)[3].label).toBe('Ngày sinh');
  });
  it('bản in đầy đủ: tên in hoa, địa chỉ, điện thoại, dòng ngày, tên người ký', () => {
    const doc = buildGateDoc({ meeting: MEETING, members: [TAM, DUNG], profile: PROFILE, options: { docDate: '2026-11-10' }, today: '2026-11-09' });
    expect(doc.companyName).toBe("CÔNG TY CỔ PHẦN LET'S GO VN");
    expect(doc.address).toBe('Địa chỉ: 273 Tổ 5, Khu phố 1, Phường Long Bình, TP Đồng Nai, Việt Nam');
    expect(doc.phone).toBe('Điện thoại: 0926.42.3838');
    expect(doc.title).toBe('DANH SÁCH ĐĂNG KÝ RA VÀO CỔNG');
    expect(doc.dateLine).toBe('Đồng Nai, ngày 10 tháng 11 năm 2026');
    expect(doc.signerName).toBe('Nguyễn Thị Tâm');
    expect(doc.recipient).toBe('');
    expect(doc.visit).toBe('');
    const opt = buildGateDoc({
      meeting: MEETING, members: [TAM], profile: PROFILE, today: '2026-11-09',
      options: { recipient: 'Kính gửi: Ban bảo vệ Công ty TTI', showVisit: true, showSigner: false },
    });
    expect(opt.recipient).toBe('Kính gửi: Ban bảo vệ Công ty TTI');
    expect(opt.visit).toBe('Thời gian: 08:30, Thứ Tư 11/11/2026   ·   Địa điểm: KCN Long Đức   ·   Nội dung: Họp giao ban');
    expect(opt.signerName).toBe('');
    expect(opt.dateLine).toBe('Đồng Nai, ngày 09 tháng 11 năm 2026');
  });
  it('nhắc chỗ thiếu trước khi gửi', () => {
    const rows = buildGateRows(MEETING, [member({ id_number: '30183011915', id_issued_on: null, gender: '' }), DUNG]);
    expect(gateIssues(rows, { entityMissing: true })).toEqual([
      'Chưa chọn pháp nhân đứng tên danh sách',
      'Nguyễn Thị Tâm: thiếu ngày cấp, giới tính; số CCCD có 11 chữ số (CCCD 12 số, CMND 9 số)',
    ]);
    expect(gateIssues(buildGateRows(MEETING, [TAM, DUNG]), { entityMissing: false })).toEqual([]);
  });
  it('tiện ích ngày / giờ', () => {
    expect(isoToVn('2026-11-11')).toBe('11/11/2026');
    expect(visitWhen({ meet_date: '2026-11-11', meet_time: '' })).toBe('Thứ Tư 11/11/2026');
    expect(['2026-11-08', '2026-11-09', '2026-11-11', '2026-11-14'].map(shortWeekday)).toEqual(['CN', 'T2', 'T4', 'T7']);
  });
});

describe('Chuẩn hoá dữ liệu từ DB', () => {
  it('buổi họp: bỏ người tham dự rỗng, trạng thái lạ → sắp họp, tuỳ chọn in lọc khoá lạ', () => {
    const m = normalizeMeeting({ id: '1', meet_date: '2026-11-11T00:00:00', status: 'xyz', attendees: [{ id: '' }, { id: 'a' }, null], gate: { extraCols: ['phone', 'hack'], docDate: 'bad' } });
    expect(m.meet_date).toBe('2026-11-11');
    expect(m.status).toBe('planned');
    expect(m.attendees).toEqual([{ id: 'a', title: '' }]);
    expect(m.gate).toEqual({ extraCols: ['phone'] });
    expect(normalizeGate(null)).toEqual({});
  });
});

describe('Nhập thành viên từ Excel', () => {
  // Bảng chữ y như file mẫu của công ty
  const TABLE = [
    ['', '', "CÔNG TY CỔ PHẦN LET'S GO VN"],
    ['', '', 'Địa chỉ: 273 Tổ 5, Khu phố 1, Phường Long Bình, TP Đồng Nai, Việt Nam'],
    [],
    ['DANH SÁCH ĐĂNG KÝ RA VÀO CỔNG'],
    ['STT', 'Họ và Tên', 'Giới tính', 'Năm sinh', 'Số CMND/CCCD', 'Ngày cấp', 'Nơi cấp', 'Địa chỉ thường trú', 'Chức vụ'],
    ['01', 'Nguyễn Thị Tâm', 'Nữ', '1983', '030183011915', '25/05/2022', 'CCSHCTTXH', 'Phường Hiệp Bình, TP. Hồ Chí Minh', 'Tổng Giám Đốc'],
    ['02', 'Trịnh  Việt Dũng', 'nam', '1993', '30093002317', '2023-05-25', 'CCSHCTTXH', 'Phường Tam Bình, TP. Hồ Chí Minh', 'Giám đốc Kinh doanh'],
    [],
    ['', '', '', '', '', '', 'Đồng Nai, ngày 10 tháng 11 năm 2026'],
    ['', '', '', '', '', '', "CÔNG TY CỔ PHẦN LET'S GO VN"],
  ];
  it('nhận đủ 2 người, dừng ở dòng ngày ký, sửa CCCD mất số 0 đầu', () => {
    const r = parseMemberTable(TABLE);
    expect(r.noHeader).toBe(false);
    expect(r.rows).toEqual([
      { full_name: 'Nguyễn Thị Tâm', gender: 'Nữ', birth: '1983', id_number: '030183011915', id_issued_on: '2022-05-25', id_issued_by: 'CCSHCTTXH', address: 'Phường Hiệp Bình, TP. Hồ Chí Minh', title: 'Tổng Giám Đốc', phone: '', vehicle_plate: '' },
      { full_name: 'Trịnh Việt Dũng', gender: 'Nam', birth: '1993', id_number: '030093002317', id_issued_on: '2023-05-25', id_issued_by: 'CCSHCTTXH', address: 'Phường Tam Bình, TP. Hồ Chí Minh', title: 'Giám đốc Kinh doanh', phone: '', vehicle_plate: '' },
    ]);
  });
  it('không thấy dòng tiêu đề → báo', () => {
    expect(parseMemberTable([['a', 'b'], ['c']]).noHeader).toBe(true);
  });
  it('tiện ích', () => {
    expect(parseVnDate('31/02/2024')).toBeNull();
    expect(parseVnDate('1/2/2024')).toBe('2024-02-01');
    expect(parseGender('Nữ')).toBe('Nữ');
    expect(parseGender('khác')).toBe('');
    expect(normalizeIdNumber('030 183 011 915')).toBe('030183011915');
    expect(normalizeIdNumber('23456789')).toBe('023456789');
  });
});

describe('File Excel', () => {
  it('dựng đúng khung mẫu và đọc ngược lại ra đúng người', async () => {
    const doc = buildGateDoc({ meeting: MEETING, members: [TAM, DUNG], profile: PROFILE, options: { docDate: '2026-11-10' }, today: '2026-11-10' });
    const buf = await buildGateXlsx(doc, { logo: null, signature: null, seal: null, layout: DEFAULT_LAYOUT });
    const table = await readXlsxTable(buf);
    const flat = table.map(r => r.join('|'));
    expect(flat.some(l => l.includes("CÔNG TY CỔ PHẦN LET'S GO VN"))).toBe(true);
    expect(flat.some(l => l.includes('DANH SÁCH ĐĂNG KÝ RA VÀO CỔNG'))).toBe(true);
    expect(flat.some(l => l.includes('Đồng Nai, ngày 10 tháng 11 năm 2026'))).toBe(true);
    expect(flat.some(l => l.includes('(Ký, ghi rõ họ tên, đóng dấu)'))).toBe(true);
    const back = parseMemberTable(table);
    expect(back.rows.map(r => [r.full_name, r.id_number, r.id_issued_on, r.title])).toEqual([
      ['Nguyễn Thị Tâm', '030183011915', '2022-05-25', 'Tổng Giám Đốc'],
      ['Trịnh Việt Dũng', '030093002317', '2023-05-25', 'Giám đốc Kinh doanh'],
    ]);
    // Khối ký bắt đầu ở cột "Nơi cấp" (G) như mẫu
    expect(signStartCol(doc)).toBe(7);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    expect(ws.pageSetup.orientation).toBe('landscape');
    expect([1, 2, 8, 9].map(c => ws.getColumn(c).width)).toEqual([7, 28, 50, 24]);
    // CCCD là chữ (giữ số 0 đầu)
    let cccd: unknown = null;
    ws.eachRow(row => row.eachCell(cell => { if (cell.value === '030183011915') cccd = cell.value; }));
    expect(cccd).toBe('030183011915');
  });
});
