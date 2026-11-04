// ============================================================================
// CSKH — việc Workspace có GẮN người liên hệ (work_tasks.contact_ids, migration 200).
// ----------------------------------------------------------------------------
// Việc gắn người ở form "Thêm công việc" (VD "HĐ Bổ sung HSNL" trao đổi với Mr Tuấn) là lịch sử làm
// việc với người đó → hiện trong Nhật ký CSKH, thẻ tóm tắt và hồ sơ người liên hệ. Chỉ ĐỌC thẳng
// work_tasks (nguồn duy nhất), KHÔNG chép sang cskh_logs và KHÔNG tính vào "lần liên hệ gần nhất" /
// điểm chăm sóc — tạo việc chưa chắc là đã liên hệ.
// ============================================================================
import { todayVN } from './dates';
import { diffDays } from './lunar';

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

/**
 * Việc còn phải làm: chưa xong VÀ chưa bị ngưng. 'ngung_hd' (Tái ký → Ngưng HĐ) là việc đã khép lại — không còn
 * ai phải xử lý nên không đếm là "đang mở", không nhắc ở Tổng quan.
 */
export const isWorkTaskOpen = (t: Pick<CskhWorkTask, 'status'>): boolean => t.status !== 'done' && t.status !== 'ngung_hd';

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
  const open = mine.filter(isWorkTaskOpen).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const done = mine.filter(t => !isWorkTaskOpen(t)).sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  return [...open, ...done];
}

/** Bỏ "Tên công ty — " ở đầu tên việc khi đã hiện tên công ty riêng bên cạnh. */
export function workTaskTitleWithoutCompany(title: string, companyName: string | null | undefined): string {
  const name = (companyName ?? '').trim();
  if (!name) return title;
  const prefix = `${name} — `;
  return title.toLowerCase().startsWith(prefix.toLowerCase()) && title.length > prefix.length ? title.slice(prefix.length) : title;
}

export interface WorkAgendaRow {
  task: CskhWorkTask;
  /** Trễ bao nhiêu ngày so với hạn: > 0 trễ · 0 hạn hôm nay · < 0 còn N ngày · null không đặt hạn. */
  late: number | null;
  /** Người gắn trong việc thuộc phạm vi đang xem, theo thứ tự gắn (người đầu = người hiện avatar / mở thẻ tóm tắt). */
  people: string[];
}

/**
 * Việc Workspace CÒN MỞ liên quan tới người trong phạm vi — cho thẻ "Sắp tới → Workspace" ở Tổng quan CSKH.
 *  • Chỉ việc còn làm (isWorkTaskOpen) — việc xong / ngưng nằm ở Nhật ký và hồ sơ người liên hệ.
 *  • Bỏ việc là bản sao của "việc đã hứa" (`excludeIds` = followup_task_id / extra_task_ids của nhật ký) để không
 *    hiện 2 lần ở 2 tab; hiện chưa có việc kiểu này mang contact_ids, nhưng đừng để lệch khi sau này có.
 *  • Xếp: trễ nhất trước → hạn hôm nay → sắp tới → việc không hạn (mới tạo trước).
 * KHÔNG tính vào hàng đợi "Hôm nay cần liên hệ", nhịp chăm sóc hay điểm quan hệ — tạo việc chưa chắc là đã liên hệ.
 */
export function openWorkAgenda(
  tasks: readonly CskhWorkTask[],
  contactIds: ReadonlySet<string>,
  today: string,
  excludeIds: ReadonlySet<string> = new Set(),
): WorkAgendaRow[] {
  const rows: WorkAgendaRow[] = [];
  for (const task of tasks) {
    if (!isWorkTaskOpen(task) || excludeIds.has(task.id)) continue;
    const people = task.contactIds.filter(id => contactIds.has(id));
    if (!people.length) continue;
    rows.push({ task, late: task.due ? diffDays(task.due, today) : null, people });
  }
  return rows.sort((a, b) => {
    if (a.late !== null && b.late !== null) return b.late - a.late || a.task.createdAt.localeCompare(b.task.createdAt);
    if (a.late !== null) return -1;
    if (b.late !== null) return 1;
    return b.task.createdAt.localeCompare(a.task.createdAt);
  });
}
