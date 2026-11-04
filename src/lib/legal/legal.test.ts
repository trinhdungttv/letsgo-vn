import { describe, expect, it } from 'vitest';
import { guessTypeFromName, parseDocLink, resolveFileType } from './drive';
import {
  companyAge, currentValueFor, defaultMilestoneTitle, entityPatchFromChanges, fmtMoneyShort, groupByYear, initials,
  licenseAlerts, licenseState, ownerShares, parseMoney, sortMilestones, suggestChangeNo,
} from './timeline';
import { lessonText, moveBlock, newBlock, parseInline, parseLesson, starterLesson } from './lesson';
import { boxCounts, cardsFromLesson, cardsFromMindmap, dueCards, masteredPct, parseCards, review } from './cards';
import { entityOverviewMap, ownershipMap, templateMap } from './maps';
import { normEntity, normMilestone } from './api';
import type { LegalEntity, LegalMilestone } from './types';

const entity = (over: Partial<LegalEntity> = {}): LegalEntity => ({
  ...normEntity({ id: 'e1', name: "Công ty TNHH Let's Go Việt Nam", created_at: '2026-01-01', updated_at: '2026-01-01' }),
  ...over,
});
const ms = (over: Partial<LegalMilestone>): LegalMilestone => ({
  ...normMilestone({ id: Math.random().toString(36).slice(2), entity_id: 'e1', event_date: '2020-01-01', kind: 'thay_doi', created_at: '2026-01-01T00:00:00Z' }),
  ...over,
});

describe('parseDocLink — link Google Drive / Docs / YouTube', () => {
  it('file Drive (PDF, xlsx tải lên) → xem trước /preview', () => {
    const r = parseDocLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp_qrs-TUV/view?usp=sharing');
    expect(r.source).toBe('drive');
    expect(r.embedUrl).toBe('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp_qrs-TUV/preview');
    expect(r.fileType).toBeNull();
    expect(parseDocLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp').source).toBe('drive');
  });
  it('Docs / Sheets (giữ tab gid) / Slides / thư mục', () => {
    expect(parseDocLink('https://docs.google.com/document/d/1AbCdEfGhIjKl/edit#heading=h.1').embedUrl).toBe('https://docs.google.com/document/d/1AbCdEfGhIjKl/preview');
    const sh = parseDocLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKl/edit#gid=12345');
    expect(sh.fileType).toBe('sheet');
    expect(sh.embedUrl).toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKl/preview#gid=12345');
    expect(parseDocLink('https://docs.google.com/presentation/d/1AbCdEfGhIjKl/edit?usp=sharing').fileType).toBe('slide');
    const f = parseDocLink('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMn');
    expect(f.source).toBe('folder');
    expect(f.embedUrl).toBe('https://drive.google.com/embeddedfolderview?id=1AbCdEfGhIjKlMn#grid');
  });
  it('YouTube, ảnh, PDF trực tiếp, trang web, link hỏng', () => {
    expect(parseDocLink('https://youtu.be/dQw4w9WgXcQ').embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(parseDocLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10').id).toBe('dQw4w9WgXcQ');
    expect(parseDocLink('https://a.com/so-do.PNG').source).toBe('image');
    expect(parseDocLink('https://chinhphu.vn/van-ban.pdf').source).toBe('pdf');
    const web = parseDocLink('thuvienphapluat.vn/van-ban/abc');
    expect(web.source).toBe('web');
    expect(web.embedUrl).toBeNull();
    expect(web.openUrl).toBe('https://thuvienphapluat.vn/van-ban/abc');
    expect(parseDocLink('   ').source).toBe('invalid');
  });
  it('loại file: link > tên file > mặc định', () => {
    expect(guessTypeFromName('Điều lệ 2024.PDF')).toBe('pdf');
    expect(guessTypeFromName('Bảng lương.xlsx')).toBe('sheet');
    expect(guessTypeFromName('Không đuôi')).toBeNull();
    const drive = parseDocLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view');
    expect(resolveFileType(drive, 'Trình bày.pptx')).toBe('slide');
    expect(resolveFileType(drive, 'Giấy phép')).toBe('pdf');
    expect(resolveFileType(drive, 'x', 'doc')).toBe('doc');
  });
});

describe('Dòng thời gian pháp nhân', () => {
  it('gợi ý số lần thay đổi theo ngày, bỏ qua mốc đang sửa', () => {
    const list = [
      ms({ id: 'a', event_date: '2019-03-01', change_no: 1 }),
      ms({ id: 'b', event_date: '2021-06-01', change_no: 2 }),
      ms({ id: 'c', event_date: '2018-01-01', kind: 'thanh_lap' }),
    ];
    expect(suggestChangeNo(list, 'e1', '2022-01-01')).toBe(3);
    expect(suggestChangeNo(list, 'e1', '2020-01-01')).toBe(2);
    expect(suggestChangeNo(list, 'e1', '2022-01-01', 'b')).toBe(2);
    expect(suggestChangeNo(list, 'khac', '2022-01-01')).toBe(1);
    // chưa đánh số → đếm
    expect(suggestChangeNo([ms({ event_date: '2019-01-01' }), ms({ event_date: '2019-05-01' })], 'e1', '2020-01-01')).toBe(3);
  });
  it('tiêu đề mặc định, sắp xếp, nhóm theo năm', () => {
    expect(defaultMilestoneTitle('thay_doi', 4)).toBe('Đăng ký thay đổi lần thứ 4');
    expect(defaultMilestoneTitle('thanh_lap', null)).toBe('Thành lập doanh nghiệp');
    const sorted = sortMilestones([ms({ event_date: '2019-01-01' }), ms({ event_date: '2021-02-01' }), ms({ event_date: '2021-05-01' })]);
    expect(sorted.map(m => m.event_date)).toEqual(['2021-05-01', '2021-02-01', '2019-01-01']);
    expect(groupByYear(sorted).map(g => [g.year, g.items.length])).toEqual([['2021', 2], ['2019', 1]]);
  });
  it('tuổi doanh nghiệp', () => {
    expect(companyAge('2018-03-15', '2026-11-04')).toBe('8 năm 7 tháng');
    expect(companyAge('2026-11-01', '2026-11-04')).toBe('dưới 1 tháng');
    expect(companyAge(null)).toBe('');
  });
  it('giấy phép sắp / đã hết hạn', () => {
    const e = entity({ info: { owners: [], industries: [], banks: [], licenses: [
      { id: 'l1', name: 'GP cho thuê lại LĐ', number: '', issuer: '', issued: '', expires: '2026-12-01', url: '', note: '' },
      { id: 'l2', name: 'GP cũ', number: '', issuer: '', issued: '', expires: '2026-10-01', url: '', note: '' },
      { id: 'l3', name: 'Còn lâu', number: '', issuer: '', issued: '', expires: '2030-01-01', url: '', note: '' },
      { id: 'l4', name: 'Không hạn', number: '', issuer: '', issued: '', expires: '', url: '', note: '' },
    ] } });
    const alerts = licenseAlerts([e], '2026-11-04');
    expect(alerts.map(a => [a.license.id, a.daysLeft])).toEqual([['l2', -34], ['l1', 27]]);
    expect(licenseAlerts([{ ...e, status: 'dissolved' }], '2026-11-04')).toEqual([]);
    expect(licenseState('2026-10-01', '2026-11-04').tint).toBe('red');
    expect(licenseState('', '2026-11-04').label).toBe('Không thời hạn');
  });
  it('đọc số tiền gõ tay', () => {
    expect(parseMoney('5.000.000.000')).toBe(5_000_000_000);
    expect(parseMoney('5,000,000,000 đ')).toBe(5_000_000_000);
    expect(parseMoney('1,5 tỷ')).toBe(1_500_000_000);
    expect(parseMoney('800 triệu')).toBe(800_000_000);
    expect(parseMoney('800tr')).toBe(800_000_000);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(fmtMoneyShort(1_500_000_000)).toBe('1,5 tỷ');
  });
  it('tỉ lệ vốn: theo % nhập, không thì tính từ số vốn', () => {
    const owners = [
      { id: 'a', name: 'A', capital: 3_000_000_000, percent: null, note: '' },
      { id: 'b', name: 'B', capital: null, percent: 40, note: '' },
    ];
    expect(ownerShares(owners, 5_000_000_000).map(o => o.pct)).toEqual([60, 40]);
  });
  it('ghi nội dung thay đổi vào hồ sơ hiện tại', () => {
    const patch = entityPatchFromChanges([
      { id: '1', aspect: 'address', from: 'Cũ', to: ' 12 Lê Lợi ' },
      { id: '2', aspect: 'capital', from: '', to: '10 tỷ' },
      { id: '3', aspect: 'owners', from: '', to: 'Ông A' },
      { id: '4', aspect: 'legal_rep', from: 'X', to: '' },
    ]);
    expect(patch).toEqual({ address: '12 Lê Lợi', charter_capital: 10_000_000_000 });
    expect(currentValueFor(entity({ charter_capital: 5e9 }), 'capital')).toBe('5.000.000.000 đ');
  });
  it('chữ viết tắt logo', () => {
    expect(initials("Công ty TNHH Let's Go Việt Nam")).toBe('LG');
    expect(initials('Orient')).toBe('O');
  });
});

describe('Bài học trực quan', () => {
  it('đọc JSON hỏng không lỗi, giữ khối hợp lệ', () => {
    const d = parseLesson({ accent: 'xanh', blocks: [{ t: 'p', text: 'a' }, { t: 'lạ' }, null, { t: 'callout', tone: 'sai', text: 'b' }, { t: 'compare', cols: ['x'], rows: [['1', '2', '3']] }] });
    expect(d.accent).toBe('#FF9500');
    expect(d.blocks.map(b => b.t)).toEqual(['p', 'callout', 'compare']);
    expect(d.blocks[1]).toMatchObject({ tone: 'define' });
    expect(d.blocks[2]).toMatchObject({ cols: ['x', ''], rows: [['1', '2']] });
    expect(parseLesson(null).blocks).toEqual([]);
  });
  it('định dạng trong dòng **đậm** ==tô== !!đỏ!!', () => {
    expect(parseInline('Phạt **5 triệu** nếu ==quá hạn== và !!không nộp!!.')).toEqual([
      { text: 'Phạt ' }, { text: '5 triệu', mark: 'bold' }, { text: ' nếu ' }, { text: 'quá hạn', mark: 'hl' },
      { text: ' và ' }, { text: 'không nộp', mark: 'red' }, { text: '.' },
    ]);
    expect(parseInline('thường')).toEqual([{ text: 'thường' }]);
  });
  it('đổi chỗ khối, chữ thuần', () => {
    const a = newBlock('p');
    const b = newBlock('h');
    expect(moveBlock([a, b], b.id, -1).map(x => x.id)).toEqual([b.id, a.id]);
    expect(moveBlock([a, b], a.id, -1)).toEqual([a, b]);
    expect(lessonText(starterLesson('Thành lập DN'))).toContain('Thủ tục');
  });
});

describe('Thẻ ghi nhớ', () => {
  const map = templateMap('procedure', 'Thay đổi ĐKKD');
  it('tạo thẻ từ sơ đồ: chủ đề có nhánh con → 1 thẻ', () => {
    const cards = cardsFromMindmap(map);
    expect(cards[0].front).toBe('Thay đổi ĐKKD');
    expect(cards[0].back).toContain('• Hồ sơ cần có');
    expect(cards.some(c => c.front === 'Thay đổi ĐKKD › Hồ sơ cần có' && c.back.includes('• Giấy tờ 1'))).toBe(true);
  });
  it('tạo thẻ từ bài học: khối màu + các bước', () => {
    const cards = cardsFromLesson(starterLesson('Thành lập'), 'Thành lập');
    expect(cards.map(c => c.front)).toContain('Mức phạt — Thủ tục');
    expect(cards.find(c => c.front.startsWith('Các bước'))?.back).toContain('1. Chuẩn bị hồ sơ');
  });
  it('hộp nhớ Leitner', () => {
    const now = 1_000_000_000_000;
    const p1 = review(undefined, true, now);
    expect(p1.box).toBe(1);
    expect(p1.due).toBe(now + 86_400_000);
    const p2 = review(p1, true, now);
    expect(p2.box).toBe(2);
    const p3 = review(p2, false, now);
    expect(p3).toMatchObject({ box: 1, seen: 3, ok: 2 });
    const cards = parseCards({ cards: [{ id: 'a', front: 'Q', back: 'A' }, { id: 'b', front: 'Q2', back: '' }, { id: 'c', front: '', back: '' }] }).cards;
    expect(dueCards(cards, { a: { box: 2, due: now + 1, seen: 1, ok: 1 } }, now).map(c => c.id)).toEqual(['b']);
    expect(boxCounts(cards, { a: { box: 3, due: 0, seen: 1, ok: 1 } })).toEqual([2, 0, 0, 1, 0, 0]);
    expect(masteredPct(cards, { a: { box: 3, due: 0, seen: 1, ok: 1 } })).toBe(33);
  });
});

describe('Sơ đồ dựng sẵn', () => {
  it('cơ cấu sở hữu + sơ đồ tổng quan pháp nhân', () => {
    const e = entity({
      short_name: "Let's Go", charter_capital: 5e9, tax_code: '0312345678',
      info: { owners: [{ id: 'o', name: 'Ông A', capital: 5e9, percent: null, note: '' }], industries: [{ id: 'i', code: '7830', name: 'Cung ứng lao động', main: true }], banks: [], licenses: [] },
    });
    const own = ownershipMap(e, 'x');
    expect(own.structure).toBe('org');
    expect(own.root.children[0].text).toBe('Ông A · 100%');
    const m = entityOverviewMap(e, [ms({ event_date: '2020-05-01', title: 'Đăng ký thay đổi lần thứ 1', changes: [{ id: 'c', aspect: 'address', from: '', to: '' }] })]);
    expect(m.root.text).toBe("Let's Go");
    const labels = m.root.children.map(c => c.text);
    expect(labels).toContain('Lịch sử thay đổi');
    expect(labels).toContain('Ngành nghề');
    const hist = m.root.children.find(c => c.text === 'Lịch sử thay đổi')!;
    expect(hist.children[0].text).toBe('01/05/2020 · Đăng ký thay đổi lần thứ 1');
    expect(hist.children[0].children[0].text).toBe('Địa chỉ trụ sở');
  });
});
