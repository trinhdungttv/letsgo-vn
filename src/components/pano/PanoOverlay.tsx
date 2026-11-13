// Lớp phủ trên ảnh 360°: nét vẽ của người dùng (nhãn / đường / vùng), nét đang vẽ dở, ghim các công ty / dự án ở gần
// (đặt theo phương vị thật + hướng Bắc đã căn), và la bàn "radar" góc dưới trái. Mọi vị trí tính lại mỗi khung hình
// từ lib/pano/sphere.ts nên khớp đúng phép chiếu của WebGL.
import { Fragment } from 'react';
import { Camera } from 'lucide-react';
import {
  compassAt, dirName, fmtDistance, placeInPano, project, projectPath, wrap360, type PanoView, type SphPt,
} from '../../lib/pano/sphere';
import { shapeAnchor, type PanoShape } from '../../lib/pano/annotations';

export interface NearbyItem {
  id: string;
  kind: 'point' | 'pano';
  name: string;
  sub: string;
  color: string;
  groupLabel: string;
  lat: number;
  lng: number;
  dist: number;
  bearing: number;
  onOpen?: () => void;
}

const LABEL_FONT = 13;

export function PanoShapesLayer({ v, shapes, selected, editing, draft, hover }: {
  v: PanoView;
  shapes: PanoShape[];
  selected: string | null;
  editing: boolean;
  draft: { kind: 'line' | 'area'; pts: SphPt[] } | null;
  hover: SphPt | null;
}) {
  const inView = (p: { x: number; y: number } | null, m = 40): p is { x: number; y: number } =>
    !!p && p.x > -m && p.y > -m && p.x < v.w + m && p.y < v.h + m;
  const pathD = (pts: { x: number; y: number }[], closed: boolean) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('') + (closed ? 'Z' : '');

  const draftPts = draft ? [...draft.pts, ...(hover ? [hover] : [])] : [];
  const firstDraft = draft?.pts[0] ? project(draft.pts[0], v) : null;
  const canCloseDraft = draft?.kind === 'area' && draft.pts.length >= 3;

  return (
    <>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" width={v.w} height={v.h}>
        {shapes.map(s => {
          if (s.kind === 'label') return null;
          const runs = projectPath(s.pts, v, s.kind === 'area');
          if (!runs.length) return null;
          const sel = s.id === selected;
          return (
            <g key={s.id}>
              {runs.map((r, i) => (
                <Fragment key={i}>
                  {sel && <path d={pathD(r, s.kind === 'area')} fill="none" stroke="#fff" strokeWidth={s.kind === 'line' ? 7 : 6} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />}
                  <path d={pathD(r, s.kind === 'area')} data-shape={s.id}
                    fill={s.kind === 'area' ? `${s.color}33` : 'none'} stroke={s.color} strokeWidth={s.kind === 'line' ? 3.5 : 2.5}
                    strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.kind === 'line' ? undefined : undefined}
                    style={{ pointerEvents: s.kind === 'area' ? 'visiblePainted' : 'stroke', cursor: 'pointer' }} />
                  {s.kind === 'line' && (
                    <path d={pathD(r, false)} data-shape={s.id} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} />
                  )}
                </Fragment>
              ))}
              {editing && sel && s.pts.map((p, i) => {
                const q = project(p, v);
                if (!inView(q, 10)) return null;
                return (
                  <circle key={i} cx={q.x} cy={q.y} r={7} fill="#fff" stroke="#1D4ED8" strokeWidth={2.5}
                    data-drag={`v:${s.id}:${i}`} style={{ pointerEvents: 'all', cursor: 'move' }} />
                );
              })}
            </g>
          );
        })}
        {draft && draftPts.length > 0 && (() => {
          const closedPreview = draft.kind === 'area' && draftPts.length >= 3;
          const runs = projectPath(draftPts, v, closedPreview);
          return (
            <g>
              {runs.map((r, i) => (
                <path key={i} d={pathD(r, closedPreview)} fill={draft.kind === 'area' ? 'rgba(29,78,216,0.12)' : 'none'}
                  stroke="#1D4ED8" strokeWidth={2.5} strokeDasharray="7 5" strokeLinejoin="round" />
              ))}
              {draft.pts.map((p, i) => {
                const q = project(p, v);
                if (!inView(q, 10)) return null;
                const first = i === 0 && canCloseDraft;
                return (
                  <circle key={i} cx={q.x} cy={q.y} r={first ? 9 : 5.5} fill={first ? '#1D4ED8' : '#fff'} stroke="#1D4ED8" strokeWidth={2.5}
                    {...(first ? { 'data-draft-first': '1' } : {})} style={{ pointerEvents: first ? 'all' : 'none', cursor: first ? 'pointer' : undefined }} />
                );
              })}
            </g>
          );
        })()}
      </svg>
      {canCloseDraft && inView(firstDraft) && (
        <div className="absolute pointer-events-none text-[11px] font-medium text-white bg-[#1D4ED8] px-1.5 py-0.5 rounded"
          style={{ left: firstDraft.x + 12, top: firstDraft.y - 26 }}>Bấm để khép vùng</div>
      )}
      {shapes.map(s => {
        const q = project(shapeAnchor(s), v);
        if (!inView(q)) return null;
        const sel = s.id === selected;
        const fs = LABEL_FONT * (s.size ?? 1);
        return (
          <div key={s.id} data-shape={s.id} data-drag={editing ? `s:${s.id}` : undefined}
            className="absolute whitespace-nowrap font-bold leading-none rounded-[0.25em] shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
            style={{
              left: q.x, top: q.y, transform: 'translate(-50%, -50%)', fontSize: fs, color: s.color, background: 'rgba(255,255,255,0.93)',
              padding: '0.22em 0.4em', cursor: editing ? 'move' : 'pointer',
              outline: sel ? `2px solid ${editing ? '#1D4ED8' : s.color}` : undefined, outlineOffset: 2,
            }}
            title={s.note ? `${s.label}: ${s.note}` : s.label}>
            {s.kind === 'label' && <span className="inline-block w-[0.5em] h-[0.5em] rounded-full mr-[0.3em] align-middle" style={{ background: s.color }} />}
            {s.label || '?'}
          </div>
        );
      })}
    </>
  );
}

/** Ghim các công ty / dự án / ảnh 360 khác ở gần. Nhãn tự xếp tầng để không đè nhau. */
export function PanoPinsLayer({ v, items, heading, cameraHeight, calibrated, calibrating, focus, dim }: {
  v: PanoView;
  items: NearbyItem[];
  heading: number;
  cameraHeight: number;
  calibrated: boolean;
  calibrating: boolean;
  focus: string | null;
  /** Đang vẽ: ghim mờ đi, chạm vào ghim = chấm điểm vẽ. */
  dim?: boolean;
}) {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const nodes = items.map(it => {
    const at = placeInPano(it.bearing, it.dist, heading, cameraHeight);
    const q = project(at, v);
    if (!q || q.x < -80 || q.x > v.w + 80 || q.y < -60 || q.y > v.h + 200) return null;
    const label = `${it.name} · ${fmtDistance(it.dist)}`;
    const wPx = Math.min(240, 16 + label.length * 6.6);
    let level = 0;
    let rect = { x0: q.x - wPx / 2, x1: q.x + wPx / 2, y0: 0, y1: 0 };
    for (; level < 7; level++) {
      const top = q.y - 44 - level * 24;
      rect = { ...rect, y0: top, y1: top + 22 };
      if (!placed.some(r => r.x0 < rect.x1 && rect.x0 < r.x1 && r.y0 < rect.y1 && rect.y0 < r.y1)) break;
    }
    placed.push(rect);
    return { it, q, top: rect.y0, label };
  });
  return (
    <>
      {nodes.map(n => {
        if (!n) return null;
        const { it, q, top, label } = n;
        const isFocus = it.id === focus;
        const faded = !calibrated && !calibrating;
        return (
          <div key={it.id} className="absolute" style={{ left: q.x, top: 0, opacity: dim ? 0.45 : faded ? 0.7 : 1, zIndex: isFocus ? 3 : 1 }}>
            <div className="absolute w-px" style={{ left: 0, top: top + 22, height: Math.max(0, q.y - top - 22), background: 'rgba(255,255,255,0.85)', boxShadow: '0 0 2px rgba(0,0,0,0.6)' }} />
            <div className="absolute w-2.5 h-2.5 rounded-full border-2 border-white" style={{ left: -5, top: q.y - 5, background: it.color, boxShadow: '0 0 3px rgba(0,0,0,0.6)' }} />
            <div data-pin={it.id} data-drag={calibrating && it.kind === 'point' ? `pin:${it.id}` : undefined}
              className={`absolute -translate-x-1/2 h-[22px] px-2 rounded-full text-[11.5px] font-semibold whitespace-nowrap inline-flex items-center gap-1 shadow-[0_2px_6px_rgba(0,0,0,0.35)] ${isFocus ? 'ring-2 ring-white' : ''}`}
              style={{ top, background: it.color, color: '#fff', maxWidth: 240, cursor: calibrating ? 'ew-resize' : 'pointer' }}
              title={`${it.name} — ${it.groupLabel}${it.sub ? ` · ${it.sub}` : ''}\n${fmtDistance(it.dist)} về hướng ${dirName(it.bearing)}`}>
              {it.kind === 'pano' && <Camera size={11} />}
              <span className="truncate">{label}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** La bàn nhỏ: các điểm gần (theo phương vị / khoảng cách) + hình quạt hướng đang nhìn. Bấm 1 chấm → quay tới đó. */
export function PanoRadar({ v, items, radius, heading, calibrated, onPick, left = '12px', bottom = '12px' }: {
  v: PanoView;
  items: NearbyItem[];
  radius: number;
  heading: number;
  calibrated: boolean;
  onPick: (it: NearbyItem) => void;
  /** Vị trí (CSS) — màn cha chừa safe-area / ngăn kéo dưới. */
  left?: string;
  bottom?: string;
}) {
  const R = 52;
  const facing = compassAt(v.yaw, heading);
  const half = Math.min(80, v.hfov / 2);
  const RAD = Math.PI / 180;
  const pt = (bearing: number, r: number) => ({ x: R + r * Math.sin(bearing * RAD), y: R - r * Math.cos(bearing * RAD) });
  const a = pt(facing - half, R), b = pt(facing + half, R);
  return (
    <div data-ui className="absolute z-10 select-none" style={{ width: R * 2 + 8, left, bottom }}>
      <svg width={R * 2} height={R * 2} className="block drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
        <circle cx={R} cy={R} r={R - 1} fill="rgba(20,20,22,0.62)" stroke="rgba(255,255,255,0.5)" />
        <circle cx={R} cy={R} r={(R - 1) / 2} fill="none" stroke="rgba(255,255,255,0.18)" />
        <path d={`M${R},${R} L${a.x},${a.y} A${R},${R} 0 0 1 ${b.x},${b.y} Z`} fill={calibrated ? 'rgba(10,132,255,0.45)' : 'rgba(255,255,255,0.18)'}
          stroke={calibrated ? 'none' : 'rgba(255,255,255,0.5)'} strokeDasharray="3 3" />
        <text x={R} y={11} textAnchor="middle" fontSize={10} fontWeight={700} fill="#FF453A">B</text>
        {items.map(it => {
          const p = pt(it.bearing, Math.min(1, it.dist / radius) * (R - 6));
          return (
            <circle key={it.id} cx={p.x} cy={p.y} r={it.kind === 'pano' ? 3 : 3.5} fill={it.color} stroke="#fff" strokeWidth={1} pointerEvents="none" />
          );
        })}
        <circle cx={R} cy={R} r={3} fill="#0A84FF" stroke="#fff" strokeWidth={1.5} />
        {/* Vùng bấm to (chấm chỉ 7 px — ngón tay khó trúng); vẽ sau cùng nên nằm trên */}
        {items.map(it => {
          const p = pt(it.bearing, Math.min(1, it.dist / radius) * (R - 6));
          return (
            <circle key={`hit-${it.id}`} cx={p.x} cy={p.y} r={11} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => onPick(it)}>
              <title>{`${it.name} · ${fmtDistance(it.dist)} ${dirName(it.bearing, true)}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="mt-1 text-center whitespace-nowrap text-[10.5px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
        {calibrated ? `Đang nhìn ${dirName(facing)} ${Math.round(wrap360(facing))}°` : 'Chưa căn hướng'}
      </div>
    </div>
  );
}
