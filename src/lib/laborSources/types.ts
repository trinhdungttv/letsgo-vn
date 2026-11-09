// ============================================================================
// Nguồn Lao Động — kiểu dữ liệu (bảng labor_source*, migration 213).
// Đơn vị nguồn = trường ĐH / CĐ / Trung cấp, trung tâm GDNN / DVVL, xã-phường / đoàn thể địa phương.
// Sinh viên chỉ quản lý theo SỐ LƯỢNG (đợt: gửi đi / đạt) — không lưu thông tin cá nhân.
// Người liên hệ của đơn vị nguồn nằm ở CSKH tệp Sale / CTV (contacts.labor_source_id).
// ============================================================================

export type SourceKind = 'dai_hoc' | 'cao_dang' | 'trung_cap' | 'trung_tam' | 'dia_phuong' | 'khac';
export type SourceStatus = 'new' | 'contacting' | 'partner' | 'paused';
export type Ownership = '' | 'cong_lap' | 'tu_thuc';
export type ProgramLevel = '' | 'dai_hoc' | 'cao_dang' | 'trung_cap' | 'so_cap';
export type BatchStatus = 'planned' | 'ongoing' | 'done' | 'cancelled';
export type RouteTargetType = 'zone' | 'client' | 'lead' | 'branch';
export type RouteEngine = 'valhalla-bus' | 'osrm-car';

export interface LaborSource {
  id: string;
  kind: SourceKind;
  name: string;
  short_name: string;
  ownership: Ownership;
  status: SourceStatus;
  priority: number | null;
  province: string;
  address: string;
  map_link: string;
  lat: number | null;
  lng: number | null;
  website: string;
  fanpage: string;
  phone: string;
  email: string;
  logo_url: string | null;
  student_total: number | null;
  intern_per_year: number | null;
  has_dorm: boolean | null;
  requirements: string[];
  requirements_note: string;
  mou_signed_at: string | null;
  mou_expires_at: string | null;
  mou_note: string;
  branch_id: string | null;
  owner_id: string | null;
  tags: string[];
  notes: string;
  created_by: string;
  updated_by: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceProgram {
  id: string;
  source_id: string;
  name: string;
  level: ProgramLevel;
  industry_ids: string[];
  students_per_year: number | null;
  note: string;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
}

export interface InternWindow {
  id: string;
  source_id: string;
  program_ids: string[];
  cohort: string;
  /** 'YYYY-MM-DD' */
  start_date: string;
  end_date: string | null;
  expected_count: number | null;
  repeat_yearly: boolean;
  remind_days: number;
  reminder_task_id: string | null;
  reminder_for: string | null;
  note: string;
  deleted_at: string | null;
  created_at: string;
}

export interface SourceBatch {
  id: string;
  source_id: string;
  window_id: string | null;
  program_ids: string[];
  client_id: string | null;
  lead_id: string | null;
  company_name: string;
  zone_id: string | null;
  start_date: string | null;
  end_date: string | null;
  sent_count: number;
  passed_count: number;
  status: BatchStatus;
  note: string;
  created_by: string;
  deleted_at: string | null;
  created_at: string;
}

export interface RouteRow {
  source_id: string;
  target_type: RouteTargetType;
  target_id: string;
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  distance_km: number | null;
  duration_min: number | null;
  engine: RouteEngine;
  computed_at: string;
}

/** Người liên hệ (CSKH tệp Sale/CTV) gắn với đơn vị nguồn — chỉ vài trường để hiện trong hồ sơ. */
export interface SourceContact {
  id: string;
  name: string;
  role: string;
  phone: string;
  avatar_url: string;
  group_id: string | null;
  labor_source_id: string;
  is_active: boolean;
}

// ── Nhãn ────────────────────────────────────────────────────────────────────
export const SOURCE_KINDS: readonly SourceKind[] = ['dai_hoc', 'cao_dang', 'trung_cap', 'trung_tam', 'dia_phuong', 'khac'];
export const KIND_LABEL: Readonly<Record<SourceKind, string>> = {
  dai_hoc: 'Đại học',
  cao_dang: 'Cao đẳng',
  trung_cap: 'Trung cấp nghề',
  trung_tam: 'Trung tâm GDNN / DVVL',
  dia_phuong: 'Địa phương / đoàn thể',
  khac: 'Khác',
};
/** Nhãn ngắn trên viên / bản đồ. */
export const KIND_SHORT: Readonly<Record<SourceKind, string>> = {
  dai_hoc: 'ĐH', cao_dang: 'CĐ', trung_cap: 'TC', trung_tam: 'TT', dia_phuong: 'ĐP', khac: 'Khác',
};
/** Loại là trường học (có ngành đào tạo / lịch thực tập). */
export const isSchoolKind = (k: SourceKind) => k === 'dai_hoc' || k === 'cao_dang' || k === 'trung_cap' || k === 'trung_tam';

export const SOURCE_STATUSES: readonly SourceStatus[] = ['new', 'contacting', 'partner', 'paused'];
export const STATUS_LABEL: Readonly<Record<SourceStatus, string>> = {
  new: 'Chưa tiếp cận',
  contacting: 'Đang tiếp cận',
  partner: 'Đang hợp tác',
  paused: 'Tạm dừng',
};

export const OWNERSHIP_LABEL: Readonly<Record<Ownership, string>> = { '': 'Chưa rõ', cong_lap: 'Công lập', tu_thuc: 'Tư thục' };

export const PROGRAM_LEVELS: readonly ProgramLevel[] = ['dai_hoc', 'cao_dang', 'trung_cap', 'so_cap', ''];
export const LEVEL_LABEL: Readonly<Record<ProgramLevel, string>> = {
  dai_hoc: 'Đại học', cao_dang: 'Cao đẳng', trung_cap: 'Trung cấp', so_cap: 'Sơ cấp', '': 'Chưa rõ',
};

export const BATCH_STATUSES: readonly BatchStatus[] = ['planned', 'ongoing', 'done', 'cancelled'];
export const BATCH_STATUS_LABEL: Readonly<Record<BatchStatus, string>> = {
  planned: 'Dự kiến', ongoing: 'Đang thực tập', done: 'Đã xong', cancelled: 'Huỷ',
};

/** Điều kiện trường hay yêu cầu doanh nghiệp (mã lưu DB → nhãn). */
export const REQUIREMENTS: readonly { key: string; label: string }[] = [
  { key: 'cho_o', label: 'Chỗ ở / KTX' },
  { key: 'xe_dua_don', label: 'Xe đưa đón' },
  { key: 'suat_an', label: 'Suất ăn' },
  { key: 'phu_cap', label: 'Phụ cấp / lương TT' },
  { key: 'bao_hiem', label: 'Bảo hiểm' },
  { key: 'xac_nhan_tt', label: 'Xác nhận thực tập' },
  { key: 'huong_dan', label: 'Người hướng dẫn' },
  { key: 'dung_nganh', label: 'Đúng chuyên ngành' },
];
export const requirementLabel = (key: string) => REQUIREMENTS.find(r => r.key === key)?.label ?? key;

export const TARGET_LABEL: Readonly<Record<RouteTargetType, string>> = {
  zone: 'KCN', client: 'Khách hàng', lead: 'Công ty / Dự án', branch: 'Chi nhánh',
};

export const MIGRATION_213_HINT =
  'Cần chạy migration 213 (Nguồn Lao Động) trên Supabase → SQL Editor trước khi lưu.';
