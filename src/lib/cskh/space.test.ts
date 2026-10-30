// Mạng lưới Sale (migration 178): 2 khu vực dùng chung bộ máy CSKH nhưng KHÔNG lẫn dữ liệu.
import { describe, expect, it } from 'vitest';
import { planCareReminders } from './automation';
import { buildGroupLogRows, type GroupLogCtx } from './groupLog';
import { mapContactRow, mapGroupRow, mapSettingsRow, type ContactRow, type CskhSettingsRow } from './mappers';
import { isWonReferral, mapReferralRows, referralsByContact } from './saleReferrals';
import {
  contactKindOf, DEFAULT_SALE_CADENCE, parseSaleCadence, SALE_TIER_LABEL, sliceSpace, SPACE_INFO,
} from './space';
import { addDays, makeContact, makeGift, makeInteraction, makeOccasion } from './testFixtures';
import type { CskhGroup } from './types';
import { DEFAULT_CADENCE, TIER_LABEL } from './types';

const group = (id: string, kind: 'client' | 'sale'): CskhGroup => ({ id, name: id, color: 'blue', baseTier: 'vip', kind, isArchived: false });

describe('loại người liên hệ', () => {
  it('chưa chạy migration 178 / giá trị lạ → khách; chỉ "sale" là Sale', () => {
    expect(contactKindOf({})).toBe('client');
    expect(contactKindOf({ kind: null })).toBe('client');
    expect(contactKindOf({ kind: 'abc' })).toBe('client');
    expect(contactKindOf({ kind: 'sale' })).toBe('sale');
    expect(contactKindOf(null)).toBe('client');
  });

  it('dòng contacts của Sale: "công ty" hiển thị là nơi đang làm, không lấy công ty khách', () => {
    const row = {
      id: 's1', client_id: null, name: 'Anh Sơn', phone: null, email: null, role: null, start_date: null, end_date: null,
      is_active: true, is_primary: false, notes: null, address: null, birthday: null, hobbies: null, social_link: null,
      channel: null, rich_notes: null, created_at: '', updated_at: '', contact_clients: [],
      kind: 'sale', sale_company: ' Nhân lực MD ', competitor_id: 'cp1', sale_stage: 'invited', sale_area: 'VSIP', sale_industries: 'Điện tử',
    } as ContactRow;
    const c = mapContactRow(row);
    expect(c).toMatchObject({ kind: 'sale', organization: 'Nhân lực MD', saleCompany: 'Nhân lực MD', competitorId: 'cp1', saleStage: 'invited', saleArea: 'VSIP' });
    // Thiếu cột (chưa chạy 178) → khách, tiến độ mặc định
    const legacy = mapContactRow({ ...row, kind: undefined, sale_company: undefined, sale_stage: 'lạ' } as ContactRow);
    expect(legacy).toMatchObject({ kind: 'client', saleStage: 'none', saleCompany: '' });
  });

  it('nhóm tự tạo chưa có cột kind → nhóm của khách', () => {
    expect(mapGroupRow({ id: 'g', name: 'A', color: 'blue', base_tier: 'vip' }).kind).toBe('client');
    expect(mapGroupRow({ id: 'g', name: 'A', color: 'blue', base_tier: 'vip', kind: 'sale' }).kind).toBe('sale');
  });
});

describe('nhịp chăm sóc Sale', () => {
  it('thưa hơn khách ở mọi hạng chính', () => {
    for (const t of ['vvip', 'vip', 'partner'] as const) expect(DEFAULT_SALE_CADENCE[t]).toBeGreaterThan(DEFAULT_CADENCE[t]);
  });

  it('đọc jsonb sale_cadence: bỏ giá trị lạ, thiếu thì mặc định', () => {
    expect(parseSaleCadence(null)).toEqual(DEFAULT_SALE_CADENCE);
    expect(parseSaleCadence({ vvip: 21, vip: 'x', partner: 0, friend: 5000 })).toEqual({ ...DEFAULT_SALE_CADENCE, vvip: 21 });
  });

  it('cài đặt có cả nhịp khách lẫn nhịp Sale', () => {
    expect(mapSettingsRow(null).saleCadence).toEqual(DEFAULT_SALE_CADENCE);
    const s = mapSettingsRow({ cadence_vvip: 7, sale_cadence: { vvip: 60 } } as unknown as CskhSettingsRow);
    expect(s.cadence.vvip).toBe(7);
    expect(s.saleCadence.vvip).toBe(60);
  });

  it('nhãn hạng riêng, khoá enum giữ nguyên', () => {
    expect(SPACE_INFO.client.tierLabel).toBe(TIER_LABEL);
    expect(SPACE_INFO.sale.tierLabel).toBe(SALE_TIER_LABEL);
    expect(SALE_TIER_LABEL.vvip).toBe('Muốn chiêu mộ');
    expect(SPACE_INFO.sale.storageKey('cskh_scope_filters')).not.toBe(SPACE_INFO.client.storageKey('cskh_scope_filters'));
  });
});

describe('tách dữ liệu theo khu vực (không lẫn)', () => {
  const client = makeContact({ id: 'k1', kind: 'client' });
  const sale = makeContact({ id: 's1', kind: 'sale' });
  const all = {
    contacts: [client, sale],
    interactions: [
      makeInteraction('k1', { id: 'log-k' }),
      makeInteraction('s1', { id: 'log-s' }),
      makeInteraction(null, { id: 'log-old' }),            // dòng cũ chưa gắn người — của khách
      makeInteraction('deleted', { id: 'log-deleted' }),   // người đã xoá hẳn — như trước: của khách
    ],
    occasions: [makeOccasion('k1', { id: 'o-k' }), makeOccasion('s1', { id: 'o-s' })],
    gifts: [
      makeGift('k1', { id: 'g-k', clientId: 'cl1' }),
      makeGift('s1', { id: 'g-s', clientId: null }),
      makeGift(null as unknown as string, { id: 'g-orphan', contactId: null, clientId: null }),
    ],
    groups: [group('gk', 'client'), group('gs', 'sale')],
  };

  it('khu vực khách: không có người / nhật ký / sự kiện / quà / nhóm của Sale', () => {
    const v = sliceSpace(all, 'client');
    expect(v.contacts.map(c => c.id)).toEqual(['k1']);
    expect(v.interactions.map(i => i.id)).toEqual(['log-k', 'log-old', 'log-deleted']);
    expect(v.occasions.map(o => o.id)).toEqual(['o-k']);
    expect(v.gifts.map(g => g.id)).toEqual(['g-k']);
    expect(v.groups.map(g => g.id)).toEqual(['gk']);
  });

  it('khu vực Sale: chỉ dữ liệu gắn đúng người Sale', () => {
    const v = sliceSpace(all, 'sale');
    expect(v.contacts.map(c => c.id)).toEqual(['s1']);
    expect(v.interactions.map(i => i.id)).toEqual(['log-s']);
    expect(v.occasions.map(o => o.id)).toEqual(['o-s']);
    expect(v.gifts.map(g => g.id)).toEqual(['g-s']);
    expect(v.groups.map(g => g.id)).toEqual(['gs']);
  });
});

describe('quà tặng Sale không cần công ty', () => {
  it('ghi cho nhóm: Sale chưa gắn công ty vẫn có dòng quà (client_id NULL); khách chưa gắn công ty thì không', () => {
    const people = [
      makeContact({ id: 's1', fullName: 'Anh Sơn', kind: 'sale', clientIds: [] }),
      makeContact({ id: 'k1', fullName: 'Chị Lan', kind: 'client', clientIds: [] }),
    ];
    const ctx: GroupLogCtx = { userId: 'u1', userName: 'Tony', contactById: new Map(people.map(p => [p.id, p])), clientName: () => null };
    const rows = buildGroupLogRows({
      contactIds: ['s1', 'k1'], type: 'gift', occurredAt: '2026-10-20', content: 'Tặng hoa 20/10', gift: { item: 'Hoa', estimatedValue: null },
    }, ctx, '2026-10-20T03:00:00.000Z');
    expect(rows.logs).toHaveLength(2);
    expect(rows.gifts).toEqual([expect.objectContaining({ recipient_contact_id: 's1', client_id: null })]);
    expect(rows.noGiftNames).toEqual(['Chị Lan']);
  });
});

describe('việc nhắc của Sale', () => {
  it('tiền tố "Sale:" và không tạo "Kết nối lại" khi maxReconnect = 0', () => {
    const today = '2026-10-20';
    const c = makeContact({ fullName: 'Anh Sơn', kind: 'sale', tier: 'vvip', lastInteractionAt: '2026-01-01' });
    const near = makeOccasion(c.id, { day: Number(addDays(today, 3).slice(8)), month: 10, remindDaysBefore: 7 });
    const r = planCareReminders({ contacts: [c], occasions: [near], cadence: DEFAULT_SALE_CADENCE, today, prefix: 'Sale', maxReconnect: 0 });
    expect(r.gifts[0].title).toMatch(/^Sale: Chuẩn bị quà/);
    expect(r.reconnect).toEqual([]);
  });
});

describe('Sale giới thiệu khách (BD Pipeline)', () => {
  const son = makeContact({ id: 's1', fullName: 'Mr Sơn - Nhơn Trạch', nickname: 'Anh Sơn' });
  const ha = makeContact({ id: 's2', fullName: 'Chị Hà' });
  const rows = mapReferralRows([
    { id: 'p1', company_name: 'Midea', stage: 'hop-tac', source_type: 'partner', source_name: 'mr  sơn - nhơn trạch', created_at: '2026-10-01' },
    { id: 'p2', company_name: 'Samsung', stage: 'dang-lh', source_type: 'sale', source_name: 'Anh Sơn', created_at: '2026-10-05' },
    { id: 'p3', company_name: 'LG', stage: 'quan-tam', source_type: 'partner', source_name: 'Tên khác', source_contact_id: 's2', created_at: '2026-10-02' },
    { id: 'p4', company_name: 'Canon', stage: 'tiem-nang', source_type: 'company', source_name: 'Ban điều hành', created_at: '2026-10-03' },
    { id: 'p5', company_name: 'Bosch', stage: 'tiem-nang', source_type: 'partner', source_name: 'Người lạ', created_at: '2026-10-04' },
  ]);

  it('chỉ giữ nguồn Sale / Đối tác giới thiệu', () => {
    expect(rows.map(r => r.id)).toEqual(['p1', 'p2', 'p3', 'p5']);
  });

  it('nối chắc chắn theo source_contact_id, dòng chưa nối thì khớp tên / tên thân mật (bỏ hoa thường, khoảng trắng)', () => {
    const by = referralsByContact([son, ha], rows);
    expect(by.get('s1')?.map(r => r.id)).toEqual(['p2', 'p1']); // mới nhất trước
    expect(by.get('s2')?.map(r => r.id)).toEqual(['p3']);
    expect([...by.values()].flat().some(r => r.id === 'p5')).toBe(false);
  });

  it('đã hợp tác / đã thành khách = giới thiệu thành công', () => {
    expect(isWonReferral({ stage: 'hop-tac', clientId: null })).toBe(true);
    expect(isWonReferral({ stage: 'dang-lh', clientId: 'cl1' })).toBe(true);
    expect(isWonReferral({ stage: 'quan-tam', clientId: null })).toBe(false);
  });
});
