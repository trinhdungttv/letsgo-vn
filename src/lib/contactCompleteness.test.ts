import { describe, it, expect } from 'vitest';
import { contactMissingInfo } from './contactCompleteness';

describe('thông tin người liên hệ còn thiếu', () => {
  it('tạo nhanh chỉ có tên → thiếu đủ 4 mục, theo thứ tự', () => {
    expect(contactMissingInfo({ role: null, phone: '', email: '  ', birthday: null }))
      .toEqual(['chức vụ', 'số điện thoại', 'email', 'ngày sinh']);
  });
  it('đã đủ → rỗng; thiếu 1 mục → chỉ mục đó', () => {
    expect(contactMissingInfo({ role: 'Nhân sự', phone: '0901', email: 'a@b.vn', birthday: '1990-01-02' })).toEqual([]);
    expect(contactMissingInfo({ role: 'Nhân sự', phone: '0901', email: 'a@b.vn' })).toEqual(['ngày sinh']);
  });
});
