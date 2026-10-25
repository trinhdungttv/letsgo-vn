// Dữ liệu mẫu dùng chung cho test của src/lib/cskh (không dùng trong app).
import type { CskhContact, CskhGift, CskhInteraction, CskhOccasion } from './types';

let seq = 0;
const next = (p: string) => `${p}${String(++seq).padStart(3, '0')}`;

export function makeContact(over: Partial<CskhContact> = {}): CskhContact {
  const id = over.id ?? next('c');
  return {
    id,
    fullName: `Người ${id}`,
    nickname: '',
    avatarUrl: '',
    phones: [],
    zaloPhone: '',
    emails: [],
    clientIds: [],
    primaryClientIds: [],
    organization: '',
    jobTitle: '',
    tier: 'vip',
    groupId: null,
    cadenceDays: null,
    lastInteractionAt: null,
    lastColdAlertAt: null,
    ownerId: null,
    interests: [],
    habits: '',
    personality: '',
    mbti: '',
    notes: '',
    rememberNotes: {},
    introducedBy: null,
    context: 'work',
    address: '',
    mapUrl: '',
    province: '',
    originProvince: '',
    lat: null,
    lng: null,
    geoSource: '',
    birthday: null,
    birthdayRemindDays: null,
    gender: '',
    education: [],
    isActive: true,
    isArchived: false,
    externalRef: null,
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

export function makeInteraction(contactId: string | null, over: Partial<CskhInteraction> = {}): CskhInteraction {
  return {
    id: next('i'),
    contactId,
    clientId: null,
    clientName: '',
    contactPerson: '',
    type: 'call',
    channel: '',
    initiatedBy: null,
    occurredAt: '2026-10-10',
    content: '',
    followUpAction: '',
    followUpDue: null,
    followUpDone: false,
    followUpTaskId: null,
    createdBy: null,
    createdByName: '',
    isArchived: false,
    createdAt: '2026-10-10T00:00:00Z',
    ...over,
  };
}

export function makeOccasion(contactId: string, over: Partial<CskhOccasion> = {}): CskhOccasion {
  return {
    id: next('o'),
    contactId,
    title: 'Sinh nhật',
    occasionType: 'birthday',
    day: 1,
    month: 1,
    year: null,
    isLunar: false,
    relatedPerson: '',
    remindDaysBefore: 7,
    lastRemindedYear: null,
    note: '',
    isArchived: false,
    source: 'special_date',
    ...over,
  };
}

export function makeGift(contactId: string, over: Partial<CskhGift> = {}): CskhGift {
  return {
    id: next('g'),
    clientId: 'cl1',
    contactId,
    recipientName: '',
    occasionId: null,
    direction: 'given',
    item: 'Giỏ quà',
    estimatedValue: null,
    givenAt: '2026-09-01',
    note: '',
    createdBy: '',
    isArchived: false,
    createdAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

/** Cộng n ngày vào "YYYY-MM-DD" (giờ UTC, chỉ dùng trong test). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
