import { describe, expect, it } from 'vitest';
import {
  buildShareMessage, groupZonesByProvince, isWeakPin, parseSurveyShareHash, provincesOf, randomPin, shareState, surveyShareUrl, type ShareZone,
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
});
