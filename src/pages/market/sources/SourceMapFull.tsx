// Bản đồ TOÀN MÀN HÌNH của 1 đơn vị nguồn: thời gian xe khách từ trường tới KCN / khách hàng / công ty / chi nhánh.
// Lọc theo loại điểm + giới hạn giờ đi + tìm tên; danh sách xếp theo giờ đi; bấm 1 điểm → vẽ tuyến xe.
// Nút ◎ đưa trường về giữa bản đồ. Esc / nút × để đóng (không đóng luôn hồ sơ phía sau).
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { foldVn } from '../../../lib/companyMatch';
import { MAP_GROUP_COLOR } from '../../../lib/mapGroups';
import { estimateBusMinutes } from '../../../lib/laborSources/match';
import { fetchRouteShape, fmtKm } from '../../../lib/laborSources/routing';
import type { LaborSource } from '../../../lib/laborSources/types';
import { SearchField } from '../../../modules/cskh/components/apple';
import { useLabor } from './context';
import RouteMiniMap, { type MiniPoint } from './RouteMiniMap';
import { BusChip, KIND_COLOR } from './parts';

type Kind = 'zone' | 'client' | 'prospect' | 'lead' | 'branch';
const KINDS: { key: Kind; label: string; color: string }[] = [
  { key: 'zone', label: 'KCN', color: MAP_GROUP_COLOR.kcn },
  { key: 'client', label: 'KH hợp tác', color: MAP_GROUP_COLOR.client },
  { key: 'prospect', label: 'KH tiềm năng', color: MAP_GROUP_COLOR.prospect },
  { key: 'lead', label: 'Công ty / Dự án', color: MAP_GROUP_COLOR.lead },
  { key: 'branch', label: 'Chi nhánh', color: MAP_GROUP_COLOR.branch },
];
const COLOR = Object.fromEntries(KINDS.map(k => [k.key, k.color])) as Record<Kind, string>;
const LIMITS = [0, 30, 60, 90, 120] as const;
const PREFS_KEY = 'lgvn_labor_fullmap_v1';

export default function SourceMapFull({ source, onClose }: { source: LaborSource; onClose: () => void }) {
  const L = useLabor();
  const saved = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as { kinds?: Kind[]; limit?: number }; } catch { return {}; } })();
  const [kinds, setKinds] = useState<Kind[]>(saved.kinds?.length ? saved.kinds : ['zone', 'client', 'prospect']);
  const [limit, setLimit] = useState<number>(saved.limit ?? 0);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Map<string, [number, number][]>>(new Map());
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ kinds, limit })); } catch { /* bỏ qua */ } }, [kinds, limit]);

  // Esc đóng bản đồ trước (bắt ở pha capture để hồ sơ phía sau không đóng theo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const home = { lat: source.lat as number, lng: source.lng as number };
  const clientType = useMemo(() => new Map(L.clients.map(c => [c.id, c.client_type])), [L.clients]);

  const items = useMemo(() => {
    const k = foldVn(q).trim();
    return L.targets.map(t => {
      const kind: Kind = t.type === 'client' ? (clientType.get(t.id) === 'active' ? 'client' : 'prospect') : t.type === 'zone' ? 'zone' : t.type;
      const r = L.route(source.id, t.type, t.id) ?? null;
      const est = r ? null : estimateBusMinutes(home, t);
      const min = r ? r.duration_min : est!.min;
      return { t, kind, r, est, min };
    }).filter(x => kinds.includes(x.kind)
      && (!limit || (x.min != null && x.min <= limit))
      && (!k || foldVn(`${x.t.name} ${x.t.sub}`).includes(k))
      && !(x.r && x.r.distance_km == null))
      .sort((a, b) => (a.min ?? Infinity) - (b.min ?? Infinity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L.targets, L.routeIdx, kinds, limit, q, source.id, clientType]);

  const points = useMemo<MiniPoint[]>(() => items.map(x => ({
    id: `${x.t.type}:${x.t.id}`, lat: x.t.lat, lng: x.t.lng, label: x.t.name, color: COLOR[x.kind],
    sub: `${x.t.sub} · xe khách ${x.est ? '≈' : ''}${Math.round(x.min ?? 0)} phút${x.r?.distance_km != null ? ` · ${fmtKm(x.r.distance_km)}` : ''}`,
    badge: x.min != null ? `${x.est ? '≈' : ''}${Math.round(x.min)}′` : undefined,
  })), [items]);

  const pick = async (key: string) => {
    setFocus(key);
    if (shapes.has(key)) return;
    const p = points.find(x => x.id === key);
    if (!p) return;
    const shape = await fetchRouteShape(home, p);
    if (shape) setShapes(prev => new Map(prev).set(key, shape.points));
  };

  const toggle = (k: Kind) => setKinds(list => (list.includes(k) ? list.filter(x => x !== k) : [...list, k]));
  const fitKey = `${kinds.join(',')}|${limit}|${q}`;

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-[#F5F5F7] flex flex-col md:flex-row" role="dialog" aria-modal="true" aria-label={`Bản đồ ${source.name}`}>
      {/* Bản đồ */}
      <div className="relative h-[52dvh] md:h-auto md:flex-1 min-h-0">
        <RouteMiniMap className="h-full w-full" roundedClass="rounded-none" showBadges
          home={{ ...home, label: source.short_name || source.name }} homeColor={KIND_COLOR[source.kind]}
          points={points} route={focus ? shapes.get(focus) ?? null : null} focusId={focus} onPick={k => void pick(k)} fitKey={fitKey} />
        <button type="button" onClick={onClose} aria-label="Đóng bản đồ"
          className="absolute left-3 top-[max(12px,env(safe-area-inset-top))] z-[1000] h-10 pl-3 pr-4 rounded-full bg-white/95 shadow-[0_1px_6px_rgba(0,0,0,0.25)] text-[14px] font-semibold text-[#1D1D1F] inline-flex items-center gap-1.5">
          <X size={17} strokeWidth={2.4} /> Đóng
        </button>
      </div>

      {/* Bảng lọc + danh sách */}
      <aside className="flex-1 md:flex-none md:w-[400px] min-h-0 flex flex-col bg-white md:border-l border-black/[0.08]">
        <div className="px-4 pt-3 pb-2 space-y-2.5 border-b border-black/[0.06]">
          <div>
            <p className="text-[17px] font-semibold text-[#1D1D1F] leading-tight truncate">{source.short_name || source.name}</p>
            <p className="text-[12px] text-[#86868B]">Thời gian xe khách 16–45 chỗ từ trường · {items.length} điểm</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map(k => {
              const on = kinds.includes(k.key);
              return (
                <button key={k.key} type="button" onClick={() => toggle(k.key)} aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-medium transition ${on ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#6E6E73]'}`}>
                  <span className="w-2 h-2 rounded-full" style={{ background: k.color }} />{k.label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1 p-[2px] rounded-[9px] bg-[rgba(118,118,128,0.12)]">
            {LIMITS.map(m => (
              <button key={m} type="button" onClick={() => setLimit(m)}
                className={`flex-1 h-7 rounded-[7px] text-[12.5px] ${limit === m ? 'bg-white font-semibold shadow-[0_2px_6px_rgba(0,0,0,0.12)]' : 'text-[#3C3C43]/80'}`}>
                {m ? `≤ ${m}′` : 'Mọi giờ'}
              </button>
            ))}
          </div>
          <SearchField value={q} onChange={setQ} placeholder="Tìm KCN, công ty…" />
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-[max(12px,env(safe-area-inset-bottom))]">
          {items.length === 0 && <li className="py-10 text-center text-[13px] text-[#86868B]">Không có điểm nào khớp bộ lọc</li>}
          {items.map(x => {
            const key = `${x.t.type}:${x.t.id}`;
            return (
              <li key={key}>
                <button type="button" onClick={() => void pick(key)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-[10px] text-left transition ${focus === key ? 'bg-[#0071E3]/[0.08]' : 'hover:bg-[#F5F5F7]'}`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLOR[x.kind] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-[#1D1D1F] truncate">{x.t.name}</span>
                    <span className="block text-[11.5px] text-[#86868B] truncate">{[x.t.sub, x.r?.distance_km != null ? fmtKm(x.r.distance_km) : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <BusChip route={x.r} estimate={x.est} compact />
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>,
    document.body,
  );
}
