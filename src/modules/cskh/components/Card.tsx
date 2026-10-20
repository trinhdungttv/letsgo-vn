// Khối thẻ dùng chung cho các tab CSKH — kiểu Apple (xem ./apple.tsx).
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Panel } from './apple';

export function Card({ icon, title, count, right, sub, children, footer }: {
  icon: ReactNode;
  title: string;
  count?: number;
  right?: ReactNode;
  sub?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Panel title={title} icon={icon} count={count} meta={sub} action={right} footer={footer || undefined}>
      {children}
    </Panel>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="py-8 text-center text-[13px] text-[#86868B]">{children}</p>
);

export const Dot = ({ color }: { color: string }) => (
  <i className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: color }} />
);

export const Spinner = () => (
  <div className="py-16 flex justify-center"><div className="w-5 h-5 border-2 border-black/[0.08] border-t-[#0071E3] rounded-full animate-spin" /></div>
);

/** Banner khi DB chưa chạy migration CSKH. */
export const MigrationBanner = () => (
  <div className="flex items-start gap-3 rounded-[14px] bg-[#FF9500]/[0.12] px-4 py-3 text-[13px] leading-snug text-[#7A3E00]">
    <AlertTriangle size={17} className="shrink-0 mt-px text-[#C93400]" />
    <p>
      Database chưa chạy migration CSKH <b>168–173</b> — đang xem được nhưng chưa lưu được hạng, nhật ký, việc đã hứa, sự kiện.
      Mở Supabase → SQL Editor, chạy lần lượt 6 file migration rồi tải lại trang.
    </p>
  </div>
);
