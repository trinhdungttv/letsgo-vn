import { describe, expect, it } from 'vitest';
import {
  CONTRACT_KINDS, TASK_GROUPS, normalizeTaskTypeChoice, storedTypeOfGroup, taskGroupOf, taskTypeLabel,
} from './workTaskTypes';

describe('taskGroupOf — gộp loại việc cũ vào 5 nhóm, không đổi dữ liệu', () => {
  it('3 loại Hợp đồng cũ (giữ nguyên giá trị lưu) → nhóm Hợp đồng', () => {
    expect(['Tái ký HĐ', 'Hợp đồng', 'Phụ lục'].map(taskGroupOf)).toEqual(['Hợp đồng', 'Hợp đồng', 'Hợp đồng']);
  });
  it('Thăm quan + Hỏi thăm CN → Gặp khách; Văn phòng + Khác → Nội bộ / Khác', () => {
    expect(taskGroupOf('Thăm quan')).toBe('Gặp khách');
    expect(taskGroupOf('Hỏi thăm CN')).toBe('Gặp khách');
    expect(taskGroupOf('Văn phòng')).toBe('Nội bộ / Khác');
    expect(taskGroupOf('Khác')).toBe('Nội bộ / Khác');
  });
  it('giá trị mới lưu đúng tên nhóm thì trả lại chính nhóm đó', () => {
    for (const g of TASK_GROUPS) expect(taskGroupOf(storedTypeOfGroup(g))).toBe(g);
  });
  it('việc CSKH / Sale tự tạo, rỗng, giá trị lạ → Nội bộ / Khác (như nhóm "Khác" trước đây)', () => {
    expect(taskGroupOf('CSKH')).toBe('Nội bộ / Khác');
    expect(taskGroupOf('Sale')).toBe('Nội bộ / Khác');
    expect(taskGroupOf(null)).toBe('Nội bộ / Khác');
    expect(taskGroupOf('  ')).toBe('Nội bộ / Khác');
  });
  it('Báo giá / Xử lý phát sinh giữ nguyên', () => {
    expect(taskGroupOf('Báo giá')).toBe('Báo giá');
    expect(taskGroupOf('Xử lý phát sinh')).toBe('Xử lý phát sinh');
  });
});

describe('storedTypeOfGroup — giá trị LƯU khi chọn nhóm', () => {
  it('Hợp đồng lưu đúng loại con cũ để luồng Tái ký / bảng HĐ / Phụ lục chạy như trước', () => {
    expect(CONTRACT_KINDS.map(k => k.value)).toEqual(['Hợp đồng', 'Tái ký HĐ', 'Phụ lục']);
    expect(storedTypeOfGroup('Hợp đồng')).toBe('Hợp đồng');
    expect(storedTypeOfGroup('Hợp đồng', 'Tái ký HĐ')).toBe('Tái ký HĐ');
    expect(storedTypeOfGroup('Hợp đồng', 'Phụ lục')).toBe('Phụ lục');
    expect(storedTypeOfGroup('Hợp đồng', 'Báo giá')).toBe('Hợp đồng');
  });
  it('nhóm khác lưu tên nhóm', () => {
    expect(storedTypeOfGroup('Gặp khách')).toBe('Gặp khách');
    expect(storedTypeOfGroup('Nội bộ / Khác')).toBe('Nội bộ / Khác');
  });
});

describe('normalizeTaskTypeChoice — "loại việc lần trước" nhớ trong trình duyệt', () => {
  it('giá trị cũ không còn trong ô chọn → đổi sang nhóm mới', () => {
    expect(normalizeTaskTypeChoice('Thăm quan')).toBe('Gặp khách');
    expect(normalizeTaskTypeChoice('Văn phòng')).toBe('Nội bộ / Khác');
    expect(normalizeTaskTypeChoice(undefined)).toBe('Nội bộ / Khác');
  });
  it('loại con Hợp đồng giữ nguyên', () => {
    expect(normalizeTaskTypeChoice('Tái ký HĐ')).toBe('Tái ký HĐ');
    expect(normalizeTaskTypeChoice('Phụ lục')).toBe('Phụ lục');
  });
});

describe('taskTypeLabel — nhãn trên dòng việc / lịch sử', () => {
  it('Hợp đồng kèm loại con', () => {
    expect(taskTypeLabel('Tái ký HĐ')).toBe('Hợp đồng · Tái ký');
    expect(taskTypeLabel('Hợp đồng')).toBe('Hợp đồng · HĐ mới');
    expect(taskTypeLabel('Phụ lục')).toBe('Hợp đồng · Phụ lục');
  });
  it('việc gặp khách cũ giữ chi tiết loại gốc, Văn phòng/Khác gộp hẳn', () => {
    expect(taskTypeLabel('Thăm quan')).toBe('Gặp khách · Thăm quan');
    expect(taskTypeLabel('Hỏi thăm CN')).toBe('Gặp khách · Hỏi thăm CN');
    expect(taskTypeLabel('Văn phòng')).toBe('Nội bộ / Khác');
    expect(taskTypeLabel(null)).toBe('Nội bộ / Khác');
  });
  it('việc CSKH / Sale giữ đúng chữ', () => {
    expect(taskTypeLabel('CSKH')).toBe('CSKH');
    expect(taskTypeLabel('Sale')).toBe('Sale');
  });
});
