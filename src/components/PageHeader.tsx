import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 md:px-6 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
      {/* flex-1 + basis 160px: tiêu đề nhường chỗ cho nút ở cùng hàng (phụ đề tự cắt "…"),
          chỉ xuống dòng khi cụm nút quá rộng — tránh header 2–3 tầng trên điện thoại. */}
      <div className="min-w-0 flex-1 basis-[160px]">
        <div className="text-[14px] font-semibold text-[#111] flex items-center gap-1.5">
          {icon}{title}
        </div>
        {subtitle && <div className="text-[11.5px] text-[#888] mt-0.5 truncate">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 max-w-full">{actions}</div>}
    </div>
  );
}
