// Chữ cái đầu avatar chi nhánh.
import { describe, expect, it } from 'vitest';
import { branchInitials, managerAvatarUrl } from './branchAvatar';

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

describe('managerAvatarUrl', () => {
  const branches = [
    { id: 'vsip', manager_name: 'Ms Phượng', manager_avatar_url: 'https://x/phuong.jpg' },
    { id: 'mp', manager_name: 'Ms Oanh', manager_avatar_url: 'https://x/oanh.jpg' },
    { id: 'bb', manager_name: 'Mr Hùng', manager_avatar_url: null },
    { id: 'vt', manager_name: 'Mr Hùng', manager_avatar_url: 'https://x/hung-vt.jpg' },
    { id: 'cc', manager_name: 'Mr Hùng', manager_avatar_url: 'https://x/hung-cc.jpg' },
  ];

  it('khớp tên Trưởng chi nhánh, kể cả khi khách thuộc chi nhánh khác', () => {
    expect(managerAvatarUrl('Ms Phượng', branches, 'vsip')).toBe('https://x/phuong.jpg');
    expect(managerAvatarUrl('Ms Oanh', branches, 'vsip')).toBe('https://x/oanh.jpg');
  });

  it('không phân biệt hoa thường, khoảng trắng thừa, NFD', () => {
    expect(managerAvatarUrl('  ms   OANH ', branches)).toBe('https://x/oanh.jpg');
    expect(managerAvatarUrl('Ms Phượng'.normalize('NFD'), branches)).toBe('https://x/phuong.jpg');
  });

  it('cùng tên ở nhiều chi nhánh: ưu tiên chi nhánh của khách, bỏ qua chỗ chưa có ảnh', () => {
    expect(managerAvatarUrl('Mr Hùng', branches, 'cc')).toBe('https://x/hung-cc.jpg');
    expect(managerAvatarUrl('Mr Hùng', branches, 'bb')).toBe('https://x/hung-vt.jpg');
  });

  it('không khớp ai / tên rỗng → null', () => {
    expect(managerAvatarUrl('Ms Sở', branches)).toBeNull();
    expect(managerAvatarUrl('', branches)).toBeNull();
    expect(managerAvatarUrl(null, branches)).toBeNull();
  });
});
