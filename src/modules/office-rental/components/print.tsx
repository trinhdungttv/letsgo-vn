/* eslint-disable react-refresh/only-export-components */
// In / lưu PDF bằng CSS print: nội dung cần in được đưa ra ngoài app (portal vào body),
// mọi thứ khác bị ẩn khi in. Không cần thư viện PDF.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { todayStr, fmtDate } from '../lib/ops';

export const PRINT_CSS = `
.bds-print-root { display: none; }
@media print {
  body > *:not(.bds-print-root) { display: none !important; }
  .bds-print-root { display: block !important; color: #111; }
  .bds-print-page { page-break-after: always; break-after: page; }
  .bds-print-page:last-child { page-break-after: auto; break-after: auto; }
  .bds-print-root table { border-collapse: collapse; width: 100%; }
  .bds-print-root th, .bds-print-root td { border-bottom: 1px solid #ddd; }
  @page { size: A4; margin: 12mm; }
}`;

/** Gọi print(nội dung) → dựng nội dung vào vùng in rồi mở hộp thoại In của trình duyệt. */
export function usePrint() {
  const [node, setNode] = useState<ReactNode | null>(null);
  useEffect(() => {
    if (!node) return;
    const t = setTimeout(() => window.print(), 80);
    const after = () => setNode(null);
    window.addEventListener('afterprint', after);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, [node]);
  const portal = node
    ? createPortal(<div className="bds-print-root"><style>{PRINT_CSS}</style><div className="bds-print-page">{node}</div></div>, document.body)
    : null;
  return { print: (content: ReactNode) => setNode(content), portal };
}

/** Đầu trang báo cáo (dùng cả trên màn hình lẫn bản in). */
export function ReportHeader({ title, period }: { title: string; period: string }) {
  return (
    <div className="flex justify-between items-start border-b-2 border-[#0c2340] pb-2 mb-3">
      <div>
        <div className="text-[14px] font-bold text-[#0c2340]">TTV HR GROUP · Văn phòng Orient</div>
        <div className="text-[11px] text-gray-500">331 Bến Vân Đồn, Quận 4, TP.HCM</div>
      </div>
      <div className="text-right">
        <div className="text-[14px] font-bold uppercase">{title}</div>
        <div className="text-[11px] text-gray-500">{period} · Lập ngày {fmtDate(todayStr())}</div>
      </div>
    </div>
  );
}
