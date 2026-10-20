// Khối thẻ dùng chung cho các tab CSKH (tông LetsGo: nền trắng, viền mảnh).
import type { ReactNode } from 'react';

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
    <section className="bg-white border border-[#E8E7E2] rounded-[10px]" aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-3.5 md:px-4 pt-3 pb-1">
        <h2 className="text-[13px] font-semibold text-[#111] flex items-center gap-1.5">
          <span className="text-[#888]">{icon}</span>{title}
          {count !== undefined && count > 0 && (
            <span className="ml-0.5 min-w-[20px] h-5 px-1.5 rounded-full bg-[#1D4ED8] text-white text-[11px] font-semibold inline-flex items-center justify-center">{count}</span>
          )}
        </h2>
        {right}
      </div>
      {sub && <p className="px-3.5 md:px-4 text-[11px] text-[#999]">{sub}</p>}
      <div className="px-3.5 md:px-4 pb-2">{children}</div>
      {footer && <div className="px-3.5 md:px-4 py-2 border-t border-[#F0EFEB]">{footer}</div>}
    </section>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="py-5 text-center text-[12px] text-[#aaa]">{children}</p>
);

export const Dot = ({ color }: { color: string }) => (
  <i className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: color }} />
);

export const Spinner = () => (
  <div className="py-16 flex justify-center"><div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" /></div>
);

/** Banner khi DB chưa chạy migration CSKH. */
export const MigrationBanner = () => (
  <p className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-[10px] px-3.5 py-2.5">
    Database chưa chạy migration CSKH <b>168–173</b> — đang xem được nhưng chưa lưu được hạng, nhật ký, việc đã hứa, sự kiện.
    Mở Supabase → SQL Editor, chạy lần lượt 6 file migration rồi tải lại trang.
  </p>
);
