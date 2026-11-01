// Xuất PDF báo cáo lao động: chụp TỪNG trang A4 đã dàn sẵn (794×1123 px) rồi ghép thành PDF.
// Trang được dàn trước nên không bao giờ cắt ngang biểu đồ / dòng bảng. Chạy hoàn toàn trên trình duyệt,
// thư viện chỉ nạp khi bấm xuất. PDF dạng ảnh nét cao (scale 2) — xem/in đẹp, chữ không sao chép được.
import { METRICS_FIX } from '../costPlan/pdf';

export { downloadBlob } from '../costPlan/pdf';

export async function pagesToPdf(
  pages: HTMLElement[],
  opts: { scale?: number; quality?: number; title?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<Blob> {
  if (!pages.length) throw new Error('Chưa có trang nào để xuất');
  if (document.fonts?.ready) await document.fonts.ready;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  pdf.setProperties({ title: opts.title ?? 'Báo cáo lao động', creator: "Let's Go VN CRM" });
  const fix = document.createElement('style');
  fix.textContent = METRICS_FIX;
  document.head.appendChild(fix);
  try {
    for (let i = 0; i < pages.length; i++) {
      const el = pages[i];
      const canvas = await html2canvas(el, {
        scale: opts.scale ?? 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
        windowWidth: el.scrollWidth, windowHeight: el.scrollHeight,
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', opts.quality ?? 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      opts.onProgress?.(i + 1, pages.length);
      // Nhường luồng cho giao diện cập nhật thanh tiến độ.
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    fix.remove();
  }
  return pdf.output('blob');
}
