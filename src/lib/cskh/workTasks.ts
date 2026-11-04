// ============================================================================
// CSKH — việc Workspace có GẮN người liên hệ (work_tasks.contact_ids, migration 200).
// ----------------------------------------------------------------------------
// Việc gắn người ở form "Thêm công việc" (VD "HĐ Bổ sung HSNL" trao đổi với Mr Tuấn) là lịch sử làm
// việc với người đó → hiện trong Nhật ký CSKH, thẻ tóm tắt và hồ sơ người liên hệ. Chỉ ĐỌC thẳng
// work_tasks (nguồn duy nhất), KHÔNG chép sang cskh_logs và KHÔNG tính vào "lần liên hệ gần nhất" /
// điểm chăm sóc — tạo việc chưa chắc là đã liên hệ.
// ============================================================================
import { todayVN } from './dates';

export interface CskhWorkTask {
  id: string;
  title: string;
  taskType: string | null;
  /** pending | in_progress | done | ngung_hd */
  status: string;
  due: string | null;
  completedAt: string | null;
  createdAt: string;
  notes: string | null;
  clientId: string | null;
  /** Người phụ trách việc (app_users.id). */
  userId: string | null;
  contactIds: string[];
}

export interface WorkTaskRow {
  id: string;
  title: string | null;
  task_type: string | null;
  status: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  notes: string | null;
  client_id: string | null;
  user_id: string | null;
  contact_ids: string[] | null;
}

/** Cột cần đọc — chỉ việc chưa xoá và có gắn ít nhất 1 người (lọc ở câu truy vấn). */
export const CSKH_WORK_TASK_SELECT = 'id, title, task_type, status, due_date, completed_at, created_at, notes, client_id, user_id, contact_ids';

export function mapWorkTaskRow(r: WorkTaskRow): CskhWorkTask {
  return {
    id: r.id,
    title: (r.title ?? '').trim(),
    taskType: r.task_type,
    status: r.status ?? 'pending',
    due: r.due_date ? r.due_date.slice(0, 10) : null,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    notes: r.notes?.trim() || null,
    clientId: r.client_id,
    userId: r.user_id,
    contactIds: [...new Set((r.contact_ids ?? []).filter(Boolean))],
  };
}

export const isWorkTaskDone = (t: Pick<CskhWorkTask, 'status'>): boolean => t.status === 'done';

export const WORK_TASK_STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: 'Cần làm', in_progress: 'Đang làm', done: 'Hoàn thành', ngung_hd: 'Ngưng HĐ',
};

/**
 * Ngày (giờ Việt Nam) đặt việc vào dòng thời gian Nhật ký: việc đã xong → ngày xong (kết quả mới
 * nhất), còn mở → ngày tạo việc.
 */
export function workTaskLogDate(t: Pick<CskhWorkTask, 'status' | 'completedAt' | 'createdAt'>): string {
  const iso = isWorkTaskDone(t) && t.completedAt ? t.completedAt : t.createdAt;
  return todayVN(new Date(iso));
}

/** Việc chỉ gồm người của 1 tệp (khách / Sale). */
export function workTasksForContacts(tasks: readonly CskhWorkTask[], contactIds: ReadonlySet<string>): CskhWorkTask[] {
  return tasks.filter(t => t.contactIds.some(id => contactIds.has(id)));
}

/** Việc của 1 người: đang mở trước (hạn gần nhất trước), rồi việc đã xong (xong gần nhất trước). */
export function workTasksOfContact(tasks: readonly CskhWorkTask[], contactId: string): CskhWorkTask[] {
  const mine = tasks.filter(t => t.contactIds.includes(contactId));
  const open = mine.filter(t => !isWorkTaskDone(t)).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const done = mine.filter(isWorkTaskDone).sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  return [...open, ...done];
}

/** Bỏ "Tên công ty — " ở đầu tên việc khi đã hiện tên công ty riêng bên cạnh. */
export function workTaskTitleWithoutCompany(title: string, companyName: string | null | undefined): string {
  const name = (companyName ?? '').trim();
  if (!name) return title;
  const prefix = `${name} — `;
  return title.toLowerCase().startsWith(prefix.toLowerCase()) && title.length > prefix.length ? title.slice(prefix.length) : title;
}
