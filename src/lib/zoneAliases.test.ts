import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { aliasZoneId, type ZoneAlias } from './zoneAliases';

const NT = 'nt-main';
const aliases: ZoneAlias[] = [1, 2, 3, 4, 5, 6].map(n => ({ key: `nhon trach ${n}`, zone_id: NT, label: `KCN Nhơn Trạch ${n}` }));

describe('tên KCN đã gộp', () => {
  it('mọi cách ghi Nhơn Trạch 1–6 → KCN Nhơn Trạch', () => {
    for (const n of ['KCN Nhơn Trạch 3', 'Khu công nghiệp Nhơn Trạch III', 'kcn nhon trach 6', 'Khu Công Nghiệp Nhơn Trạch 2 - Lộc Khang', 'KCN Nhơn Trạch 2 – Nhơn Phú']) {
      expect(aliasZoneId(n, aliases)).toBe(NT);
    }
  });
  it('không đụng tên khác', () => {
    expect(aliasZoneId('KCN Nhơn Trạch', aliases)).toBeNull();
    expect(aliasZoneId('KCN Nhơn Trạch 10', aliases)).toBeNull();
    expect(aliasZoneId('KCN VSIP 3', aliases)).toBeNull();
    expect(aliasZoneId('', aliases)).toBeNull();
  });
});
