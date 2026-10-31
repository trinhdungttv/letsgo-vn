// ============================================================================
// Module Tuyển dụng — kiểu dữ liệu (bảng recruit_*, migration 180+).
// Dữ liệu chỉ đi qua recruit_rpc (lib/recruit/api.ts) — bảng khoá với anon key vì có SĐT / CCCD.
// ============================================================================
import type { ReferralConfig } from '../costPlan/referral';

export type RecruitStage =
  | 'new' | 'contacted' | 'interview' | 'passed' | 'ready' | 'started' | 'fee_ok' | 'done'
  | 'rejected' | 'dropped' | 'no_show' | 'left' | 'converted';

/** direct = NLĐ ký HĐ trực tiếp với khách (mình giới thiệu) · leasing = thời vụ do Let's Go ký. */
export type EmploymentType = 'direct' | 'leasing';
export type PositionGroup = 'A' | 'B' | 'C' | 'other';
export type TargetStatus = 'planned' | 'confirmed' | 'cancelled';
export type ProjectStatus = 'active' | 'paused' | 'closed';

export interface RecruitProject {
  id: string;
  name: string;
  client_id: string | null;
  contact_name: string;
  contact_title: string;
  /** 'YYYY-MM' */
  period_from: string | null;
  period_to: string | null;
  status: ProjectStatus;
  /** Điều khoản phí giới thiệu — cùng dạng Phương án giá (có thể thiếu trường → normalizeReferral). */
  fee: Partial<ReferralConfig>;
  no_worker_fee: boolean;
  notes: string;
  /** Hoa hồng CTV (migration 181) */
  ctv?: Partial<CtvConfig>;
  /** Link ứng tuyển công khai #/apply/<mã> (migration 181) */
  public_code?: string | null;
  public_open?: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Hoa hồng CTV: cố định / người hoặc % phí giới thiệu, tính khi người được giới thiệu đi làm hoặc đủ ngày tính phí. */
export interface CtvConfig {
  mode: 'per_hire' | 'pct_fee';
  value: number;
  milestone: 'started' | 'fee_ok';
}

export interface RecruitSite {
  id: string;
  project_id: string;
  name: string;
  zone_name: string;
  branch_id: string | null;
  client_id: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  sort_order: number;
}

export interface RecruitPosition {
  id: string;
  project_id: string;
  title: string;
  group_code: PositionGroup;
  employment_type: EmploymentType;
  /** false = vị trí đề xuất khảo sát (chưa phải nhu cầu KH xác nhận) */
  confirmed: boolean;
  is_open: boolean;
  /** rỗng = áp dụng mọi nhà máy của dự án */
  site_ids: string[];
  salary_min: number | null;
  salary_max: number | null;
  salary_note: string;
  hours_per_week: number | null;
  shift_note: string;
  description: string;
  requirements: string;
  benefits: string;
  education_min: string;
  age_min: number | null;
  age_max: number | null;
  gender_pref: 'any' | 'male' | 'female';
  cleanroom: boolean;
  fee_override: Partial<ReferralConfig> | null;
  sort_order: number;
}

export interface RecruitTarget {
  id: string;
  project_id: string;
  site_id: string;
  /** null = chỉ tiêu chung của nhà máy (chưa chia vị trí) */
  position_id: string | null;
  month: string;
  qty: number;
  status: TargetStatus;
  note: string;
}

export interface HireCount {
  project_id: string;
  site_id: string | null;
  position_id: string | null;
  month: string;
  started: number;
  fee_ok: number;
  left_count: number;
}

export interface PipelineCount {
  project_id: string;
  site_id: string | null;
  stage: RecruitStage;
  n: number;
}

export interface ScheduledCount {
  project_id: string;
  site_id: string | null;
  position_id: string | null;
  month: string;
  n: number;
}

export interface RecruitMe {
  name: string;
  role: string;
  level: 'full' | 'view';
}

export interface RecruitBootstrap {
  projects: RecruitProject[];
  sites: RecruitSite[];
  positions: RecruitPosition[];
  targets: RecruitTarget[];
  hires: HireCount[];
  pipeline: PipelineCount[];
  scheduled: ScheduledCount[];
  candidate_count: number;
  me: RecruitMe;
}

export type Education = '' | 'none' | 'thcs' | 'thpt' | 'trung_cap' | 'cao_dang' | 'dai_hoc';

export interface RecruitCandidate {
  id: string;
  full_name: string;
  phone: string;
  phone_alt: string;
  id_number: string;
  birth_year: number | null;
  gender: 'male' | 'female' | null;
  province: string;
  commune: string;
  address: string;
  hometown: string;
  lat: number | null;
  lng: number | null;
  education: Education;
  major: string;
  diploma_pending: boolean;
  diploma_due: string | null;
  experience: string;
  shift_ok: boolean | null;
  cleanroom_ok: boolean | null;
  source_channel: string;
  referrer_contact_id: string | null;
  referrer_name: string;
  referrer_phone: string;
  consent_at: string | null;
  consent_source: string;
  blacklisted: boolean;
  blacklist_reason: string;
  notes: string;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Vài trường ứng viên đi kèm mỗi dòng ứng tuyển (recruit__app_json). */
export interface CandidateBrief {
  id: string;
  full_name: string;
  phone: string;
  birth_year: number | null;
  gender: 'male' | 'female' | null;
  education: Education;
  province: string;
  commune: string;
  blacklisted: boolean;
  diploma_pending: boolean;
  diploma_due: string | null;
  referrer_name: string;
  source_channel: string;
}

export interface RecruitApplication {
  id: string;
  candidate_id: string;
  project_id: string | null;
  site_id: string | null;
  position_id: string | null;
  client_id: string | null;
  employment_type: EmploymentType;
  stage: RecruitStage;
  source_channel: string;
  contacted_at: string | null;
  interview_at: string | null;
  passed_at: string | null;
  ready_at: string | null;
  planned_start: string | null;
  start_date: string | null;
  fee_date: string | null;
  done_at: string | null;
  closed_at: string | null;
  left_date: string | null;
  close_reason: string;
  employee_code: string;
  replaces_id: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // GĐ2 (migration 181)
  batch_id?: string | null;
  /** phí giới thiệu đã chốt (đ); null = chưa tới mốc / theo giờ chưa nhập */
  fee_amount?: number | null;
  settlement_id?: string | null;
  ctv_amount?: number | null;
  ctv_paid_at?: string | null;
  /** HĐ thời vụ đến ngày (migration 183) */
  contract_end?: string | null;
  candidate?: CandidateBrief;
}

/** Ứng tuyển kèm thông tin ứng viên đầy đủ hơn (danh sách đợt / đối soát / CTV — recruit__app_full). */
export interface RecruitApplicationFull extends RecruitApplication {
  candidate: CandidateBrief & { id_number: string; address: string; hometown: string; major: string; referrer_phone: string; referrer_contact_id: string | null };
  /** đối soát: thẻ khách hàng xuất hoá đơn (nhà máy → dự án) */
  bill_client_id?: string | null;
  /** việc hôm nay: ngày tới mốc tính phí / hết bảo hành */
  due?: string;
  guarantee_end?: string;
  /** thời vụ: số ngày đã làm (migration 183) */
  days?: number;
}

/** Tổng lao động thời vụ theo khách (report.workforce). */
export interface WorkforceSummary {
  client_id: string;
  active: number;
  warn10: number;
  over12: number;
  contract_ending: number;
  weekly_count: number | null;
  weekly_label: string | null;
}

export interface RecruitBatch {
  id: string;
  project_id: string;
  site_id: string | null;
  batch_date: string;
  start_time: string;
  capacity: number | null;
  meeting_point: string;
  bus_route: string;
  note: string;
  status: 'planned' | 'done' | 'cancelled';
  assigned?: number;
  started?: number;
  no_show?: number;
}

export interface RecruitSettlement {
  id: string;
  project_id: string;
  client_id: string | null;
  period: string;
  status: 'draft' | 'sent' | 'confirmed';
  total_amount: number;
  line_count: number;
  pnl_id: string | null;
  pnl_line_id: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
}

export interface TodayExtra {
  fee_due: RecruitApplicationFull[];
  need_replacement: RecruitApplicationFull[];
  guarantee_over: RecruitApplicationFull[];
  batches: RecruitBatch[];
}

export interface RecruitEvent {
  id: string;
  application_id: string | null;
  candidate_id: string | null;
  kind: 'stage' | 'create' | 'import' | 'note' | string;
  from_stage: RecruitStage | null;
  to_stage: RecruitStage | null;
  note: string;
  by_name: string | null;
  at: string;
}

export interface CandidateListRow extends RecruitCandidate {
  last_app: Pick<RecruitApplication, 'id' | 'stage' | 'project_id' | 'site_id' | 'client_id' | 'employment_type' | 'updated_at'> | null;
  app_count: number;
}

export interface CandidateMatch {
  id: string;
  full_name: string;
  phone: string;
  id_number: string;
  birth_year: number | null;
  blacklisted: boolean;
  blacklist_reason?: string;
}

export interface AppListResult {
  counts: Partial<Record<RecruitStage, number>>;
  total: number;
  rows: RecruitApplication[];
}

export interface TodayList {
  interviews: RecruitApplication[];
  stale_new: RecruitApplication[];
  stale_new_count: number;
  starting: RecruitApplication[];
  diploma_due: RecruitApplication[];
}

export interface ImportResult {
  created: number;
  linked: number;
  apps: number;
  skipped: { row: number; reason: string }[];
}

// ── Nhãn hiển thị ──────────────────────────────────────────────────────────
export const EDUCATION_LABEL: Readonly<Record<Exclude<Education, ''>, string>> = {
  none: 'Chưa qua lớp 9',
  thcs: 'THCS (lớp 9)',
  thpt: 'THPT (lớp 12)',
  trung_cap: 'Trung cấp',
  cao_dang: 'Cao đẳng',
  dai_hoc: 'Đại học',
};
export const EDUCATION_ORDER: readonly Exclude<Education, ''>[] = ['none', 'thcs', 'thpt', 'trung_cap', 'cao_dang', 'dai_hoc'];

export const GROUP_LABEL: Readonly<Record<PositionGroup, string>> = {
  A: 'Nhóm A · Kỹ thuật viên',
  B: 'Nhóm B · Công nhân sản xuất',
  C: 'Nhóm C · Cần khảo sát',
  other: 'Khác',
};

export const EMPLOYMENT_LABEL: Readonly<Record<EmploymentType, string>> = {
  direct: 'Chính thức của KH',
  leasing: 'Thời vụ Let\'s Go',
};

/** Kênh tuyển gợi ý (gõ tự do được). */
export const SOURCE_CHANNELS: readonly string[] = [
  'Facebook', 'Zalo', 'TikTok', 'Trang tuyển dụng', 'CTV giới thiệu', 'Người lao động giới thiệu',
  'Trường nghề', 'Tờ rơi / băng rôn', 'Xe loa / tuyển tại chỗ', 'Form tuyển dụng', 'Khác',
];
