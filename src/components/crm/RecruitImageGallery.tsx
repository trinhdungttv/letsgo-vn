import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ExternalLink, Tag, X } from 'lucide-react';
import {
  addTag, availableOptions, competitorOptions, filterChips, removeTag, resolveTags, visibleIndexes,
  type CompetitorRow, type RecruitTag, type ResolvedTag,
} from '../../lib/recruitImages';

/** Hướng dẫn khi chưa chạy migration 216 (cột recruit_image_tags). */
export const MIGRATION_216_HINT = 'Chưa chạy migration 216 (thẻ đối thủ cho ảnh tuyển dụng) — chạy xong rồi thử lại';

interface Props {
  urls: string[];
  /** Thẻ đã lưu của từng ảnh, cùng vị trí với `urls`. */
  tags: RecruitTag[][];
  /** Đối thủ ở Thị trường → Đối thủ (mọi dòng — hàm tự gộp theo công ty). */
  competitors: readonly CompetitorRow[];
  /** false = DB chưa có cột thẻ → chỉ xem ảnh, chưa gắn được thẻ. */
  tagsReady: boolean;
  onChangeTags: (index: number, next: RecruitTag[]) => void;
  onRemove: (index: number) => void;
}

/** Thẻ đối thủ của 1 ảnh (mỗi ảnh 1 nhà cung ứng): chưa có thì hiện ô chọn "Gắn đối thủ…" (chỉ chọn từ danh sách Đối thủ có sẵn, không gõ tay); có rồi thì hiện viên thẻ + nút ×.
 * Dữ liệu vẫn là danh sách nên ảnh nào lỡ có nhiều thẻ từ trước vẫn hiện đủ và gỡ từng thẻ được. */
function TagEditor({ tags, resolved, options, rows, onChange, size = 'sm' }: {
  tags: RecruitTag[];
  resolved: ResolvedTag[];
  options: { id: string; name: string }[];
  rows: readonly CompetitorRow[];
  onChange: (next: RecruitTag[]) => void;
  size?: 'sm' | 'md';
}) {
  const rest = availableOptions(options, resolved);
  const chipH = size === 'md' ? 'h-7 text-[12px]' : 'h-5 text-[10.5px]';
  return (
    <div className="flex flex-wrap items-center gap-1">
      {resolved.length === 0 && <span className={`${size === 'md' ? 'text-[12px]' : 'text-[10.5px]'} text-[#aaa] italic`}>Chưa gắn đối thủ</span>}
      {resolved.map(r => (
        <span key={r.key} title={r.missing ? 'Đối thủ này không còn trong Thị trường → Đối thủ' : r.name}
          className={`inline-flex items-center gap-0.5 rounded-full border pl-2 pr-0.5 max-w-full ${chipH} ${r.missing ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
          <span className="truncate font-medium">{r.name}</span>
          <button type="button" onClick={e => { e.stopPropagation(); onChange(removeTag(tags, rows, r.key)); }} aria-label={`Gỡ thẻ ${r.name}`}
            className="w-4 h-4 shrink-0 rounded-full hover:bg-black/10 flex items-center justify-center"><X size={10} strokeWidth={2.6} /></button>
        </span>
      ))}
      {/* Mỗi ảnh chỉ 1 nhà cung ứng: đã có thẻ thì ẩn ô chọn — muốn đổi thì bấm × rồi chọn lại */}
      {resolved.length === 0 && rest.length > 0 && (
        <select value="" onChange={e => { const o = options.find(x => x.id === e.target.value); if (o) onChange(addTag(tags, o)); }}
          onClick={e => e.stopPropagation()} aria-label="Gắn đối thủ cho ảnh"
          className={`${size === 'md' ? 'h-7 text-[12px]' : 'h-6 text-[10.5px]'} max-w-[9.5rem] rounded-full border border-dashed border-blue-300 bg-white text-blue-600 px-1.5 outline-none focus:border-blue-500 cursor-pointer`}>
          <option value="">＋ Gắn đối thủ…</option>
          {rest.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
    </div>
  );
}

/** Popup xem ảnh lớn trong app: ← → đổi ảnh, Esc / bấm nền / nút × để đóng, bấm vào ảnh để phóng to 100%. */
function Lightbox({ urls, order, current, bad, onBad, onClose, onGo, footer }: {
  urls: string[];
  /** Vị trí các ảnh đang được xem (đã lọc) — thứ tự chuyển ảnh. */
  order: number[];
  current: number;
  bad: Record<string, boolean>;
  onBad: (u: string) => void;
  onClose: () => void;
  onGo: (index: number) => void;
  footer: React.ReactNode;
}) {
  // Phóng to nhớ theo ảnh đang xem — đổi ảnh thì tự về vừa khung
  const [zoomAt, setZoomAt] = useState<number | null>(null);
  const zoom = zoomAt === current;
  const touchX = useRef<number | null>(null);
  const url = urls[current];
  const pos = order.indexOf(current);
  const go = (d: number) => { if (order.length > 1 && pos >= 0) onGo(order[(pos + d + order.length) % order.length]); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (!typing && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (!typing && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (url === undefined) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const arrow = 'absolute top-1/2 -translate-y-1/2 z-10 w-11 h-11 md:w-12 md:h-12 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center';
  const imgStyle: CSSProperties = zoom ? { maxWidth: 'none', maxHeight: 'none' } : { maxWidth: '100%', maxHeight: '100%' };

  // Portal ra body nhưng sự kiện React vẫn nổi lên hồ sơ công ty (đang mở) — chặn lại kẻo bấm nền popup làm đóng cả hồ sơ.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Xem ảnh tuyển dụng"
      className="fixed inset-0 z-[300] bg-black/85 flex flex-col" onClick={e => { stop(e); onClose(); }} onMouseDown={stop} onKeyDown={stop}>
      <div className="flex items-center gap-2 px-3 py-2 text-white shrink-0">
        <span className="text-[13px] font-medium tabular-nums">{pos + 1} / {order.length}</span>
        <span className="flex-1" />
        <a href={url} target="_blank" rel="noopener noreferrer" title="Mở ảnh gốc ở tab mới" onClick={stop}
          className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center"><ExternalLink size={16} /></a>
        <button type="button" onClick={e => { stop(e); onClose(); }} aria-label="Đóng" title="Đóng (Esc)"
          className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center"><X size={20} /></button>
      </div>

      <div className="relative flex-1 min-h-0">
        <div className={`absolute inset-0 flex ${zoom ? 'overflow-auto' : 'overflow-hidden'} p-2 md:px-16`}
          onTouchStart={e => { touchX.current = e.touches[0]?.clientX ?? null; }}
          onTouchEnd={e => {
            const x0 = touchX.current; touchX.current = null;
            const dx = x0 == null ? 0 : (e.changedTouches[0]?.clientX ?? x0) - x0;
            if (!zoom && Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
          }}>
          {bad[url]
            ? <div className="m-auto rounded-xl bg-red-50 border border-red-300 text-red-600 text-[13px] font-semibold px-5 py-4 text-center" onClick={stop}>Ảnh lỗi — link không tải được</div>
            : <img key={url} src={url} alt="" referrerPolicy="no-referrer" onError={() => onBad(url)} style={imgStyle}
                onClick={e => { stop(e); setZoomAt(zoom ? null : current); }}
                className={`m-auto object-contain select-none ${zoom ? 'cursor-zoom-out' : 'cursor-zoom-in'}`} draggable={false} />}
        </div>
        {order.length > 1 && (
          <>
            <button type="button" className={`${arrow} left-2`} aria-label="Ảnh trước" title="Ảnh trước (←)" onClick={e => { stop(e); go(-1); }}><ChevronLeft size={24} /></button>
            <button type="button" className={`${arrow} right-2`} aria-label="Ảnh sau" title="Ảnh sau (→)" onClick={e => { stop(e); go(1); }}><ChevronRight size={24} /></button>
          </>
        )}
      </div>

      <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-2xl rounded-xl bg-white px-3 py-2" onClick={stop}>{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Lưới "Ảnh tuyển dụng" của công ty: ảnh hiện TRỌN VẸN (thu nhỏ vừa khung), bấm để xem popup, gắn thẻ đối thủ, lọc theo đối thủ. */
export default function RecruitImageGallery({ urls, tags, competitors, tagsReady, onChangeTags, onRemove }: Props) {
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [viewingRaw, setViewing] = useState<number | null>(null);
  // Ảnh đang xem bị xoá → tự đóng popup (không nhảy sang ảnh khác)
  const viewing = viewingRaw !== null && viewingRaw < urls.length ? viewingRaw : null;

  const options = useMemo(() => competitorOptions(competitors), [competitors]);
  const resolved = useMemo(() => urls.map((_, i) => resolveTags(tags[i] ?? [], competitors)), [urls, tags, competitors]);
  const chips = useMemo(() => filterChips(resolved), [resolved]);
  const active = filter && chips.some(c => c.key === filter) ? filter : null;
  const shown = useMemo(() => visibleIndexes(resolved, active), [resolved, active]);
  const markBad = (u: string) => setBad(b => ({ ...b, [u]: true }));

  if (!urls.length) return null;

  const retag = (i: number, next: RecruitTag[]) => onChangeTags(i, next);
  const editor = (i: number, size: 'sm' | 'md') => (
    <TagEditor tags={tags[i] ?? []} resolved={resolved[i] ?? []} options={options} rows={competitors} onChange={n => retag(i, n)} size={size} />
  );

  return (
    <div className="mb-2 space-y-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <Tag size={11} className="text-[#999]" />
          {[{ key: null as string | null, name: 'Tất cả', count: urls.length }, ...chips].map(c => (
            <button key={c.key ?? 'all'} type="button" onClick={() => setFilter(c.key)}
              className={`h-6 px-2 rounded-full text-[10.5px] font-medium border ${active === c.key ? 'bg-[#1D4ED8] border-[#1D4ED8] text-white' : 'bg-white border-gray-200 text-[#555] hover:border-blue-300'}`}>
              {c.name} <span className={active === c.key ? 'text-white/80' : 'text-[#999]'}>{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {!tagsReady && <div className="text-[10.5px] text-amber-600">Chưa gắn được thẻ đối thủ cho ảnh — cần chạy migration 216 (xem hướng dẫn của Claude).</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {shown.map(i => {
          const u = urls[i];
          return (
            <div key={`${i}|${u}`} className="relative group rounded-lg border border-gray-200 bg-white overflow-hidden flex flex-col">
              <button type="button" onClick={() => setViewing(i)} title="Bấm để xem ảnh lớn"
                className="block w-full h-36 md:h-40 bg-gray-50 cursor-zoom-in">
                {bad[u]
                  ? <span className="w-full h-full bg-red-50 text-red-600 text-[11px] font-semibold flex items-center justify-center text-center px-1">Ảnh lỗi — xoá & dán link khác</span>
                  : <img src={u} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => markBad(u)} className="w-full h-full object-contain" />}
              </button>
              <button type="button" onClick={() => onRemove(i)} title="Bỏ ảnh" aria-label="Bỏ ảnh"
                className="absolute top-1 right-1 p-1 rounded bg-white/90 text-gray-500 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
              {tagsReady && <div className="px-1.5 py-1.5 border-t border-gray-100">{editor(i, 'sm')}</div>}
              {!tagsReady && resolved[i].length > 0 && (
                <div className="px-1.5 py-1.5 border-t border-gray-100 flex flex-wrap gap-1">
                  {resolved[i].map(r => <span key={r.key} className="px-2 h-5 inline-flex items-center rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[10.5px] font-medium">{r.name}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {shown.length === 0 && <div className="text-[11.5px] text-[#aaa] italic">Không có ảnh nào khớp bộ lọc.</div>}

      {viewing !== null && (
        <Lightbox urls={urls} order={shown.includes(viewing) ? shown : urls.map((_, i) => i)} current={viewing} bad={bad} onBad={markBad}
          onClose={() => setViewing(null)} onGo={setViewing}
          footer={tagsReady
            ? <div><div className="text-[11px] text-[#888] font-medium mb-1">Ảnh của nhà cung ứng</div>{editor(viewing, 'md')}</div>
            : <div className="text-[12px] text-[#666]">{resolved[viewing]?.length ? resolved[viewing].map(r => r.name).join(', ') : 'Chưa gắn đối thủ'}</div>} />
      )}
    </div>
  );
}
