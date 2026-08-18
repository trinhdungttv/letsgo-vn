import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

export interface CoverImageValue {
  url: string | null;
  /** 'cover' (lấp đầy, cắt ảnh) | 'contain' (tự khớp, giữ nguyên ảnh). null/undefined = 'cover'. */
  fit: string | null;
  posX: number | null;
  posY: number | null;
}

/** Ô nhập link ảnh cover (tỷ lệ 16:9) + chọn "Lấp đầy (cắt ảnh)"/"Tự khớp" + kéo chỉnh vị trí
 *  hiển thị (object-position) — cùng cơ chế đã dùng ở Khu vực (ZonesTab) và Đối thủ
 *  (CompetitorDetail, migration 116/128). Tách ra dùng chung thay vì copy-paste lần 3 (Khách
 *  hàng), để mọi nơi hiện card ảnh cover đồng nhất 1 hành vi. */
export default function CoverImageEditor({ value, onChange, urlPlaceholder = 'Dán link ảnh…', previewHint = 'Kéo ảnh để chỉnh vị trí hiển thị — khung này đúng tỷ lệ thẻ thật' }: {
  value: CoverImageValue;
  onChange: (v: CoverImageValue) => void;
  urlPlaceholder?: string;
  previewHint?: string;
}) {
  const imgBoxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // Ref giữ giá trị mới nhất để đọc trong onMove — movementX là delta TỪNG frame (không phải
  // từ lúc bắt đầu kéo), nên phải cộng dồn dựa trên giá trị vừa ghi ở frame trước, không phải
  // giá trị `value` (đã cũ) đóng gói lúc bắt đầu kéo.
  const valueRef = useRef(value);
  valueRef.current = value;

  const fit = value.fit ?? 'cover';
  const posX = value.posX ?? 50;
  const posY = value.posY ?? 50;

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const box = imgBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const dxPct = (ev.movementX / rect.width) * 100;
      const dyPct = (ev.movementY / rect.height) * 100;
      const cur = valueRef.current;
      const next: CoverImageValue = {
        ...cur,
        posX: Math.min(100, Math.max(0, (cur.posX ?? 50) - dxPct)),
        posY: Math.min(100, Math.max(0, (cur.posY ?? 50) - dyPct)),
      };
      valueRef.current = next;
      onChange(next);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5 items-center">
        <input
          value={value.url || ''}
          onChange={e => onChange({ ...value, url: e.target.value })}
          title={value.url || ''}
          placeholder={urlPlaceholder}
          className="text-[12.5px] flex-1 min-w-0 truncate px-2 py-1 rounded border border-gray-300 focus:border-blue-400 outline-none"
        />
        {value.url && (
          <div className="w-8 h-8 rounded overflow-hidden border border-gray-200 shrink-0">
            <img src={value.url} alt="" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
      {value.url && (
        <div>
          <div className="flex items-center gap-1 mb-1.5">
            <button type="button" onClick={() => onChange({ ...value, fit: 'cover' })}
              className={`px-2 py-1 rounded-lg text-[10.5px] font-medium border transition ${fit !== 'contain' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-[#666] hover:bg-[#F9F9F7]'}`}
            >Lấp đầy (cắt ảnh)</button>
            <button type="button" onClick={() => onChange({ ...value, fit: 'contain' })}
              className={`px-2 py-1 rounded-lg text-[10.5px] font-medium border transition ${fit === 'contain' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-[#666] hover:bg-[#F9F9F7]'}`}
            >Tự khớp (giữ nguyên ảnh)</button>
          </div>
          <div
            ref={imgBoxRef}
            onMouseDown={fit === 'contain' ? undefined : handleDragStart}
            className={`aspect-video w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 ${fit === 'contain' ? '' : dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          >
            <img
              src={value.url}
              alt=""
              draggable={false}
              className={`w-full h-full pointer-events-none select-none ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
              style={{ objectPosition: `${posX}% ${posY}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10.5px] text-[#999]">
              {fit === 'contain' ? 'Chế độ tự khớp: hiện toàn bộ ảnh, không cắt' : previewHint}
            </span>
            {fit !== 'contain' && (
              <button type="button" onClick={() => onChange({ ...value, posX: 50, posY: 50 })}
                className="inline-flex items-center gap-1 text-[10.5px] text-blue-600 hover:underline shrink-0">
                <RotateCcw size={10} /> Về giữa
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
