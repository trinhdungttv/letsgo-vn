import { describe, expect, it } from 'vitest';
import { VN_PROVINCES } from '../cskh/provinces';
import { canonicalNewProvince, NEW_PROVINCES, NEW_PROVINCES_SORTED, newProvinceOfMerged, sourceInProvinceFilter } from './provinces';

describe('34 tỉnh / thành sau sáp nhập', () => {
  it('đúng 34 tỉnh, không trùng tên', () => {
    expect(NEW_PROVINCES).toHaveLength(34);
    expect(new Set(NEW_PROVINCES.map(p => p.name)).size).toBe(34);
    expect(NEW_PROVINCES_SORTED).toHaveLength(34);
  });

  it('63 tỉnh cũ đều thuộc đúng 1 tỉnh mới (không sót, không trùng)', () => {
    const olds = NEW_PROVINCES.flatMap(p => [p.name, ...p.merged]);
    for (const old of VN_PROVINCES) {
      const own = canonicalNewProvince(old);
      const merged = newProvinceOfMerged(old);
      expect(own || merged, `${old} chưa có tỉnh mới`).toBeTruthy();
      expect(!!own && !!merged, `${old} bị tính 2 lần`).toBe(false);
    }
    // 63 tỉnh cũ + 1 vì "Huế" là tên mới của "Thừa Thiên Huế" (cùng 1 nơi, 2 cách gọi)
    expect(olds).toHaveLength(64);
  });

  it('tỉnh cũ đã gộp trỏ về tỉnh mới', () => {
    expect(newProvinceOfMerged('Bình Dương')).toBe('TP. Hồ Chí Minh');
    expect(newProvinceOfMerged('Bà Rịa - Vũng Tàu')).toBe('TP. Hồ Chí Minh');
    expect(newProvinceOfMerged('Bình Phước')).toBe('Đồng Nai');
    expect(newProvinceOfMerged('Long An')).toBe('Tây Ninh');
    expect(newProvinceOfMerged('Tiền Giang')).toBe('Đồng Tháp');
    expect(newProvinceOfMerged('Sóc Trăng')).toBe('Cần Thơ');
    expect(newProvinceOfMerged('Thừa Thiên Huế')).toBe('Huế');
  });

  it('tên tỉnh mới nhận ra nhiều cách viết → tên chuẩn để lưu', () => {
    expect(canonicalNewProvince('Hồ Chí Minh')).toBe('TP. Hồ Chí Minh');
    expect(canonicalNewProvince('TPHCM')).toBe('TP. Hồ Chí Minh');
    expect(canonicalNewProvince('Tỉnh Đồng Nai')).toBe('Đồng Nai');
    expect(canonicalNewProvince('TP. Cần Thơ')).toBe('Cần Thơ');
    expect(canonicalNewProvince('  vĩnh long ')).toBe('Vĩnh Long');
    expect(canonicalNewProvince('Bình Dương')).toBeNull();
    expect(canonicalNewProvince('')).toBeNull();
    expect(canonicalNewProvince(null)).toBeNull();
  });
});

describe('lọc tỉnh trên Bản đồ cho Nguồn LĐ', () => {
  it('không lọc → hiện hết', () => {
    expect(sourceInProvinceFilter('Cần Thơ', 'all')).toBe(true);
    expect(sourceInProvinceFilter('', 'all')).toBe(true);
  });
  it('khớp tỉnh theo khoá chuẩn, khác tỉnh thì ẩn', () => {
    expect(sourceInProvinceFilter('TP. Hồ Chí Minh', 'Hồ Chí Minh')).toBe(true);
    expect(sourceInProvinceFilter('Đồng Nai', 'TP. Đồng Nai')).toBe(true);
    expect(sourceInProvinceFilter('Vĩnh Long', 'Bình Dương')).toBe(false);
  });
  it('chưa ghi tỉnh → vẫn hiện, không bị loại âm thầm', () => {
    expect(sourceInProvinceFilter('', 'Bình Dương')).toBe(true);
    expect(sourceInProvinceFilter('   ', 'Bình Dương')).toBe(true);
    expect(sourceInProvinceFilter(null, 'Bình Dương')).toBe(true);
  });
});
