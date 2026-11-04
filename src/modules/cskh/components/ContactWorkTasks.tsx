// Việc Workspace có GẮN người liên hệ này (work_tasks.contact_ids) — khối gọn dùng ở thẻ tóm tắt và đầu
// hồ sơ người liên hệ. Chỉ xem: hoàn thành / sửa ở Workspace (bấm Xong ở đó cần ghi kết quả).
import { useState } from 'react';
import { formatDateVN } from '../../../lib/cskh/dates';
import { isWorkTaskDone, workTaskLogDate, workTaskTitleWithoutCompany, WORK_TASK_STATUS_LABEL, type CskhWorkTask } from '../../../lib/cskh/workTasks';
import { taskTypeLabel } from '../../../lib/workTaskTypes';
import { TaskCheck } from './apple';

const SHOW = 5;

export function ContactWorkTasks({ tasks, companyName, ownerName, onOpenWorkspace, className = 'mt-3' }: {
  /** Đã xếp: đang mở trước, rồi đã xong (workTasksOfContact). */
  tasks: readonly CskhWorkTask[];
  companyName: (clientId: string | null) => string | null;
  ownerName: (userId: string | null) => string | null;
  onOpenWorkspace?: () => void;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  if (!tasks.length) return null;
  const open = tasks.filter(t => !isWorkTaskDone(t)).length;
  const shown = all ? tasks : tasks.slice(0, SHOW);
  return (
    <div className={className}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#3634A3] mb-1.5">
        Việc Workspace · {tasks.length}{open ? ` (${open} đang mở)` : ''}
      </p>
      <div className="space-y-1">
        {shown.map(t => {
          const done = isWorkTaskDone(t);
          const company = companyName(t.clientId);
          const owner = ownerName(t.userId);
          const meta = [
            taskTypeLabel(t.taskType),
            done ? `xong ${formatDateVN(workTaskLogDate(t))}` : `${WORK_TASK_STATUS_LABEL[t.status] ?? t.status}${t.due ? ` · hạn ${formatDateVN(t.due)}` : ''}`,
            company,
            owner ? `phụ trách ${owner}` : null,
          ].filter(Boolean).join(' · ');
          return (
            <div key={t.id} className={`flex items-start gap-1 rounded-[12px] pl-1.5 pr-3 py-1 ${done ? 'bg-[#F5F5F7]' : 'bg-[#5856D6]/[0.08]'}`}>
              <TaskCheck done={done} label={done ? `Đã xong: ${t.title}` : `Đang mở: ${t.title}`} />
              <div className="flex-1 min-w-0 py-1 text-[12.5px] leading-snug">
                <span className={done ? 'text-[#86868B]' : 'text-[#1D1D1F] font-medium'}>{workTaskTitleWithoutCompany(t.title, company)}</span>
                <span className="block text-[11.5px] text-[#86868B] mt-0.5">{meta}</span>
                {t.notes && (
                  <span className="block text-[12px] text-[#6E6E73] mt-0.5 whitespace-pre-wrap break-words line-clamp-3">
                    {done ? 'Kết quả: ' : ''}{t.notes}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-1 px-1 text-[12px]">
        {tasks.length > SHOW && (
          <button type="button" onClick={() => setAll(a => !a)} className="font-medium text-[#0071E3] hover:underline">
            {all ? 'Thu gọn' : `Xem thêm ${tasks.length - SHOW} việc`}
          </button>
        )}
        {onOpenWorkspace && (
          <button type="button" onClick={onOpenWorkspace} className="font-medium text-[#0071E3] hover:underline">Xử lý ở Workspace →</button>
        )}
      </div>
    </div>
  );
}
