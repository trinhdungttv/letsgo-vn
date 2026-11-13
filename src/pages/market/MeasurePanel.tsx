// Bảng «Đo khoảng cách» trên Bản đồ Thị trường, kiểu chỉ đường Google Maps: A → B → C …
// Kéo nút ⠿ (chuột hoặc ngón tay) để đổi thứ tự, ✕ bỏ 1 điểm, «+ Thêm điểm dừng», xuất phát từ vị trí hiện tại.
// Bảng chỉ hiển thị — trạng thái + tính đường nằm ở MapViewTab (bản đồ cần vẽ theo).
import { Fragment, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, X, Plus, ArrowUpDown, Sparkles, LocateFixed, ExternalLink, Loader2, MapPin } from 'lucide-react';
import SearchSelect from './SearchSelect';
import { MAX_STOPS, MY_LOCATION, dropIndex, fmtDuration, fmtKm, moveItem, stopColor, stopLetter, type MultiRoute } from './measureRoute';

export interface StopRow {
  key: number;
  /** '' = chưa chọn · MY_LOCATION · id điểm trên bản đồ */
  id: string;
  /** Ảnh chụp lúc chọn — điểm bị bộ lọc tỉnh/ngành ẩn đi vẫn giữ được trên lộ trình */
  label?: string;
  name?: string;
  lat?: number;
  lng?: number;
}

interface Props {
  rows: StopRow[];
  onRows: (rows: StopRow[]) => void;
  onPick: (index: number, id: string) => void;
  optionsFor: (index: number) => { value: string; label: string }[];
  /** Chặng nối từ dòng này sang điểm có toạ độ kế tiếp (theo chỉ số dòng) */
  legs: Map<number, { km: number; sec: number | null }>;
  route: MultiRoute | null;
  loading: boolean;
  straightKm: number | null;
  filledCount: number;
  locating: boolean;
  onRefreshMe: () => void;
  onAdd: () => void;
  onStartFromMe: (() => void) | null;
  onOptimize: (() => void) | null;
  optimizing: boolean;
  googleLink: string | null;
  onClear: () => void;
}

const chip = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition disabled:opacity-40';
const chipIdle = `${chip} bg-white border-[#D8D6D0] text-[#555] hover:bg-[#F9F9F7]`;

export default function MeasurePanel(p: Props) {
  const { rows } = p;
  const rowEls = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<{ from: number; over: number; pid: number } | null>(null);
  const shown = drag ? moveItem(rows, drag.from, drag.over) : rows;

  const onDown = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (rows.length < 2) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: i, over: i, pid: e.pointerId });
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const mids: number[] = [];
    shown.forEach((_, j) => {
      if (j === drag.over) return;
      const r = rowEls.current[j]?.getBoundingClientRect();
      if (r) mids.push(r.top + r.height / 2);
    });
    const over = dropIndex(mids, e.clientY);
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const onUp = (commit: boolean) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pid) return;
    if (commit && drag.over !== drag.from) p.onRows(moveItem(rows, drag.from, drag.over));
    setDrag(null);
  };

  const hasMe = rows.some(r => r.id === MY_LOCATION);
  const modeLabel = p.route?.mode === 'car' ? 'ô tô' : 'xe máy';

  return (
    <div className="w-full md:max-w-[560px] bg-white border border-[#E8E7E2] rounded-[10px] px-2 py-2">
      {shown.map((row, j) => {
        const orig = rows.indexOf(row);
        const leg = drag ? undefined : p.legs.get(orig);
        const color = stopColor(j, shown.length);
        return (
          <Fragment key={row.key}>
            <div ref={el => { rowEls.current[j] = el; }}
              className={`flex items-center gap-1.5 rounded-lg ${drag && j === drag.over ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}>
              <button type="button" aria-label="Kéo để đổi thứ tự" title="Kéo lên / xuống để đổi thứ tự"
                onPointerDown={onDown(j)} onPointerMove={onMove} onPointerUp={onUp(true)} onPointerCancel={onUp(false)}
                style={{ touchAction: 'none' }}
                className="w-6 h-9 flex-none flex items-center justify-center text-[#B5B3AD] hover:text-[#666] cursor-grab active:cursor-grabbing">
                <GripVertical size={15} />
              </button>
              <span className="w-5 h-5 flex-none rounded-full text-white text-[10.5px] font-bold flex items-center justify-center" style={{ backgroundColor: color }}>
                {stopLetter(j)}
              </span>
              <SearchSelect
                value={row.id}
                onChange={v => p.onPick(orig, v)}
                options={p.optionsFor(orig)}
                placeholder={j === 0 ? 'Điểm xuất phát… (gõ để tìm)' : 'Đến điểm… (gõ để tìm)'}
                className="flex-1 min-w-0"
              />
              {row.id === MY_LOCATION && (
                <button type="button" onClick={p.onRefreshMe} disabled={p.locating} title="Lấy lại vị trí hiện tại"
                  className="w-8 h-8 flex-none flex items-center justify-center rounded-lg text-[#0A84FF] hover:bg-blue-50 disabled:opacity-50">
                  {p.locating ? <Loader2 size={15} className="animate-spin" /> : <LocateFixed size={15} />}
                </button>
              )}
              {rows.length > 2 && (
                <button type="button" onClick={() => p.onRows(rows.filter((_, k) => k !== orig))} title="Bỏ điểm này"
                  className="w-8 h-8 flex-none flex items-center justify-center rounded-lg text-[#999] hover:text-[#333] hover:bg-[#F3F2EE]">
                  <X size={14} />
                </button>
              )}
            </div>
            {j < shown.length - 1 && (
              <div className="ml-[18px] pl-[22px] border-l-2 border-dotted border-[#D8D6D0] min-h-[10px] text-[11px] text-[#888] leading-4 py-0.5">
                {leg && (leg.sec != null
                  ? <>{fmtKm(leg.km)} km · {fmtDuration(leg.sec)}</>
                  : <>≈ {fmtKm(leg.km)} km chim bay</>)}
              </div>
            )}
          </Fragment>
        );
      })}

      <div className="flex items-center gap-1.5 flex-wrap mt-2 pl-1">
        <button type="button" onClick={p.onAdd} disabled={rows.length >= MAX_STOPS} className={chipIdle}
          title={rows.length >= MAX_STOPS ? `Tối đa ${MAX_STOPS} điểm` : undefined}>
          <Plus size={12} /> Thêm điểm dừng
        </button>
        {!hasMe && p.onStartFromMe && (
          <button type="button" onClick={p.onStartFromMe} className={`${chip} bg-blue-50 border-blue-200 text-[#0A84FF] hover:bg-blue-100`}>
            <MapPin size={12} /> Xuất phát từ vị trí của tôi
          </button>
        )}
        {p.filledCount >= 2 && (
          <button type="button" onClick={() => p.onRows(rows.slice().reverse())} className={chipIdle} title="Đảo ngược thứ tự các điểm">
            <ArrowUpDown size={12} /> Đảo chiều
          </button>
        )}
        {p.onOptimize && (
          <button type="button" onClick={p.onOptimize} disabled={p.optimizing} className={chipIdle}
            title="Giữ điểm A, sắp các điểm còn lại theo thứ tự đi nhanh nhất">
            {p.optimizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Sắp thứ tự nhanh nhất
          </button>
        )}
        {p.googleLink && (
          <a href={p.googleLink} target="_blank" rel="noopener noreferrer" className={chipIdle}>
            <ExternalLink size={12} /> Mở Google Maps
          </a>
        )}
        {p.filledCount > 0 && (
          <button type="button" onClick={p.onClear} className="ml-auto text-[11.5px] text-[#999] hover:text-[#333] px-1.5">Xoá hết</button>
        )}
      </div>

      <div className="mt-2 pl-1 text-[12px]">
        {p.filledCount < 2 ? (
          <span className="text-[#999]">Chọn ít nhất 2 điểm · kéo <GripVertical size={11} className="inline -mt-0.5" /> để đổi thứ tự</span>
        ) : p.loading ? (
          <span className="text-[#888] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin text-blue-500" /> Đang tính đường đi…</span>
        ) : p.route ? (
          <span className="font-semibold text-blue-700">
            Tổng {fmtKm(p.route.km)} km · {fmtDuration(p.route.sec)}
            <span className="font-normal text-[#888]"> {modeLabel}</span>
            {p.straightKm != null && <span className="font-normal text-[#aaa]"> · {fmtKm(p.straightKm)} km chim bay</span>}
          </span>
        ) : p.straightKm != null ? (
          <span className="font-semibold text-red-600">
            ≈ {fmtKm(p.straightKm)} km <span className="font-normal text-[#888]">(chim bay — không lấy được đường đi)</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
