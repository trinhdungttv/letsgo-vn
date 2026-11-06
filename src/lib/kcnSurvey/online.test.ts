import { describe, expect, it } from 'vitest';
import { kindPdfTag, matchesKind, parsePosition } from './online';

describe('đọc vị trí công ty', () => {
  it('link Google Maps dài', () => {
    expect(parsePosition('https://www.google.com/maps/place/ABC/@10.9482,106.8431,17z/data=!3d10.9490!4d106.8440')).toEqual({ lat: 10.949, lng: 106.844 });
    expect(parsePosition('https://www.google.com/maps?q=10.95,106.84')).toEqual({ lat: 10.95, lng: 106.84 });
  });
  it('gõ thẳng vĩ độ, kinh độ', () => {
    expect(parsePosition('10.9482, 106.8431')).toEqual({ lat: 10.9482, lng: 106.8431 });
    expect(parsePosition('10.9482 106.8431')).toEqual({ lat: 10.9482, lng: 106.8431 });
  });
  it('từ chối link rút gọn, trống, ngoài Việt Nam', () => {
    expect(parsePosition('https://maps.app.goo.gl/abc123')).toBeNull();
    expect(parsePosition('')).toBeNull();
    expect(parsePosition('51.5, -0.12')).toBeNull();
    expect(parsePosition('0, 0')).toBeNull();
  });
});

describe('loại khảo sát', () => {
  const field = { survey_kind: 'field' as const, verified_at: null };
  const online = { survey_kind: 'online' as const, verified_at: null };
  const done = { survey_kind: 'online' as const, verified_at: '2026-11-06T00:00:00Z' };
  it('lọc theo loại', () => {
    expect([field, online, done].map(p => matchesKind(p, 'all'))).toEqual([true, true, true]);
    expect([field, online, done].map(p => matchesKind(p, 'field'))).toEqual([true, false, false]);
    expect([field, online, done].map(p => matchesKind(p, 'online'))).toEqual([false, true, true]);
    expect([field, online, done].map(p => matchesKind(p, 'unverified'))).toEqual([false, true, false]);
  });
  it('nhãn PDF', () => {
    expect(kindPdfTag(field)).toBe('');
    expect(kindPdfTag(online)).toContain('Chưa xác thực');
    expect(kindPdfTag(done)).toContain('Đã xác thực');
  });
});
