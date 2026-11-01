// Nút "Báo cáo LĐ": bấm phần chính = mở xem trước + tuỳ chọn; mũi tên = tải ngay PDF / Markdown (1 cú bấm ra file).
// Cửa sổ báo cáo nạp lười (lazy) — không làm nặng trang khi chưa dùng.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BarChart3, ChevronDown, FileDown, FileText, Eye } from 'lucide-react';
import type { LaborReportAutoExport } from './LaborReportModal';

const LaborReportModal = lazy(() => import('./LaborReportModal'));

export default function LaborReportButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState<{ auto: LaborReportAutoExport } | null>(null);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const start = (auto: LaborReportAutoExport) => { setMenu(false); setOpen({ auto }); };

  return (
    <>
      <div ref={ref} className="relative flex shrink-0">
        <button onClick={() => start(null)} title="Báo cáo tổng quan lao động toàn hệ thống (PDF / Markdown)"
          className="h-[30px] pl-2.5 pr-2 sm:pl-3 text-[12px] border border-[#E8E7E2] rounded-l-lg bg-white hover:bg-[#F9F9F7] flex items-center gap-1.5">
          <BarChart3 size={13} className="text-blue-600" />
          <span className={compact ? 'hidden lg:inline' : 'hidden sm:inline'}>Báo cáo LĐ</span>
        </button>
        <button onClick={() => setMenu(v => !v)} aria-label="Tải nhanh báo cáo lao động"
          className="h-[30px] px-1.5 text-[12px] border border-l-0 border-[#E8E7E2] rounded-r-lg bg-white hover:bg-[#F9F9F7] flex items-center">
          <ChevronDown size={13} />
        </button>
        {menu && (
          <div className="absolute right-0 top-[34px] z-40 w-[250px] bg-white border border-[#E8E7E2] rounded-lg shadow-lg py-1 text-[12.5px]">
            <button onClick={() => start('pdf')} className="w-full flex items-start gap-2 px-3 py-2 hover:bg-[#F9F9F7] text-left">
              <FileDown size={14} className="text-blue-600 mt-0.5 shrink-0" />
              <span><span className="font-medium text-[#111]">Tải PDF ngay</span><br /><span className="text-[11px] text-[#888]">Toàn hệ thống · tuần này · đủ biểu đồ</span></span>
            </button>
            <button onClick={() => start('md')} className="w-full flex items-start gap-2 px-3 py-2 hover:bg-[#F9F9F7] text-left">
              <FileText size={14} className="text-blue-600 mt-0.5 shrink-0" />
              <span><span className="font-medium text-[#111]">Tải Markdown ngay</span><br /><span className="text-[11px] text-[#888]">Biểu đồ Mermaid + bảng số, đưa vào Claude được</span></span>
            </button>
            <div className="border-t border-[#F0EEE9] my-1" />
            <button onClick={() => start(null)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F9F9F7] text-left">
              <Eye size={14} className="text-[#666] shrink-0" />Xem trước & tuỳ chọn…
            </button>
          </div>
        )}
      </div>
      {open && (
        <Suspense fallback={null}>
          <LaborReportModal autoExport={open.auto} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </>
  );
}
