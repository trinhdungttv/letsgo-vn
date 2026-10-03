// Vẽ 1 sheet Excel (SheetModel) ra HTML để xem trước / chụp PDF / in. Mọi thứ định vị tuyệt đối theo px đã tính sẵn
// (không dùng <table>) để html2canvas chụp đúng cả ô gộp, chữ Hán và ảnh chữ ký / con dấu.
import type { CSSProperties } from 'react';
import type { Edge, SheetCell, SheetModel } from '../../../lib/costPlan/sheetModel';

export const SHEET_PAGE = { portrait: { w: 794, h: 1123 }, landscape: { w: 1123, h: 794 } };
export const SHEET_MARGIN = 36;

export function sheetScale(model: SheetModel): number {
  const page = model.landscape ? SHEET_PAGE.landscape : SHEET_PAGE.portrait;
  const byW = (page.w - SHEET_MARGIN * 2) / Math.max(1, model.width);
  const byH = model.fitOnePage ? (page.h - SHEET_MARGIN * 2) / Math.max(1, model.height) : Infinity;      // "vừa 1 trang" như khi in từ Excel
  return Math.min(1, byW, byH);
}

function Edges({ c, k }: { c: SheetCell; k: number }) {
  const out: [string, CSSProperties | null][] = [];
  const th = (e: Edge) => (e ? Math.max(1, Math.round(e.w * k)) : 0);
  const solid = (e: Edge, s: CSSProperties): CSSProperties | null => (e ? { position: 'absolute', background: e.color, ...s } : null);
  out.push(['t', solid(c.t, { left: c.x * k, top: c.y * k - th(c.t) / 2, width: c.w * k, height: th(c.t) })]);
  out.push(['b', solid(c.b, { left: c.x * k, top: (c.y + c.h) * k - th(c.b) / 2, width: c.w * k, height: th(c.b) })]);
  out.push(['l', solid(c.l, { left: c.x * k - th(c.l) / 2, top: c.y * k, width: th(c.l), height: c.h * k })]);
  out.push(['r', solid(c.r, { left: (c.x + c.w) * k - th(c.r) / 2, top: c.y * k, width: th(c.r), height: c.h * k })]);
  return <>{out.map(([key, st]) => (st ? <div key={key} style={st} /> : null))}</>;
}

export default function SheetPreview({ model, k: kOverride, onEdit, edited }: {
  model: SheetModel; k?: number;
  /** Có thì bản xem trước vào chế độ SỬA CHỮ: bấm vào ô để sửa nội dung */
  onEdit?: (cell: SheetCell) => void;
  /** Địa chỉ các ô đã sửa (tô nền vàng nhạt để dễ thấy) */
  edited?: Set<string>;
}) {
  const page = model.landscape ? SHEET_PAGE.landscape : SHEET_PAGE.portrait;
  const k = kOverride ?? sheetScale(model);
  const W = model.width * k, H = model.height * k;
  return (
    <div style={{ width: page.w, minHeight: page.h, background: '#fff', padding: SHEET_MARGIN, boxSizing: 'border-box' }}>
      <div style={{ position: 'relative', width: W, height: H, margin: '0 auto' }}>
        {/* nền ô */}
        {model.cells.filter(c => c.bg).map((c, i) => <div key={`bg${i}`} style={{ position: 'absolute', left: c.x * k, top: c.y * k, width: c.w * k, height: c.h * k, background: c.bg! }} />)}
        {/* viền */}
        {model.cells.map((c, i) => (c.t || c.b || c.l || c.r ? <Edges key={`e${i}`} c={c} k={k} /> : null))}
        {/* chữ. Ô 1 dòng: căn dọc bằng line-height = chiều cao ô (không dùng flex vì html2canvas lệch dòng khi chụp); ô nhiều dòng: flex */}
        {model.cells.filter(c => c.text).map((c, i) => {
          const font: CSSProperties = {
            fontFamily: c.font, fontSize: c.size * k, color: c.color, fontWeight: c.bold ? 700 : 400, fontStyle: c.italic ? 'italic' : 'normal',
            textDecoration: c.underline ? 'underline' : 'none', textAlign: c.h_align,
          };
          const box: CSSProperties = { position: 'absolute', left: c.x * k, top: c.y * k, width: c.w * k, height: c.h * k, boxSizing: 'border-box' };
          const padX = 3 * k;
          const padL = padX + (c.h_align === 'left' ? c.indent * 9 * k : 0);
          const content = c.runs ? c.runs.map((r, j) => <span key={j} style={{ fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? 'italic' : 'normal', color: r.color }}>{r.text}</span>) : c.text;
          if (!c.wrap && !c.text.includes('\n')) {
            const lh = c.v_align === 'center' ? c.h * k : c.size * k * 1.25;
            const top = c.v_align === 'top' ? 2 * k : c.v_align === 'bottom' ? c.h * k - lh - 2 * k : 0;
            return (
              <div key={`t${i}`} style={{ ...box, overflow: 'visible' }}>
                <div style={{ ...font, position: 'absolute', top, left: 0, right: 0, paddingLeft: c.h_align === 'left' ? padL : 0, paddingRight: c.h_align === 'right' ? padX : 0, lineHeight: `${lh}px`, whiteSpace: 'pre', height: lh }}>{content}</div>
              </div>
            );
          }
          return (
            <div key={`t${i}`} style={{
              ...box, padding: `${2 * k}px ${padX}px ${2 * k}px ${padL}px`, display: 'flex', alignItems: c.v_align === 'top' ? 'flex-start' : c.v_align === 'center' ? 'center' : 'flex-end',
              justifyContent: c.h_align === 'center' ? 'center' : c.h_align === 'right' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{ ...font, lineHeight: 1.25, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '100%' }}>{content}</div>
            </div>
          );
        })}
        {/* ảnh (logo / chữ ký / con dấu in sẵn trong mẫu) */}
        {model.images.map((im, i) => <img key={`i${i}`} src={im.src} alt="" draggable={false} style={{ position: 'absolute', left: im.x * k, top: im.y * k, width: im.w * k, height: im.h * k, objectFit: 'fill' }} />)}
        {/* chế độ sửa chữ: lớp bấm được phủ lên từng ô */}
        {onEdit && model.cells.filter(c => c.editable).map((c, i) => (
          <div key={`ed${i}`} role="button" tabIndex={0} title={`Sửa ô ${c.addr}`} onClick={() => onEdit(c)} onKeyDown={e => { if (e.key === 'Enter') onEdit(c); }}
            className="hover:outline hover:outline-2 hover:outline-[#0071e3] hover:bg-[#0071e3]/10 cursor-text"
            style={{ position: 'absolute', left: c.x * k, top: c.y * k, width: c.w * k, height: c.h * k, background: edited?.has(c.addr) ? 'rgba(255,196,0,0.22)' : undefined }} />
        ))}
        {/* dải dòng & khối ảnh: chỗ chia trang không được cắt giữa */}
        {model.bands.map((b, i) => <div key={`b${i}`} data-pdf-block style={{ position: 'absolute', left: 0, width: 1, top: b.top * k, height: Math.max(1, (b.bottom - b.top) * k), pointerEvents: 'none' }} />)}
        {model.images.map((im, i) => <div key={`ib${i}`} data-pdf-block style={{ position: 'absolute', left: 0, width: 1, top: Math.max(0, im.y - 70) * k, height: (im.h + 70) * k, pointerEvents: 'none' }} />)}
      </div>
    </div>
  );
}
