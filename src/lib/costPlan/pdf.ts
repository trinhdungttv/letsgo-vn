// Xuất PDF báo giá từ phần tử HTML (khổ A4). Chụp đúng cái đang xem trước → PDF giống hệt (kể cả chữ Hán, chữ ký, con dấu),
// chạy hoàn toàn trên trình duyệt, không gửi dữ liệu đi đâu. Thư viện nạp khi bấm xuất (không làm nặng lúc mở app).
// Lưu ý: PDF dạng ảnh chất lượng cao (chữ không bôi đen/sao chép được). Cần chữ vector thì dùng nút "In" rồi chọn "Lưu dạng PDF".

export const A4_MM = { w: 210, h: 297 };
export const A4_LANDSCAPE_MM = { w: 297, h: 210 };

export interface PdfBlock { top: number; bottom: number }

/**
 * Điểm bắt đầu của từng trang (px của tài liệu, trang đầu = 0). Mỗi trang cao `pageH`; nếu chỗ cắt rơi GIỮA một khối không nên
 * chia đôi (dòng giá, khối chữ ký, ghi chú…) thì dời chỗ cắt lên đầu khối đó. Không dời quá xa (khối phải nằm ở 35% cuối trang) và
 * khối quá cao (≥ 60% trang) thì cho cắt tự nhiên.
 */
export function planCuts(blocks: PdfBlock[], total: number, pageH: number): number[] {
  const starts = [0];
  let pos = 0;
  for (let guard = 0; total - pos > pageH + 2 && guard < 50; guard++) {
    let y = pos + pageH;
    const hits = blocks.filter(b => b.top < y && b.bottom > y && b.top > pos + pageH * 0.35 && b.bottom - b.top < pageH * 0.6);
    if (hits.length) y = Math.min(...hits.map(b => b.top));
    starts.push(y);
    pos = y;
  }
  return starts;
}

/**
 * html2canvas đo "đường cơ sở" của chữ bằng 1 thẻ <img> 1×1 chèn thẳng vào <body>. Tailwind preflight đặt `img{display:block}` làm phép đo sai
 * → MỌI chữ bị vẽ lệch xuống vài px (rất rõ ở bảng có dòng sát). Đặt lại riêng cho thẻ đo đó trong lúc chụp.
 */
const METRICS_FIX = 'body > div > img[width="1"][height="1"]{display:inline-block!important;vertical-align:baseline!important}';

export async function renderElementToPdf(el: HTMLElement, opts: { scale?: number; quality?: number; landscape?: boolean } = {}): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const fix = document.createElement('style');
  fix.textContent = METRICS_FIX;
  document.head.appendChild(fix);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(el, {
      scale: opts.scale ?? 2.5, backgroundColor: '#ffffff', useCORS: true, logging: false,
      windowWidth: el.scrollWidth, windowHeight: el.scrollHeight,
    });
  } finally { fix.remove(); }
  // Chia trang theo các khối đánh dấu data-pdf-block (px của tài liệu → px của ảnh theo tỉ lệ chụp)
  const k = canvas.height / el.scrollHeight;
  const top = el.getBoundingClientRect().top;
  const blocks: PdfBlock[] = [...el.querySelectorAll<HTMLElement>('[data-pdf-block]')].map(n => {
    const r = n.getBoundingClientRect();
    return { top: r.top - top, bottom: r.bottom - top + Number(n.dataset.pdfKeep ?? 0) };
  });
  const mm = opts.landscape ? A4_LANDSCAPE_MM : A4_MM;
  const pageH = (el.scrollWidth * mm.h) / mm.w;                       // chiều cao 1 trang A4 theo px của tài liệu
  const starts = planCuts(blocks, el.scrollHeight, pageH);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: opts.landscape ? 'landscape' : 'portrait', compress: true });
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : el.scrollHeight;
    const sy = Math.round(start * k), sh = Math.max(1, Math.min(canvas.height - sy, Math.round((end - start) * k)));
    const seg = document.createElement('canvas');
    seg.width = canvas.width; seg.height = sh;
    const ctx = seg.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, seg.width, seg.height);
    ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
    if (i > 0) pdf.addPage();
    pdf.addImage(seg.toDataURL('image/jpeg', opts.quality ?? 0.92), 'JPEG', 0, 0, mm.w, (sh * mm.w) / canvas.width, undefined, 'FAST');
  });
  return pdf.output('blob');
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/** CSS để IN đúng 1 phần tử `#quote-export-host` (ẩn mọi thứ khác của trang), khổ A4 dọc hoặc ngang. */
export function printCss(pagePx: number, landscape = false): string {
  return `
#quote-export-host{position:fixed;left:-10000px;top:0;width:${pagePx}px;pointer-events:none}
@media print{
  body > *:not(#quote-export-host){display:none!important}
  #quote-export-host{position:static!important;left:auto!important;width:${landscape ? '297mm' : '210mm'}!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:0}
}`;
}
