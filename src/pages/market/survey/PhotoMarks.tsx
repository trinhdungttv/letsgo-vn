// Vẽ lớp ghi chú (nét bút / khoanh / mũi tên / chữ) chồng khít lên ảnh chỉ tiêu — ảnh gốc không bị sửa.
import type { CSSProperties, ReactNode } from 'react';
import { arrowHead, MARK_W, type PhotoMark, type Pt } from '../../../lib/kcnSurvey/markup';
import { useImageBox } from './useImageBox';

interface SvgProps {
  marks: readonly PhotoMark[];
  /** cao / ngang của ảnh */
  aspect: number;
  /** 'fill' = khung SVG đúng bằng ảnh; 'cover' = ảnh bị cắt vuông (lưới ảnh nhỏ) → cắt theo cùng kiểu */
  fit?: 'fill' | 'cover';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  svgRef?: React.Ref<SVGSVGElement>;
  onPointerDown?: React.PointerEventHandler<SVGSVGElement>;
  onPointerMove?: React.PointerEventHandler<SVGSVGElement>;
  onPointerUp?: React.PointerEventHandler<SVGSVGElement>;
}

export function MarksSvg({ marks, aspect, fit = 'fill', className, style, children, svgRef, onPointerDown, onPointerMove, onPointerUp }: SvgProps) {
  const H = MARK_W * aspect;
  const X = (x: number) => x * MARK_W;
  const Y = (y: number) => y * H;
  const pts = (p: readonly Pt[]) => p.map(q => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ');
  return (
    <svg ref={svgRef} viewBox={`0 0 ${MARK_W} ${H.toFixed(1)}`} preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'none'}
      className={className} style={style} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {marks.map((m, i) => {
        if (m.t === 'text') {
          const fs = m.s * MARK_W;
          return (
            <text key={i} x={X(m.x)} y={Y(m.y)} fontSize={fs} fontWeight={700} fill={m.c} textAnchor="middle" dominantBaseline="middle"
              stroke="rgba(0,0,0,0.75)" strokeWidth={fs * 0.14} paintOrder="stroke" style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}>{m.text}</text>
          );
        }
        const sw = m.w * MARK_W;
        const common = { stroke: m.c, strokeWidth: sw, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
        const shadow = { stroke: 'rgba(0,0,0,0.35)', strokeWidth: sw + 4, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
        if (m.t === 'pen') {
          return <g key={i}><polyline points={pts(m.p)} {...shadow} /><polyline points={pts(m.p)} {...common} /></g>;
        }
        if (m.t === 'ellipse') {
          const cx = X((m.a[0] + m.b[0]) / 2), cy = Y((m.a[1] + m.b[1]) / 2);
          const rx = Math.abs(X(m.b[0]) - X(m.a[0])) / 2, ry = Math.abs(Y(m.b[1]) - Y(m.a[1])) / 2;
          return <g key={i}><ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...shadow} /><ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...common} /></g>;
        }
        const [w1, w2] = arrowHead(m.a, m.b, m.w, aspect);
        const d = `M${X(m.a[0])},${Y(m.a[1])} L${X(m.b[0])},${Y(m.b[1])} M${X(w1[0])},${Y(w1[1])} L${X(m.b[0])},${Y(m.b[1])} L${X(w2[0])},${Y(w2[1])}`;
        return <g key={i}><path d={d} {...shadow} /><path d={d} {...common} /></g>;
      })}
      {children}
    </svg>
  );
}

/** Ảnh + lớp ghi chú chồng khít. Khung ngoài nên có kích thước cố định (ảnh tự thu vừa khung). */
export function MarkedImage({ src, alt, marks, className = '', imgClassName = '' }: { src: string; alt: string; marks: readonly PhotoMark[]; className?: string; imgClassName?: string }) {
  const { imgRef, box, measure } = useImageBox();
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <img ref={imgRef} src={src} alt={alt} onLoad={measure} className={`max-w-full max-h-full object-contain ${imgClassName}`} />
      {box && marks.length > 0 && (
        <MarksSvg marks={marks} aspect={box.aspect} className="absolute pointer-events-none" style={{ left: box.l, top: box.t, width: box.w, height: box.h }} />
      )}
    </div>
  );
}
