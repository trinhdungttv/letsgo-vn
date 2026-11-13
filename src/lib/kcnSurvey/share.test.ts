import { describe, expect, it } from 'vitest';
import {
  buildShareMessage, FOLLOW_ALL, followKeys, followLabels, groupZonesByProvince, isWeakPin, parseSurveyShareHash, provincesOf, randomPin, scopeModeText,
  scopeSelection, shareState, surveyShareUrl, type ShareZone,
} from './share';

const z = (id: string, name: string, location: string | null): ShareZone => ({ id, name, location, photos: 1, trips: 1 });

describe('link chia sẻ khảo sát', () => {
  it('tạo và đọc lại mã link', () => {
    expect(surveyShareUrl('K7M4QX', 'https://letsgo-vn.vercel.app')).toBe('https://letsgo-vn.vercel.app/#/ks/K7M4QX');
    expect(parseSurveyShareHash('#/ks/k7m4qx')).toBe('K7M4QX');
    expect(parseSurveyShareHash('#/ks/K7M4QX/')).toBe('K7M4QX');
  });
  it('không nhầm với link khác', () => {
    expect(parseSurveyShareHash('#/p/K7M4QX')).toBeNull();
    expect(parseSurveyShareHash('#/market/survey')).toBeNull();
    expect(parseSurveyShareHash('#/ks/')).toBeNull();
    expect(parseSurveyShareHash('#/ks/ab')).toBeNull();
  });
});

describe('mã PIN', () => {
  it('luôn đúng 4 chữ số, giữ số 0 đứng đầu', () => {
    expect(randomPin(() => 7)).toBe('0007');
    for (let i = 0; i < 200; i++) expect(randomPin()).toMatch(/^\d{4}$/);
  });
  it('bỏ qua mã dễ đoán', () => {
    const seq = [1111, 1234, 4821];
    let i = 0;
    expect(randomPin(() => seq[i++])).toBe('4821');
    expect(isWeakPin('0000')).toBe(true);
    expect(isWeakPin('4321')).toBe(true);
    expect(isWeakPin('4821')).toBe(false);
  });
});

describe('trạng thái link', () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  it('phân biệt đang dùng / hết hạn / thu hồi', () => {
    expect(shareState({ revoked: false, expires_at: null }, now)).toBe('active');
    expect(shareState({ revoked: false, expires_at: '2026-11-07T00:00:00Z' }, now)).toBe('active');
    expect(shareState({ revoked: false, expires_at: '2026-11-05T00:00:00Z' }, now)).toBe('expired');
    expect(shareState({ revoked: true, expires_at: '2026-11-07T00:00:00Z' }, now)).toBe('revoked');
  });
});

describe('nhóm KCN theo tỉnh', () => {
  const zones = [
    z('1', 'KCN Nhơn Trạch 3', 'Nhơn Trạch, Đồng Nai'),
    z('2', 'KCN Long Thành', 'TP. Đồng Nai'),
    z('3', 'KCN VSIP 1', 'Bình Dương'),
    z('4', 'KCN Lạ', null),
  ];
  it('gộp các cách ghi cùng 1 tỉnh, KCN chưa rõ tỉnh xuống cuối', () => {
    const g = groupZonesByProvince(zones);
    expect(g.map(x => x.label)).toEqual(['Đồng Nai', 'Bình Dương', 'Chưa ghi tỉnh']);
    expect(g[0].zones.map(x => x.id)).toEqual(['2', '1']);
  });
  it('tỉnh của các KCN được chọn, bỏ trùng và bỏ KCN chưa rõ tỉnh', () => {
    expect(provincesOf(zones, new Set(['1', '2', '4']))).toEqual(['Đồng Nai']);
    expect(provincesOf(zones, new Set(['3', '1']))).toEqual(['Bình Dương', 'Đồng Nai']);
  });
});

describe('tin nhắn Zalo', () => {
  const base = { url: 'https://x.vn/#/ks/AAAAAA', pin: '0420', zoneNames: ['KCN A', 'KCN B'], provinces: ['Đồng Nai'], expiresAt: '2026-11-13T05:00:00Z' };
  it('có link, mã, hạn và tên KCN', () => {
    const m = buildShareMessage(base);
    expect(m).toContain('https://x.vn/#/ks/AAAAAA');
    expect(m).toContain('Mã xem: 0420');
    expect(m).toContain('KCN A, KCN B');
    expect(m).toContain('2 KCN (Đồng Nai)');
    expect(m).toMatch(/đến hết ngày \d{2}\/11\/2026/);
  });
  it('không giới hạn thời gian', () => {
    expect(buildShareMessage({ ...base, expiresAt: null })).toContain('không giới hạn');
  });
  it('gọi đúng tên người nhận và rút gọn khi quá nhiều KCN', () => {
    const many = Array.from({ length: 9 }, (_, i) => `KCN ${i + 1}`);
    const m = buildShareMessage({ ...base, zoneNames: many, recipient: 'anh Nam' });
    expect(m).toContain('Chào anh Nam');
    expect(m).toContain('và 3 KCN khác');
    expect(m).not.toContain('KCN 9');
  });
  it('nhắc tới nhà trọ khi link có kèm nhà trọ', () => {
    expect(buildShareMessage(base)).not.toContain('nhà trọ');
    expect(buildShareMessage({ ...base, lodgings: true })).toContain('nhà trọ quanh KCN');
  });
});

describe('khảo sát sau này (tự cập nhật / chốt số liệu)', () => {
  const zones = [
    z('1', 'KCN Nhơn Trạch', 'TP. Đồng Nai'),
    z('2', 'KCN Long Thành', 'Nhơn Trạch, Đồng Nai'),
    z('3', 'KCN VSIP 2', 'Bình Dương'),
    z('4', 'KCN VSIP 3', 'Bình Dương'),
    z('5', 'KCN Lạ', null),
  ];
  it('theo dõi tỉnh đã chọn đủ mọi KCN, chọn hết = mọi KCN', () => {
    expect(followKeys(zones, new Set(['1', '2', '3']))).toEqual(['dong nai']);
    expect(followKeys(zones, new Set(['3', '4', '5']))).toEqual(['binh duong', '']);
    expect(followKeys(zones, new Set(['1', '3']))).toEqual([]);
    expect(followKeys(zones, new Set(['1', '2', '3', '4', '5']))).toEqual([FOLLOW_ALL]);
    expect(followKeys([], new Set())).toEqual([]);
  });
  it('tên tỉnh đang theo dõi', () => {
    expect(followLabels(zones, ['dong nai', ''])).toEqual(['Đồng Nai', 'KCN chưa ghi tỉnh']);
    expect(followLabels(zones, [FOLLOW_ALL])).toEqual(['mọi KCN']);
  });
  it('mở Sửa phạm vi: tick KCN đã lưu + KCN mới của tỉnh đang theo dõi', () => {
    expect([...scopeSelection(zones, { zone_ids: ['1', '3'], follow_provinces: ['binh duong'] })].sort()).toEqual(['1', '3', '4']);
    expect(scopeSelection(zones, { zone_ids: ['1'], follow_provinces: [FOLLOW_ALL] }).size).toBe(5);
    // đang chốt số liệu thì không theo dõi tỉnh; KCN không còn trong danh sách thì bỏ
    expect([...scopeSelection(zones, { zone_ids: ['3', 'gone'], follow_provinces: ['binh duong'], data_until: '2026-11-13T05:00:00Z' })]).toEqual(['3']);
    expect([...scopeSelection(zones, { zone_ids: ['2'] })]).toEqual(['2']);
  });
  it('mô tả chế độ trong danh sách link', () => {
    expect(scopeModeText(zones, {})).toBe('tự cập nhật KCN đã chọn');
    expect(scopeModeText(zones, { follow_provinces: ['binh duong'] })).toBe('tự cập nhật, theo cả Bình Dương');
    expect(scopeModeText(zones, { follow_provinces: [FOLLOW_ALL] })).toBe('tự cập nhật mọi KCN');
    expect(scopeModeText(zones, { data_until: '2026-11-13T05:00:00Z' })).toMatch(/^chốt số liệu đến \d{2}:\d{2} 13\/11\/2026$/);
  });
  it('tin nhắn nói rõ link tự cập nhật hay số liệu chốt đến ngày nào', () => {
    const base = { url: 'u', pin: '0420', zoneNames: ['KCN A'], provinces: [], expiresAt: null };
    expect(buildShareMessage(base)).not.toMatch(/tự cập nhật|tính đến/);
    expect(buildShareMessage({ ...base, live: true })).toContain('tự cập nhật khi có khảo sát mới');
    expect(buildShareMessage({ ...base, live: false, dataUntil: '2026-11-13T05:00:00Z' })).toContain('Số liệu khảo sát tính đến 13/11/2026');
  });
});
