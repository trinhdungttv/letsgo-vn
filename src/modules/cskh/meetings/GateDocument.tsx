// "DANH SÁCH ĐĂNG KÝ RA VÀO CỔNG" — trang A4 NGANG (1123×794px @96dpi) dựng lại đúng file mẫu của công ty.
// Kích thước lấy từ file Excel mẫu rồi thu theo tỉ lệ "vừa 1 trang ngang" như Excel in ra: độ rộng cột (ký tự × 7 + 5 px),
// chiều cao dòng / cỡ chữ (pt × 4/3). Bản xem trước, PDF (html2canvas) và In đều dùng thành phần này.
// Style nội tuyến (không Tailwind) để html2canvas chụp đúng.
import type { CSSProperties } from 'react';
import { stampBoxes, type StampLayout } from '../../../lib/costPlan/entity';
import { SIGN_HINT, SIGN_ROW_PT, SIGN_ROWS, STAMP_BOX, gateHeaderGeom, signStartCol, type GateDoc } from '../../../lib/meetings/gateList';

export const PAGE_W = 1123;
export const PAGE_H = 794;
const PAD_X = 48;       // lề trái/phải 0,5"
const PAD_T = 58;       // lề trên 0,6"
const FONT = '"Times New Roman", Times, serif';

export interface GateImagesView {
  logo: string | null;
  signature: string | null;
  seal: string | null;
  layout: StampLayout;
}

export function GateDocument({ doc, images }: { doc: GateDoc; images: GateImagesView }) {
  const cw = PAGE_W - PAD_X * 2;
  const colRaw = doc.columns.map(c => c.width * 7 + 5);
  const total = colRaw.reduce((a, b) => a + b, 0);
  const k = cw / total;
  const pt = (v: number) => (v * 4 * k) / 3;
  const colW = colRaw.map(w => w * k);
  const logoW = (colW[0] ?? 0) + (colW[1] ?? 0);
  const g = gateHeaderGeom(doc.header);
  const indentPx = g.indent * 9 * k;
  const s = signStartCol(doc);
  const signLeft = colW.slice(0, s - 1).reduce((a, b) => a + b, 0);
  const signW = cw - signLeft;
  const THICK = 2.5, MEDIUM = 1.5;

  const line = (h: number, extra: CSSProperties = {}): CSSProperties => ({ height: pt(h), display: 'flex', alignItems: 'center', ...extra });
  const text = (size: number, o: { bold?: boolean; italic?: boolean } = {}): CSSProperties => ({
    fontSize: pt(size), fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', lineHeight: 1.15,
  });

  // Chữ ký + con dấu: khung chuẩn 280×112 (px Excel) đặt giữa khối ký, thu theo tỉ lệ trang
  const stampH = pt(SIGN_ROW_PT * SIGN_ROWS);
  const box = { x: (signW - STAMP_BOX.w * k) / 2, y: (stampH - STAMP_BOX.h * k) / 2 };
  const { sig, seal } = stampBoxes(images.layout, STAMP_BOX);
  const imgAt = (src: string, r: { x: number; y: number; w: number; h: number }, key: string) => (
    <img key={key} src={src} alt="" style={{ position: 'absolute', left: box.x + r.x * k, top: box.y + r.y * k, width: r.w * k, height: r.h * k, objectFit: 'contain' }} />
  );
  const stampOrder = images.layout.sealOnTop === false ? ['seal', 'sig'] : ['sig', 'seal'];

  const cell = (i: number, last: boolean, head: boolean): CSSProperties => ({
    // Lề ô sát như Excel (cột giữa chỉ ~1px) — rộng hơn là tiêu đề cột dài bị xuống dòng, khác bản Excel
    width: colW[i], padding: `0 ${doc.columns[i].align === 'left' && !head ? 9 * k : 1}px`, whiteSpace: head ? 'nowrap' : 'normal',
    borderTop: '1px solid #000', borderBottom: '1px solid #000',
    borderLeft: i === 0 ? 'none' : '1px solid #000', borderRight: last ? 'none' : '1px solid #000',
    textAlign: head ? 'center' : doc.columns[i].align, verticalAlign: 'middle', wordBreak: 'break-word',
  });

  return (
    <div style={{ width: PAGE_W, minHeight: PAGE_H, padding: `${PAD_T}px ${PAD_X}px`, boxSizing: 'border-box', background: '#fff', color: '#000', fontFamily: FONT }}>
      <div style={{ border: `${THICK}px solid #000`, boxSizing: 'border-box', width: cw }}>
        {/* Đầu trang: logo · tên pháp nhân · địa chỉ · điện thoại (cỡ / vị trí theo doc.header — giống hệt file Excel) */}
        <div data-pdf-block style={{ position: 'relative', display: 'flex', borderBottom: `${MEDIUM}px solid #000`, height: pt(g.padTop + g.nameH + 2 * g.lineH + g.tail) }}>
          <div style={{ width: logoW, flexShrink: 0 }} />
          <div style={{
            flex: 1, minWidth: 0, paddingTop: pt(g.padTop), textAlign: g.align,
            paddingLeft: g.align === 'left' ? indentPx : 0, paddingRight: g.align === 'right' ? indentPx : 0,
          }}>
            {([[doc.companyName, g.nameH, g.nameSize, true], [doc.address, g.lineH, g.lineSize, false], [doc.phone, g.lineH, g.lineSize, true]] as const).map(([t, h, sz, bold], i) => (
              <div key={i} style={{ ...line(h, text(sz, { bold })), justifyContent: g.align === 'center' ? 'center' : g.align === 'right' ? 'flex-end' : 'flex-start' }}>{t}</div>
            ))}
          </div>
          {images.logo && (
            <img src={images.logo} alt="" style={{ position: 'absolute', left: g.logo.x * k, top: g.logo.y * k, width: g.logo.w * k, height: g.logo.h * k, objectFit: 'contain', objectPosition: 'left top' }} />
          )}
        </div>
        <div style={{ height: pt(g.titleGap) }} />
        <div style={line(g.titleH, { ...text(g.titleSize, { bold: true }), justifyContent: 'center', textAlign: 'center' })}>{doc.title}</div>
        {doc.recipient && <div style={line(22, { ...text(13, { bold: true }), justifyContent: 'center', textAlign: 'center' })}>{doc.recipient}</div>}
        {doc.visit && <div style={{ ...text(12, { italic: true }), minHeight: pt(22), display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: `0 ${12 * k}px` }}>{doc.visit}</div>}
        <div style={{ height: pt(7.5) }} />

        {/* Bảng */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr data-pdf-block style={{ height: pt(33.75) }}>
              {doc.columns.map((c, i) => <th key={c.key} style={{ ...cell(i, i === doc.columns.length - 1, true), ...text(13, { bold: true }) }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {doc.rows.map(r => (
              <tr key={r.memberId} data-pdf-block style={{ height: pt(42) }}>
                {doc.columns.map((c, i) => (
                  <td key={c.key} style={{ ...cell(i, i === doc.columns.length - 1, false), ...text(c.key === 'name' ? 13 : 12, { bold: !!c.bold }) }}>{r[c.key]}</td>
                ))}
              </tr>
            ))}
            {doc.rows.length === 0 && (
              <tr style={{ height: pt(42) }}>
                <td colSpan={doc.columns.length} style={{ ...text(12, { italic: true }), textAlign: 'center', color: '#888', borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>Chưa chọn người tham dự</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Ngày ký + khối ký */}
        <div style={{ height: pt(13.5) }} />
        <div data-pdf-block style={{ marginLeft: signLeft, width: signW, textAlign: 'center' }}>
          <div style={line(16, { ...text(12, { italic: true }), justifyContent: 'center' })}>{doc.dateLine}</div>
          <div style={{ height: pt(8) }} />
          <div style={line(21.75, { ...text(13, { bold: true }), justifyContent: 'center' })}>{doc.signCompany}</div>
          <div style={line(15, { ...text(11, { italic: true }), justifyContent: 'center' })}>{SIGN_HINT}</div>
          <div style={{ position: 'relative', height: stampH }}>
            {stampOrder.map(kd => (kd === 'sig'
              ? (images.signature ? imgAt(images.signature, sig, 'sig') : null)
              : (images.seal ? imgAt(images.seal, seal, 'seal') : null)))}
          </div>
          {doc.signerName && <div style={line(21.75, { ...text(13, { bold: true }), justifyContent: 'center' })}>{doc.signerName}</div>}
          <div style={{ height: pt(21.75) }} />
        </div>
      </div>
    </div>
  );
}
