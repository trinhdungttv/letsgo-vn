import { describe, it, expect } from 'vitest';
import {
  birthdayOccasion, interactionTypeOf, mapContactRow, mapGiftRow, mapGroupRow, mapLogRow, mapSettingsRow,
  mapSpecialDateRow, parseInterests, type ContactRow, type CskhLogRow,
} from './mappers';
import { buildSeedPlan, suggestTierForRole } from './seedTiers';
import { formatDateVN, longDateVN, relativeDayLabel } from './dates';
import { makeContact } from './testFixtures';
import type { ClientGift } from '../types';

const baseContact: ContactRow = {
  id: 'c1', client_id: 'cl1', name: 'Nguyễn Văn A', phone: '0901 234 567, +84 912 345 678', email: ' a@x.vn ',
  role: 'GĐ Nhân Sự', start_date: null, end_date: null, is_active: true, is_primary: false, notes: null,
  address: null, birthday: '1985-03-15', hobbies: '["golf","cà phê"]', social_link: null, channel: null,
  rich_notes: null, created_at: '2026-01-01', updated_at: '2026-01-02',
  contact_clients: [
    { client_id: 'cl2', is_primary: true, clients: { name: 'Samsung' } },
    { client_id: 'cl1', is_primary: false, clients: { name: 'Midea' } },
  ],
};

describe('người liên hệ', () => {
  it('DB chưa chạy migration 169 → giá trị mặc định, không vỡ', () => {
    const c = mapContactRow(baseContact);
    expect(c).toMatchObject({
      fullName: 'Nguyễn Văn A', tier: 'unclassified', context: 'work', cadenceDays: null, ownerId: null,
      phones: ['0901 234 567', '+84 912 345 678'], emails: ['a@x.vn'], interests: ['golf', 'cà phê'],
      clientIds: ['cl1', 'cl2'], primaryClientIds: ['cl2'], organization: 'Midea, Samsung', jobTitle: 'GĐ Nhân Sự',
      isActive: true, isArchived: false, rememberNotes: {}, birthday: '1985-03-15',
    });
  });

  it('đọc cột CSKH; khoá lạ về mặc định; người đã nghỉ = lưu trữ', () => {
    const c = mapContactRow({
      ...baseContact, is_active: false, tier: 'vip', context: 'abc', mbti: 'ENTJ', cadence_days: 20,
      remember_notes: { family: ' Vợ tên Hoa ' }, last_interaction_at: '2026-10-01',
    });
    expect(c).toMatchObject({ tier: 'vip', context: 'work', mbti: 'ENTJ', cadenceDays: 20, isArchived: true, lastInteractionAt: '2026-10-01' });
    expect(c.rememberNotes).toEqual({ family: 'Vợ tên Hoa' });
    expect(mapContactRow({ ...baseContact, tier: 'boss' }).tier).toBe('unclassified');
  });

  it('DB chưa có bảng nối → lấy công ty từ cột cũ client_id', () => {
    const c = mapContactRow({ ...baseContact, contact_clients: undefined, is_primary: true, clients: { name: 'Midea' } });
    expect(c).toMatchObject({ clientIds: ['cl1'], primaryClientIds: ['cl1'], organization: 'Midea' });
  });

  it('sở thích: JSON array hoặc chuỗi ngăn phẩy (dữ liệu cũ)', () => {
    expect(parseInterests('golf, du lịch')).toEqual(['golf', 'du lịch']);
    expect(parseInterests(null)).toEqual([]);
    expect(parseInterests('{"a":1}')).toEqual([]);
  });
});

describe('nhật ký: đọc được dòng cũ', () => {
  const old: CskhLogRow = {
    id: 'l1', client_id: null, client_name: 'Cty cũ', contact_person: 'Chị B', contact_type: 'zalo',
    content: 'x', followup: 'gửi báo giá', followup_done: false, log_date: '2026-06-01', created_at: '2026-06-01',
  };

  it('zalo cũ → Tin nhắn qua Zalo; meeting cũ → Gặp mặt; loại lạ → Khác', () => {
    expect(mapLogRow(old)).toMatchObject({
      type: 'message', channel: 'zalo', contactId: null, clientName: 'Cty cũ', contactPerson: 'Chị B',
      followUpAction: 'gửi báo giá', followUpDue: null, isArchived: false,
    });
    expect(interactionTypeOf('meeting')).toBe('meet');
    expect(interactionTypeOf('coffee')).toBe('coffee');
    expect(interactionTypeOf('fax')).toBe('other');
    expect(mapLogRow({ ...old, contact_type: 'call' }).channel).toBe('call');
  });

  it('dòng mới giữ nguyên kênh đã chọn', () => {
    expect(mapLogRow({ ...old, contact_type: 'message', channel: 'sms', initiated_by: 'them', contact_id: 'c1' }))
      .toMatchObject({ type: 'message', channel: 'sms', initiatedBy: 'them', contactId: 'c1' });
  });
});

describe('sự kiện', () => {
  it('dòng cũ chưa có day/month → lấy từ cột date', () => {
    expect(mapSpecialDateRow({ id: 's1', contact_id: 'c1', label: 'Thành lập', date: '2015-01-20' }))
      .toMatchObject({ day: 20, month: 1, isLunar: false, occasionType: 'other', remindDaysBefore: 7, year: null });
  });

  it('âm lịch dùng day/month; thiếu ngày → bỏ qua', () => {
    expect(mapSpecialDateRow({ id: 's2', contact_id: 'c1', label: 'Giỗ bố', date: null, is_lunar: true, day: 10, month: 3, occasion_type: 'memorial' }))
      .toMatchObject({ day: 10, month: 3, isLunar: true, occasionType: 'memorial' });
    expect(mapSpecialDateRow({ id: 's3', contact_id: 'c1', label: 'Hỏng', date: null, is_lunar: true })).toBeNull();
  });

  it('ngày sinh trong hồ sơ → sự kiện "Sinh nhật" ảo', () => {
    expect(birthdayOccasion(makeContact({ id: 'c9', birthday: '1985-03-15' })))
      .toMatchObject({ id: 'birthday:c9', day: 15, month: 3, year: 1985, occasionType: 'birthday', source: 'birthday' });
    expect(birthdayOccasion(makeContact({ birthday: null }))).toBeNull();
  });
});

describe('quà, nhóm, cài đặt', () => {
  it('quà cũ = mình tặng, giá trị dạng số', () => {
    const g: ClientGift = {
      id: 'g1', client_id: 'cl1', item_name: 'Bánh trung thu', value: 500000, gift_date: '2026-09-20',
      notes: null, recipient_name: 'Anh A', recipient_contact_id: 'c1', created_by: 'Tony', created_at: '2026-09-20',
    };
    expect(mapGiftRow(g)).toMatchObject({ direction: 'given', estimatedValue: 500000, contactId: 'c1', item: 'Bánh trung thu' });
  });

  it('nhóm: màu lạ → blue, hạng lạ → null', () => {
    expect(mapGroupRow({ id: 'gr', name: 'Khách Midea', color: 'pink', base_tier: 'boss' })).toMatchObject({ color: 'blue', baseTier: null });
  });

  it('chưa có dòng cài đặt → mặc định; "07:30:00" → "07:30"', () => {
    expect(mapSettingsRow(null).cadence.vvip).toBe(14);
    expect(mapSettingsRow({
      cadence_vvip: 10, cadence_vip: 30, cadence_partner: 45, cadence_friend: 90, cadence_family: 30, cadence_other: 180,
      digest_enabled: true, digest_time: '07:30:00', digest_max_items: 5, digest_last_sent_on: null, updated_at: 'x',
    })).toMatchObject({ digestTime: '07:30', digestEnabled: true, cadence: { vvip: 10 } });
  });
});

describe('Xếp gợi ý theo chức vụ', () => {
  it('chức vụ thật đang có trong dữ liệu LetsGo', () => {
    const t = (r: string, p = false) => suggestTierForRole(r, p).tier;
    expect(t('GĐ - Điều Hành')).toBe('vvip');
    expect(t('GĐ - Xưởng')).toBe('vvip');
    expect(t('GĐ Nhân Sự')).toBe('vip');
    expect(t('TP - Nhân Sự')).toBe('vip');
    expect(t('PP - Nhân Sự')).toBe('vip');
    expect(t('TP - Tuyển Dụng')).toBe('vip');
    expect(t('TL Chủ Tịch')).toBe('vip');
    expect(t('TL - GĐ Nhân Sự')).toBe('vip');
    expect(t('Nhân Sự')).toBe('partner');
    expect(t('Tổng Vụ')).toBe('partner');
    expect(t('')).toBe('partner');
  });

  it('liên hệ chính đang ở Tác nghiệp → nâng lên Người ảnh hưởng (không nâng quá)', () => {
    expect(suggestTierForRole('Nhân Sự', true)).toEqual({ tier: 'vip', reason: 'Làm việc hằng ngày · liên hệ chính của công ty' });
    expect(suggestTierForRole('GĐ - Điều Hành', true).tier).toBe('vvip');
  });

  it('"tp" không khớp nhầm giữa chữ', () => {
    expect(suggestTierForRole('Nhân viên TPHCM').tier).toBe('partner');
  });

  it('chỉ gợi ý người đang phụ trách, còn Chưa chăm sóc, ở khách đang hợp tác', () => {
    const clients = [
      { id: 'ok', client_type: 'active' as const, cooperation_status: 'active' as const, archived_at: null },
      { id: 'stop', client_type: 'active' as const, cooperation_status: 'suspended' as const, archived_at: null },
      { id: 'lead', client_type: 'prospect' as const, cooperation_status: undefined, archived_at: null },
    ];
    const contacts = [
      makeContact({ id: 'a', tier: 'unclassified', clientIds: ['ok'], jobTitle: 'GĐ - Điều Hành' }),
      makeContact({ id: 'b', tier: 'unclassified', clientIds: ['stop'] }),
      makeContact({ id: 'c', tier: 'unclassified', clientIds: ['lead'] }),
      makeContact({ id: 'd', tier: 'friend', clientIds: ['ok'] }), // đã chọn tay → không đè
      makeContact({ id: 'e', tier: 'unclassified', clientIds: ['ok'], isArchived: true, isActive: false }),
      makeContact({ id: 'f', tier: 'unclassified', clientIds: ['stop', 'ok'], primaryClientIds: ['stop'], jobTitle: 'Nhân Sự' }),
    ];
    expect(buildSeedPlan(contacts, clients).map(r => [r.contactId, r.tier])).toEqual([['a', 'vvip'], ['f', 'partner']]);
  });
});

describe('ngày hiển thị', () => {
  it('nhãn tương đối và ngày dài', () => {
    expect(relativeDayLabel('2026-10-19', '2026-10-19')).toBe('Hôm nay');
    expect(relativeDayLabel('2026-10-18', '2026-10-19')).toBe('Hôm qua');
    expect(relativeDayLabel('2026-10-14', '2026-10-19')).toBe('5 ngày trước');
    expect(relativeDayLabel('2026-09-28', '2026-10-19')).toBe('3 tuần trước');
    expect(relativeDayLabel('2026-07-19', '2026-10-19')).toBe('3 tháng trước');
    expect(relativeDayLabel('2024-01-02', '2026-10-19')).toBe('02/01/2024');
    expect(formatDateVN('2026-10-19')).toBe('19/10/2026');
    expect(longDateVN('2026-10-18')).toBe('Chủ Nhật, 18 tháng 10');
  });
});
