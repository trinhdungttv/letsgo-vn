import { lazy, Suspense } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CalendarCheck, ClipboardList, HardHat, LayoutGrid, ListChecks, Receipt, TrendingUp, UserPlus, Users } from 'lucide-react';
import { ICON_TILE } from '../components/workspace/wsTheme';
import { useHashTab } from '../hooks/useHashSubRoute';
import type { Client } from '../lib/types';
import type { RecruitTab } from '../modules/recruit/context';

// Tuyển dụng — quản lý TỪNG NGƯỜI (giới thiệu lao động / tuyển chính thức cho khách, VD Co-Herent):
// kế hoạch chỉ tiêu nhà máy × tháng, kho ứng viên, hồ sơ ứng tuyển qua các bước. Dữ liệu khoá, chỉ đi qua
// recruit_rpc (migration 180). Bundle riêng — chỉ tải khi mở trang.
const RecruitModule = lazy(() => import('../modules/recruit'));

const ROUTE_TABS = ['overview', 'pipeline', 'candidates', 'batches', 'settle', 'insights', 'workforce', 'plan'] as const;
const TABS: { key: RecruitTab; label: string; Icon: LucideIcon }[] = [
  { key: 'overview', label: 'Tổng quan', Icon: LayoutGrid },
  { key: 'pipeline', label: 'Ứng tuyển', Icon: ListChecks },
  { key: 'candidates', label: 'Ứng viên', Icon: Users },
  { key: 'batches', label: 'Nhận việc', Icon: CalendarCheck },
  { key: 'settle', label: 'Đối soát', Icon: Receipt },
  { key: 'insights', label: 'Phân tích', Icon: TrendingUp },
  { key: 'workforce', label: 'Đang cho thuê', Icon: HardHat },
  { key: 'plan', label: 'Kế hoạch', Icon: ClipboardList },
];

export default function Recruit({ clients, toast }: { clients: Client[]; toast: (m: string) => void }) {
  // Tab ghi vào URL (#/recruit/pipeline) — F5 / bookmark quay lại đúng tab.
  const [tab, setTab] = useHashTab<RecruitTab>('recruit', ROUTE_TABS, 'overview');

  return (
    <>
      <div className="shrink-0 bg-[#F5F5F7]/90 backdrop-blur-xl border-b border-black/[0.06] px-3 md:px-8 py-2.5 flex items-center gap-3">
        <div className="flex items-center gap-2.5 shrink-0" title="Tuyển dụng — kế hoạch, ứng viên, ứng tuyển">
          <span className={`w-8 h-8 rounded-[9px] ${ICON_TILE.teal} text-white flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.12)]`}>
            <UserPlus size={17} strokeWidth={2.1} />
          </span>
          <span className="hidden xl:inline text-[15px] font-semibold tracking-[-0.01em] text-[#1D1D1F]">Tuyển dụng</span>
        </div>
        <div role="tablist" aria-label="Các trang Tuyển dụng"
          className="flex p-[2px] rounded-[10px] bg-[rgba(118,118,128,0.12)] max-w-full overflow-x-auto no-scrollbar xl:mx-auto">
          {TABS.map(t => {
            const on = tab === t.key;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                className={[
                  'shrink-0 inline-flex items-center gap-1.5 px-3 md:px-3.5 h-9 md:h-8 rounded-[8px] text-[13px] transition-all whitespace-nowrap',
                  on ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_3px_8px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]' : 'text-[#3C3C43]/75 font-medium hover:text-[#1D1D1F]',
                ].join(' ')}>
                <t.Icon size={15} strokeWidth={on ? 2.3 : 2} className={on ? 'text-[#00708F]' : ''} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="hidden xl:block w-[120px] shrink-0" aria-hidden />
      </div>

      <div className="flex-1 overflow-y-auto bg-[#F5F5F7] px-3 md:px-8 pt-4 md:pt-6 pb-8 space-y-4 md:space-y-5">
        <Suspense fallback={<div className="py-16 flex justify-center"><div className="w-5 h-5 border-2 border-black/[0.08] border-t-[#30B0C7] rounded-full animate-spin" /></div>}>
          <RecruitModule tab={tab} onTab={setTab} clients={clients} toast={toast} />
        </Suspense>
      </div>
    </>
  );
}
