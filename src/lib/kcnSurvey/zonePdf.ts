// Vẽ báo cáo khảo sát 1 KCN (zoneReport.ts) ra PDF CHỮ THẬT — AI (Gemini, ChatGPT…) đọc / trích được, không phải ảnh
// chụp màn hình. Font tiếng Việt Be Vietnam Pro (OFL, public/fonts) chỉ tải khi bấm xuất; kèm ảnh bảng tuyển dụng tuỳ chọn
// (ảnh tải lỗi — chặn CORS / mất mạng — thì ghi link thay cho ảnh). Thư viện jsPDF nạp động.
import type { jsPDF as JsPdf } from 'jspdf';
import { fmtDistance } from './track';
import { headcountText, kindPdfTag } from './online';
import { reportIntro, type ZoneReport } from './zoneReport';

const FONT = 'BeVietnamPro';
const PAGE_W = 210, PAGE_H = 297, M = 14, BOTTOM = PAGE_H - 14;
const W = PAGE_W - M * 2;
/** Font không có ký tự ngôi sao → ghi bằng chữ (AI đọc cũng rõ nghĩa hơn) */
export const STAR_TAG = '[Chú trọng] ';

async function fontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được font chữ (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Ảnh → JPEG nhỏ gọn (cạnh dài ≤ 1200 px) để PDF không quá nặng. null = không tải được. */
async function loadImage(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return { data: c.toDataURL('image/jpeg', 0.72), w: c.width, h: c.height };
  } catch { return null; }
}

const fmtDT = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

export async function zoneReportPdf(r: ZoneReport, opts: { images: boolean; onProgress?: (done: number, total: number) => void }): Promise<Blob> {
  const [{ jsPDF }, regular, bold] = await Promise.all([import('jspdf'), fontBase64('/fonts/BeVietnamPro-Regular.ttf'), fontBase64('/fonts/BeVietnamPro-Bold.ttf')]);
  const pdf: JsPdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  pdf.addFileToVFS('BeVietnamPro-Regular.ttf', regular);
  pdf.addFont('BeVietnamPro-Regular.ttf', FONT, 'normal');
  pdf.addFileToVFS('BeVietnamPro-Bold.ttf', bold);
  pdf.addFont('BeVietnamPro-Bold.ttf', FONT, 'bold');
  pdf.setProperties({ title: r.title, subject: 'Khảo sát tuyển dụng KCN', creator: "Let's Go VN CRM" });

  let y = M;
  const ensure = (h: number) => { if (y + h > BOTTOM) { pdf.addPage(); y = M; } };
  /** Đoạn chữ tự xuống dòng, tự sang trang. */
  const para = (text: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) => {
    const size = o.size ?? 9.5, lh = size * 0.42;
    pdf.setFont(FONT, o.bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...(o.color ?? [29, 29, 31]));
    const lines = pdf.splitTextToSize(text, W - (o.indent ?? 0)) as string[];
    for (const ln of lines) { ensure(lh); pdf.text(ln, M + (o.indent ?? 0), y + lh * 0.8); y += lh; }
    y += o.gap ?? 1.2;
  };
  const heading = (text: string) => { y += 2; ensure(12); para(text, { size: 12.5, bold: true, color: [17, 24, 39], gap: 1.5 }); pdf.setDrawColor(220); pdf.line(M, y, M + W, y); y += 2.5; };

  // ── Bìa / mở đầu ──
  para(r.title, { size: 16, bold: true, gap: 1 });
  para(`Thời gian: ${r.periodText} · Xuất lúc ${fmtDT(new Date().toISOString())}`, { size: 9, color: [110, 110, 115], gap: 3 });
  for (const t of reportIntro(r)) para(t, { size: 9, color: [60, 60, 67] });

  heading('Tóm tắt');
  const s = r.summary;
  para([
    `Số chuyến khảo sát: ${s.trips} (tổng ${fmtDistance(s.distanceM)})`,
    `Số bảng tuyển dụng đã chụp: ${s.photos} · Ghi âm: ${s.voice}`,
    `Số công ty có bảng tuyển dụng: ${s.companies} · Có ghi mức lương: ${s.withWage} · Công ty gắn sao cần chú trọng: ${s.starred}`,
    `Tổng số lượng tuyển (lần chụp gần nhất mỗi công ty): ${s.headcount.toLocaleString('vi-VN')}`,
  ].join('\n'));

  // ── Bảng theo công ty ──
  if (r.companies.length) {
    heading('Tổng hợp theo công ty');
    const cols = [
      { t: 'Công ty', w: 50 }, { t: 'Ảnh', w: 10 }, { t: 'Vị trí tuyển', w: 50 }, { t: 'SL', w: 12 }, { t: 'Lương ghi trên bảng', w: 40 }, { t: 'Gần nhất', w: W - 162 },
    ];
    const size = 8.2, lh = size * 0.42, pad = 1.2;
    const header = () => {
      ensure(lh + pad * 2 + 2);
      pdf.setFillColor(242, 242, 240); pdf.rect(M, y, W, lh + pad * 2, 'F');
      pdf.setFont(FONT, 'bold'); pdf.setFontSize(size); pdf.setTextColor(60, 60, 67);
      let x = M;
      for (const c of cols) { pdf.text(c.t, x + 1, y + pad + lh * 0.8); x += c.w; }
      y += lh + pad * 2;
    };
    header();
    for (const c of r.companies) {
      const cells = [
        `${c.starred ? STAR_TAG : ''}${c.name}`, String(c.photos), c.positions.join(', ') || '—', c.headcount != null ? String(c.headcount) : '—',
        c.wages.join(' | ') || '—', fmtDay(c.lastAt),
      ];
      pdf.setFont(FONT, 'normal'); pdf.setFontSize(size);
      const wrapped = cells.map((v, k) => pdf.splitTextToSize(v, cols[k].w - 2) as string[]);
      const h = Math.max(...wrapped.map(l => l.length)) * lh + pad * 2;
      if (y + h > BOTTOM) { pdf.addPage(); y = M; header(); }
      pdf.setFont(FONT, 'normal'); pdf.setFontSize(size); pdf.setTextColor(29, 29, 31);
      let x = M;
      wrapped.forEach((lines, k) => {
        if (k === 0 && c.starred) pdf.setFont(FONT, 'bold');
        lines.forEach((ln, j) => pdf.text(ln, x + 1, y + pad + lh * 0.8 + j * lh));
        pdf.setFont(FONT, 'normal');
        x += cols[k].w;
      });
      y += h;
      pdf.setDrawColor(232); pdf.line(M, y, M + W, y);
    }
    y += 2;
  }

  // ── Chi tiết từng ảnh ──
  if (r.photos.length) {
    heading('Chi tiết từng bảng tuyển dụng');
    for (let k = 0; k < r.photos.length; k++) {
      const { photo: p, starred, markText } = r.photos[k];
      ensure(18);
      para(`#${k + 1} · ${fmtDT(p.taken_at)} · ${kindPdfTag(p)}${starred ? STAR_TAG : ''}${p.company_name.trim() || 'Chưa rõ công ty'}`, { size: 10.5, bold: true, gap: 0.6 });
      const lines = [
        p.positions && `Vị trí tuyển: ${p.positions}`,
        headcountText(p) != null && `Số lượng: ${headcountText(p)}`,
        p.wage_text && `Lương: ${p.wage_text}`,
        p.note && `Ghi chú: ${p.note}`,
        markText.length > 0 && `Chữ ghi trên ảnh: ${markText.join(' · ')}`,
      ].filter(Boolean) as string[];
      if (lines.length) para(lines.join('\n'), { indent: 3, gap: 0.6 });
      para(`${p.user_name ? `Người chụp: ${p.user_name} · ` : ''}Toạ độ: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} · Ảnh: ${p.url}`, { size: 7.5, color: [120, 120, 128], indent: 3, gap: 1 });
      if (opts.images) {
        const img = await loadImage(p.url);
        if (img) {
          const iw = Math.min(110, W - 3), ih = Math.min(120, iw * (img.h / img.w));
          const w2 = ih < iw * (img.h / img.w) ? ih * (img.w / img.h) : iw;
          ensure(ih + 2);
          pdf.addImage(img.data, 'JPEG', M + 3, y, w2, ih, undefined, 'FAST');
          y += ih + 2;
        } else para('(Không tải được ảnh — mở link ảnh ở trên)', { size: 7.5, color: [200, 0, 32], indent: 3 });
      }
      y += 1.5;
      opts.onProgress?.(k + 1, r.photos.length);
    }
  }

  // ── Ghi âm ──
  if (r.voice.length) {
    heading('Ghi âm khảo sát');
    for (const n of r.voice) {
      const head = `${fmtDT(n.recorded_at)} · ${n.company_name.trim() || 'Không gắn công ty'} · ${Math.round(n.duration_s)} giây`;
      para(head, { bold: true, gap: 0.4 });
      para(n.note.trim() ? `Ghi chú: ${n.note.trim()}` : '(chưa ghi chú chữ — nghe bản ghi ở link)', { indent: 3, gap: 0.4, color: n.note.trim() ? undefined : [120, 120, 128] });
      para(`Bản ghi: ${n.url}`, { size: 7.5, color: [120, 120, 128], indent: 3 });
    }
  }

  // ── Công ty đã đi ngang ──
  if (r.passed.length) {
    heading('Công ty đã đi ngang khi khảo sát');
    for (const g of r.passed) para(`${g.label} (${g.names.length}): ${g.names.join(' · ')}`);
  }

  // ── Các chuyến ──
  if (r.trips.length) {
    heading('Các chuyến khảo sát');
    for (const t of r.trips) {
      const bits = [fmtDT(t.started_at), t.title || t.zone_name, fmtDistance(t.distance_m), t.road_coverage != null ? `phủ ${t.road_coverage.toLocaleString('vi-VN')}% đường` : '', t.user_name].filter(Boolean);
      para(bits.join(' · ') + (t.note ? `\nGhi chú: ${t.note}` : ''), { gap: 0.8 });
    }
  }

  // Số trang
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    pdf.setFont(FONT, 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(150);
    pdf.text(`${r.title} · Trang ${i}/${n}`, PAGE_W / 2, PAGE_H - 7, { align: 'center' });
  }
  return pdf.output('blob');
}
