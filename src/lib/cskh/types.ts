// ============================================================================
// CSKH — kiểu dữ liệu + nhãn hiển thị dùng chung cho cả module.
// ----------------------------------------------------------------------------
// Mang từ PRM (Tony Study, src/lib/types/prm.types.ts). Các KHOÁ enum giữ y hệt
// PRM để sau này đồng bộ 2 hệ thống — chỉ NHÃN hiển thị đổi cho hợp khách
// doanh nghiệp (nhân viên LetsGo chăm sóc người đại diện công ty khách hàng).
//
// File này thuần kiểu + hằng số: không gọi Supabase, không đọc đồng hồ.
// ============================================================================

// ── Hạng chăm sóc ───────────────────────────────────────────────────────────
export type CskhTier = 'vvip' | 'vip' | 'partner' | 'friend' | 'family' | 'other' | 'unclassified';
export type CskhClassifiedTier = Exclude<CskhTier, 'unclassified'>;

/** Thứ tự hạng trên giao diện (cao → thấp). */
export const CLASSIFIED_TIERS: readonly CskhClassifiedTier[] = ['vvip', 'vip', 'partner', 'friend', 'family', 'other'];
export const ALL_TIERS: readonly CskhTier[] = [...CLASSIFIED_TIERS, 'unclassified'];

/** Nhãn theo VAI TRÒ của người đó với hợp đồng cung ứng (chốt 19/10/2026). */
export const TIER_LABEL: Readonly<Record<CskhTier, string>> = {
  vvip: 'Người quyết định',
  vip: 'Người ảnh hưởng',
  partner: 'Tác nghiệp',
  friend: 'Quan hệ rộng',
  family: 'Thân thiết',
  other: 'Khác',
  unclassified: 'Chưa chăm sóc',
};

/** Một câu giải thích ngắn cho từng hạng (hiện ở ô chọn hạng / màn xếp gợi ý). */
export const TIER_HINT: Readonly<Record<CskhTier, string>> = {
  vvip: 'Giám đốc, chủ doanh nghiệp, người ký hợp đồng',
  vip: 'Trưởng/Giám đốc nhân sự, trợ lý của người quyết định',
  partner: 'Nhân sự, tổng vụ, tuyển dụng — làm việc hằng ngày',
  friend: 'Quen biết rộng, giữ liên lạc thưa',
  family: 'Quan hệ thân thiết riêng',
  other: 'Khác',
  unclassified: 'Chỉ nằm trong danh bạ, không nhắc, không chấm điểm',
};

/** Nhịp liên hệ (số ngày) theo hạng. */
export type CadenceConfig = Record<CskhClassifiedTier, number>;

export const DEFAULT_CADENCE: Readonly<CadenceConfig> = {
  vvip: 14,
  vip: 30,
  partner: 45,
  friend: 90,
  family: 30,
  other: 180,
};

// ── Tương tác (nhật ký) ─────────────────────────────────────────────────────
export type InteractionType = 'call' | 'message' | 'email' | 'meet' | 'coffee' | 'gift' | 'other';

export const INTERACTION_TYPES: readonly InteractionType[] = ['call', 'message', 'email', 'meet', 'coffee', 'gift', 'other'];

export const INTERACTION_LABEL: Readonly<Record<InteractionType, string>> = {
  call: 'Cuộc gọi',
  message: 'Tin nhắn',
  email: 'Email',
  meet: 'Gặp mặt',
  coffee: 'Cà phê',
  gift: 'Quà tặng',
  other: 'Khác',
};

/** Kênh liên lạc — '' = không rõ / gặp trực tiếp. */
export type InteractionChannel = '' | 'call' | 'zalo' | 'sms' | 'other';

export const CHANNEL_LABEL: Readonly<Record<Exclude<InteractionChannel, ''>, string>> = {
  call: 'Điện thoại',
  zalo: 'Zalo',
  sms: 'SMS',
  other: 'Khác',
};

/** Ai chủ động liên hệ: mình (nhân viên LetsGo) hay họ (khách). */
export type InitiatedBy = 'me' | 'them';

// ── Sự kiện ─────────────────────────────────────────────────────────────────
export type OccasionType = 'birthday' | 'anniversary' | 'memorial' | 'other';

export const OCCASION_LABEL: Readonly<Record<OccasionType, string>> = {
  birthday: 'Sinh nhật',
  anniversary: 'Kỷ niệm',
  memorial: 'Đám giỗ',
  other: 'Khác',
};

/** Gợi ý tiêu đề sự kiện doanh nghiệp — vẫn lưu loại 'anniversary' để giữ khoá PRM. */
export const BUSINESS_OCCASION_TITLES: readonly string[] = [
  'Ngày thành lập công ty',
  'Ngày khai trương nhà máy',
  'Kỷ niệm ngày ký hợp đồng đầu tiên',
];

// ── Quà ─────────────────────────────────────────────────────────────────────
export type GiftDirection = 'given' | 'received';

export const GIFT_DIRECTION_LABEL: Readonly<Record<GiftDirection, string>> = {
  given: 'Đã tặng',
  received: 'Đã nhận',
};

// ── Hồ sơ người liên hệ ─────────────────────────────────────────────────────
export type CskhContext = 'personal' | 'work' | 'both';
/**
 * Nguồn toạ độ nhà hiện tại (khoá giống PRM): map_url = link Google Maps trong hồ sơ ·
 * address = tra chữ địa chỉ · manual = chấm tay trên bản đồ · address_url = link Maps của
 * địa chỉ (PRM tách 2 link; LetsGo chỉ có 1 link nên ít dùng). 'address_url' / 'manual'
 * cần migration 174 (nới CHECK).
 */
export type GeoSource = '' | 'map_url' | 'address' | 'address_url' | 'manual';
export const GEO_SOURCES: readonly GeoSource[] = ['', 'map_url', 'address', 'address_url', 'manual'];

/** Giới tính — '' = chưa rõ (migration 174, khoá giống PRM). */
export type Gender = '' | 'male' | 'female';
export const GENDER_LABEL: Readonly<Record<Exclude<Gender, ''>, string>> = { male: 'Nam', female: 'Nữ' };

/** Bậc học của 1 dòng học vấn — '' = chưa chọn (khoá giống PRM). */
export type EducationLevel = '' | 'high_school' | 'vocational' | 'college' | 'university' | 'master' | 'doctor' | 'other';
export interface Education {
  level: EducationLevel;
  /** Tên trường đã chuẩn hoá (gom khoảng trắng, trùng tên đã có ở người khác). */
  school: string;
}
export const EDUCATION_LEVELS: readonly Exclude<EducationLevel, ''>[] = [
  'high_school', 'vocational', 'college', 'university', 'master', 'doctor', 'other',
];
export const EDUCATION_LEVEL_LABEL: Readonly<Record<Exclude<EducationLevel, ''>, string>> = {
  high_school: 'THPT',
  vocational: 'Trung cấp',
  college: 'Cao đẳng',
  university: 'Đại học',
  master: 'Thạc sĩ',
  doctor: 'Tiến sĩ',
  other: 'Khác',
};

export type RememberKey = 'family' | 'likes' | 'avoid' | 'work' | 'other';
/** Thành viên gia đình (Vợ/Chồng, Con) — lưu ở remember_notes.members, không cần cột mới. */
export type FamilyRole = 'spouse' | 'child';
export interface FamilyMember {
  role: FamilyRole;
  name: string;
  /** Năm sinh dương lịch; null = chưa biết. */
  year: number | null;
}
/** family = ghi chú gia đình (chữ tự do); members = vợ/chồng + con có năm sinh. */
export type RememberNotes = Partial<Record<RememberKey, string>> & { members?: FamilyMember[] };

export const REMEMBER_LABEL: Readonly<Record<RememberKey, string>> = {
  family: 'Gia đình',
  likes: 'Món ăn, đồ uống',
  avoid: 'Kiêng kỵ',
  work: 'Công việc, dự án',
  other: 'Khác',
};

export const MBTI_TYPES: readonly string[] = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP',
];

export type GroupColor = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
export const GROUP_COLORS: readonly GroupColor[] = ['blue', 'green', 'orange', 'red', 'purple', 'gray'];

// ── Khu vực chăm sóc: khách hàng / Mạng lưới Sale (migration 178) ──────────
/** contacts.kind — 'client' = người của công ty khách (mặc định), 'sale' = Sale / CTV bên ngoài. */
export type ContactKind = 'client' | 'sale';
export const CONTACT_KINDS: readonly ContactKind[] = ['client', 'sale'];

/** Tiến độ chiêu mộ Sale về làm cho Let's Go (contacts.sale_stage). */
export type SaleStage = 'none' | 'exploring' | 'invited' | 'negotiating' | 'joined' | 'declined';
export const SALE_STAGES: readonly SaleStage[] = ['none', 'exploring', 'invited', 'negotiating', 'joined', 'declined'];

// ── Đối tượng miền (camelCase) — mappers.ts dựng từ dòng DB ─────────────────
export interface CskhContact {
  id: string;
  /** Khu vực: khách hàng (mặc định) hay Mạng lưới Sale — chưa chạy migration 178 thì luôn 'client'. */
  kind: ContactKind;
  /** ── Riêng Sale (migration 178) ── nơi đang làm (gõ tự do / tên đối thủ). */
  saleCompany: string;
  /** Đối thủ trong Thị trường (competitors.id) nếu Sale đang làm cho đối thủ. */
  competitorId: string | null;
  saleStage: SaleStage;
  /** Khu vực / KCN mạnh. */
  saleArea: string;
  /** Ngành quen. */
  saleIndustries: string;
  fullName: string;
  nickname: string;
  avatarUrl: string;
  /** Các số điện thoại (cột `phone` cho nhập nhiều số, ngăn bằng dấu phẩy). */
  phones: string[];
  zaloPhone: string;
  emails: string[];
  /** Các công ty người này phụ trách (bảng nối contact_clients) — ngang hàng. */
  clientIds: string[];
  /** Tập con của clientIds: công ty người này là liên hệ chính. */
  primaryClientIds: string[];
  /** Tên các công ty, nối bằng ", " — để hiển thị / tìm kiếm. */
  organization: string;
  /** Chức vụ (contacts.role / contact_roles). */
  jobTitle: string;
  tier: CskhTier;
  groupId: string | null;
  /** Nhịp riêng; null = theo hạng. */
  cadenceDays: number | null;
  /** "YYYY-MM-DD" — do trigger DB ghi từ cskh_logs. */
  lastInteractionAt: string | null;
  lastColdAlertAt: string | null;
  /** Người phụ trách — app_users.id. */
  ownerId: string | null;
  /** Sở thích (cột `hobbies`). */
  interests: string[];
  habits: string;
  personality: string;
  mbti: string;
  notes: string;
  rememberNotes: RememberNotes;
  introducedBy: string | null;
  context: CskhContext;
  /** Địa chỉ nhà hiện tại — giữ nguyên chữ người dùng dán. */
  address: string;
  /** Link Google Maps của nhà hiện tại (có link = vị trí chính xác). */
  mapUrl: string;
  /** Tỉnh / thành nơi ở hiện tại. */
  province: string;
  /** Quê quán — chỉ tỉnh (migration 174); trên bản đồ vẽ ở tâm tỉnh, luôn "tương đối". */
  originProvince: string;
  lat: number | null;
  lng: number | null;
  geoSource: GeoSource;
  /** Ngày sinh dương lịch "YYYY-MM-DD" (cột contacts.birthday). */
  birthday: string | null;
  /** Nhắc sinh nhật trong hồ sơ trước N ngày (migration 174); null = mặc định 3. */
  birthdayRemindDays: number | null;
  gender: Gender;
  education: Education[];
  /** false = "Đã nghỉ" (rời công ty khách). */
  isActive: boolean;
  /**
   * Coi như "lưu trữ" của PRM: không nhắc, không chấm điểm, không vào hàng đợi.
   * Ở LetsGo = người đã nghỉ (chốt 19/10/2026) — giữ nguyên hạng + lịch sử.
   */
  isArchived: boolean;
  externalRef: string | null;
  updatedAt: string;
}

export interface CskhExtraTask {
  id: string;
  action: string;
  due: string | null;
  done: boolean;
}

export interface CskhInteraction {
  id: string;
  /** null = dòng nhật ký cũ chỉ có tên công ty / người liên hệ dạng chữ. */
  contactId: string | null;
  clientId: string | null;
  clientName: string;
  contactPerson: string;
  type: InteractionType;
  channel: InteractionChannel;
  initiatedBy: InitiatedBy | null;
  /** "YYYY-MM-DD" */
  occurredAt: string;
  content: string;
  followUpAction: string;
  followUpDue: string | null;
  followUpDone: boolean;
  followUpTaskId: string | null;
  /** Id các việc THÊM trong Workspace tạo từ dòng này (migration 175). */
  extraTaskIds: string[];
  /** Việc thêm đã nạp từ work_tasks (chưa xoá) — loadCskhData điền. */
  extraTasks: CskhExtraTask[];
  createdBy: string | null;
  createdByName: string;
  isArchived: boolean;
  createdAt: string;
}

export interface CskhOccasion {
  id: string;
  contactId: string;
  title: string;
  occasionType: OccasionType;
  day: number;
  month: number;
  /** Năm thật nếu biết (năm sinh, năm thành lập…); null = không rõ. */
  year: number | null;
  isLunar: boolean;
  /** "của người thân" — con gái, mẹ… '' = của chính người liên hệ. */
  relatedPerson: string;
  remindDaysBefore: number;
  lastRemindedYear: number | null;
  note: string;
  isArchived: boolean;
  /**
   * 'special_date' = dòng contact_special_dates; 'birthday' = suy từ
   * contacts.birthday (sửa ở form người liên hệ, không có dòng riêng).
   */
  source: 'special_date' | 'birthday';
}

export interface CskhGift {
  id: string;
  /** null = quà tặng Sale (không gắn công ty khách, migration 178). */
  clientId: string | null;
  /** Người liên hệ của món quà (người nhận khi mình tặng, người tặng khi họ tặng). */
  contactId: string | null;
  recipientName: string;
  occasionId: string | null;
  direction: GiftDirection;
  item: string;
  /** VND, có thể trống. */
  estimatedValue: number | null;
  /** "YYYY-MM-DD" */
  givenAt: string;
  note: string;
  createdBy: string;
  isArchived: boolean;
  /** Dấu đợt khi ghi cho nhóm (cùng created_at với nhật ký của đợt). */
  createdAt: string;
}

export interface CskhGroup {
  id: string;
  name: string;
  color: GroupColor;
  /** null = chưa chọn → coi như 'other'. */
  baseTier: CskhClassifiedTier | null;
  /** Nhóm của khách hay của Sale (migration 178; chưa chạy = 'client'). */
  kind: ContactKind;
  isArchived: boolean;
}

export interface CskhSettings {
  /** Nhịp theo hạng của khu vực đang mở (trang Sale nạp = saleCadence). */
  cadence: CadenceConfig;
  /** Nhịp theo hạng của Mạng lưới Sale (migration 178; chưa chạy = mặc định). */
  saleCadence: CadenceConfig;
  digestEnabled: boolean;
  /** "HH:MM" */
  digestTime: string;
  digestMaxItems: number;
  digestLastSentOn: string | null;
  updatedAt: string | null;
}

// ── Điểm sức khỏe quan hệ ───────────────────────────────────────────────────
export interface RelationshipScoreBreakdown {
  /** Nhịp liên hệ — tối đa 50. */
  cadence: number;
  /** Thấu hiểu — tối đa 20. */
  understanding: number;
  /** Sự kiện & quà — tối đa 20. */
  care: number;
  /** Ghi chú lần gần nhất — tối đa 10. */
  recentNote: number;
}

export interface RelationshipScore {
  total: number;
  breakdown: RelationshipScoreBreakdown;
  daysSinceLastInteraction: number | null;
  daysUntilDue: number | null;
}

export interface RelationshipScoreInput {
  cadenceDays: number;
  today: string;
  interactionDates: string[];
  lastInteractionContent: string;
  interests: string[];
  habits: string;
  personality: string;
  mbti: string;
  occasionCount: number;
  giftsGivenLastYear: number;
}
