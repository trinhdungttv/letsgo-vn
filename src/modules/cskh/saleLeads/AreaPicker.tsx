// Chọn khu vực của đầu mối từ DANH SÁCH TẠO SẴN — mỗi khu vực là 1 mục riêng để lọc được:
//   • KCN  = danh mục Thị trường → Khu vực (market_zones, dùng chung với hồ sơ Sale / CTV);
//   • Khu vực khác = danh sách riêng của bảng nháp (tỉnh, quận / huyện… — migration 229), thêm được ngay ở đây.
// Chữ gốc lúc nhập chưa ghép được hiện thành viên xám: bấm vào là tìm sẵn chữ đó trong danh sách.
import { useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { areaKey, type NamedItem } from '../../../lib/saleLeads/match';
import { fold } from '../../../lib/saleLeads/parse';
import { SearchField } from '../components/apple';
import { AREA_CHIP, shortZone } from './helpers';

export interface AreaValue {
  zoneIds: string[];
  areaIds: string[];
}

export function AreaPicker({ zones, areas, areasReady, value, onChange, onCreate, hints = [], listClass = 'max-h-[300px]', initialQuery = '' }: {
  zones: readonly NamedItem[];
  areas: readonly NamedItem[];
  /** false = chưa chạy migration 229 (chỉ chọn được KCN). */
  areasReady: boolean;
  value: AreaValue;
  onChange: (v: AreaValue) => void;
  /** Thêm 1 khu vực mới vào danh sách; trả về mục vừa tạo (null = lỗi, đã báo). */
  onCreate?: (name: string) => Promise<NamedItem | null>;
  /** Chữ gốc chưa ghép — bấm để tìm. */
  hints?: readonly string[];
  listClass?: string;
  /** Tìm sẵn chữ này khi mở. */
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [creating, setCreating] = useState(false);

  const zoneSel = useMemo(() => new Set(value.zoneIds), [value.zoneIds]);
  const areaSel = useMemo(() => new Set(value.areaIds), [value.areaIds]);
  const qFold = fold(q).trim();
  const qKey = areaKey(q);
  const hit = (name: string) => !qFold || fold(name).includes(qFold) || (!!qKey && areaKey(name).includes(qKey));
  const zoneList = zones.filter(z => hit(z.name));
  const areaList = areasReady ? areas.filter(a => hit(a.name)) : [];
  const exact = !!qKey && [...zones, ...areas].some(x => areaKey(x.name) === qKey);

  const toggleZone = (id: string) => onChange({ ...value, zoneIds: zoneSel.has(id) ? value.zoneIds.filter(x => x !== id) : [...value.zoneIds, id] });
  const toggleArea = (id: string) => onChange({ ...value, areaIds: areaSel.has(id) ? value.areaIds.filter(x => x !== id) : [...value.areaIds, id] });

  const create = async () => {
    if (!onCreate || !q.trim() || creating) return;
    setCreating(true);
    const made = await onCreate(q.trim());
    setCreating(false);
    if (made) {
      onChange({ ...value, areaIds: value.areaIds.includes(made.id) ? value.areaIds : [...value.areaIds, made.id] });
      setQ('');
    }
  };

  const chosen = [
    ...zones.filter(z => zoneSel.has(z.id)).map(z => ({ key: `z:${z.id}`, label: shortZone(z.name), cls: AREA_CHIP.zone, off: () => toggleZone(z.id) })),
    ...areas.filter(a => areaSel.has(a.id)).map(a => ({ key: `a:${a.id}`, label: a.name, cls: AREA_CHIP.area, off: () => toggleArea(a.id) })),
  ];

  const row = (id: string, name: string, on: boolean, toggle: () => void) => (
    <li key={id}>
      <button type="button" onClick={toggle} aria-pressed={on}
        className={`w-full flex items-center gap-2.5 px-3 min-h-[40px] md:min-h-[34px] text-left text-[13.5px] md:text-[13px] transition ${on ? 'bg-[#0071E3]/[0.06]' : 'hover:bg-black/[0.03]'}`}>
        <span className={`w-[18px] h-[18px] rounded-[5px] shrink-0 flex items-center justify-center border transition ${on ? 'bg-[#0071E3] border-[#0071E3] text-white' : 'border-black/20 bg-white'}`}>
          {on && <Check size={12} strokeWidth={3} />}
        </span>
        <span className={`flex-1 min-w-0 truncate ${on ? 'font-medium text-[#1D1D1F]' : 'text-[#3C3C43]'}`}>{name}</span>
      </button>
    </li>
  );

  return (
    <div className="space-y-2.5">
      {hints.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-[#86868B]">Chữ gốc chưa ghép:</span>
          {hints.map(h => (
            <button key={h} type="button" onClick={() => setQ(h)} title="Tìm chữ này trong danh sách"
              className={`px-2 h-7 inline-flex items-center rounded-full text-[12px] font-medium ${AREA_CHIP.raw} hover:bg-black/[0.09] transition`}>
              {h}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 min-h-[28px]">
        {chosen.length === 0
          ? <span className="text-[12.5px] text-[#86868B]">Chưa chọn khu vực nào</span>
          : chosen.map(c => (
            <span key={c.key} className={`inline-flex items-center gap-0.5 rounded-full pl-2.5 pr-0.5 h-8 md:h-7 max-w-full ${c.cls}`}>
              <span className="text-[12.5px] font-medium truncate">{c.label}</span>
              <button type="button" onClick={c.off} aria-label={`Bỏ ${c.label}`}
                className="w-7 h-7 md:w-6 md:h-6 shrink-0 rounded-full hover:bg-black/[0.08] flex items-center justify-center">
                <X size={12} strokeWidth={2.6} />
              </button>
            </span>
          ))}
      </div>

      <SearchField value={q} onChange={setQ} placeholder="Tìm KCN / khu vực — hoặc gõ tên mới để thêm vào danh sách" className="w-full" />

      <div className={`rounded-[12px] bg-white border border-black/[0.08] overflow-y-auto overscroll-contain ${listClass}`}>
        {q.trim() && !exact && onCreate && (
          areasReady ? (
            <button type="button" onClick={() => void create()} disabled={creating}
              className="w-full flex items-center gap-2 px-3 min-h-[42px] md:min-h-[36px] text-left text-[13px] font-medium text-[#0066CC] bg-[#0071E3]/[0.05] hover:bg-[#0071E3]/[0.1] border-b border-black/[0.06] disabled:opacity-50 transition">
              <Plus size={15} strokeWidth={2.4} className="shrink-0" />
              <span className="truncate">{creating ? 'Đang thêm…' : <>Thêm «{q.trim()}» vào danh sách khu vực</>}</span>
            </button>
          ) : (
            <p className="px-3 py-2 text-[12px] text-[#B25000] border-b border-black/[0.06]">
              Muốn thêm khu vực mới (ngoài KCN) cần chạy migration 229 trên Supabase.
            </p>
          )
        )}
        {areaList.length > 0 && (
          <>
            <p className="sticky top-0 z-[1] px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#86868B] bg-white/95 backdrop-blur">Khu vực</p>
            <ul>{areaList.map(a => row(a.id, a.name, areaSel.has(a.id), () => toggleArea(a.id)))}</ul>
          </>
        )}
        {zoneList.length > 0 && (
          <>
            <p className="sticky top-0 z-[1] px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#86868B] bg-white/95 backdrop-blur">KCN · Thị trường → Khu vực</p>
            <ul>{zoneList.map(z => row(z.id, z.name, zoneSel.has(z.id), () => toggleZone(z.id)))}</ul>
          </>
        )}
        {!zoneList.length && !areaList.length && (
          <p className="px-3 py-4 text-center text-[12.5px] text-[#86868B]">{q.trim() ? 'Không có trong danh sách' : 'Danh sách trống'}</p>
        )}
      </div>
    </div>
  );
}
