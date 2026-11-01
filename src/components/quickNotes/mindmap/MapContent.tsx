// Vẽ sơ đồ (phần nội dung — cũng là phần được xuất ra ảnh): vùng bao, đường nhánh, ngoặc tóm tắt, đường liên kết,
// chủ đề, nút đếm nhánh đang thu gọn. Phần chọn / kéo thả / nút −  nằm ở lớp riêng trong MindMapEditor.
import { canvasMeasure, fontString, type MapLayout, type TopicBox } from '../../../lib/quickNotes/mindmap/layout';
import type { MindTheme } from '../../../lib/quickNotes/mindmap/themes';
import { MarkerGlyph, TopicIcon } from './MarkerIcon';

export const SELECT_COLOR = '#2C7BF6';

export function shapeRadius(b: Pick<TopicBox, 'shape' | 'bh' | 'depth'>): number {
  if (b.shape === 'pill') return b.bh / 2;
  if (b.shape === 'rect') return 2;
  return Math.min(b.depth === 0 ? 12 : 9, b.bh * 0.3);
}

function TopicShapeEl({ b }: { b: TopicBox }) {
  if (b.shape === 'ellipse') {
    return <ellipse cx={b.bx + b.bw / 2} cy={b.by + b.bh / 2} rx={b.bw / 2} ry={b.bh / 2} fill={b.fill ?? 'transparent'} stroke={b.stroke ?? 'none'} strokeWidth={b.strokeW} />;
  }
  if (b.shape === 'underline') {
    return (
      <>
        <rect x={b.bx} y={b.by} width={b.bw} height={b.bh} rx={4} fill={b.fill ?? 'transparent'} />
        <line x1={b.bx} y1={b.by + b.bh} x2={b.bx + b.bw} y2={b.by + b.bh} stroke={b.stroke ?? b.color} strokeWidth={b.strokeW || 2} strokeLinecap="round" />
      </>
    );
  }
  if (b.shape === 'none') return <rect x={b.bx} y={b.by} width={b.bw} height={b.bh} rx={4} fill={b.fill ?? 'transparent'} />;
  const inset = b.strokeW ? b.strokeW / 2 : 0;
  return (
    <rect x={b.bx + inset} y={b.by + inset} width={b.bw - 2 * inset} height={b.bh - 2 * inset} rx={shapeRadius(b)}
      fill={b.fill ?? 'transparent'} stroke={b.stroke ?? 'none'} strokeWidth={b.strokeW} />
  );
}

export function TopicText({ b, opacity = 1 }: { b: TopicBox; opacity?: number }) {
  return (
    <text x={b.textCx} textAnchor="middle" fill={b.textColor} fontFamily={b.family} fontSize={b.size} fontWeight={b.weight}
      fontStyle={b.italic ? 'italic' : undefined} textDecoration={b.strike ? 'line-through' : undefined} opacity={opacity}
      style={{ whiteSpace: 'pre' }}>
      {b.lines.map((l, i) => (
        <tspan key={i} x={b.textCx} y={b.textTop + b.lineH * i + b.lineH / 2 + b.size * 0.35}>{l || ' '}</tspan>
      ))}
    </text>
  );
}

function TopicNode({ b, theme, editing }: { b: TopicBox; theme: MindTheme; editing: boolean }) {
  return (
    <g data-hit={`topic:${b.id}`} style={{ cursor: 'default' }}>
      <TopicShapeEl b={b} />
      {b.markers.map(m => (
        <g key={m.id} data-hit={`marker:${b.id}:${m.id}`} style={{ cursor: 'pointer' }}>
          <MarkerGlyph id={m.id} x={m.x} y={m.y} s={m.s} />
        </g>
      ))}
      {!editing && <TopicText b={b} />}
      {b.icons.map(ic => (
        <g key={ic.kind} data-hit={`icon:${b.id}:${ic.kind}`} style={{ cursor: 'pointer' }}>
          <rect x={ic.x - 2} y={ic.y - 2} width={ic.s + 4} height={ic.s + 4} fill="transparent" />
          <TopicIcon kind={ic.kind} x={ic.x} y={ic.y} s={ic.s} color={b.textColor} />
        </g>
      ))}
      {b.labels.map((l, i) => (
        <g key={i}>
          <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={l.h / 2} fill={theme.labelBg} />
          <text x={l.x + l.w / 2} y={l.y + l.h / 2 + 3.8} textAnchor="middle" fontSize={11} fontWeight={500} fontFamily={b.family} fill={theme.labelText}>{l.text}</text>
        </g>
      ))}
    </g>
  );
}

export default function MapContent({ layout, theme, editingId }: { layout: MapLayout; theme: MindTheme; editingId: string | null }) {
  const family = layout.boxes[0]?.family ?? 'sans-serif';
  const relFont = fontString(false, 500, 12, family);
  return (
    <g data-layer="content">
      {layout.boundaries.map(bd => (
        <g key={bd.id}>
          <rect x={bd.x} y={bd.y} width={bd.w} height={bd.h} rx={14} fill={bd.color} fillOpacity={0.07}
            stroke={bd.color} strokeOpacity={0.75} strokeWidth={1.5} strokeDasharray="7 5" />
          <rect data-hit={`boundary:${bd.id}`} x={bd.x} y={bd.y} width={bd.w} height={bd.h} rx={14} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} />
          {bd.text && (
            <text data-hit={`boundary:${bd.id}`} x={bd.x + 12} y={bd.y + 16} fontSize={12} fontWeight={700} fontFamily={family} fill={bd.color} style={{ cursor: 'pointer' }}>{bd.text}</text>
          )}
        </g>
      ))}

      {layout.connectors.map(c => (c.filled
        ? <path key={c.id} d={c.d} fill={c.color} />
        : <path key={c.id} d={c.d} fill="none" stroke={c.color} strokeWidth={c.width} strokeLinecap="round" strokeLinejoin="round" />))}

      {layout.axis && (
        <g>
          <path d={layout.axis} stroke={theme.lineColor ?? theme.mono} strokeWidth={3.5} strokeLinecap="round" fill="none" />
          {(() => {
            const m = layout.axis.match(/H(-?[\d.]+)/);
            const x = m ? Number(m[1]) : 0;
            return <path d={`M${x - 2},-7L${x + 10},0L${x - 2},7Z`} fill={theme.lineColor ?? theme.mono} />;
          })()}
        </g>
      )}

      {layout.braces.map(br => <path key={br.id} d={br.d} fill="none" stroke={br.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />)}

      {layout.relations.map(r => {
        const tw = r.text ? canvasMeasure(r.text, relFont) + 12 : 0;
        return (
          <g key={r.id}>
            <path d={r.d} fill="none" stroke={theme.relation} strokeWidth={1.6} strokeDasharray="6 5" strokeLinecap="round" />
            <path d={r.arrow} fill="none" stroke={theme.relation} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            <path data-hit={`rel:${r.id}`} d={r.d} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} />
            {r.text && (
              <g data-hit={`rel:${r.id}`} style={{ cursor: 'pointer' }}>
                <rect x={r.label.x - tw / 2} y={r.label.y - 10} width={tw} height={20} rx={6} fill={theme.bg} fillOpacity={0.92} />
                <text x={r.label.x} y={r.label.y + 4.2} textAnchor="middle" fontSize={12} fontWeight={500} fontFamily={family} fill={theme.relation}>{r.text}</text>
              </g>
            )}
          </g>
        );
      })}

      {layout.boxes.map(b => <TopicNode key={b.id} b={b} theme={theme} editing={editingId === b.id} />)}

      {layout.boxes.filter(b => b.toggle && b.hidden > 0).map(b => (
        <g key={b.id} data-hit={`toggle:${b.id}`} style={{ cursor: 'pointer' }}>
          <circle cx={b.toggle!.x} cy={b.toggle!.y} r={b.hidden > 99 ? 11 : 9.5} fill={theme.bg} stroke={b.color} strokeWidth={1.5} />
          <text x={b.toggle!.x} y={b.toggle!.y + 3.6} textAnchor="middle" fontSize={b.hidden > 99 ? 9 : 10.5} fontWeight={700} fontFamily={family} fill={b.color}>
            {b.hidden > 99 ? '99+' : b.hidden}
          </text>
        </g>
      ))}
    </g>
  );
}
