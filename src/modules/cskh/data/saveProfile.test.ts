// Lưu hồ sơ CSKH: cột migration 174 chỉ gửi khi đổi, lớp lùi khi chưa chạy 174, ngày quan trọng,
// toạ độ (chấm tay > link > tra chữ). Supabase + contactOps giả.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planOccasionSave, profileBirthdayId } from '../../../lib/cskh/occasions';
import { makeContact } from '../../../lib/cskh/testFixtures';
import type { AppUser, Contact } from '../../../lib/types';

interface Call { table: string; op: string; payload?: unknown; filters: string[] }
const calls: Call[] = [];
const failOnce = new Map<string, { message: string; code?: string }>();
const saveContact = vi.fn(async () => ({}));

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  const result = () => {
    const k = `${table}:${call.op}`;
    const err = failOnce.get(k);
    if (err) { failOnce.delete(k); return { data: null, error: err }; }
    return { data: { id: 'row' }, error: null };
  };
  const b: Record<string, unknown> = {
    insert: (p: unknown) => { call.op = 'insert'; call.payload = p; calls.push(call); return b; },
    update: (p: unknown) => { call.op = 'update'; call.payload = p; calls.push(call); return b; },
    select: () => b,
    eq: (k: string, v: unknown) => { call.filters.push(`${k}=${v}`); return b; },
    in: (k: string, v: unknown[]) => { call.filters.push(`${k} in ${v.join(',')}`); return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return b;
}
vi.mock('../../../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock('../../../lib/audit', () => ({ logActivity: vi.fn() }));
vi.mock('../../../lib/contactOps', () => ({
  saveContact,
  selectContacts: vi.fn(),
  contactToForm: (c: Contact) => ({
    name: c.name, phone: '', email: '', role: '', client_ids: [], primary_client_ids: [], start_date: '', is_active: true,
    notes: '', address: c.address ?? '', birthday: c.birthday ?? '', hobbies: [], channel: '', social_link: '', rich_notes: '',
    map_link: c.map_link ?? '', avatar_url: '',
  }),
}));

const { saveProfile } = await import('./api');

const user = { id: 'u1', username: 'a', full_name: 'Admin', role: 'admin' } as AppUser;
const raw = { id: 'c1', name: 'Ms Lan', address: '12 Lê Lợi', birthday: '1990-10-27', map_link: '' } as Contact;
const current = makeContact({ id: 'c1', fullName: 'Ms Lan', address: '12 Lê Lợi', lat: 10, lng: 106, geoSource: 'address', birthday: '1990-10-27' });
const cskh = {
  tier: 'vip' as const, groupId: null, cadenceDays: null, ownerId: null, nickname: '', zaloPhone: '', habits: '', personality: '',
  mbti: '', rememberNotes: {}, introducedBy: null, context: 'work' as const, province: '', gender: '' as const, education: [], originProvince: '',
};
const noGeo = { manualPin: null, linkCoords: null, preview: null };
const of = (table: string, op: string) => calls.filter(c => c.table === table && c.op === op);

beforeEach(() => { calls.length = 0; failOnce.clear(); saveContact.mockClear(); });

describe('saveProfile', () => {
  it('không đổi cột mới → không gửi cột migration 174; toạ độ giữ nguyên', async () => {
    const r = await saveProfile({ raw, current, shared: {}, cskh, geo: noGeo, occasions: null, user, clientName: () => null });
    const patch = of('contacts', 'update')[0].payload as Record<string, unknown>;
    expect(patch).not.toHaveProperty('gender');
    expect(patch).not.toHaveProperty('education');
    expect(patch).not.toHaveProperty('origin_province');
    expect(patch).not.toHaveProperty('lat');
    expect(r.partial174).toBe(false);
  });

  it('chưa chạy 174: ghi lại không kèm cột mới, chấm tay → nguồn "address"; báo partial', async () => {
    failOnce.set('contacts:update', { message: "Could not find the 'gender' column", code: 'PGRST204' });
    const r = await saveProfile({
      raw, current, shared: {}, cskh: { ...cskh, gender: 'female', originProvince: 'Nam Định' },
      geo: { ...noGeo, manualPin: { lat: 10.5, lng: 106.5 } }, occasions: null, user, clientName: () => null,
    });
    const [first, second] = of('contacts', 'update').map(c => c.payload as Record<string, unknown>);
    expect(first).toMatchObject({ gender: 'female', origin_province: 'Nam Định', geo_source: 'manual', lat: 10.5 });
    expect(second).not.toHaveProperty('gender');
    expect(second).not.toHaveProperty('origin_province');
    expect(second).toMatchObject({ geo_source: 'address', lat: 10.5, lng: 106.5, tier: 'vip' });
    expect(r.partial174).toBe(true);
  });

  it('lỗi khác (không phải thiếu cột) → báo lỗi, không nuốt', async () => {
    failOnce.set('contacts:update', { message: 'permission denied', code: '42501' });
    await expect(saveProfile({ raw, current, shared: {}, cskh: { ...cskh, gender: 'male' }, geo: noGeo, occasions: null, user, clientName: () => null }))
      .rejects.toThrow('permission denied');
  });

  it('ngày quan trọng: đổi sinh nhật hồ sơ + nhắc trước, thêm ngày giỗ âm lịch', async () => {
    const existing = [{
      id: profileBirthdayId('c1'), contactId: 'c1', title: 'Sinh nhật', occasionType: 'birthday' as const, day: 27, month: 10, year: 1990,
      isLunar: false, relatedPerson: '', remindDaysBefore: 3, lastRemindedYear: null, note: '', isArchived: false, source: 'birthday' as const,
    }];
    const plan = planOccasionSave(existing, [
      { id: profileBirthdayId('c1'), occasionType: 'birthday', title: '', day: 28, month: 10, year: 1990, isLunar: false, remindDaysBefore: 7 },
      { occasionType: 'memorial', title: 'Giỗ bố', day: 10, month: 3, year: null, isLunar: true, remindDaysBefore: 3 },
    ]);
    await saveProfile({ raw, current, shared: {}, cskh, geo: noGeo, occasions: plan, user, clientName: () => null });
    expect(saveContact).toHaveBeenCalledWith(expect.objectContaining({ birthday: '1990-10-28' }), raw, expect.anything());
    expect(of('contacts', 'update')[0].payload).toMatchObject({ birthday_remind_days: 7 });
    expect(of('contact_special_dates', 'insert')[0].payload).toEqual([{
      contact_id: 'c1', label: 'Giỗ bố', occasion_type: 'memorial', day: 10, month: 3, year: null, is_lunar: true, remind_days_before: 3, date: null,
    }]);
  });
});
