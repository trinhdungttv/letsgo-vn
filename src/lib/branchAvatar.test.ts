// Chữ cái đầu avatar chi nhánh.
import { describe, expect, it } from 'vitest';
import { branchInitials } from './branchAvatar';

describe('branchInitials', () => {
  it('bỏ tiền tố LGV - rồi lấy chữ đầu của hai từ', () => {
    expect(branchInitials('LGV - Bầu Bàng')).toBe('BB');
    expect(branchInitials('LGV - Tân Uyên')).toBe('TU');
    expect(branchInitials('LGV - Cong ty')).toBe('CT');
    expect(branchInitials('LGV - Quận 9')).toBe('Q9');
  });

  it('không có tiền tố: lấy phần trước dấu gạch', () => {
    expect(branchInitials('Vũng Tàu')).toBe('VT');
    expect(branchInitials('Biên Hoà - Ms Thương')).toBe('BH');
  });

  it('một từ → hai chữ đầu; ưu tiên tên viết tắt nếu có', () => {
    expect(branchInitials('Đồng Nai')).toBe('ĐN');
    expect(branchInitials('Hanoi')).toBe('HA');
    expect(branchInitials('LGV - Bầu Bàng', 'BB2')).toBe('BB');
  });

  it('chuỗi rỗng / chỉ có tiền tố không bị lỗi', () => {
    expect(branchInitials('')).toBe('?');
    expect(branchInitials(null)).toBe('?');
    expect(branchInitials('LGV - ')).toBe('LG');
  });

  it('chữ viết dạng tổ hợp (NFD) vẫn ra đúng', () => {
    expect(branchInitials('Vũng Tàu')).toBe('VT');
  });
});
