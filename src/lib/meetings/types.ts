// Đi họp (CSKH → tab "Đi họp", migration 217): thành viên hay đi họp + lịch họp + tuỳ chọn bản
// "Danh sách đăng ký ra vào cổng". Pháp nhân đứng tên danh sách = quote_entities (dùng chung Phương án giá).

export type MemberGender = '' | 'Nam' | 'Nữ';

export interface MeetingMember {
  id: string;
  full_name: string;
  gender: MemberGender;
  /** "1983" hoặc "12/03/1983" — in y như nhập. */
  birth: string;
  id_number: string;
  /** yyyy-mm-dd | null */
  id_issued_on: string | null;
  id_issued_by: string;
  address: string;
  title: string;
  phone: string;
  vehicle_plate: string;
  note: string;
  active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Thành viên đã xoá vẫn được trả về để buổi họp cũ hiện đúng tên. */
  deleted_at: string | null;
}

export type MemberDraft = Pick<MeetingMember,
  'full_name' | 'gender' | 'birth' | 'id_number' | 'id_issued_on' | 'id_issued_by' | 'address' | 'title' | 'phone' | 'vehicle_plate' | 'note' | 'active'>;

export const emptyMember = (): MemberDraft => ({
  full_name: '', gender: '', birth: '', id_number: '', id_issued_on: null, id_issued_by: DEFAULT_ISSUER,
  address: '', title: '', phone: '', vehicle_plate: '', note: '', active: true,
});

/** Nơi cấp CCCD gắn chip mới (từ 2016): Cục Cảnh sát QLHC về TTXH — viết tắt như mẫu của công ty. */
export const DEFAULT_ISSUER = 'CCSHCTTXH';
export const ISSUER_SUGGESTIONS = [
  'CCSHCTTXH',
  'Cục Cảnh sát QLHC về TTXH',
  'Bộ Công an',
  'Cục Cảnh sát ĐKQL cư trú và DLQG về dân cư',
];

export type MeetingStatus = 'planned' | 'done' | 'cancelled';
export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = { planned: 'Sắp họp', done: 'Đã họp', cancelled: 'Huỷ' };

export interface Attendee {
  id: string;
  /** Chức vụ riêng cho buổi này (khác hồ sơ) — trống = theo hồ sơ thành viên. */
  title: string;
}

/** Cột thêm (ngoài 9 cột như mẫu) có thể bật trên bản in. */
export type GateExtraCol = 'phone' | 'vehicle_plate';

export interface GateOptions {
  /** yyyy-mm-dd — ngày ghi ở dòng "…, ngày … tháng … năm …"; null = hôm nay. */
  docDate?: string | null;
  /** Nơi ký ("Đồng Nai") — trống = theo pháp nhân. */
  place?: string;
  title?: string;
  /** "Kính gửi: …" — trống = không in dòng này. */
  recipient?: string;
  /** In thêm dòng "Thời gian · Nội dung" dưới tiêu đề. */
  showVisit?: boolean;
  extraCols?: GateExtraCol[];
  /** In tên người đại diện (pháp nhân) dưới chỗ ký — mặc định có. */
  showSigner?: boolean;
}

export interface Meeting {
  id: string;
  meet_date: string;
  /** 'HH:MM' hoặc '' */
  meet_time: string;
  client_id: string | null;
  company_name: string;
  location: string;
  purpose: string;
  entity_id: string | null;
  attendees: Attendee[];
  contact_ids: string[];
  status: MeetingStatus;
  note: string;
  result: string;
  gate: GateOptions;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MeetingDraft = Pick<Meeting,
  'meet_date' | 'meet_time' | 'client_id' | 'company_name' | 'location' | 'purpose' | 'entity_id' | 'attendees' | 'contact_ids' | 'status' | 'note' | 'result'>;

export interface MeetingBootstrap {
  me: { name: string; role: string; level: 'full' | 'view' };
  members: MeetingMember[];
  meetings: Meeting[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function normalizeMember(raw: unknown): MeetingMember {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const g = str(r.gender);
  return {
    id: str(r.id), full_name: str(r.full_name), gender: g === 'Nam' || g === 'Nữ' ? g : '', birth: str(r.birth),
    id_number: str(r.id_number), id_issued_on: str(r.id_issued_on) || null, id_issued_by: str(r.id_issued_by),
    address: str(r.address), title: str(r.title), phone: str(r.phone), vehicle_plate: str(r.vehicle_plate), note: str(r.note),
    active: r.active !== false, sort_order: Number(r.sort_order) || 0, created_by: str(r.created_by) || null,
    created_at: str(r.created_at), updated_at: str(r.updated_at), deleted_at: str(r.deleted_at) || null,
  };
}

export function normalizeGate(raw: unknown): GateOptions {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: GateOptions = {};
  if (typeof r.docDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.docDate)) out.docDate = r.docDate;
  if (typeof r.place === 'string') out.place = r.place;
  if (typeof r.title === 'string') out.title = r.title;
  if (typeof r.recipient === 'string') out.recipient = r.recipient;
  if (typeof r.showVisit === 'boolean') out.showVisit = r.showVisit;
  if (typeof r.showSigner === 'boolean') out.showSigner = r.showSigner;
  if (Array.isArray(r.extraCols)) out.extraCols = r.extraCols.filter((c): c is GateExtraCol => c === 'phone' || c === 'vehicle_plate');
  return out;
}

export function normalizeMeeting(raw: unknown): Meeting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const st = str(r.status);
  const att = Array.isArray(r.attendees) ? r.attendees : [];
  return {
    id: str(r.id), meet_date: str(r.meet_date).slice(0, 10), meet_time: str(r.meet_time),
    client_id: str(r.client_id) || null, company_name: str(r.company_name), location: str(r.location), purpose: str(r.purpose),
    entity_id: str(r.entity_id) || null,
    attendees: att.map(a => {
      const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      return { id: str(o.id), title: str(o.title) };
    }).filter(a => a.id),
    contact_ids: Array.isArray(r.contact_ids) ? r.contact_ids.map(str).filter(Boolean) : [],
    status: st === 'done' || st === 'cancelled' ? st : 'planned',
    note: str(r.note), result: str(r.result), gate: normalizeGate(r.gate),
    created_by: str(r.created_by) || null, created_at: str(r.created_at), updated_at: str(r.updated_at),
  };
}
