// Gắn ở App: mở app (bất kỳ trang nào) là kiểm tra lịch thực tập mỗi ngày 1 lần / máy — mùa nào sắp tới
// (trong số ngày "nhắc trước") thì tự tạo việc "Nguồn LĐ: Liên hệ trường…" trong Workspace.
// Chỉ tài khoản vào được Thị trường mới chạy. Chưa chạy migration 213 → không làm gì.
import { useEffect } from 'react';
import { useAuth, canAccess } from '../../../lib/auth';
import { todayVN } from '../../../lib/cskh/dates';
import { runLaborReminders } from '../../../lib/laborSources/api';

const START_DELAY_MS = 6000;
const dayKey = (userId: string) => `lgvn_labor_reminders_${userId}`;

export default function LaborReminderRunner({ toast }: { toast: (msg: string) => void }) {
  const { user, rolePermissions } = useAuth();
  const allowed = !!user && canAccess(user.role, 'market', rolePermissions);

  useEffect(() => {
    if (!allowed || !user) return;
    const today = todayVN();
    try { if (localStorage.getItem(dayKey(user.id)) === today) return; } catch { /* chế độ riêng tư */ }
    let alive = true;
    const t = setTimeout(() => {
      runLaborReminders(user, today)
        .then(made => {
          try { localStorage.setItem(dayKey(user.id), today); } catch { /* bỏ qua */ }
          if (made && alive) toast(`Đã tạo ${made} việc nhắc mùa thực tập (Nguồn LĐ) trong Workspace`);
        })
        .catch(e => console.error('[nguồn LĐ] Lỗi tạo việc nhắc', e));
    }, START_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, user?.id]);

  return null;
}
