// ============================================================================
// Bảng nháp đầu mối Sale / CTV (migration 226 — bảng `sale_leads`).
// ----------------------------------------------------------------------------
// Đầu mối = người tìm được trên mạng (bài đăng tuyển, kênh FB / Zalo…), CHƯA quen — mới gọi / nhắn mời
// hợp tác. Để riêng khỏi danh bạ chăm sóc: không nhắc việc, không chấm điểm. Mục đích chính là KHÔNG
// GỌI TRÙNG (mỗi SĐT 1 dòng). Gặp được rồi mới "Chuyển sang Sale / CTV" (tạo contacts kind = 'sale').
// File thuần: kiểu + nhãn, không gọi Supabase.
// ============================================================================

export type SaleLeadStatus = 'new' | 'no_answer' | 'talking' | 'meeting' | 'declined' | 'promoted';
export const SALE_LEAD_STATUSES: readonly SaleLeadStatus[] = ['new', 'no_answer', 'talking', 'meeting', 'declined', 'promoted'];

export const SALE_LEAD_STATUS_LABEL: Readonly<Record<SaleLeadStatus, string>> = {
  new: 'Chưa liên hệ',
  no_answer: 'Chưa bắt máy',
  talking: 'Đang trao đổi',
  meeting: 'Hẹn gặp',
  declined: 'Từ chối',
  promoted: 'Đã chuyển Sale / CTV',
};

export const SALE_LEAD_STATUS_HINT: Readonly<Record<SaleLeadStatus, string>> = {
  new: 'Mới nhập, chưa gọi / nhắn lần nào',
  no_answer: 'Gọi không nghe máy / nhắn chưa trả lời',
  talking: 'Đã nói chuyện, đang trao đổi',
  meeting: 'Đã hẹn được buổi gặp',
  declined: 'Không muốn hợp tác — giữ lại để không gọi lại',
  promoted: 'Đã gặp, đã thêm vào danh sách Sale / CTV',
};

export const SALE_LEAD_STATUS_COLOR: Readonly<Record<SaleLeadStatus, string>> = {
  new: '#6E6E73',
  no_answer: '#B25000',
  talking: '#0071E3',
  meeting: '#8944AB',
  declined: '#D70015',
  promoted: '#248A3D',
};

/** Kết quả chọn được khi ghi 1 lần liên hệ ('promoted' chỉ đặt khi chuyển sang Sale / CTV). */
export type LeadContactResult = Exclude<SaleLeadStatus, 'new' | 'promoted'>;
export const LEAD_CONTACT_RESULTS: readonly LeadContactResult[] = ['no_answer', 'talking', 'meeting', 'declined'];

export type LeadChannel = 'call' | 'zalo' | 'facebook' | 'sms' | 'other';
export const LEAD_CHANNELS: readonly LeadChannel[] = ['call', 'zalo', 'facebook', 'sms', 'other'];
export const LEAD_CHANNEL_LABEL: Readonly<Record<LeadChannel, string>> = {
  call: 'Gọi điện',
  zalo: 'Zalo',
  facebook: 'Facebook',
  sms: 'SMS',
  other: 'Khác',
};

/** 1 lần gọi / nhắn (sale_leads.contact_log). */
export interface LeadContactLog {
  /** ISO thời điểm ghi. */
  at: string;
  channel: LeadChannel;
  result: LeadContactResult;
  note: string;
  /** Tên người ghi. */
  by: string;
}

export interface SaleLead {
  id: string;
  fullName: string;
  /** SĐT như đã nhập (có thể nhiều số). */
  phone: string;
  /** Số đã chuẩn hoá 0xxxxxxxxx — khoá chống trùng. */
  phoneKeys: string[];
  /** Đơn vị đang làm (Manpower, Green Speed… / tự do). */
  company: string;
  /** KCN đã ghép với danh mục (market_zones.id). */
  zoneIds: string[];
  /** Cột "Khu vực" chữ gốc. */
  areaText: string;
  channelUrl: string;
  postUrl: string;
  note: string;
  status: SaleLeadStatus;
  /** Cũ → mới. */
  contactLog: LeadContactLog[];
  lastContactAt: string | null;
  promotedContactId: string | null;
  promotedAt: string | null;
  source: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Dòng DB (snake_case). */
export interface SaleLeadRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  phone_keys: string[] | null;
  company: string | null;
  zone_ids: string[] | null;
  area_text: string | null;
  channel_url: string | null;
  post_url: string | null;
  note: string | null;
  status: string | null;
  contact_log: unknown;
  last_contact_at: string | null;
  promoted_contact_id: string | null;
  promoted_at: string | null;
  source: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const isStatus = (v: unknown): v is SaleLeadStatus => typeof v === 'string' && (SALE_LEAD_STATUSES as readonly string[]).includes(v);
const isResult = (v: unknown): v is LeadContactResult => typeof v === 'string' && (LEAD_CONTACT_RESULTS as readonly string[]).includes(v);
const isChannel = (v: unknown): v is LeadChannel => typeof v === 'string' && (LEAD_CHANNELS as readonly string[]).includes(v);

function mapLog(raw: unknown): LeadContactLog[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e): LeadContactLog[] => {
    if (!e || typeof e !== 'object') return [];
    const o = e as Record<string, unknown>;
    if (typeof o.at !== 'string' || !isResult(o.result)) return [];
    return [{
      at: o.at,
      channel: isChannel(o.channel) ? o.channel : 'other',
      result: o.result,
      note: typeof o.note === 'string' ? o.note : '',
      by: typeof o.by === 'string' ? o.by : '',
    }];
  });
}

export function mapSaleLeadRow(r: SaleLeadRow): SaleLead {
  return {
    id: r.id,
    fullName: (r.full_name ?? '').trim(),
    phone: (r.phone ?? '').trim(),
    phoneKeys: (r.phone_keys ?? []).filter(Boolean),
    company: (r.company ?? '').trim(),
    zoneIds: (r.zone_ids ?? []).filter(Boolean),
    areaText: (r.area_text ?? '').trim(),
    channelUrl: (r.channel_url ?? '').trim(),
    postUrl: (r.post_url ?? '').trim(),
    note: (r.note ?? '').trim(),
    status: isStatus(r.status) ? r.status : 'new',
    contactLog: mapLog(r.contact_log),
    lastContactAt: r.last_contact_at,
    promotedContactId: r.promoted_contact_id,
    promotedAt: r.promoted_at,
    source: (r.source ?? '').trim(),
    createdBy: (r.created_by ?? '').trim(),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
