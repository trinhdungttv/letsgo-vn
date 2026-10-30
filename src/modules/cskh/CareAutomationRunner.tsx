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
  // Mạng lưới Sale: chỉ người vào được trang Sale mới chạy (chỉ nhắc chuẩn bị quà)
  const saleAllowed = !!user && canAccess(user.role, 'crm-sales', rolePermissions);
  const ready = (allowed || saleAllowed) && clients.length > 0 && branches.length > 0;

  useEffect(() => {
    if (!ready || !user) return;
    let alive = true;
    const t = setTimeout(() => {
      import('./automationRunner')
        .then(async m => {
          const ctx = { user, clients, branches };
          // Lần lượt (không song song) — 2 khu vực cùng tải dữ liệu một lúc chỉ làm chậm app lúc mở
          for (const space of [...(allowed ? ['client'] as const : []), ...(saleAllowed ? ['sale'] as const : [])]) {
            const r = await m.runCareAutomationOnce({ ctx, today: todayVN(), daily: true, space });
            const msg = m.automationMessage(r, space);
            if (msg && alive) toast(msg);
          }
        })
        .catch(e => console.error('[cskh] Lỗi chạy việc nhắc tự động', e));
    }, START_DELAY_MS);
    return () => { alive = false; clearTimeout(t); };
    // Chỉ chạy lại khi đổi tài khoản / đủ dữ liệu — không chạy theo mỗi lần danh sách khách đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  return null;
}
