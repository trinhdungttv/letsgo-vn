// Pháp lý — khối giao diện dùng chung (phong cách Apple, token wsTheme.ts): biểu tượng, nhãn, ô nhập, bảng màu,
// menu ⋯, hộp xác nhận, trạng thái trống.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BookOpen, GanttChart, Briefcase, Building2, Clock, Coins, Factory, FileText, Folder, Gavel, Globe, GraduationCap, Heart, Image,
  Landmark, Layers, Lightbulb, Link2, MoreHorizontal, Network, Presentation, Receipt, Scale, ShieldCheck, Sheet as SheetIcon,
  HardHat, Users, Video, NotebookPen, FileSpreadsheet, Check,
} from 'lucide-react';
import { CARD, INPUT, POPOVER, TINT, type Tint } from '../workspace/wsTheme';
import { DOC_KINDS, FILE_TYPES, SWATCHES, type DocKind, type FileType } from '../../lib/legal/types';
import { initials } from '../../lib/legal/timeline';

export const TOPIC_ICON_MAP: Record<string, typeof BookOpen> = {
  book: BookOpen, scale: Scale, gavel: Gavel, landmark: Landmark, briefcase: Briefcase, users: Users, hardhat: HardHat,
  receipt: Receipt, coins: Coins, shield: ShieldCheck, building: Building2, factory: Factory, globe: Globe, file: FileText,
  graduation: GraduationCap, heart: Heart, clock: Clock, lightbulb: Lightbulb,
};

export function TopicGlyph({ icon, size = 16 }: { icon: string; size?: number }) {
  const I = TOPIC_ICON_MAP[icon] ?? BookOpen;
  return <I size={size} />;
}

/** Ô màu bo góc + icon trắng (kiểu ô app iOS), màu tự do. */
export function ColorTile({ color, size = 36, radius = 10, children }: { color: string; size?: number; radius?: number; children: ReactNode }) {
  return (
    <span className="shrink-0 inline-flex items-center justify-center text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)]"
      style={{ width: size, height: size, borderRadius: radius, background: `linear-gradient(180deg, ${shade(color, 0.18)} 0%, ${color} 100%)` }}>
      {children}
    </span>
  );
}

/** Pha sáng (amt > 0) / tối (amt < 0) 1 màu hex. */
export function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
/** Nền nhạt từ 1 màu (rgba). */
export function soft(hex: string, a = 0.12): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function EntityLogo({ name, color, url, size = 40 }: { name: string; color: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      <span className="shrink-0 bg-white overflow-hidden inline-flex items-center justify-center shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)]"
        style={{ width: size, height: size, borderRadius: size * 0.26 }}>
        <img src={url} alt="" className="w-full h-full object-contain" onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <ColorTile color={color} size={size} radius={size * 0.26}>
      <span className="font-semibold tracking-[-0.02em]" style={{ fontSize: size * 0.38 }}>{initials(name)}</span>
    </ColorTile>
  );
}

export function DocKindIcon({ kind, fileType, size = 16 }: { kind: DocKind; fileType?: FileType | ''; size?: number }) {
  if (kind === 'mindmap') return <Network size={size} />;
  if (kind === 'timeline') return <GanttChart size={size} />;
  if (kind === 'lesson') return <NotebookPen size={size} />;
  if (kind === 'cards') return <Layers size={size} />;
  switch (fileType) {
    case 'sheet': return <FileSpreadsheet size={size} />;
    case 'slide': return <Presentation size={size} />;
    case 'folder': return <Folder size={size} />;
    case 'image': return <Image size={size} />;
    case 'video': return <Video size={size} />;
    case 'doc': return <FileText size={size} />;
    case 'pdf': return <FileText size={size} />;
    case 'web': return <Link2 size={size} />;
    default: return kind === 'link' ? <Link2 size={size} /> : <SheetIcon size={size} />;
  }
}

/** Màu đại diện của 1 tài liệu: màu chọn tay → màu loại file (Drive) → màu loại tài liệu. */
export function docColor(d: { kind: DocKind; file_type: FileType | ''; color: string }): string {
  if (d.color) return d.color;
  if ((d.kind === 'drive' || d.kind === 'link') && d.file_type) return FILE_TYPES[d.file_type]?.color ?? DOC_KINDS[d.kind].color;
  return DOC_KINDS[d.kind].color;
}
export function docTypeLabel(d: { kind: DocKind; file_type: FileType | '' }): string {
  if ((d.kind === 'drive' || d.kind === 'link') && d.file_type) return FILE_TYPES[d.file_type]?.label ?? DOC_KINDS[d.kind].label;
  return DOC_KINDS[d.kind].label;
}

export function Pill({ tint, children, className = '' }: { tint: Tint; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-full text-[11.5px] font-medium whitespace-nowrap ${TINT[tint]} ${className}`}>{children}</span>;
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-[12px] font-medium text-[#6E6E73] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[#86868B] mt-1">{hint}</span>}
    </label>
  );
}

export const INPUT_CLS = `${INPUT} w-full h-10 md:h-9 px-3 text-[14px] md:text-[13.5px]`;
export const TEXTAREA_CLS = `${INPUT} w-full px-3 py-2 text-[14px] md:text-[13.5px] leading-relaxed resize-y`;

export function Swatches({ value, onChange, colors = SWATCHES }: { value: string; onChange: (c: string) => void; colors?: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={`Màu ${c}`}
          className="w-7 h-7 rounded-full inline-flex items-center justify-center transition active:scale-90"
          style={{ background: c, boxShadow: value.toLowerCase() === c.toLowerCase() ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : 'inset 0 0 0 0.5px rgba(0,0,0,0.15)' }}>
          {value.toLowerCase() === c.toLowerCase() && <Check size={13} strokeWidth={3} className="text-white" />}
        </button>
      ))}
    </div>
  );
}

/** Menu ⋯ (bấm ra ngoài để đóng). */
export function MoreMenu({ items, label = 'Thêm thao tác', className = '', button }: {
  items: ({ label: string; icon?: ReactNode; danger?: boolean; onClick: () => void } | null | false)[];
  label?: string;
  className?: string;
  button?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const list = items.filter(Boolean) as { label: string; icon?: ReactNode; danger?: boolean; onClick: () => void }[];
  if (!list.length) return null;
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" aria-label={label} title={label} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[#6E6E73] hover:bg-black/[0.06] hover:text-[#1D1D1F] transition">
        {button ?? <MoreHorizontal size={17} />}
      </button>
      {open && (
        <div className={`absolute right-0 top-9 z-50 min-w-[200px] py-1.5 ${POPOVER}`} onClick={e => e.stopPropagation()}>
          {list.map(it => (
            <button key={it.label} type="button" onClick={() => { setOpen(false); it.onClick(); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-black/[0.05] ${it.danger ? 'text-[#D70015]' : 'text-[#1D1D1F]'}`}>
              {it.icon && <span className="w-4 inline-flex justify-center opacity-80">{it.icon}</span>}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 md:py-16">
      <div className="w-14 h-14 rounded-[16px] bg-black/[0.04] text-[#86868B] inline-flex items-center justify-center mb-3">{icon}</div>
      <div className="text-[15px] font-semibold text-[#1D1D1F]">{title}</div>
      {text && <div className="text-[13px] text-[#86868B] mt-1 max-w-[420px] leading-relaxed">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Section({ title, icon, action, children, className = '' }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${CARD} ${className}`}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        {icon && <span className="text-[#86868B]">{icon}</span>}
        <h3 className="text-[13.5px] font-semibold text-[#1D1D1F] tracking-[-0.01em] flex-1 min-w-0 truncate">{title}</h3>
        {action}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

/** Hộp xác nhận (xoá…). */
export function Confirm({ title, text, confirmLabel, danger = true, onConfirm, onClose }: {
  title: string; text: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" role="presentation" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div role="alertdialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="relative w-full max-w-[380px] bg-white rounded-[20px] p-5 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.3)] animate-fade-in">
        <div className="text-[16px] font-semibold text-[#1D1D1F]">{title}</div>
        <div className="text-[13px] text-[#6E6E73] mt-1.5 leading-relaxed">{text}</div>
        <div className="flex gap-2 justify-end mt-5">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-full bg-black/[0.05] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.08]">Huỷ</button>
          <button type="button" disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}
            className={`h-9 px-4 rounded-full text-[13px] font-medium text-white disabled:opacity-50 ${danger ? 'bg-[#FF3B30] hover:bg-[#E0352B]' : 'bg-[#0071E3] hover:bg-[#0077ED]'}`}>
            {busy ? 'Đang xử lý…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Định dạng thời điểm sửa gần nhất: "14:05" hôm nay, "03/11" ngày khác. */
export function fmtWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('vi-VN', today ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', year: '2-digit' });
}
