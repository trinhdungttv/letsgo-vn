// Port từ PRM Tony Study (groupLog.test.mjs, regionInsight.test.mjs) — chỉnh cho cskh_logs / client_gifts / Gemini.
import { describe, expect, it } from 'vitest';
import {
  batchGiftsOf, buildGroupLogRows, canEditBatch, GROUP_ACTIONS, groupBatches, groupLogContent, planBatchEdit,
  suggestOccasion, type GroupLogCtx,
} from './groupLog';
import { buildRegionRequest, parseRegionResponse, regionCandidates, sanitizeInsight } from './regionInsight';
import { makeContact, makeGift, makeInteraction } from './testFixtures';

const people = [
  makeContact({ id: 'a', fullName: 'Ms Lan', clientIds: ['k1', 'k2'], primaryClientIds: ['k2'] }),
  makeContact({ id: 'b', fullName: 'Ms Hoa', clientIds: ['k1'] }),
  makeContact({ id: 'c', fullName: 'Ms Mai', clientIds: [], organization: '' }),
  makeContact({ id: 'd', fullName: 'Ms Thu', clientIds: ['k1'] }),
];
const ctx: GroupLogCtx = {
  userId: 'u1',
  userName: 'Tony',
  contactById: new Map(people.map(p => [p.id, p])),
  clientName: id => ({ k1: 'Midea', k2: 'Samsung' } as Record<string, string>)[id] ?? null,
};

describe('ghi cho nhóm', () => {
  it('gợi ý dịp theo ngày: quanh 20/10 và 8/3', () => {
    expect(suggestOccasion('2026-10-24')).toBe('20/10');
    expect(suggestOccasion('2026-10-09')).toBe('');
    expect(suggestOccasion('2026-03-08')).toBe('8/3');
    expect(suggestOccasion('2026-07-01')).toBe('');
  });

  it('nội dung mặc định', () => {
    const flowers = GROUP_ACTIONS.find(a => a.key === 'flowers')!;
    const other = GROUP_ACTIONS.find(a => a.key === 'other')!;
    expect(groupLogContent(flowers, '20/10')).toBe('Tặng hoa 20/10');
    expect(groupLogContent(flowers, '')).toBe('Tặng hoa');
    expect(groupLogContent(other, 'Tết')).toBe('Tết');
  });

  it('mỗi người 1 dòng nhật ký (công ty = liên hệ chính) + 1 dòng quà; bỏ trùng; người chưa gắn công ty không có dòng quà', () => {
    const r = buildGroupLogRows({
      contactIds: ['a', 'b', 'a', '', 'c', 'zz'],
      type: 'gift', occurredAt: '2026-10-20', content: ' Tặng hoa 20/10 ',
      gift: { item: 'Hoa', estimatedValue: 150000.4 },
    }, ctx, '2026-10-24T08:00:00.123Z');
    expect(r.logs).toHaveLength(3);
    expect(r.logs[0]).toMatchObject({
      contact_id: 'a', client_id: 'k2', client_name: 'Samsung', contact_person: 'Ms Lan', contact_type: 'gift',
      content: 'Tặng hoa 20/10', log_date: '2026-10-20', initiated_by: 'me', created_by: 'u1', created_by_name: 'Tony',
      created_at: '2026-10-24T08:00:00.123Z', followup: null,
    });
    expect(r.gifts.map(g => [g.recipient_contact_id, g.client_id, g.value, g.direction])).toEqual([['a', 'k2', 150000, 'given'], ['b', 'k1', 150000, 'given']]);
    expect(r.noGiftNames).toEqual(['Ms Mai']);
  });

  it('không phải quà → không ghi quà; giá trị trống → null', () => {
    expect(buildGroupLogRows({ contactIds: ['a'], type: 'message', occurredAt: '2026-10-20', content: 'Chúc mừng', gift: null }, ctx, 'x').gifts).toHaveLength(0);
    expect(buildGroupLogRows({ contactIds: ['a'], type: 'gift', occurredAt: '2026-10-20', content: 'x', gift: { item: 'Hoa', estimatedValue: null } }, ctx, 'x').gifts[0].value).toBeNull();
  });
});

const STAMP = '2026-10-24T08:00:00.123+00:00';
const log = (id: string, contactId: string, over: Parameters<typeof makeInteraction>[1] = {}) =>
  makeInteraction(contactId, { id, type: 'gift', occurredAt: '2026-10-24', content: 'Tặng hoa 20/10', createdAt: STAMP, createdBy: 'u1', createdByName: 'Tony', ...over });

describe('đợt ghi nhóm', () => {
  it('gom: cùng dấu đợt (so mili-giây) + cùng nội dung, ≥ 2 người; dòng lẻ, dòng có việc đã hứa giữ nguyên', () => {
    const list = [
      log('1', 'a'),
      log('x', 'z', { type: 'call', content: 'Gọi hỏi thăm', createdAt: '2026-10-24T07:00:00Z' }),
      log('2', 'b', { createdAt: '2026-10-24T08:00:00.123Z' }),
      log('3', 'c'),
      log('p', 'd', { followUpAction: 'Gửi báo giá', followUpDue: '2026-10-30' }),
      log('y', 'a', { createdAt: '2026-10-23T08:00:00Z' }),
    ];
    const out = groupBatches(list);
    expect(out.map(e => e.kind)).toEqual(['batch', 'single', 'single', 'single']);
    expect(out[0].kind === 'batch' && out[0].batch.items.map(i => i.id)).toEqual(['1', '2', '3']);
    expect(out[0].kind === 'batch' && out[0].batch.createdBy).toBe('u1');
  });

  it('quyền sửa / xoá đợt: người tạo hoặc admin', () => {
    expect(canEditBatch({ createdBy: 'u1' }, { id: 'u1', role: 'kinhdoanh' })).toBe(true);
    expect(canEditBatch({ createdBy: 'u1' }, { id: 'u2', role: 'kinhdoanh' })).toBe(false);
    expect(canEditBatch({ createdBy: 'u1' }, { id: 'u2', role: 'admin' })).toBe(true);
    expect(canEditBatch({ createdBy: null }, { id: 'u2', role: 'bdh' })).toBe(false);
    expect(canEditBatch({ createdBy: 'u1' }, null)).toBe(false);
  });

  it('sửa đợt: đổi ngày / nội dung cả loạt, bỏ người, thêm người (kèm quà, cùng dấu đợt)', () => {
    const entry = groupBatches([log('1', 'a'), log('2', 'b'), log('3', 'c')])[0];
    if (entry.kind !== 'batch') throw new Error('phải là đợt');
    const batch = entry.batch;
    const gifts = [
      makeGift('a', { id: 'g1', item: 'Hoa', estimatedValue: 200000, createdAt: STAMP }),
      makeGift('b', { id: 'g2', item: 'Hoa', estimatedValue: 200000, createdAt: STAMP }),
      makeGift('a', { id: 'gx', item: 'Sách', createdAt: '2026-01-01T00:00:00Z' }),
      makeGift('b', { id: 'gy', item: 'Hoa', createdAt: STAMP, isArchived: true }),
    ];
    const mine = batchGiftsOf(gifts, batch.createdAt, batch.items.map(i => i.contactId as string));
    expect(mine.map(g => g.id)).toEqual(['g1', 'g2']);
    const plan = planBatchEdit(batch, mine, {
      type: 'gift', content: ' Tặng hoa 20/10 ', occurredAt: '2026-10-20', removeContactIds: ['b'], addContactIds: ['d', 'a'],
    }, { ...ctx, userId: 'admin', userName: 'Admin' });
    expect(plan.updateLogIds).toEqual(['1', '3']);
    expect(plan.archiveLogIds).toEqual(['2']);
    expect(plan.logPatch).toEqual({ contact_type: 'gift', content: 'Tặng hoa 20/10', log_date: '2026-10-20' });
    expect(plan.updateGiftIds).toEqual(['g1']);
    expect(plan.archiveGiftIds).toEqual(['g2']);
    expect(plan.insertLogs.map(l => [l.contact_id, l.created_at, l.created_by])).toEqual([['d', STAMP, 'u1']]); // vào đúng đợt, giữ người tạo đợt
    expect(plan.insertGifts.map(g => [g.recipient_contact_id, g.item_name, g.value])).toEqual([['d', 'Hoa', 200000]]);
  });
});

describe('tìm hiểu vùng miền (Gemini)', () => {
  const answer = {
    highlights: 'Xứ chùa Khmer, ao Bà Om.',
    traits: 'Ven biển, nông nghiệp lúa – dừa.',
    culture: 'Đồng bào Khmer, lễ Ok Om Bok.',
    people: 'Hiền hoà, mến khách.',
    food: ['Bún nước lèn', 'Bánh tét Trà Cuôn', ''],
    places: ['Ao Bà Om', 'Chùa Âng'],
    notable_people: [{ name: 'Nguyễn Văn A', note: 'Từng là bộ trưởng' }, { name: '', note: 'rác' }],
  };

  it('dựng yêu cầu: JSON theo schema, có bối cảnh', () => {
    const r = buildRegionRequest('Trà Vinh', 'tỉnh cũ, nay thuộc Vĩnh Long') as {
      generationConfig: { responseMimeType: string; responseSchema: { required: string[] } };
      contents: { parts: { text: string }[] }[];
    };
    expect(r.generationConfig.responseMimeType).toBe('application/json');
    expect(r.generationConfig.responseSchema.required).toEqual(['highlights', 'traits', 'culture', 'people', 'food', 'places', 'notable_people']);
    expect(r.contents[0].parts[0].text).toMatch(/Trà Vinh.*Vĩnh Long/s);
  });

  it('đọc kết quả: ghép phần chữ, bỏ phần suy nghĩ, làm sạch mục rỗng', () => {
    const out = parseRegionResponse({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'nghĩ…', thought: true }, { text: JSON.stringify(answer) }] } }],
    });
    expect(out.food).toEqual(['Bún nước lèn', 'Bánh tét Trà Cuôn']);
    expect(out.notablePeople).toEqual([{ name: 'Nguyễn Văn A', note: 'Từng là bộ trưởng' }]);
    expect(out.highlights).toBe('Xứ chùa Khmer, ao Bà Om.');
    // Bọc ```json vẫn đọc được
    expect(parseRegionResponse({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(answer) + '\n```' }] } }] }).places).toHaveLength(2);
  });

  it('lỗi rõ ràng: bị chặn, bị cắt, JSON hỏng, proxy lỗi', () => {
    expect(() => parseRegionResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/từ chối/);
    expect(() => parseRegionResponse({ candidates: [{ finishReason: 'SAFETY' }] })).toThrow(/từ chối/);
    expect(() => parseRegionResponse({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toThrow(/cắt/);
    expect(() => parseRegionResponse({ candidates: [{ content: { parts: [{ text: '{oops' }] } }] })).toThrow(/Không đọc được/);
    expect(() => parseRegionResponse({ error: 'Server chua cau hinh GEMINI_API_KEY' })).toThrow(/GEMINI_API_KEY/);
    expect(() => parseRegionResponse({ error: { message: 'overloaded' } })).toThrow(/overloaded/);
  });

  it('làm sạch dữ liệu đọc lại từ bộ nhớ máy: sai kiểu → null', () => {
    expect(sanitizeInsight(null)).toBeNull();
    expect(sanitizeInsight({ food: 'x' })).toBeNull();
    expect(sanitizeInsight({ notablePeople: [{ name: 'B', note: '' }] })?.notablePeople[0].name).toBe('B');
  });

  it('vùng để tìm hiểu: quê, tỉnh nơi ở, nơi trong link — bỏ trùng, bỏ rỗng', () => {
    expect(regionCandidates({ originProvince: 'Nam Định', province: 'Bình Dương' }).map(c => c.label)).toEqual(['Quê Nam Định', 'Bình Dương']);
    expect(regionCandidates({ originProvince: '', province: 'Bình Dương' }, 'bình dương').map(c => c.region)).toEqual(['Bình Dương']);
    expect(regionCandidates({ originProvince: '', province: '' })).toEqual([]);
  });
});
