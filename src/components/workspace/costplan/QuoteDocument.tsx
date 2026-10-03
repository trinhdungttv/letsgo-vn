// Tài liệu báo giá khổ A4 — DÙNG CHUNG cho xem trước, in và xuất PDF nên cả 3 nơi giống hệt nhau.
// Mọi kích thước dùng px cố định theo A4 (794 × 1123 px ở 96 dpi) và style nội tuyến để kết quả không phụ thuộc CSS của trang.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Bi, DocView } from '../../../lib/costPlan/quoteDoc';
import { DEFAULT_LAYOUT, stampBoxes, type StampLayout } from '../../../lib/costPlan/entity';

export const A4_W = 794;
export const A4_H = 1123;
/** Thu nhỏ chữ tối đa còn 80% để vừa 1 trang; dôi ra nhiều hơn thì để sang trang 2 */
export const MIN_FIT = 0.8;

/** Tỉ lệ thu nhỏ để nội dung cao `natural` px vừa đúng 1 trang A4 (1 = không cần). Dài quá (cần thu < MIN_FIT) thì không thu. */
export function fitScale(natural: number): number {
  if (natural <= A4_H + 1) return 1;
  const f = A4_H / natural;
  return f >= MIN_FIT ? Math.floor(f * 1000) / 1000 : 1;
}
const NAVY = '#0c2340';
const INK = '#1d1d1f';
const GREY = '#6b6b70';
const LINE = '#d9dbe0';
const FONT_DOC = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', Arial, sans-serif`;

const money = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** Dòng chính + dòng phụ nhỏ hơn, xám hơn (bản song ngữ). */
function B({ t, size = 13, weight = 400, sub = 0.82, color = INK, style }: { t: Bi; size?: number; weight?: number; sub?: number; color?: string; style?: CSSProperties }) {
  return (
    <div style={style}>
      <div style={{ fontSize: size, fontWeight: weight, color }}>{t.a}</div>
      {t.b ? <div style={{ fontSize: size * sub, fontWeight: 400, color: GREY, marginTop: 1 }}>{t.b}</div> : null}
    </div>
  );
}

function Heading({ n, t }: { n: number; t: Bi }) {
  return (
    <div data-pdf-block data-pdf-keep="46" style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '13px 0 6px', breakAfter: 'avoid' }}>
      <span style={{ width: 22, height: 22, borderRadius: 11, background: NAVY, color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', transform: 'translateY(2px)' }}>{n}</span>
      <span style={{ fontSize: 14.5, fontWeight: 700, color: NAVY, letterSpacing: 0.2 }}>{t.a}</span>
      {t.b ? <span style={{ fontSize: 12, color: GREY }}>/ {t.b}</span> : null}
    </div>
  );
}

export interface DocImages { logo?: string | null; signature?: string | null; seal?: string | null }

export default function QuoteDocument({ view, images, layout = DEFAULT_LAYOUT, showSignature, showSeal, autoFit = true, onFit }: {
  view: DocView; images: DocImages; showSignature: boolean; showSeal: boolean;
  /** Cách căn chữ ký / con dấu của pháp nhân */
  layout?: StampLayout;
  /** Tự thu nhỏ chữ (tối đa còn 80%) để vừa 1 trang; tắt thì để chữ nguyên cỡ và sang trang 2 khi dài */
  autoFit?: boolean;
  /** Báo tỉ lệ thu nhỏ đang áp dụng (1 = giữ nguyên cỡ chữ) */
  onFit?: (f: number) => void;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [f, setF] = useState(1);
  // Đo chiều cao tự nhiên (ở khổ A4 không thu nhỏ) rồi tính tỉ lệ vừa 1 trang. Đo bằng cách tạm đặt style gốc rồi trả lại ngay
  // trong cùng 1 lượt layout (trình duyệt chưa kịp vẽ) nên không nhấp nháy.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const w = el.style.width, t = el.style.transform;
    el.style.width = `${A4_W}px`; el.style.transform = 'none';
    const natural = el.offsetHeight;
    el.style.width = w; el.style.transform = t;
    const next = autoFit ? fitScale(natural) : 1;
    setF(prev => (Math.abs(prev - next) > 0.0005 ? next : prev));
    onFit?.(next);
  });
  const L = view.labels;
  const th: CSSProperties = { padding: '6px 8px', background: NAVY, color: '#fff', fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', border: `1px solid ${NAVY}` };
  const td: CSSProperties = { padding: '5px 8px', border: `1px solid ${LINE}`, verticalAlign: 'middle' };
  const sign = showSignature && !!images.signature;
  const seal = showSeal && !!images.seal;
  const SIGN_BOX = { w: 280, h: 92 };
  const boxes = stampBoxes(layout, SIGN_BOX);

  return (
    <div style={{ width: A4_W, height: f < 1 ? A4_H : undefined, minHeight: A4_H, overflow: f < 1 ? 'hidden' : undefined, background: '#fff' }}>
    <div ref={innerRef} style={{ width: f < 1 ? A4_W / f : A4_W, transform: f < 1 ? `scale(${f})` : undefined, transformOrigin: 'top left', minHeight: f < 1 ? undefined : A4_H, boxSizing: 'border-box', padding: '34px 50px 30px', background: '#fff', color: INK, fontFamily: FONT_DOC, fontSize: 12.5, lineHeight: 1.45, position: 'relative' }}>
      {/* Đầu trang: logo + thông tin công ty */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 10, borderBottom: `2.5px solid ${NAVY}` }}>
        {images.logo ? <img src={images.logo} alt="" style={{ maxHeight: 62, maxWidth: 150, objectFit: 'contain', flex: 'none' }} /> : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.3 }}>{view.company.name}</div>
          {view.company.lines.map((l, i) => <div key={i} style={{ fontSize: 11, color: GREY }}>{l}</div>)}
        </div>
      </div>

      {/* Tiêu đề */}
      <div style={{ textAlign: 'center', margin: '14px 0 2px' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, letterSpacing: 0.6 }}>{view.title.a}</div>
        {view.title.b ? <div style={{ fontSize: 14, color: GREY, marginTop: 2 }}>{view.title.b}</div> : null}
        <div style={{ fontSize: 12, color: GREY, marginTop: 6 }}>
          {view.number ? <span>{L.number.a}: <b style={{ color: INK }}>{view.number}</b></span> : null}
          {view.number && view.dateText ? <span style={{ margin: '0 10px' }}>·</span> : null}
          {view.dateText ? <span>{L.date.a}: <b style={{ color: INK }}>{view.dateText}</b></span> : null}
        </div>
      </div>

      {/* Khách hàng */}
      <div data-pdf-block style={{ margin: '10px 0 0', padding: '7px 12px', background: '#f6f7f9', borderLeft: `3px solid ${NAVY}`, borderRadius: 3 }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ color: GREY }}>{L.to.a}{L.to.b ? ` / ${L.to.b}` : ''}: </span>
          <b style={{ fontSize: 14.5 }}>{view.customer.name || '………………………………………'}</b>
        </div>
        {view.customer.rows.map((r, i) => (
          <div key={i} style={{ fontSize: 11.5, color: '#3a3a3f', marginTop: 1 }}>
            <span style={{ color: GREY }}>{r.label.a}{r.label.b ? ` / ${r.label.b}` : ''}: </span>{r.value}
          </div>
        ))}
      </div>

      {/* Lời mở đầu */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12.5 }}>{view.intro.a}</div>
        {view.intro.b ? <div style={{ fontSize: 11.5, color: GREY, marginTop: 1 }}>{view.intro.b}</div> : null}
      </div>

      {/* 1. Nội dung dịch vụ */}
      <Heading n={1} t={L.s1} />
      <div style={{ paddingLeft: 4 }}>
        {view.serviceLines.map((l, i) => (
          <div key={i} data-pdf-block style={{ display: 'flex', gap: 9, marginBottom: 2, breakInside: 'avoid' }}>
            <span style={{ color: NAVY, fontWeight: 700 }}>–</span>
            <B t={l} size={12.5} sub={0.9} />
          </div>
        ))}
      </div>

      {/* 2. Bảng giá */}
      <Heading n={2} t={L.s2} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, tableLayout: 'fixed' }}>
        <colgroup><col style={{ width: 44 }} /><col /><col style={{ width: 138 }} /><col style={{ width: 118 }} /></colgroup>
        <thead>
          <tr>
            {([L.thNo, L.thDesc, L.thUnit, L.thPrice] as Bi[]).map((h, i) => (
              <th key={i} style={th}><div style={{ fontSize: 11.5 }}>{h.a}</div>{h.b ? <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>{h.b}</div> : null}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r, i) => (
            <tr key={i} data-pdf-block style={{ breakInside: 'avoid', background: i % 2 ? '#f8f9fb' : '#fff' }}>
              <td style={{ ...td, textAlign: 'center', color: GREY }}>{r.no}</td>
              <td style={td}><B t={r.name} size={12.5} sub={0.86} /></td>
              <td style={{ ...td, textAlign: 'center' }}><B t={r.unit} size={11.5} sub={0.9} style={{ textAlign: 'center' }} /></td>
              <td style={{ ...td, textAlign: 'right', fontSize: 14, fontWeight: 700, color: NAVY, fontVariantNumeric: 'tabular-nums' }}>{money(r.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.includedNote ? (
        <div data-pdf-block style={{ marginTop: 7, padding: '6px 10px', background: '#f6f7f9', borderLeft: `3px solid ${NAVY}`, fontSize: 11.5, fontStyle: 'italic', color: '#3a3a3f' }}>{view.includedNote}</div>
      ) : null}

      {/* Ghi chú */}
      {view.notes.length > 0 && (
        <div data-pdf-block style={{ marginTop: 10, breakInside: 'avoid' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, marginBottom: 2 }}>{L.notes.a}{L.notes.b ? ` / ${L.notes.b}` : ''}:</div>
          {view.notes.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
              <span style={{ color: GREY }}>–</span>
              <B t={n} size={11.5} sub={0.92} />
            </div>
          ))}
        </div>
      )}

      {/* Lời kết + hiệu lực + chữ ký */}
      <div data-pdf-block style={{ marginTop: 12, breakInside: 'avoid' }}>
        <B t={view.closing} size={12.5} sub={0.92} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, marginTop: 8 }}>
          <div style={{ flex: 1, paddingTop: 4 }}>
            {view.validText ? <B t={view.validText} size={11.5} sub={0.92} style={{ fontStyle: 'italic' }} /> : null}
          </div>
          <div style={{ width: 280, textAlign: 'center', flex: 'none' }}>
            <div style={{ fontSize: 12, fontStyle: 'italic', color: '#3a3a3f' }}>{view.placeDate.a}</div>
            {view.placeDate.b ? <div style={{ fontSize: 10.5, color: GREY, fontStyle: 'italic' }}>{view.placeDate.b}</div> : null}
            <div style={{ fontSize: 12.5, fontWeight: 800, color: NAVY, marginTop: 6, letterSpacing: 0.3 }}>{view.signer.title.a}</div>
            {view.signer.title.b ? <div style={{ fontSize: 10, color: GREY }}>{view.signer.title.b}</div> : null}
            {view.signer.role ? <div style={{ fontSize: 11, color: GREY, fontStyle: 'italic' }}>({view.signer.role})</div> : null}

            {/* Vùng ký + đóng dấu: để trống đủ chỗ ký tay khi không chèn ảnh */}
            <div style={{ position: 'relative', width: SIGN_BOX.w, height: SIGN_BOX.h, marginTop: 0 }}>
              {/* thứ tự vẽ = thứ tự chồng: cái vẽ sau nằm trên. Mặc định ký trước, đóng dấu sau → dấu nằm trên chữ ký */}
              {(layout.sealOnTop === false ? ['seal', 'sig'] : ['sig', 'seal']).map(k => (k === 'sig'
                ? (sign ? <img key="sig" src={images.signature!} alt="" style={{ position: 'absolute', left: boxes.sig.x, top: boxes.sig.y, width: boxes.sig.w, height: boxes.sig.h, objectFit: 'contain' }} /> : null)
                : (seal ? <img key="seal" src={images.seal!} alt="" style={{ position: 'absolute', left: boxes.seal.x, top: boxes.seal.y, width: boxes.seal.w, height: boxes.seal.h, objectFit: 'contain' }} /> : null)))}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{view.signer.name}</div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

