import { describe, expect, it } from 'vitest';
import {
  isWorkTaskOpen, mapWorkTaskRow, openWorkAgenda, workTaskLogDate, workTasksForContacts, workTasksOfContact, workTaskTitleWithoutCompany,
  type CskhWorkTask, type WorkTaskRow,
} from './workTasks';

const row = (o: Partial<WorkTaskRow>): WorkTaskRow => ({
  id: 'w', title: 'X', task_type: 'Hợp đồng', status: 'pending', due_date: '2026-11-09', completed_at: null,
  created_at: '2026-11-04T07:34:53Z', notes: null, client_id: 'c', user_id: 'u', contact_ids: ['k1'], ...o,
});
const task = (o: Partial<WorkTaskRow>): CskhWorkTask => mapWorkTaskRow(row(o));

describe('mapWorkTaskRow', () => {
  it('chuẩn hoá: bỏ trùng người, ghi chú rỗng → null, trạng thái thiếu → Cần làm', () => {
    const t = mapWorkTaskRow(row({ contact_ids: ['k1', 'k1', ''], notes: '  ', status: null, due_date: '2026-11-09T00:00:00' }));
    expect(t.contactIds).toEqual(['k1']);
    expect(t.notes).toBeNull();
    expect(t.status).toBe('pending');
    expect(t.due).toBe('2026-11-09');
  });
  it('contact_ids null (dòng cũ) → mảng rỗng', () => {
    expect(mapWorkTaskRow(row({ contact_ids: null })).contactIds).toEqual([]);
  });
});

describe('workTaskLogDate — ngày đặt việc vào Nhật ký (giờ VN)', () => {
  it('việc đang mở → ngày tạo theo giờ Việt Nam (17h UTC = 0h hôm sau ở VN)', () => {
    expect(workTaskLogDate(task({ created_at: '2026-11-03T17:30:00Z' }))).toBe('2026-11-04');
  });
  it('việc đã xong → ngày xong', () => {
    expect(workTaskLogDate(task({ status: 'done', completed_at: '2026-11-06T02:00:00Z' }))).toBe('2026-11-06');
  });
  it('đã xong mà thiếu completed_at → lùi về ngày tạo', () => {
    expect(workTaskLogDate(task({ status: 'done', completed_at: null }))).toBe('2026-11-04');
  });
});

describe('workTasksForContacts / workTasksOfContact', () => {
  const list = [
    task({ id: 'a', contact_ids: ['k1'], due_date: '2026-11-20' }),
    task({ id: 'b', contact_ids: ['k1', 'k2'], due_date: '2026-11-09' }),
    task({ id: 'c', contact_ids: ['k1'], status: 'done', completed_at: '2026-11-01T00:00:00Z' }),
    task({ id: 'd', contact_ids: ['k1'], status: 'done', completed_at: '2026-11-03T00:00:00Z' }),
    task({ id: 'e', contact_ids: ['s1'] }),
  ];
  it('chỉ giữ việc có người thuộc tệp', () => {
    expect(workTasksForContacts(list, new Set(['k2'])).map(t => t.id)).toEqual(['b']);
  });
  it('việc của 1 người: đang mở theo hạn gần nhất, rồi đã xong mới nhất trước', () => {
    expect(workTasksOfContact(list, 'k1').map(t => t.id)).toEqual(['b', 'a', 'd', 'c']);
    expect(workTasksOfContact(list, 'zz')).toEqual([]);
  });
});

describe('workTaskTitleWithoutCompany', () => {
  it('bỏ "Tên công ty — " ở đầu (không phân biệt hoa thường)', () => {
    expect(workTaskTitleWithoutCompany('Coherent Vietnam — HĐ Bổ sung HSNL', 'coherent vietnam')).toBe('HĐ Bổ sung HSNL');
  });
  it('giữ nguyên khi không có tiền tố / không có tên công ty / tên việc chỉ có tiền tố', () => {
    expect(workTaskTitleWithoutCompany('HĐ Bổ sung', 'Coherent Vietnam')).toBe('HĐ Bổ sung');
    expect(workTaskTitleWithoutCompany('Coherent Vietnam — X', null)).toBe('Coherent Vietnam — X');
    expect(workTaskTitleWithoutCompany('Coherent Vietnam — ', 'Coherent Vietnam')).toBe('Coherent Vietnam — ');
  });
});

describe('isWorkTaskOpen', () => {
  it('đang làm / cần làm là mở; xong và Ngưng HĐ là đã khép', () => {
    expect(isWorkTaskOpen({ status: 'pending' })).toBe(true);
    expect(isWorkTaskOpen({ status: 'in_progress' })).toBe(true);
    expect(isWorkTaskOpen({ status: 'done' })).toBe(false);
    expect(isWorkTaskOpen({ status: 'ngung_hd' })).toBe(false);
  });
  it('việc của 1 người: Ngưng HĐ xếp cùng nhóm đã khép, không đứng đầu danh sách đang mở', () => {
    const list = [
      task({ id: 'n', status: 'ngung_hd', due_date: '2026-11-01', created_at: '2026-10-01T00:00:00Z' }),
      task({ id: 'o', status: 'pending', due_date: '2026-11-30' }),
    ];
    expect(workTasksOfContact(list, 'k1')[0].id).toBe('o');
  });
});

describe('openWorkAgenda — việc Workspace còn mở ở Tổng quan CSKH', () => {
  const today = '2026-11-04';
  const ids = new Set(['k1', 'k2']);
  const list = [
    task({ id: 'late', due_date: '2026-11-01', contact_ids: ['k1'] }),
    task({ id: 'today', due_date: '2026-11-04', contact_ids: ['k2'] }),
    task({ id: 'soon', due_date: '2026-11-09', contact_ids: ['k1', 'k2', 'zz'] }),
    task({ id: 'nodue-old', due_date: null, contact_ids: ['k1'], created_at: '2026-10-01T00:00:00Z' }),
    task({ id: 'nodue-new', due_date: null, contact_ids: ['k1'], created_at: '2026-11-03T00:00:00Z' }),
    task({ id: 'done', status: 'done', contact_ids: ['k1'] }),
    task({ id: 'stop', status: 'ngung_hd', contact_ids: ['k1'] }),
    task({ id: 'other', due_date: '2026-11-02', contact_ids: ['zz'] }),
  ];
  const run = (excl?: ReadonlySet<string>) => openWorkAgenda(list, ids, today, excl);

  it('chỉ việc còn mở của người trong phạm vi; xếp trễ → hôm nay → sắp tới → không hạn (mới tạo trước)', () => {
    expect(run().map(r => r.task.id)).toEqual(['late', 'today', 'soon', 'nodue-new', 'nodue-old']);
  });
  it('tính số ngày trễ: trễ > 0, hôm nay = 0, còn lại < 0, không hạn = null', () => {
    const by = new Map(run().map(r => [r.task.id, r.late]));
    expect(by.get('late')).toBe(3);
    expect(by.get('today')).toBe(0);
    expect(by.get('soon')).toBe(-5);
    expect(by.get('nodue-old')).toBeNull();
  });
  it('chỉ liệt kê người thuộc phạm vi (bỏ người ngoài lọc)', () => {
    expect(run().find(r => r.task.id === 'soon')?.people).toEqual(['k1', 'k2']);
  });
  it('bỏ việc là bản sao của việc đã hứa', () => {
    expect(run(new Set(['late', 'soon'])).map(r => r.task.id)).toEqual(['today', 'nodue-new', 'nodue-old']);
  });
  it('phạm vi rỗng → không có việc nào', () => {
    expect(openWorkAgenda(list, new Set(), today)).toEqual([]);
  });
});
