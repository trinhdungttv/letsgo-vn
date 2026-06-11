import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-[#E8E7E2] shrink-0">
      <div>
        <div className="text-[14px] font-semibold text-[#111] flex items-center gap-1.5">
          {icon}{title}
        </div>
        {subtitle && <div className="text-[11.5px] text-[#888] mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
