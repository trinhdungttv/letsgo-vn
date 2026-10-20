// Gắn ở App: mở app (bất kỳ trang nào) là chạy việc nhắc tự động CSKH mỗi ngày 1 lần —
// không phụ thuộc có ai mở trang CSKH. Code chạy thật nạp động (import()) nên bundle
// chính không kéo theo phần dữ liệu CSKH. Chỉ tài khoản có quyền vào CSKH mới chạy.
import { useEffect } from 'react';
import { useAuth, canAccess } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { todayVN } from '../../lib/cskh/dates';
import type { Client } from '../../lib/types';

/** Chờ app tải xong màn đầu rồi mới chạy (đỡ tranh băng thông lúc mở app). */
const START_DELAY_MS = 2500;

export default function CareAutomationRunner({ clients, toast }: { clients: Client[]; toast: (msg: string) => void }) {
  const { user, rolePermissions } = useAuth();
  const { branches } = useBranchLookup();
  const allowed = !!user && canAccess(user.role, 'crm-leads', rolePermissions);
  const ready = allowed && clients.length > 0 && branches.length > 0;

  useEffect(() => {
    if (!ready || !user) return;
    let alive = true;
    const t = setTimeout(() => {
      import('./automationRunner')
        .then(m => m.runCareAutomationOnce({ ctx: { user, clients, branches }, today: todayVN(), daily: true })
          .then(r => { const msg = m.automationMessage(r); if (msg && alive) toast(msg); }))
        .catch(e => console.error('[cskh] Lỗi chạy việc nhắc tự động', e));
    }, START_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
    // Chỉ chạy lại khi đổi tài khoản / đủ dữ liệu — không chạy theo mỗi lần danh sách khách đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  return null;
}
