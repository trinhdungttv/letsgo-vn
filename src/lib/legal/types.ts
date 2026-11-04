// Pháp lý (Workspace → "Pháp lý", trang #/legal) — kiểu dữ liệu + danh mục dùng chung. Migration 201.
// 4 bảng: legal_entities (pháp nhân) · legal_milestones (dòng thời gian) · legal_topics (thư viện ngành)
// · legal_docs (MỌI tài liệu: link Drive / web, sơ đồ tư duy, bài học trực quan, thẻ ghi nhớ).

export type EntityStatus = 'active' | 'paused' | 'dissolved';

export interface LegalOwner { id: string; name: string; capital: number | null; percent: number | null; note: string }
export interface LegalIndustry { id: string; code: string; name: string; main: boolean }
export interface LegalBank { id: string; bank: string; number: string; branch: string; holder: string }
export interface LegalLicense {
  id: string; name: string; number: string; issuer: string;
  /** yyyy-mm-dd, '' = chưa nhập */
  issued: string; expires: string; url: string; note: string;
}

export interface LegalEntityInfo {
  owners: LegalOwner[];
  industries: LegalIndustry[];
  banks: LegalBank[];
  licenses: LegalLicense[];
  /** link Google Drive của Giấy chứng nhận đăng ký doanh nghiệp (bấm icon file để xem ngay trong app) */
  registrationUrl: string;
}

export interface LegalEntity {
  id: string;
  name: string;
  short_name: string;
  english_name: string;
  tax_code: string;
  business_type: string;
  founded_date: string | null;
  registry_office: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  charter_capital: number | null;
  legal_rep: string;
  legal_rep_title: string;
  status: EntityStatus;
  color: string;
  logo_url: string | null;
  drive_url: string;
  quote_entity_id: string | null;
  info: LegalEntityInfo;
  note: string;
  sort_order: number;
  updated_by: string;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
}

export type MilestoneKind = 'thanh_lap' | 'thay_doi' | 'giay_phep' | 'thue' | 'lao_dong' | 'con_dau' | 'thanh_tra' | 'khac';
export type MilestoneStatus = 'done' | 'doing' | 'planned';

export interface MilestoneChange { id: string; aspect: string; from: string; to: string }

export interface LegalMilestone {
  id: string;
  entity_id: string;
  event_date: string;
  kind: MilestoneKind;
  change_no: number | null;
  title: string;
  description: string;
  status: MilestoneStatus;
  changes: MilestoneChange[];
  updated_by: string;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
}

export interface LegalTopic {
  id: string;
  parent_id: string | null;
  title: string;
  description: string;
  color: string;
  icon: string;
  sort_order: number;
  updated_by: string;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
}

export type DocKind = 'drive' | 'link' | 'mindmap' | 'lesson' | 'cards';
export type FileType = 'pdf' | 'doc' | 'sheet' | 'slide' | 'folder' | 'image' | 'video' | 'web';
export type LawStatus = '' | 'active' | 'upcoming' | 'amended' | 'expired';

export interface DocMeta {
  /** số hiệu văn bản, vd 145/2020/NĐ-CP */
  number?: string;
  /** cơ quan ban hành */
  issuer?: string;
  issued?: string;
  effective?: string;
  status?: LawStatus;
  tags?: string[];
}

export interface LegalDoc {
  id: string;
  kind: DocKind;
  title: string;
  entity_id: string | null;
  milestone_id: string | null;
  topic_id: string | null;
  category: string;
  url: string;
  file_type: FileType | '';
  summary: string;
  meta: DocMeta;
  color: string;
  pinned: boolean;
  sort_order: number;
  updated_by: string;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
}

// ── Danh mục hiển thị ──────────────────────────────────────────────────────

export const ENTITY_STATUS: Record<EntityStatus, { label: string; tint: 'green' | 'orange' | 'gray' }> = {
  active: { label: 'Đang hoạt động', tint: 'green' },
  paused: { label: 'Tạm ngừng', tint: 'orange' },
  dissolved: { label: 'Đã giải thể', tint: 'gray' },
};

export const BUSINESS_TYPES = [
  'Công ty TNHH một thành viên', 'Công ty TNHH hai thành viên trở lên', 'Công ty cổ phần', 'Công ty hợp danh',
  'Doanh nghiệp tư nhân', 'Chi nhánh', 'Văn phòng đại diện', 'Hộ kinh doanh',
] as const;

/** Màu nhận diện chọn nhanh (pháp nhân, chủ đề, tài liệu). */
export const SWATCHES = ['#0071E3', '#5856D6', '#AF52DE', '#FF2D55', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#30B0C7', '#8E8E93', '#1D1D1F', '#A2845E'] as const;

export const MILESTONE_KINDS: Record<MilestoneKind, { label: string; color: string }> = {
  thanh_lap: { label: 'Thành lập', color: '#34C759' },
  thay_doi: { label: 'Thay đổi ĐKKD', color: '#0071E3' },
  giay_phep: { label: 'Giấy phép', color: '#AF52DE' },
  thue: { label: 'Thuế – Hoá đơn', color: '#FF9500' },
  lao_dong: { label: 'Lao động – BHXH', color: '#30B0C7' },
  con_dau: { label: 'Con dấu', color: '#FF2D55' },
  thanh_tra: { label: 'Thanh tra – Kiểm tra', color: '#FF3B30' },
  khac: { label: 'Khác', color: '#8E8E93' },
};
export const MILESTONE_KIND_IDS = Object.keys(MILESTONE_KINDS) as MilestoneKind[];

export const MILESTONE_STATUS: Record<MilestoneStatus, { label: string; tint: 'green' | 'blue' | 'gray' }> = {
  done: { label: 'Đã xong', tint: 'green' },
  doing: { label: 'Đang làm', tint: 'blue' },
  planned: { label: 'Dự kiến', tint: 'gray' },
};

/** Nội dung thay đổi trong 1 lần đăng ký thay đổi. field = cột của pháp nhân nhận giá trị mới khi "ghi vào hồ sơ". */
export const CHANGE_ASPECTS: { key: string; label: string; field?: 'name' | 'address' | 'charter_capital' | 'legal_rep' | 'business_type' | 'english_name' }[] = [
  { key: 'name', label: 'Tên công ty', field: 'name' },
  { key: 'english_name', label: 'Tên tiếng Anh', field: 'english_name' },
  { key: 'address', label: 'Địa chỉ trụ sở', field: 'address' },
  { key: 'capital', label: 'Vốn điều lệ', field: 'charter_capital' },
  { key: 'legal_rep', label: 'Người đại diện', field: 'legal_rep' },
  { key: 'owners', label: 'Thành viên / cổ đông' },
  { key: 'industries', label: 'Ngành nghề' },
  { key: 'type', label: 'Loại hình', field: 'business_type' },
  { key: 'other', label: 'Nội dung khác' },
];
export const aspectLabel = (key: string) => CHANGE_ASPECTS.find(a => a.key === key)?.label ?? key;

/** Nhóm hồ sơ giấy tờ của 1 pháp nhân. */
export const ENTITY_DOC_CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: 'dkkd', label: 'Đăng ký kinh doanh', color: '#0071E3' },
  { key: 'dieu_le', label: 'Điều lệ – Quyết định', color: '#5856D6' },
  { key: 'giay_phep', label: 'Giấy phép', color: '#AF52DE' },
  { key: 'thue', label: 'Thuế – Hoá đơn', color: '#FF9500' },
  { key: 'lao_dong', label: 'Lao động – BHXH', color: '#30B0C7' },
  { key: 'hop_dong', label: 'Hợp đồng', color: '#34C759' },
  { key: 'khac', label: 'Khác', color: '#8E8E93' },
];
export const categoryOf = (key: string) => ENTITY_DOC_CATEGORIES.find(c => c.key === key) ?? ENTITY_DOC_CATEGORIES[ENTITY_DOC_CATEGORIES.length - 1];

export const DOC_KINDS: Record<DocKind, { label: string; hint: string; color: string }> = {
  drive: { label: 'Google Drive', hint: 'PDF, Word, Excel, PowerPoint, thư mục — xem ngay trong app', color: '#1A73E8' },
  link: { label: 'Trang web / Video', hint: 'Cổng văn bản pháp luật, YouTube, trang cơ quan…', color: '#30B0C7' },
  mindmap: { label: 'Sơ đồ tư duy', hint: 'Tự vẽ: nhánh màu, biểu tượng, liên kết, 6 kiểu bố cục', color: '#AF52DE' },
  lesson: { label: 'Bài học trực quan', hint: 'Khối màu Định nghĩa / Lưu ý / Xử phạt, các bước, bảng so sánh, ảnh', color: '#FF9500' },
  cards: { label: 'Thẻ ghi nhớ', hint: 'Lật thẻ hỏi – đáp, ôn theo hộp nhớ (Leitner)', color: '#34C759' },
};

export const FILE_TYPES: Record<FileType, { label: string; color: string }> = {
  pdf: { label: 'PDF', color: '#E5484D' },
  doc: { label: 'Word', color: '#2B579A' },
  sheet: { label: 'Excel', color: '#217346' },
  slide: { label: 'PowerPoint', color: '#D24726' },
  folder: { label: 'Thư mục', color: '#8E8E93' },
  image: { label: 'Ảnh', color: '#30B0C7' },
  video: { label: 'Video', color: '#FF0033' },
  web: { label: 'Trang web', color: '#0071E3' },
};

export const LAW_STATUS: Record<Exclude<LawStatus, ''>, { label: string; tint: 'green' | 'blue' | 'orange' | 'gray' }> = {
  active: { label: 'Còn hiệu lực', tint: 'green' },
  upcoming: { label: 'Sắp có hiệu lực', tint: 'blue' },
  amended: { label: 'Đã sửa đổi', tint: 'orange' },
  expired: { label: 'Hết hiệu lực', tint: 'gray' },
};

/** Biểu tượng chủ đề (tên → icon lucide trong components/legal/icons.tsx). */
export const TOPIC_ICONS = [
  'book', 'scale', 'gavel', 'landmark', 'briefcase', 'users', 'hardhat', 'receipt', 'coins', 'shield',
  'building', 'factory', 'globe', 'file', 'graduation', 'heart', 'clock', 'lightbulb',
] as const;
export type TopicIcon = typeof TOPIC_ICONS[number];

export function emptyInfo(): LegalEntityInfo {
  return { owners: [], industries: [], banks: [], licenses: [], registrationUrl: '' };
}

export function rid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
