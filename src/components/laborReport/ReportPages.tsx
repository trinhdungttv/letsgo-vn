// Dàn trang A4 cho báo cáo lao động: đo chiều cao thật của từng khối (ở lớp ẩn) rồi xếp khối vào trang,
// không bao giờ cắt ngang 1 khối. Cùng 1 kết quả dàn trang dùng cho bản xem trước và bản chụp PDF.
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtDateTime, type LaborReport } from '../../lib/laborReport/model';
import { MeasureContext, C } from './ReportCharts';
import { CONTENT_W, type ReportBlock } from './ReportBlocks';

export const PAGE = { W: 794, H: 1123, PX: 40, PT: 22, PB: 18, HEAD: 30, FOOT: 26 };
const GAP = 12;
export const CONTENT_H = PAGE.H - PAGE.PT - PAGE.PB - PAGE.HEAD - PAGE.FOOT;

/** Xếp khối vào trang. heights đã gồm khoảng cách GAP phía dưới mỗi khối. */
export function paginate(blocks: ReportBlock[], heights: number[], maxH = CONTENT_H + GAP): number[][] {
  const pages: number[][] = [];
  let page: number[] = [], used = 0;
  const flush = () => { if (page.length) pages.push(page); page = []; used = 0; };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.breakBefore) flush();
    let need = heights[i];
    // Tiêu đề phần / biểu đồ "dính" với khối sau: không để đứng trơ trọi cuối trang.
    for (let j = i; blocks[j]?.keepWithNext && j + 1 < blocks.length && !blocks[j + 1].breakBefore; j++) need += heights[j + 1];
    if (page.length && used + Math.min(need, maxH) > maxH) flush();
    page.push(i);
    used += heights[i];
  }
  flush();
  return pages;
}

/** Lớp đo ẩn: vẽ các khối đúng bề rộng nội dung, đo xong báo kết quả dàn trang. */
export function MeasureLayer({ blocks, onLayout }: { blocks: ReportBlock[]; onLayout: (pages: number[][], forBlocks: ReportBlock[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const heights = [...el.children].map(c => (c as HTMLElement).getBoundingClientRect().height);
    onLayout(paginate(blocks, heights), blocks);
  }, [blocks, onLayout]);
  return (
    <MeasureContext.Provider value={true}>
      <div ref={ref} aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: CONTENT_W, visibility: 'hidden', pointerEvents: 'none' }}>
        {blocks.map(b => <div key={b.id} style={{ paddingBottom: GAP }}>{b.node}</div>)}
      </div>
    </MeasureContext.Provider>
  );
}

export function ReportPage({ report, index, total, children }: { report: LaborReport; index: number; total: number; children: React.ReactNode }) {
  return (
    <div className="lr-page bg-white text-[#0b0b0b] overflow-hidden"
      style={{ width: PAGE.W, height: PAGE.H, padding: `${PAGE.PT}px ${PAGE.PX}px ${PAGE.PB}px`, display: 'flex', flexDirection: 'column', fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}>
      <div className="flex items-center justify-between text-[9.5px] text-[#898781] border-b border-[#e8e7e2]" style={{ height: PAGE.HEAD - 10, marginBottom: 10 }}>
        <span><b className="font-semibold tracking-[0.08em]" style={{ color: C.navy }}>LET'S GO VN</b> · Báo cáo tổng quan lao động</span>
        <span>{report.scopeLabel} · Tuần chốt {report.anchor.label} ({report.anchor.range})</span>
      </div>
      <div style={{ height: CONTENT_H, overflow: 'hidden' }}>{children}</div>
      <div className="flex items-end justify-between text-[9px] text-[#898781]" style={{ height: PAGE.FOOT }}>
        <span>Tạo lúc {fmtDateTime(report.generatedAt)} · Số liệu từ CRM Let's Go VN · Lưu hành nội bộ</span>
        <span>Trang {index + 1} / {total}</span>
      </div>
    </div>
  );
}

/** Toàn bộ các trang (kích thước thật). Dùng cho lớp chụp PDF. */
export const ReportPagesFull = forwardRef<HTMLDivElement, { report: LaborReport; blocks: ReportBlock[]; layout: number[][] }>(
  function ReportPagesFull({ report, blocks, layout }, ref) {
    return (
      <div ref={ref}>
        {layout.map((ids, p) => (
          <ReportPage key={p} report={report} index={p} total={layout.length}>
            {ids.map(i => <div key={blocks[i].id} style={{ paddingBottom: GAP }}>{blocks[i].node}</div>)}
          </ReportPage>
        ))}
      </div>
    );
  },
);

/** Bản xem trước: các trang thu nhỏ vừa khung, xếp dọc như trình đọc PDF. */
export function ReportPreview({ report, blocks, layout }: { report: LaborReport; blocks: ReportBlock[]; layout: number[][] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, Math.max(0.3, (el.clientWidth - 24) / PAGE.W)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrap} className="w-full">
      <div className="flex flex-col items-center gap-4 py-3">
        {layout.map((ids, p) => (
          <div key={p} className="shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.06)] rounded-[2px] overflow-hidden bg-white"
            style={{ width: PAGE.W * scale, height: PAGE.H * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <ReportPage report={report} index={p} total={layout.length}>
                {ids.map(i => <div key={blocks[i].id} style={{ paddingBottom: GAP }}>{blocks[i].node}</div>)}
              </ReportPage>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
