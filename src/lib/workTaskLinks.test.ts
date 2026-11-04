import { beforeEach, describe, expect, it, vi } from 'vitest';

// Giả lập supabase cho insertWorkTaskWithContacts / pipelineTaskClientId
const inserts: Record<string, unknown>[] = [];
let failContactIds = false;
let clientRows: { id: string; name: string; client_type: string | null; archived_at: string | null }[] = [];

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'clients') {
        return { select: () => ({ ilike: async () => ({ data: clientRows, error: null }) }) };
      }
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              inserts.push(row);
              if (failContactIds && 'contact_ids' in row) {
                return { data: null, error: { message: "Could not find the 'contact_ids' column of 'work_tasks' in the schema cache", code: 'PGRST204' } };
              }
              return { data: { id: 't1', ...row }, error: null };
            },
          }),
        }),
      };
    },
  },
}));
vi.mock('./audit', () => ({ logActivity: vi.fn() }));

import {
  cleanContactIds, insertWorkTaskWithContacts, isMissingContactIdsColumn, parseCompanyKey, pipelineTaskClientId,
  rankTaskContacts, taskPipelineChoices, toPipelineLite, MIGRATION_200_HINT, type TaskContactLite,
} from './workTaskLinks';
import type { PipelineCompanyLite } from './pipelineCompanyLink';

const card = (id: string, company_name: string, stage = 'dam-phan', client_id: string | null = null): PipelineCompanyLite =>
  ({ id, company_name, stage, client_id, contact_id: null, branch_id: null });

describe('taskPipelineChoices — công ty BD Pipeline chọn được cho việc', () => {
  it('giữ thẻ đang tìm hiểu / đàm phán chưa ký HĐ, xếp theo tên', () => {
    const out = taskPipelineChoices([card('1', 'Coherent Vietnam'), card('2', 'Brother', 'tim-hieu')], ['CICOR']);
    expect(out.map(e => e.id)).toEqual(['2', '1']);
  });
  it('bỏ thẻ Không hợp tác, Ngưng HĐ và thẻ đã là khách hàng', () => {
    const out = taskPipelineChoices([
      card('1', 'A', 'khong-nhu-cau'), card('2', 'B', 'ngung'), card('3', 'C', 'hop-tac', 'cl3'), card('4', 'D'),
    ], []);
    expect(out.map(e => e.id)).toEqual(['4']);
  });
  it('bỏ thẻ trùng tên khách đang hợp tác (đã có ở nhóm trên)', () => {
    expect(taskPipelineChoices([card('1', 'MIDEA MP4')], ['Midea MP4'])).toEqual([]);
  });
});

describe('parseCompanyKey', () => {
  it('phân biệt khách hàng / thẻ Pipeline / chưa chọn', () => {
    expect(parseCompanyKey('')).toBeNull();
    expect(parseCompanyKey('pipe:')).toBeNull();
    expect(parseCompanyKey('pipe:abc')).toEqual({ kind: 'pipeline', id: 'abc' });
    expect(parseCompanyKey('c-1')).toEqual({ kind: 'client', id: 'c-1' });
  });
});

describe('toPipelineLite', () => {
  it('điền null cho cột thiếu', () => {
    expect(toPipelineLite({ id: '1', company_name: 'X', stage: 'tim-hieu' }))
      .toEqual({ id: '1', company_name: 'X', stage: 'tim-hieu', client_id: null, contact_id: null, branch_id: null });
  });
});

describe('cleanContactIds', () => {
  it('bỏ trùng và rỗng, giữ thứ tự', () => {
    expect(cleanContactIds(['a', '', null, 'b', 'a', ' b '])).toEqual(['a', 'b']);
  });
});

describe('rankTaskContacts — gợi ý người liên hệ trong form việc', () => {
  const people: TaskContactLite[] = [
    { id: '1', name: 'Nguyễn Thu Hà', role: 'HR Manager', companies: ['Coherent Vietnam'], inCompany: true },
    { id: '2', name: 'Trần Văn Hải', role: 'Kế toán', companies: ['AQUA'], inCompany: false },
    { id: '3', name: 'Hà Minh', role: 'HR', companies: ['AQUA'], inCompany: false },
    { id: '4', name: 'Lê Hoa', role: 'Trưởng phòng', companies: ['Coherent Vietnam'], inCompany: true },
  ];
  it('chưa gõ → chỉ người của công ty đang chọn, theo ABC', () => {
    expect(rankTaskContacts(people, { query: '', selected: [] }).map(c => c.id)).toEqual(['4', '1']);
  });
  it('gõ không dấu → tìm theo tên, người của công ty lên đầu, rồi tên bắt đầu bằng chữ gõ', () => {
    expect(rankTaskContacts(people, { query: 'ha', selected: [] }).map(c => c.id)).toEqual(['1', '3', '2']);
  });
  it('tìm được theo tên công ty / chức vụ', () => {
    expect(rankTaskContacts(people, { query: 'aqua', selected: [] }).map(c => c.id)).toEqual(['3', '2']);
    expect(rankTaskContacts(people, { query: 'ke toan', selected: [] }).map(c => c.id)).toEqual(['2']);
  });
  it('bỏ người đã chọn và giới hạn số dòng', () => {
    expect(rankTaskContacts(people, { query: 'h', selected: ['1'], limit: 2 }).map(c => c.id)).toEqual(['4', '3']);
  });
});

describe('isMissingContactIdsColumn', () => {
  it('nhận ra lỗi thiếu cột (chưa chạy 200), bỏ qua lỗi khác', () => {
    expect(isMissingContactIdsColumn({ message: "Could not find the 'contact_ids' column of 'work_tasks' in the schema cache", code: 'PGRST204' })).toBe(true);
    expect(isMissingContactIdsColumn({ message: 'column "contact_ids" does not exist', code: '42703' })).toBe(true);
    expect(isMissingContactIdsColumn({ message: 'permission denied for table work_tasks' })).toBe(false);
    expect(isMissingContactIdsColumn(null)).toBe(false);
  });
});

describe('insertWorkTaskWithContacts — việc không bao giờ mất vì thiếu migration', () => {
  beforeEach(() => { inserts.length = 0; failContactIds = false; });
  it('có cột: lưu kèm contact_ids đã làm sạch', async () => {
    const r = await insertWorkTaskWithContacts({ title: 'X' }, ['a', 'a', 'b']);
    expect(r.error).toBeNull();
    expect(r.warning).toBeNull();
    expect(inserts).toEqual([{ title: 'X', contact_ids: ['a', 'b'] }]);
  });
  it('không gắn ai: không gửi cột (chưa chạy 200 vẫn lưu 1 lần là xong)', async () => {
    failContactIds = true;
    const r = await insertWorkTaskWithContacts({ title: 'X' }, []);
    expect(r.error).toBeNull();
    expect(inserts).toEqual([{ title: 'X' }]);
  });
  it('thiếu cột: lưu lại không kèm người liên hệ + báo cần chạy migration', async () => {
    failContactIds = true;
    const r = await insertWorkTaskWithContacts<{ id: string }>({ title: 'X' }, ['a']);
    expect(r.error).toBeNull();
    expect(r.data?.id).toBe('t1');
    expect(r.warning).toBe(MIGRATION_200_HINT);
    expect(inserts).toEqual([{ title: 'X', contact_ids: ['a'] }, { title: 'X' }]);
  });
});

describe('pipelineTaskClientId — hồ sơ giữ việc của 1 công ty Pipeline', () => {
  beforeEach(() => { clientRows = []; });
  it('thẻ đã hợp tác → client_id của thẻ', async () => {
    expect(await pipelineTaskClientId({ company_name: 'X', client_id: 'cl1' })).toBe('cl1');
  });
  it('chưa hợp tác → hồ sơ trùng tên chưa lưu trữ (KH tiềm năng)', async () => {
    clientRows = [
      { id: 'old', name: 'Coherent  Vietnam', client_type: 'prospect', archived_at: '2026-01-01' },
      { id: 'p1', name: 'coherent vietnam', client_type: 'prospect', archived_at: null },
    ];
    expect(await pipelineTaskClientId({ company_name: 'Coherent Vietnam', client_id: null })).toBe('p1');
  });
  it('chưa gắn gì → null', async () => {
    expect(await pipelineTaskClientId({ company_name: 'Coherent Vietnam' })).toBeNull();
  });
});
