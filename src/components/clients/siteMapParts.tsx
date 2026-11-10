import type { ZoneWorkshopInfo } from '../../lib/clientWorkflow/zoneLinks';
// Phần dùng chung của tab "Mặt bằng": ô sửa 1 khu vực (tên, ghi chú, màu, cỡ chữ, xoá) ở bảng chú thích —
// dùng cho cả mặt bằng ảnh (ClientSiteMaps) lẫn bản đồ vệ tinh (SatelliteSiteEditor).
import type { ReactNode } from 'react';
import { Trash2, X } from 'lucide-react';
import { ZONE_COLORS, ZONE_SIZES } from '../../lib/clientMaps/siteZones';

export interface ZoneFields { id: string; label: string; note: string; color: string; size?: number }

export function ZoneEditor({ z, mobile, onFocusText, onText, onStyle, onDelete, onClose, extra, labelPlaceholder = 'Tên khu (B5)', notePlaceholder = 'Ghi chú (Gia vị…)', labelMax = 40 }: {
  z: ZoneFields; mobile: boolean;
  /** Chữ gợi ý trong 2 ô (mặc định theo mặt bằng nhà xưởng). */
  labelPlaceholder?: string; notePlaceholder?: string; labelMax?: number;
  onFocusText: () => void;
  onText: (patch: Partial<ZoneFields>) => void;
  onStyle: (patch: Partial<ZoneFields>) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Nút thêm cạnh nút Xoá (VD "Căn thẳng theo khối"). */
  extra?: ReactNode;
}) {
  return (
    <div className="mx-2 my-1.5 p-3 rounded-xl border border-[#1D4ED8]/40 bg-[#F7F8FC] space-y-2">
      <div className="flex items-center gap-2">
        <input id={`zone-label-${z.id}`} value={z.label} maxLength={labelMax} placeholder={labelPlaceholder}
          onFocus={onFocusText} onChange={e => onText({ label: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') document.getElementById(`zone-note-${z.id}`)?.focus(); }}
          className="w-24 h-8 px-2 rounded-lg border border-[#D5D5DC] bg-white text-[13px] font-bold outline-none focus:border-[#1D4ED8]" style={{ color: z.color }} />
        <input id={`zone-note-${z.id}`} value={z.note} maxLength={300} placeholder={notePlaceholder}
          onFocus={onFocusText} onChange={e => onText({ note: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') onClose(); }}
          className="flex-1 min-w-0 h-8 px-2 rounded-lg border border-[#D5D5DC] bg-white text-[13px] outline-none focus:border-[#1D4ED8]" />
      </div>
      <div className="flex items-center gap-1.5">
        {ZONE_COLORS.map(c => (
          <button key={c} onClick={() => onStyle({ color: c })} aria-label={`Màu ${c}`}
            className={`w-6 h-6 rounded-full border-2 transition ${z.color === c ? 'border-[#111] scale-110' : 'border-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)]'}`}
            style={{ background: c }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {ZONE_SIZES.map(s => (
          <button key={s.k} onClick={() => onStyle({ size: s.k === 1 ? undefined : s.k })}
            className={`h-7 px-2 rounded-md text-[11.5px] ${(z.size ?? 1) === s.k ? 'bg-[#1D4ED8] text-white' : 'bg-white border border-[#E0E0E5] text-[#555]'}`}>
            {s.label}
          </button>
        ))}
        {extra}
        <button onClick={onDelete} className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-red-600 hover:bg-red-50">
          <Trash2 size={12} /> Xoá
        </button>
        {!mobile && <button onClick={onClose} className="h-7 px-2 rounded-md text-[11.5px] text-[#555] hover:bg-black/[0.05]">Xong</button>}
        {mobile && <button onClick={onClose} aria-label="Đóng" className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#555]"><X size={14} /></button>}
      </div>
    </div>
  );
}

/** Dòng nhỏ dưới tên khu vực ở bảng chú thích: khu này là xưởng nào trong Quy trình công việc (bấm để xem video / công đoạn). */
export function ZoneWorkshopBadges({ items, onOpen }: { items?: ZoneWorkshopInfo[]; onOpen?: (workshopId: string) => void }) {
  if (!items?.length || !onOpen) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {items.map(w => (
        <span key={w.id} role="button" tabIndex={0}
          onClick={e => { e.stopPropagation(); onOpen(w.id); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(w.id); } }}
          title="Mở quy trình công việc của xưởng này"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#EEF3FE] text-[#1D4ED8] hover:bg-[#E0EAFD] cursor-pointer">
          🎬 {w.name} · {w.steps} công đoạn{w.media ? ` · ${w.media} video/ảnh` : ''}
        </span>
      ))}
    </span>
  );
}
