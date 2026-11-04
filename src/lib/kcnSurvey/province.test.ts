import { describe, expect, it } from 'vitest';
import { NO_PROVINCE, normalizeSavedProvince, provinceKey, provinceLabel, provinceOptions } from './province';

describe('tỉnh / thành của KCN', () => {
  it('gộp các cách ghi về cùng 1 khoá', () => {
    for (const s of ['TP. Đồng Nai', 'Tp Đồng Nai', 'Tỉnh Đồng Nai', 'Đồng Nai', ' đồng nai ', 'Nhơn Trạch, Đồng Nai', 'Thành phố Đồng Nai']) {
      expect(provinceKey(s)).toBe('dong nai');
    }
    expect(provinceKey('Bình Dương')).toBe('binh duong');
  });
  it('TP. Hồ Chí Minh nhiều cách viết', () => {
    for (const s of ['TP. Hồ Chí Minh', 'Hồ Chí Minh', 'TPHCM', 'TP HCM', 'HCM', 'Sài Gòn', 'Q9, TP. Hồ Chí Minh']) expect(provinceKey(s)).toBe('ho chi minh');
    expect(provinceLabel('HCM')).toBe('TP. Hồ Chí Minh');
  });
  it('nhãn hiển thị bỏ tiền tố, giữ nguyên chữ hoa / dấu', () => {
    expect(provinceLabel('TP. Đồng Nai')).toBe('Đồng Nai');
    expect(provinceLabel('Tỉnh Bình Dương')).toBe('Bình Dương');
    expect(provinceLabel('Long An')).toBe('Long An');
    expect(provinceLabel('Nhơn Trạch, TP. Đồng Nai')).toBe('Đồng Nai');
  });
  it('tên tỉnh bắt đầu bằng chữ "T" không bị cắt nhầm', () => {
    expect(provinceLabel('Tây Ninh')).toBe('Tây Ninh');
    expect(provinceLabel('Tiền Giang')).toBe('Tiền Giang');
    expect(provinceLabel('Thanh Hoá')).toBe('Thanh Hoá');
    expect(provinceLabel('Thái Bình')).toBe('Thái Bình');
  });
  it('rỗng / null → chưa rõ tỉnh', () => {
    expect(provinceKey(null)).toBe('');
    expect(provinceKey('   ')).toBe('');
    expect(provinceKey(undefined)).toBe('');
  });
});

describe('danh sách tỉnh cho ô lọc', () => {
  const zones = [
    { id: 'a', location: 'TP. Đồng Nai' }, { id: 'b', location: 'TP. Đồng Nai' }, { id: 'c', location: 'Đồng Nai' },
    { id: 'd', location: 'TP. Hồ Chí Minh' }, { id: 'e', location: 'Bình Dương' }, { id: 'f', location: null }, { id: 'g', location: '' },
  ];
  it('gộp tỉnh, đếm KCN và KCN chưa ghi tỉnh', () => {
    const r = provinceOptions(zones, new Set(['a', 'f']));
    expect(r.options.map(o => o.key)).toEqual(['dong nai', 'binh duong', 'ho chi minh']);
    expect(r.options[0]).toMatchObject({ label: 'Đồng Nai', zones: 3, surveyed: 1 });
    expect(r.unknown).toBe(2);
    expect(r.unknownSurveyed).toBe(1);
  });
  it('tỉnh đã khảo sát lên trước', () => {
    const r = provinceOptions(zones, new Set(['e']));
    expect(r.options[0].key).toBe('binh duong');
  });
});

describe('bộ lọc đã lưu từ bản cũ', () => {
  it('đổi nguyên văn cũ sang khoá mới', () => {
    expect(normalizeSavedProvince('TP. Đồng Nai')).toBe('dong nai');
    expect(normalizeSavedProvince('all')).toBe('all');
    expect(normalizeSavedProvince(NO_PROVINCE)).toBe(NO_PROVINCE);
    expect(normalizeSavedProvince(undefined)).toBe('all');
    expect(normalizeSavedProvince('')).toBe('all');
  });
});
