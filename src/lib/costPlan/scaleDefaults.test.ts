import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { parseScaleDefaults, FALLBACK_SCALE } from './scaleDefaults';

describe('quy mô chuẩn dùng chung', () => {
  it('đọc JSON đã lưu, mỗi loại dịch vụ một quy mô', () => {
    expect(parseScaleDefaults('{"v":2,"supply":{"workers":10,"simDays":26},"referral":{"workers":1,"simDays":24}}'))
      .toEqual({ supply: { workers: 10, simDays: 26 }, referral: { workers: 1, simDays: 24 } });
  });
  it('chưa lưu / hỏng / số vô lý → dùng mặc định, kẹp trong khoảng hợp lệ', () => {
    expect(parseScaleDefaults(null)).toEqual(FALLBACK_SCALE);
    expect(parseScaleDefaults('không phải json')).toEqual(FALLBACK_SCALE);
    expect(parseScaleDefaults('{"v":2,"supply":{"workers":0,"simDays":99}}').supply).toEqual({ workers: 1, simDays: 31 });
  });
  it('mặc định Cung ứng = 1 người × 20 công; số cũ tự đổi theo lần gõ (đời 1) bị bỏ', () => {
    expect(FALLBACK_SCALE.supply).toEqual({ workers: 1, simDays: 20 });
    expect(parseScaleDefaults('{"supply":{"workers":20,"simDays":26},"referral":{"workers":7,"simDays":24}}')).toEqual(FALLBACK_SCALE);
  });
});
