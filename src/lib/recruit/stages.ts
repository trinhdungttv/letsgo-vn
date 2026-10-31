// Các bước ứng tuyển: nhãn, màu, nhóm hiển thị, bước kế tiếp gợi ý. File thuần (không React, không DB).
import type { Tint } from '../../components/workspace/wsTheme';
import type { EmploymentType, RecruitStage } from './types';

export interface StageMeta {
  label: string;
  /** Nhãn ngắn cho viên nang / cột hẹp */
  short: string;
  tint: Tint;
  /** pipeline = đang xử lý · working = đã đi làm · closed = đã đóng */
  phase: 'pipeline' | 'working' | 'closed';
}

export const STAGE_META: Readonly<Record<RecruitStage, StageMeta>> = {
  new:       { label: 'Mới nộp',          short: 'Mới',        tint: 'blue',   phase: 'pipeline' },
  contacted: { label: 'Đã liên hệ',       short: 'Đã gọi',     tint: 'teal',   phase: 'pipeline' },
  interview: { label: 'Hẹn phỏng vấn',    short: 'Hẹn PV',     tint: 'indigo', phase: 'pipeline' },
  passed:    { label: 'Đạt phỏng vấn',    short: 'Đạt PV',     tint: 'purple', phase: 'pipeline' },
  ready:     { label: 'Chờ nhận việc',    short: 'Chờ NV',     tint: 'orange', phase: 'pipeline' },
  started:   { label: 'Đã nhận việc',     short: 'Đi làm',     tint: 'green',  phase: 'working' },
  fee_ok:    { label: 'Đủ ngày tính phí', short: 'Đủ phí',     tint: 'green',  phase: 'working' },
  done:      { label: 'Hết bảo hành',     short: 'Ổn định',    tint: 'green',  phase: 'working' },
  rejected:  { label: 'Không đạt',        short: 'Không đạt',  tint: 'gray',   phase: 'closed' },
  dropped:   { label: 'Ứng viên bỏ',      short: 'Bỏ',         tint: 'gray',   phase: 'closed' },
  no_show:   { label: 'Không đến nhận việc', short: 'Không đến', tint: 'red', phase: 'closed' },
  left:      { label: 'Đã nghỉ việc',     short: 'Nghỉ',       tint: 'red',    phase: 'closed' },
  converted: { label: 'Chuyển chính thức', short: 'Chuyển CT', tint: 'teal',   phase: 'closed' },
};

/** Đường chính theo thứ tự. */
export const STAGE_CHAIN: readonly RecruitStage[] = ['new', 'contacted', 'interview', 'passed', 'ready', 'started', 'fee_ok', 'done'];
export const CLOSED_STAGES: readonly RecruitStage[] = ['rejected', 'dropped', 'no_show', 'left', 'converted'];
/** Còn mở = chưa đóng (kể cả đang đi làm) — khớp chỉ mục uq_recruit_apps_open_per_project. */
export const OPEN_STAGES: readonly RecruitStage[] = ['new', 'contacted', 'interview', 'passed', 'ready', 'started', 'fee_ok'];

export const stageOrder = (s: RecruitStage): number => {
  const i = STAGE_CHAIN.indexOf(s);
  return i >= 0 ? i : STAGE_CHAIN.length + CLOSED_STAGES.indexOf(s);
};

/** Nhóm tab ở trang Ứng tuyển. */
export type StageTab = 'new' | 'contacted' | 'interview' | 'passed' | 'ready' | 'working' | 'closed';
export const STAGE_TABS: readonly { key: StageTab; label: string; stages: readonly RecruitStage[] }[] = [
  { key: 'new', label: 'Mới', stages: ['new'] },
  { key: 'contacted', label: 'Đã gọi', stages: ['contacted'] },
  { key: 'interview', label: 'Hẹn PV', stages: ['interview'] },
  { key: 'passed', label: 'Đạt PV', stages: ['passed'] },
  { key: 'ready', label: 'Chờ nhận việc', stages: ['ready'] },
  { key: 'working', label: 'Đang đi làm', stages: ['started', 'fee_ok', 'done'] },
  { key: 'closed', label: 'Đã đóng', stages: CLOSED_STAGES },
];

export const tabCount = (tab: StageTab, counts: Partial<Record<RecruitStage, number>>): number =>
  (STAGE_TABS.find(t => t.key === tab)?.stages ?? []).reduce((s, st) => s + (counts[st] ?? 0), 0);

/**
 * Bước kế tiếp gợi ý (nút chính trên mỗi dòng). Thời vụ Let's Go không có mốc tính phí giới thiệu
 * → dừng ở "Đã nhận việc" (kết thúc bằng Nghỉ việc / Chuyển chính thức).
 */
export function nextStage(stage: RecruitStage, employment: EmploymentType = 'direct'): RecruitStage | null {
  if (employment === 'leasing' && (stage === 'started' || stage === 'fee_ok' || stage === 'done')) return null;
  const i = STAGE_CHAIN.indexOf(stage);
  if (i < 0 || i >= STAGE_CHAIN.length - 1) return null;
  return STAGE_CHAIN[i + 1];
}

/** Nhãn nút "chuyển sang bước X" — động từ thay vì tên bước. */
export const ACTION_LABEL: Readonly<Record<RecruitStage, string>> = {
  new: 'Về Mới',
  contacted: 'Đã gọi',
  interview: 'Hẹn PV',
  passed: 'Đạt PV',
  ready: 'Chờ nhận việc',
  started: 'Đã nhận việc',
  fee_ok: 'Đủ ngày tính phí',
  done: 'Hết bảo hành',
  rejected: 'Không đạt',
  dropped: 'Ứng viên bỏ',
  no_show: 'Không đến',
  left: 'Nghỉ việc',
  converted: 'Chuyển chính thức',
};

/** Các cách đóng hồ sơ hợp lý ở từng bước (menu "…"). */
export function closeOptions(stage: RecruitStage): RecruitStage[] {
  const phase = STAGE_META[stage].phase;
  if (phase === 'closed') return [];
  if (phase === 'working') return ['left'];
  if (stage === 'ready') return ['no_show', 'dropped'];
  if (stage === 'interview' || stage === 'passed') return ['rejected', 'dropped'];
  return ['dropped', 'rejected'];
}

/** Bước cần hỏi thêm thông tin khi chuyển (ngày giờ, lý do). */
export function stageNeeds(stage: RecruitStage): 'interview_at' | 'planned_start' | 'start_date' | 'fee_date' | 'reason' | 'left' | null {
  switch (stage) {
    case 'interview': return 'interview_at';
    case 'ready': return 'planned_start';
    case 'started': return 'start_date';
    case 'fee_ok': return 'fee_date';
    case 'left': return 'left';
    case 'rejected': case 'dropped': case 'no_show': return 'reason';
    default: return null;
  }
}

/** Lý do đóng hồ sơ gợi ý theo bước. */
export const CLOSE_REASONS: Readonly<Partial<Record<RecruitStage, readonly string[]>>> = {
  rejected: ['Không đủ trình độ', 'Không đạt kiểm tra tay nghề', 'Sức khoẻ / thị lực', 'KH từ chối', 'Khác'],
  dropped: ['Không nghe máy', 'Đã nhận việc nơi khác', 'Lương chưa phù hợp', 'Xa nhà / không có xe', 'Không làm ca được', 'Khác'],
  no_show: ['Không nghe máy', 'Đổi ý', 'Thiếu giấy tờ', 'Khác'],
  left: ['Xa nhà', 'Không hợp ca / tăng ca', 'Lương thấp hơn kỳ vọng', 'Môi trường / quản lý', 'Sức khoẻ', 'Về quê', 'KH cho nghỉ', 'Khác'],
};
