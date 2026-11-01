import { describe, it, expect } from 'vitest';
import { serviceOfProduct, needOfProduct, needOptionsFor, fitNeedToProduct } from './productService';

describe('hình thức theo sản phẩm CRM', () => {
  it('nhóm sản phẩm → hình thức dịch vụ / hình thức cần', () => {
    expect(serviceOfProduct('Giới thiệu lao động')).toBe('recruitment');
    expect(serviceOfProduct('cho THUÊ lao động')).toBe('leasing');
    expect(serviceOfProduct('HOH - Gia công')).toBeNull();
    expect(serviceOfProduct(null)).toBeNull();
    expect(needOfProduct('Giới thiệu lao động')).toBe('direct');
    expect(needOfProduct('Cho thuê lao động')).toBe('leasing');
    expect(needOfProduct(undefined)).toBeNull();
  });
  it('lựa chọn hợp với sản phẩm: chỉ hình thức đó + cả hai', () => {
    expect(needOptionsFor('direct')).toEqual(['direct', 'both']);
    expect(needOptionsFor(null)).toEqual(['leasing', 'direct', 'both']);
  });
  it('dữ liệu lệch (giới thiệu mà lưu thời vụ) → sửa theo sản phẩm; cả hai giữ nguyên', () => {
    expect(fitNeedToProduct('leasing', 'direct')).toBe('direct');
    expect(fitNeedToProduct('both', 'direct')).toBe('both');
    expect(fitNeedToProduct('direct', 'direct')).toBe('direct');
    expect(fitNeedToProduct('leasing', null)).toBe('leasing');
  });
});
