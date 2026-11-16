// Chọn lại khu vực từ danh sách — mở khi bấm ô "Khu vực" của 1 đầu mối, hoặc "Gắn khu vực" cho nhiều
// dòng đang chọn (chế độ THÊM: giữ khu vực cũ của từng người, cộng thêm mục vừa chọn).
import { useMemo, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { patchSaleLead, setLeadAreas } from '../../../lib/saleLeads/api';
import { matchAreaZones, pendingPartsOf, type NamedItem } from '../../../lib/saleLeads/match';
import type { SaleLead } from '../../../lib/saleLeads/types';
import { Sheet, SHEET_FOOTER } from '../components/Sheet';
import { AreaPicker, type AreaValue } from './AreaPicker';

export function LeadAreaSheet({ leads, zones, areas, areasReady, onCreateArea, toast, onClose, onSaved }: {
  /** 1 người = chọn lại; nhiều người = thêm khu vực cho cả nhóm. */
  leads: readonly SaleLead[];
  zones: readonly NamedItem[];
  areas: readonly NamedItem[];
  areasReady: boolean;
  onCreateArea: (name: string) => Promise<NamedItem | null>;
  toast: (m: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const single = leads.length === 1 ? leads[0] : null;
  // Chọn sẵn: khu vực đang có + mục trùng tên chữ gốc chưa ghép (VD "Vsip1" → KCN Vsip 1, "Dĩ An" → Dĩ An)
  const [value, setValue] = useState<AreaValue>(() => {
    if (!single) return { zoneIds: [], areaIds: [] };
    const zoneIds = single.zoneIds.filter(id => zones.some(z => z.id === id));
    const areaIds = single.areaIds.filter(id => areas.some(a => a.id === id));
    for (const p of pendingPartsOf(single, zones, areas)) {
      const hit = matchAreaZones(p, zones, areasReady ? areas : []);
      for (const id of hit.ids) if (!zoneIds.includes(id)) zoneIds.push(id);
      for (const id of hit.areaIds) if (!areaIds.includes(id)) areaIds.push(id);
    }
    return { zoneIds, areaIds };
  });
  const preset = useState(() => !!single && (value.zoneIds.length > single.zoneIds.length || value.areaIds.length > single.areaIds.length))[0];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Chữ gốc chưa ghép (kể cả khi đã chọn lại trước đây — để đối chiếu)
  const hints = useMemo(() => (single ? pendingPartsOf({ ...single, areaReviewed: false, ...value }, zones, areas) : []), [single, value, zones, areas]);

  const save = async () => {
    if (!single && !value.zoneIds.length && !value.areaIds.length) { setError('Chọn ít nhất 1 khu vực'); return; }
    setSaving(true);
    setError('');
    try {
      for (const l of leads) {
        const next = single ? value : {
          zoneIds: [...new Set([...l.zoneIds, ...value.zoneIds])],
          areaIds: [...new Set([...l.areaIds, ...value.areaIds])],
        };
        if (areasReady) await setLeadAreas(l.id, { ...next, reviewed: single ? true : undefined }, user);
        else await patchSaleLead(l.id, { zone_ids: next.zoneIds }, user);
      }
      toast(single ? `Đã lưu khu vực của "${single.fullName || single.phone}"` : `Đã gắn khu vực cho ${leads.length} đầu mối`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Sheet label="Chọn khu vực" onClose={onClose}>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] pr-10">
        {single ? 'Khu vực' : `Gắn khu vực · ${leads.length} đầu mối`}
      </h2>
      <p className="text-[13px] text-[#6E6E73] mt-0.5 leading-snug">
        {single
          ? <><b className="font-medium text-[#1D1D1F]">{single.fullName || single.phone}</b> — chọn từ danh sách, mỗi khu vực là 1 mục lọc được.</>
          : 'Khu vực chọn ở đây được THÊM vào khu vực sẵn có của từng người.'}
      </p>
      {single?.areaText && (
        <p className="mt-2 text-[12px] text-[#86868B] leading-snug">
          Chữ gốc khi nhập: <span className="text-[#3C3C43]">{single.areaText}</span>
          {preset && <span className="text-[#248A3D]"> · đã chọn sẵn mục trùng tên, kiểm rồi bấm Lưu</span>}
        </p>
      )}
      {!areasReady && (
        <p className="mt-2 rounded-[10px] bg-[#FF9500]/[0.12] px-3 py-2 text-[12px] leading-snug text-[#7A3E00]">
          Chưa chạy migration 229 — tạm chỉ chọn được KCN. Chạy file <code>20261116100000_229_sale_lead_areas.sql</code> để có danh sách khu vực riêng.
        </p>
      )}

      <div className="mt-3">
        <AreaPicker zones={zones} areas={areas} areasReady={areasReady} value={value} onChange={setValue}
          onCreate={onCreateArea} hints={hints} listClass="max-h-[42dvh] md:max-h-[320px]" />
      </div>

      {error && <p className="mt-3 text-[13px] text-[#D70015]">{error}</p>}

      <div className={`${SHEET_FOOTER} mt-4 flex items-center gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="h-10 md:h-9 px-4 rounded-full text-[13px] font-medium text-[#1D1D1F] bg-black/[0.05] hover:bg-black/[0.08] transition">Huỷ</button>
        <button type="button" onClick={() => void save()} disabled={saving}
          className="h-10 md:h-9 px-5 rounded-full text-[13px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 transition">
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </Sheet>
  );
}
