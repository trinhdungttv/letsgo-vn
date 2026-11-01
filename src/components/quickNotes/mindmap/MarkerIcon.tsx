// Biểu tượng (marker) của chủ đề — vẽ bằng SVG để hiện giống nhau trên mọi máy và khi xuất ảnh.
import { MARKER_COLORS, PRIORITY_COLORS } from '../../../lib/quickNotes/mindmap/themes';

const STAR = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
};

/** 1 biểu tượng vẽ trong ô vuông (x, y, s). */
export function MarkerGlyph({ id, x, y, s }: { id: string; x: number; y: number; s: number }) {
  const [group, v] = id.split('-');
  const c = s / 2;
  const t = `translate(${x} ${y}) scale(${s / 20})`;

  if (group === 'priority') {
    const n = Number(v) || 1;
    return (
      <g transform={t}>
        <circle cx={10} cy={10} r={9.5} fill={PRIORITY_COLORS[(n - 1) % PRIORITY_COLORS.length]} />
        <text x={10} y={14.2} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff" fontFamily="-apple-system, Segoe UI, Roboto, sans-serif">{n}</text>
      </g>
    );
  }
  if (group === 'task') {
    const p = Math.max(0, Math.min(100, Number(v) || 0));
    const green = '#30A46C';
    if (p >= 100) {
      return (
        <g transform={t}>
          <circle cx={10} cy={10} r={9.5} fill={green} />
          <path d="M5.6 10.4l3 3 5.8-6.4" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    }
    const a = (p / 100) * Math.PI * 2;
    const ex = 10 + 9 * Math.sin(a);
    const ey = 10 - 9 * Math.cos(a);
    return (
      <g transform={t}>
        <circle cx={10} cy={10} r={9} fill="#fff" stroke={green} strokeWidth={1.6} />
        {p > 0 && <path d={`M10 10L10 1A9 9 0 ${p > 50 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}Z`} fill={green} />}
      </g>
    );
  }
  if (group === 'flag') {
    const col = MARKER_COLORS[v] ?? MARKER_COLORS.red;
    return (
      <g transform={t}>
        <path d="M4.5 2.5v16" stroke="#6E6E73" strokeWidth={1.8} strokeLinecap="round" />
        <path d="M5.5 3h11l-2.6 4.2L16.5 11.5h-11z" fill={col} />
      </g>
    );
  }
  if (group === 'star') {
    return (
      <g transform={t}>
        <polygon points={STAR(10, 10.6, 9.4)} fill={MARKER_COLORS[v] ?? MARKER_COLORS.yellow} strokeLinejoin="round" />
      </g>
    );
  }
  if (group === 'people') {
    const col = MARKER_COLORS[v] ?? MARKER_COLORS.blue;
    return (
      <g transform={t}>
        <circle cx={10} cy={10} r={9.5} fill={col} />
        <circle cx={10} cy={7.6} r={3.2} fill="#fff" />
        <path d="M4.6 16.4c.8-3.2 3-4.8 5.4-4.8s4.6 1.6 5.4 4.8" fill="#fff" />
      </g>
    );
  }
  if (group === 'smiley') {
    const mouth: Record<string, string> = {
      smile: 'M6.2 11.6c1 2 2.4 2.9 3.8 2.9s2.8-.9 3.8-2.9',
      laugh: 'M5.8 11h8.4c-.4 2.8-2.2 4.2-4.2 4.2S6.2 13.8 5.8 11z',
      love: 'M6.4 12c1 1.8 2.2 2.6 3.6 2.6s2.6-.8 3.6-2.6',
      surprise: '',
      sad: 'M6.4 14.6c1-1.6 2.2-2.4 3.6-2.4s2.6.8 3.6 2.4',
      angry: 'M6.6 14.4h6.8',
    };
    const kind = v ?? 'smile';
    return (
      <g transform={t}>
        <circle cx={10} cy={10} r={9.5} fill={kind === 'angry' ? '#FF8A5B' : '#FFC93C'} />
        {kind === 'love' ? (
          <>
            <path d="M5 7.2c0-1.2 1.6-1.6 2-.4.4-1.2 2-.8 2 .4 0 1-2 2.2-2 2.2S5 8.2 5 7.2z" fill="#E5484D" />
            <path d="M11 7.2c0-1.2 1.6-1.6 2-.4.4-1.2 2-.8 2 .4 0 1-2 2.2-2 2.2S11 8.2 11 7.2z" fill="#E5484D" />
          </>
        ) : (
          <>
            <circle cx={7} cy={8} r={1.3} fill="#4A3300" />
            <circle cx={13} cy={8} r={1.3} fill="#4A3300" />
          </>
        )}
        {kind === 'angry' && <path d="M5.2 5.4l3 1.4M14.8 5.4l-3 1.4" stroke="#4A3300" strokeWidth={1.2} strokeLinecap="round" />}
        {kind === 'surprise' ? <ellipse cx={10} cy={13.4} rx={2} ry={2.4} fill="#4A3300" />
          : <path d={mouth[kind] ?? mouth.smile} fill={kind === 'laugh' ? '#4A3300' : 'none'} stroke="#4A3300" strokeWidth={1.4} strokeLinecap="round" />}
      </g>
    );
  }
  if (group === 'sym') {
    const map: Record<string, [string, string]> = {
      check: ['#30A46C', '✓'], cross: ['#E5484D', '✕'], question: ['#0090FF', '?'], exclaim: ['#F76B15', '!'], info: ['#0090FF', 'i'], idea: ['#F5B400', ''],
    };
    const [bg, ch] = map[v] ?? map.check;
    if (v === 'idea') {
      return (
        <g transform={t}>
          <circle cx={10} cy={10} r={9.5} fill={bg} />
          <path d="M10 4.2a4.3 4.3 0 0 0-2.6 7.7c.5.4.8.9.8 1.5V14h3.6v-.6c0-.6.3-1.1.8-1.5A4.3 4.3 0 0 0 10 4.2z" fill="#fff" />
          <rect x={8.2} y={14.8} width={3.6} height={1.6} rx={0.6} fill="#fff" />
        </g>
      );
    }
    return (
      <g transform={t}>
        <circle cx={10} cy={10} r={9.5} fill={bg} />
        <text x={10} y={14.4} textAnchor="middle" fontSize={v === 'info' ? 13 : 12.5} fontWeight={800} fill="#fff" fontFamily="-apple-system, Segoe UI, Roboto, sans-serif">{ch}</text>
      </g>
    );
  }
  if (group === 'arrow') {
    const rot: Record<string, number> = { up: 0, right: 90, down: 180, left: 270 };
    return (
      <g transform={t}>
        <circle cx={10} cy={10} r={9.5} fill="#5B6B83" />
        {v === 'refresh' ? (
          <path d="M14.2 7.6A4.8 4.8 0 1 0 14.8 11M14.6 4.4v3.4h-3.4" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M10 4.6v10.8M5.6 9l4.4-4.4L14.4 9" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" transform={`rotate(${rot[v] ?? 0} 10 10)`} />
        )}
      </g>
    );
  }
  return <circle cx={x + c} cy={y + c} r={c * 0.9} fill="#C7C7CC" />;
}

/** Biểu tượng nhỏ trong bảng chọn (thẻ <svg> riêng). */
export function MarkerIcon({ id, size = 20 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <MarkerGlyph id={id} x={0} y={0} s={20} />
    </svg>
  );
}

/** Ghi chú / liên kết URL gắn trên chủ đề. */
export function TopicIcon({ kind, x, y, s, color }: { kind: 'note' | 'link'; x: number; y: number; s: number; color: string }) {
  const t = `translate(${x} ${y}) scale(${s / 20})`;
  if (kind === 'note') {
    return (
      <g transform={t} opacity={0.75}>
        <rect x={3.5} y={2.5} width={13} height={15} rx={2.2} fill="none" stroke={color} strokeWidth={1.7} />
        <path d="M6.6 7h6.8M6.6 10.2h6.8M6.6 13.4h4.2" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g transform={t} opacity={0.75}>
      <path d="M8.6 11.4a3.6 3.6 0 0 0 5.2.2l2.4-2.4a3.6 3.6 0 0 0-5.1-5.1l-1 1" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M11.4 8.6a3.6 3.6 0 0 0-5.2-.2l-2.4 2.4a3.6 3.6 0 0 0 5.1 5.1l1-1" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </g>
  );
}
