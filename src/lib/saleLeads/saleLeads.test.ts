import { describe, expect, it } from 'vitest';
import {
  draftsFromGrid, findHeaderRow, formatPhoneKey, gridFromText, guessMapping, headerField, parseStatusText, phoneKey, phoneKeysOf,
  type Grid,
} from './parse';
import {
  buildPhoneIndex, checkDrafts, companyKeys, matchAreaZones, matchCompetitor, mergeLeadPatch, splitAreaText, unmatchedAreaParts,
} from './match';
import { mapSaleLeadRow, type SaleLead } from './types';

const cell = (text: string, href = '') => ({ text, href });
const row = (...cells: (string | [string, string])[]) => cells.map(c => (Array.isArray(c) ? cell(c[0], c[1]) : cell(c)));

/** Mẫu "DANH SÁCH ĐẦU MỐI TUYỂN DỤNG" của Tony (Google Sheets, dán dạng HTML có link). */
const SHEET: Grid = [
  row('DANH SÁCH ĐẦU MỐI TUYỂN DỤNG'),
  row('STT', 'TÊN', 'SĐT', 'TÌNH TRẠNG', 'KHU VỰC', 'LINK KÊNH', 'LINK BÀI ĐĂNG', 'GHI CHÚ'),
  row('1', 'Quỳnh Nguyễn', '0383.772337', '', 'KCN Mỹ Phước 3, KCN VSIP 2, KCN VSIP 2A Mở rộng', ['Link', 'https://facebook.com/quynh'], ['Link', 'https://facebook.com/posts/1'], ''),
  row('2', 'Hồng Ngân Hr', '0814821788', 'Manpower', 'KCN VSIP 3', ['Link', 'https://facebook.com/ngan'], ['Link', 'https://facebook.com/posts/2'], 'Đang tuyển cho Coherent'),
  row('14', 'Mỹ Hương Hr', '0937. 506.355', 'Green Speed', 'KCN VSIP 1-2', ['Link', 'https://fb.com/huong'], ['Link', 'https://fb.com/p/14'], ''),
  row('16', 'Cẩm Thơ Hr', '0933.885.105', 'Green Speed', 'KCN VSIP 1-2, KCN Sóng Thần 1-2', ['Link', 'https://fb.com/tho'], ['Link', 'https://fb.com/p/16'], ''),
];

const ZONES = [
  { id: 'z-mp3', name: 'KCN Mỹ Phước 3' },
  { id: 'z-mp', name: 'KCN Mỹ Phước' },
  { id: 'z-v2', name: 'KCN VSIP 2' },
  { id: 'z-v3', name: 'KCN VSIP 3' },
  { id: 'z-st1', name: 'KCN Sóng Thần 1' },
  { id: 'z-st2', name: 'KCN Sóng Thần 2' },
];

function lead(over: Partial<SaleLead>): SaleLead {
  return {
    ...mapSaleLeadRow({
      id: 'l1', full_name: '', phone: '', phone_keys: [], company: '', zone_ids: [], area_text: '', channel_url: '', post_url: '', note: '',
      status: 'new', contact_log: [], last_contact_at: null, promoted_contact_id: null, promoted_at: null, source: '', created_by: '',
      created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z',
    }),
    ...over,
  };
}

describe('SĐT', () => {
  it('chuẩn hoá về 0xxxxxxxxx', () => {
    expect(phoneKey('0383.772337')).toBe('0383772337');
    expect(phoneKey('0937. 506.355')).toBe('0937506355');
    expect(phoneKey('0866 780 467')).toBe('0866780467');
    expect(phoneKey('+84 912 345 678')).toBe('0912345678');
    expect(phoneKey('84912345678')).toBe('0912345678');
    expect(phoneKey('0084912345678')).toBe('0912345678');
    // Google Sheets bỏ số 0 đầu
    expect(phoneKey('383772337')).toBe('0383772337');
    // Đầu số cũ 11 số → mới
    expect(phoneKey('0168 123 4567')).toBe('0381234567');
    expect(phoneKey('02743 123 456')).toBe('02743123456');
    expect(phoneKey('12345')).toBe('');
    expect(phoneKey('')).toBe('');
  });

  it('ô nhiều số', () => {
    expect(phoneKeysOf('0909 123 456 / 0912.345.678')).toEqual(['0909123456', '0912345678']);
    expect(phoneKeysOf('0909123456 hoặc 0912345678')).toEqual(['0909123456', '0912345678']);
    expect(phoneKeysOf('0909 123 456 0912 345 678')).toEqual(['0909123456', '0912345678']);
    expect(phoneKeysOf('0909123456, 0909.123.456')).toEqual(['0909123456']);
    expect(phoneKeysOf('không có')).toEqual([]);
  });

  it('hiển thị dễ đọc', () => {
    expect(formatPhoneKey('0912345678')).toBe('0912 345 678');
  });
});

describe('đọc bảng', () => {
  it('chữ phân tab, ô có xuống dòng trong ngoặc kép', () => {
    const g = gridFromText('TÊN\tSĐT\tKHU VỰC\nLinda\t0962.051.250\t"KCN VSIP 2,\nKCN Bàu Bàng"\n\n');
    expect(g).toHaveLength(2);
    expect(g[1][2].text).toBe('KCN VSIP 2,\nKCN Bàu Bàng');
    expect(gridFromText('https://fb.com/a')[0][0].href).toBe('https://fb.com/a');
  });

  it('tiêu đề cột', () => {
    expect(headerField('SĐT')).toBe('phone');
    expect(headerField('LINK KÊNH')).toBe('channel');
    expect(headerField('LINK BÀI ĐĂNG')).toBe('post');
    expect(headerField('Khu vực')).toBe('area');
    expect(headerField('Ghi chú')).toBe('note');
    expect(headerField('Số điện thoại / Zalo')).toBe('phone');
    expect(headerField('Cột lạ')).toBe('skip');
  });

  it('mẫu Đầu mối tuyển dụng: "Tình trạng" ghi tên công ty → Đơn vị', () => {
    const h = findHeaderRow(SHEET);
    expect(h).toBe(1);
    expect(guessMapping(SHEET, h)).toEqual(['stt', 'name', 'phone', 'company', 'area', 'channel', 'post', 'note']);
  });

  it('cột tình trạng ghi trạng thái thật → giữ là Tình trạng', () => {
    const g: Grid = [
      row('Tên', 'SĐT', 'Tình trạng'),
      row('A', '0909123456', 'Không nghe máy'),
      row('B', '0909123457', 'Đã gọi, quan tâm'),
    ];
    expect(guessMapping(g, 0)).toEqual(['name', 'phone', 'status']);
    expect(parseStatusText('Không quan tâm')).toBe('declined');
    expect(parseStatusText('Hẹn gặp thứ 6')).toBe('meeting');
    expect(parseStatusText('Thuê bao')).toBe('no_answer');
    expect(parseStatusText('Manpower')).toBeNull();
  });

  it('dán chỉ phần dữ liệu (không tiêu đề) → đoán theo nội dung', () => {
    const body = SHEET.slice(2);
    expect(findHeaderRow(body)).toBe(-1);
    expect(guessMapping(body, -1)).toEqual(['stt', 'name', 'phone', 'company', 'area', 'channel', 'post', 'note']);
  });

  it('dán 1 cột SĐT', () => {
    const g = gridFromText('0909123456\n0912 345 678\n');
    expect(guessMapping(g, -1)).toEqual(['phone']);
    const { drafts } = draftsFromGrid(g, -1, ['phone']);
    expect(drafts.map(d => d.phoneKeys[0])).toEqual(['0909123456', '0912345678']);
  });

  it('dựng dòng: bỏ tựa bảng, lấy link, STT làm số dòng', () => {
    const h = findHeaderRow(SHEET);
    const { drafts, lostLinks } = draftsFromGrid(SHEET, h, guessMapping(SHEET, h));
    expect(lostLinks).toBe(0);
    expect(drafts).toHaveLength(4);
    expect(drafts[1]).toMatchObject({
      line: '2', fullName: 'Hồng Ngân Hr', phoneKeys: ['0814821788'], company: 'Manpower', areaText: 'KCN VSIP 3',
      channelUrl: 'https://facebook.com/ngan', postUrl: 'https://facebook.com/posts/2', note: 'Đang tuyển cho Coherent', status: null,
    });
  });

  it('dán chữ thường mất link → đếm để báo', () => {
    const g: Grid = [row('Tên', 'SĐT', 'Link kênh'), row('A', '0909123456', 'Link')];
    const { drafts, lostLinks } = draftsFromGrid(g, 0, guessMapping(g, 0));
    expect(drafts[0].channelUrl).toBe('');
    expect(lostLinks).toBe(1);
  });

  it('tình trạng không hiểu → giữ chữ ở ghi chú', () => {
    const g: Grid = [row('Tên', 'SĐT', 'Đơn vị', 'Tình trạng'), row('A', '0909123456', 'X', 'Gửi CV rồi')];
    const { drafts } = draftsFromGrid(g, 0, guessMapping(g, 0));
    expect(drafts[0].status).toBeNull();
    expect(drafts[0].note).toBe('Tình trạng: Gửi CV rồi');
  });
});

describe('khu vực → KCN', () => {
  it('tách + mở khoảng', () => {
    expect(splitAreaText('KCN VSIP 1-2, KCN Sóng Thần 1-2')).toEqual(['KCN VSIP 1', 'KCN VSIP 2', 'KCN Sóng Thần 1', 'KCN Sóng Thần 2']);
    expect(splitAreaText('VSIP 1, 2A')).toEqual(['VSIP 1', 'VSIP 2A']);
    expect(splitAreaText('KCN Mỹ Phước 3 và KCN Bàu Bàng')).toEqual(['KCN Mỹ Phước 3', 'KCN Bàu Bàng']);
  });

  it('ghép danh mục, giữ phần chưa có', () => {
    expect(matchAreaZones('KCN Mỹ Phước 3, KCN VSIP 2, KCN VSIP 2A Mở rộng', ZONES))
      .toEqual({ ids: ['z-mp3', 'z-v2'], unmatched: ['KCN VSIP 2A Mở rộng'] });
    expect(matchAreaZones('KCN VSIP 1-2, KCN Sóng Thần 1-2', ZONES))
      .toEqual({ ids: ['z-v2', 'z-st1', 'z-st2'], unmatched: ['KCN VSIP 1'] });
    expect(unmatchedAreaParts('KCN VSIP 1-2', ['z-v2'], ZONES)).toEqual(['KCN VSIP 1']);
  });
});

describe('đơn vị → đối thủ', () => {
  const COMP = [
    { id: 'c1', name: 'ManPower' },
    { id: 'c2', name: 'TTN - HR ( Tâm Thiện Nhi )' },
    { id: 'c3', name: 'RITA ( PBNC )' },
    { id: 'c4', name: 'Human Power' },
    { id: 'c5', name: 'Nam Phú Phát' },
  ];
  it('khớp tên chính / tên trong ngoặc, bỏ chữ chung', () => {
    expect(companyKeys('TTN - HR ( Tâm Thiện Nhi )')).toEqual(['ttn', 'tamthiennhi']);
    expect(matchCompetitor('Manpower', COMP)?.id).toBe('c1');
    expect(matchCompetitor('TTN HR', COMP)?.id).toBe('c2');
    expect(matchCompetitor('RITA_TUYỂN DỤNG', COMP)?.id).toBe('c3');
    expect(matchCompetitor('Human Power', COMP)?.id).toBe('c4');
    expect(matchCompetitor('Phú Phát', COMP)).toBeNull();
    expect(matchCompetitor('Green Speed', COMP)).toBeNull();
    expect(matchCompetitor('', COMP)).toBeNull();
  });
});

describe('dò trùng', () => {
  const existing = lead({ id: 'L', fullName: 'Quỳnh Nguyễn', phone: '0383.772337', phoneKeys: ['0383772337'], company: '' });
  const idx = buildPhoneIndex([existing], [
    { id: 'S', name: 'Linda', phone: '0962051250', kind: 'sale', org: 'Human Power' },
    { id: 'C', name: 'Chị Hoa', phone: '0909 000 111, 0912000111', kind: 'client', org: 'Công ty ABC' },
  ]);
  const d = (line: string, phone: string, fullName = 'X') => ({
    line, fullName, phone, phoneKeys: phoneKeysOf(phone), company: '', areaText: '', channelUrl: '', postUrl: '', note: '', status: null,
  });

  it('phân loại từng dòng', () => {
    const res = checkDrafts([
      d('1', '383772337'),        // Sheets bỏ số 0 → vẫn bắt trùng bảng nháp
      d('2', '0962.051.250'),     // đã là Sale / CTV
      d('3', '0912 000 111'),     // người liên hệ của khách
      d('4', '0977111222'),
      d('5', '0977.111.222'),     // trùng dòng 4 trong chính bảng dán
      d('6', ''),
      d('7', '12345'),
    ], idx);
    expect(res.map(r => r.kind)).toEqual(['dup_lead', 'dup_sale', 'dup_client', 'new', 'dup_batch', 'no_phone', 'bad_phone']);
    expect(res[0]).toMatchObject({ owner: { id: 'L', name: 'Quỳnh Nguyễn' } });
    expect(res[4]).toEqual({ kind: 'dup_batch', line: '4' });
  });

  it('bổ sung thông tin thiếu, không ghi đè', () => {
    const l = lead({ fullName: 'Quỳnh', company: 'Manpower', zoneIds: ['z-v2'], areaText: 'KCN VSIP 2', note: 'Đã gọi 1 lần' });
    const draft = { ...d('1', '0383772337', 'Quỳnh Nguyễn'), company: 'Khác', areaText: 'KCN VSIP 2, KCN VSIP 3', channelUrl: 'https://fb.com/q', note: 'Đang tuyển cho Coherent' };
    expect(mergeLeadPatch(l, draft, ['z-v2', 'z-v3'])).toEqual({
      channel_url: 'https://fb.com/q',
      zone_ids: ['z-v2', 'z-v3'],
      area_text: 'KCN VSIP 2, KCN VSIP 3',
      note: 'Đã gọi 1 lần\nĐang tuyển cho Coherent',
    });
    expect(mergeLeadPatch({ ...l, channelUrl: 'https://fb.com/q', zoneIds: ['z-v2', 'z-v3'], areaText: 'KCN VSIP 2, KCN VSIP 3', note: 'Đã gọi 1 lần\nĐang tuyển cho Coherent' }, draft, ['z-v2', 'z-v3'])).toBeNull();
  });
});
