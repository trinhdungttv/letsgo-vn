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
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-[#111] flex items-center gap-1.5">
          {icon}{title}
        </div>
        {subtitle && <div className="text-[11.5px] text-[#888] mt-0.5 truncate">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 max-w-full">{actions}</div>}
    </div>
  );
}
