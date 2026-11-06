// Pháp lý — SƠ ĐỒ DÒNG THỜI GIAN: vẽ 3 kiểu (trục & chấm tròn · dải mũi tên · uốn lượn) + trình soạn mốc + xuất ảnh PNG.
// Dùng cho tài liệu loại 'timeline' trong Topic, và cho nút "Dòng thời gian" của Sơ đồ tư duy (TimelineOverlay).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Download, Loader2, Plus, Trash2, X } from 'lucide-react';
import { chunkRows, moveItem, newItem, TIMELINE_STYLES, type TimelineDoc, type TimelineItem, type TimelineStyle } from '../../lib/legal/timelineChart';
import { downloadBlob } from '../../lib/quickNotes/pendingAudio';
import { BTN_PRIMARY, BTN_SECONDARY } from '../workspace/wsTheme';
import { INPUT_CLS, TEXTAREA_CLS, shade, soft } from './ui';

const COL = 176;
const ARROW_H = 46;
const TIP = 15;
const GAP = 3;

const clipRight = (notch: boolean) => `polygon(0 0, calc(100% - ${TIP}px) 0, 100% 50%, calc(100% - ${TIP}px) 100%, 0 100%${notch ? `, ${TIP}px 50%` : ''})`;
const clipLeft = (notch: boolean) => `polygon(${TIP}px 0, 100% 0${notch ? `, calc(100% - ${TIP}px) 50%` : ''}, 100% 100%, ${TIP}px 100%, 0 50%)`;

function Note({ it, align = 'center' }: { it: TimelineItem; align?: 'center' | 'left' }) {
  if (!it.title && !it.text) return null;
  return (
    <div className={`px-1 ${align === 'center' ? 'text-center' : 'text-left'}`}>
      {it.title && <div className="text-[13px] font-semibold leading-snug" style={{ color: shade(it.color, -0.2) }}>{it.title}</div>}
      {it.text && <div className="text-[12px] text-[#6E6E73] leading-snug mt-0.5 whitespace-pre-line">{it.text}</div>}
    </div>
  );
}

/** Kiểu 1 — trục ngang, chấm tròn ghi nhãn, thẻ màu xen kẽ trên / dưới. */
function DotsChart({ items }: { items: TimelineItem[] }) {
  const n = items.length;
  const cols = `repeat(${n}, ${COL}px)`;
  return (
    <div className="relative grid" style={{ gridTemplateColumns: cols, gridTemplateRows: 'auto 70px auto', width: n * COL }}>
      {/* trục */}
      <div className="relative" style={{ gridColumn: '1 / -1', gridRow: 2 }}>
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[6px] rounded-full bg-gradient-to-r from-black/[0.08] to-black/[0.08]" />
      </div>
      {items.map((it, i) => {
        const up = i % 2 === 0;
        const card = (
          <div className="mx-2 rounded-[12px] overflow-hidden bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_6px_16px_-8px_rgba(0,0,0,0.25)]" style={{ alignSelf: up ? 'end' : 'start' }}>
            {it.title && <div className="px-2.5 py-1.5 text-[12.5px] font-semibold text-white text-center leading-snug" style={{ background: it.color }}>{it.title}</div>}
            {it.text && <div className="px-2.5 py-2 text-[12px] text-[#3A3A3C] leading-snug text-center whitespace-pre-line" style={{ background: soft(it.color, 0.07) }}>{it.text}</div>}
          </div>
        );
        return (
          <div key={it.id} className="contents">
            <div className="flex flex-col justify-end" style={{ gridColumn: i + 1, gridRow: 1 }}>{up && (it.title || it.text) ? card : null}</div>
            <div className="relative flex items-center justify-center" style={{ gridColumn: i + 1, gridRow: 2 }}>
              {(it.title || it.text) && <span className="absolute left-1/2 -translate-x-1/2 w-[2px]" style={{ background: it.color, ...(up ? { top: 0, bottom: '50%' } : { top: '50%', bottom: 0 }) }} />}
              <span className="relative z-10 inline-flex items-center justify-center rounded-full bg-white text-[12.5px] font-bold tabular-nums"
                style={{ minWidth: 52, height: 52, padding: '0 6px', border: `4px solid ${it.color}`, color: shade(it.color, -0.3), boxShadow: '0 4px 10px -4px rgba(0,0,0,0.3)' }}>
                {it.label || i + 1}
              </span>
            </div>
            <div className="flex flex-col justify-start" style={{ gridColumn: i + 1, gridRow: 3 }}>{!up && (it.title || it.text) ? card : null}</div>
          </div>
        );
      })}
    </div>
  );
}

/** 1 mũi tên chevron có nhãn. */
function Chevron({ it, i, first, dir, w }: { it: TimelineItem; i: number; first: boolean; dir: 'right' | 'left'; w?: string }) {
  const style: CSSProperties = {
    background: `linear-gradient(180deg, ${shade(it.color, 0.1)}, ${it.color})`, height: ARROW_H,
    clipPath: dir === 'right' ? clipRight(!first) : clipLeft(!first),
    ...(first ? {} : dir === 'right' ? { marginLeft: -(TIP - GAP), width: `calc(100% + ${TIP - GAP}px)` } : { marginRight: -(TIP - GAP), width: `calc(100% + ${TIP - GAP}px)` }),
    ...(w ? { width: w } : {}),
  };
  return (
    <div className="flex items-center justify-center text-white text-[14px] font-bold tabular-nums px-5" style={style}>
      <span className="truncate">{it.label || i + 1}</span>
    </div>
  );
}

/** Kiểu 2 — dải mũi tên màu, ghi chú đan xen trên / dưới kèm vạch nối + chấm. */
function ArrowsChart({ items }: { items: TimelineItem[] }) {
  const n = items.length;
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, ${COL}px)`, gridTemplateRows: 'auto auto auto', width: n * COL }}>
      {items.map((it, i) => {
        const up = i % 2 === 0;
        const has = !!(it.title || it.text);
        const stem = <span className="mx-auto block w-[2px]" style={{ background: it.color, height: 22 }} />;
        const dot = <span className="mx-auto block w-2.5 h-2.5 rounded-full border-2 bg-white" style={{ borderColor: it.color }} />;
        return (
          <div key={it.id} className="contents">
            <div className="flex flex-col justify-end items-stretch pb-0.5" style={{ gridColumn: i + 1, gridRow: 1 }}>
              {up && has && <><Note it={it} />{dot}{stem}</>}
            </div>
            <div style={{ gridColumn: i + 1, gridRow: 2 }}><Chevron it={it} i={i} first={i === 0} dir="right" /></div>
            <div className="flex flex-col justify-start items-stretch pt-0.5" style={{ gridColumn: i + 1, gridRow: 3 }}>
              {!up && has && <>{stem}{dot}<Note it={it} /></>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    setW(el.clientWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Kiểu 3 — nhiều hàng mũi tên, hàng lẻ quay đầu (S-shape), nối bằng khuỷu ở mép. */
function SnakeChart({ items, width }: { items: TimelineItem[]; width: number }) {
  const per = Math.max(2, Math.min(6, Math.floor((width - 60) / 150)));
  const rows = chunkRows(items.map((it, idx) => ({ it, idx })), per);
  const cell = `calc((100% - 0px) / ${per})`;
  return (
    <div className="px-[30px]" style={{ width: '100%' }}>
      {rows.map((row, r) => {
        const rev = r % 2 === 1;
        const shown = rev ? [...row].reverse() : row;
        const last = row[row.length - 1].it;
        return (
          <div key={r} className="relative" style={{ paddingBottom: 6 }}>
            <div className="flex" style={{ justifyContent: rev ? 'flex-end' : 'flex-start' }}>
              {shown.map(({ it, idx }, k) => {
                const first = rev ? k === shown.length - 1 : k === 0;
                return (
                  <div key={it.id} style={{ width: cell, flex: `0 0 ${cell}` }}>
                    <Chevron it={it} i={idx} first={first} dir={rev ? 'left' : 'right'} />
                    <div className="pt-1.5 pb-1"><Note it={it} /></div>
                  </div>
                );
              })}
            </div>
            {r < rows.length - 1 && (
              <span className="absolute pointer-events-none" style={{
                top: ARROW_H / 2, bottom: -ARROW_H / 2 + 6, [rev ? 'left' : 'right']: -22, width: 22,
                border: `3px solid ${last.color}`, [rev ? 'borderRight' : 'borderLeft']: 0, borderRadius: rev ? '14px 0 0 14px' : '0 14px 14px 0',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Vẽ sơ đồ (chỉ xem). `innerRef` = lớp để chụp ảnh. */
export function TimelineChart({ doc, innerRef }: { doc: TimelineDoc; innerRef?: React.Ref<HTMLDivElement> }) {
  const [wrapRef, width] = useWidth();
  if (!doc.items.length) return <div className="py-10 text-center text-[13px] text-[#86868B]">Chưa có mốc nào — bấm "+ Thêm mốc"</div>;
  return (
    <div ref={wrapRef} className="overflow-x-auto no-scrollbar">
      <div ref={innerRef} className="bg-white py-5 px-3 inline-block min-w-full align-top" style={{ minWidth: doc.style === 'snake' ? undefined : doc.items.length * COL + 24 }}>
        {doc.style === 'dots' && <DotsChart items={doc.items} />}
        {doc.style === 'arrows' && <ArrowsChart items={doc.items} />}
        {doc.style === 'snake' && <SnakeChart items={doc.items} width={width} />}
      </div>
    </div>
  );
}

export async function exportTimelinePng(el: HTMLElement, name: string): Promise<void> {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#FFFFFF', width: el.scrollWidth, height: el.scrollHeight, windowWidth: el.scrollWidth + 80 });
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Không tạo được ảnh');
  downloadBlob(blob, `${name.replace(/[\\/:*?"<>|\n]+/g, '-').trim().slice(0, 80) || 'Dong thoi gian'}.png`);
}

export function StyleChips({ value, onChange }: { value: TimelineStyle; onChange: (s: TimelineStyle) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
      {TIMELINE_STYLES.map(s => (
        <button key={s.id} type="button" title={s.hint} onClick={() => onChange(s.id)}
          className={`shrink-0 whitespace-nowrap h-8 px-3 rounded-full text-[12.5px] font-medium transition ${value === s.id ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'}`}>{s.label}</button>
      ))}
    </div>
  );
}

function PngButton({ chartRef, name, toast }: { chartRef: React.RefObject<HTMLDivElement>; name: string; toast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`}
      onClick={async () => {
        if (!chartRef.current) return;
        setBusy(true);
        try { await exportTimelinePng(chartRef.current, name); } catch (e) { toast((e as Error).message); }
        setBusy(false);
      }}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Tải ảnh
    </button>
  );
}

/** Trình soạn đầy đủ: chọn kiểu, xem trước, sửa từng mốc. */
export function TimelineEditor({ value, onChange, canEdit, title, toast, toolbarExtra }: {
  value: TimelineDoc; onChange: (v: TimelineDoc) => void; canEdit: boolean; title: string; toast: (m: string) => void; toolbarExtra?: ReactNode;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const setItem = (id: string, patch: Partial<TimelineItem>) => onChange({ ...value, items: value.items.map(x => (x.id === id ? { ...x, ...patch } : x)) });
  const add = () => onChange({ ...value, items: [...value.items, newItem(value.items.length)] });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#F5F5F7]">
      <div className="max-w-[1400px] mx-auto p-3 md:p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <StyleChips value={value.style} onChange={s => canEdit && onChange({ ...value, style: s })} />
          <div className="ml-auto flex items-center gap-2">
            {toolbarExtra}
            <PngButton chartRef={chartRef} name={title} toast={toast} />
          </div>
        </div>
        <div className="rounded-[18px] bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(0,0,0,0.1)] overflow-hidden">
          <TimelineChart doc={value} innerRef={chartRef} />
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#1D1D1F]">Các mốc <span className="text-[#86868B] font-normal">{value.items.length}</span></h3>
          {canEdit && <button type="button" onClick={add} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={15} /> Thêm mốc</button>}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {value.items.map((it, i) => (
            <div key={it.id} className="bg-white rounded-[16px] p-3 space-y-2 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06)]" style={{ borderTop: `4px solid ${it.color}` }}>
              <div className="flex items-center gap-2">
                <label className="relative w-7 h-7 rounded-full shrink-0 cursor-pointer shadow-[0_0_0_2px_#fff,0_0_0_3px_rgba(0,0,0,0.12)]" style={{ background: it.color }} title="Đổi màu">
                  <input type="color" value={it.color} disabled={!canEdit} onChange={e => setItem(it.id, { color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
                </label>
                <input value={it.label} disabled={!canEdit} onChange={e => setItem(it.id, { label: e.target.value })} placeholder="Năm / nhãn" className={`${INPUT_CLS} !w-[110px] font-semibold`} />
                {canEdit && (
                  <div className="ml-auto flex items-center">
                    <button type="button" disabled={i === 0} onClick={() => onChange({ ...value, items: moveItem(value.items, i, i - 1) })} className="w-7 h-7 inline-flex items-center justify-center rounded-full text-[#86868B] hover:bg-black/[0.05] disabled:opacity-30" aria-label="Lên"><ArrowUp size={14} /></button>
                    <button type="button" disabled={i === value.items.length - 1} onClick={() => onChange({ ...value, items: moveItem(value.items, i, i + 1) })} className="w-7 h-7 inline-flex items-center justify-center rounded-full text-[#86868B] hover:bg-black/[0.05] disabled:opacity-30" aria-label="Xuống"><ArrowDown size={14} /></button>
                    <button type="button" onClick={() => onChange({ ...value, items: value.items.filter(x => x.id !== it.id) })} className="w-7 h-7 inline-flex items-center justify-center rounded-full text-[#D70015] hover:bg-[#D70015]/10" aria-label="Xoá mốc"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <input value={it.title} disabled={!canEdit} onChange={e => setItem(it.id, { title: e.target.value })} placeholder="Tiêu đề mốc" className={INPUT_CLS} />
              <textarea value={it.text} disabled={!canEdit} onChange={e => setItem(it.id, { text: e.target.value })} placeholder="Mô tả ngắn" rows={2} className={TEXTAREA_CLS} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Cửa sổ xem nhanh 3 kiểu từ 1 danh sách mốc (dùng trong trình vẽ Sơ đồ tư duy). */
export function TimelineOverlay({ initial, title, onClose, toast }: { initial: TimelineDoc; title: string; onClose: () => void; toast: (m: string) => void }) {
  const [doc, setDoc] = useState(initial);
  const chartRef = useRef<HTMLDivElement>(null);
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-center justify-center p-2 md:p-6" onClick={onClose}>
      <div className="bg-[#F5F5F7] rounded-[22px] w-full max-w-[1300px] max-h-full flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
          <h3 className="text-[16px] font-semibold text-[#1D1D1F] mr-2">Dòng thời gian</h3>
          <StyleChips value={doc.style} onChange={s => setDoc({ ...doc, style: s })} />
          <div className="ml-auto flex items-center gap-2">
            <PngButton chartRef={chartRef} name={title} toast={toast} />
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-black/[0.06] inline-flex items-center justify-center" aria-label="Đóng"><X size={16} /></button>
          </div>
        </div>
        <div className="px-3 pb-3 overflow-y-auto">
          <div className="rounded-[18px] bg-white overflow-hidden"><TimelineChart doc={doc} innerRef={chartRef} /></div>
          <p className="text-[12px] text-[#86868B] mt-2 px-1">Mỗi nhánh cấp 1 của sơ đồ là 1 mốc; nhánh con thành phần mô tả. Muốn chỉnh màu / nhãn: đổi màu nhánh trong sơ đồ, hoặc tạo tài liệu "Dòng thời gian" riêng.</p>
        </div>
      </div>
    </div>
  );
}
