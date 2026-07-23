import { useMemo } from 'react';
import { Grid3x3, Eye, Sparkles } from 'lucide-react';
import type { Client, MarketLead, Competitor } from '../../lib/types';

interface Props {
  industryName: string;
  clients: Client[];
  marketLeads: MarketLead[];
  competitors: Competitor[];
}

interface Row {
  region: string;
  clients: string[];
  leads: string[];
  workers: number;
  wageMin: number | null;
  wageMax: number | null;
  zones: Set<string>;
  competitors: Competitor[];
}

const fmtTr = (v: number | null) => v != null ? (v / 1_000_000).toFixed(1) : null;

export default function IndustryMatrix({ industryName, clients, marketLeads, competitors }: Props) {
  // Ma trận ngành × khu vực — dựng hoàn toàn từ dữ liệu đã có, không cần nhập thêm.
  const { rows, indCompetitors } = useMemo(() => {
    const map = new Map<string, Row>();
    const get = (region: string): Row => {
      let r = map.get(region);
      if (!r) { r = { region, clients: [], leads: [], workers: 0, wageMin: null, wageMax: null, zones: new Set(), competitors: [] }; map.set(region, r); }
      return r;
    };
    const feed = (r: Row, min?: number | null, max?: number | null) => {
      if (min != null) r.wageMin = r.wageMin == null ? min : Math.min(r.wageMin, min);
      if (max != null) r.wageMax = r.wageMax == null ? max : Math.max(r.wageMax, max);
    };

    const indClientNames = new Set<string>();
    for (const c of clients) {
      if (c.industry !== industryName) continue;
      indClientNames.add(c.name.trim().toLowerCase());
      const r = get(c.region || 'Chưa rõ khu vực');
      r.clients.push(c.name);
      r.workers += c.current_workers ?? 0;
      feed(r, c.wage_min, c.wage_max);
      for (const z of c.industrial_zones ?? []) r.zones.add(z);
    }
    for (const l of marketLeads) {
      if (l.industry !== industryName) continue;
      indClientNames.add(l.company_name.trim().toLowerCase());
      const r = get(l.region || 'Chưa rõ khu vực');
      r.leads.push(l.company_name);
      feed(r, l.wage_min, l.wage_max);
    }

    // Đối thủ được coi là "phục vụ ngành này" nếu họ đang cung ứng cho ít nhất
    // một công ty thuộc ngành (KH của mình hoặc dự án đang tìm hiểu).
    const indCompetitors = competitors.filter(cp =>
      (cp.supplying_for ?? []).some(n => indClientNames.has(n.trim().toLowerCase())));

    for (const cp of indCompetitors) {
      const zones = [cp.zone_name, ...(cp.active_zones ?? [])].filter(Boolean) as string[];
      for (const r of map.values()) {
        const hit = zones.some(z => z.toLowerCase().includes(r.region.toLowerCase())
          || r.region.toLowerCase().includes(z.toLowerCase())
          || [...r.zones].some(rz => rz.toLowerCase() === z.toLowerCase()));
        if (hit && !r.competitors.includes(cp)) r.competitors.push(cp);
      }
    }

    const rows = [...map.values()].sort((a, b) =>
      (b.clients.length + b.leads.length) - (a.clients.length + a.leads.length));
    return { rows, indCompetitors };
  }, [industryName, clients, marketLeads, competitors]);

  if (rows.length === 0 && indCompetitors.length === 0) return null;

  const fee = (cp: Competitor) => {
    const v = cp.fee_unskilled ?? cp.fee_skilled ?? cp.fee_tech;
    return v != null ? (v / 1000).toFixed(0) + 'k' : '—';
  };

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E8E7E2] flex items-center gap-2">
        <Grid3x3 size={13} className="text-cyan-600" />
        <div className="text-[12.5px] font-semibold text-[#111]">Ngành này ở đâu · ai đang tranh</div>
        <span className="text-[10.5px] text-[#999]">tự tổng hợp từ KH, dự án và khảo sát đối thủ</span>
      </div>

      {rows.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] text-[#888] bg-[#FBFBF9]">
              <th className="text-left font-medium px-4 py-1.5">Khu vực</th>
              <th className="text-right font-medium px-2 py-1.5">KH</th>
              <th className="text-right font-medium px-2 py-1.5">Dự án</th>
              <th className="text-right font-medium px-2 py-1.5">LĐ</th>
              <th className="text-right font-medium px-2 py-1.5">Lương</th>
              <th className="text-right font-medium px-2 py-1.5">Đối thủ</th>
              <th className="text-left font-medium px-4 py-1.5">Đánh giá</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EEE9]">
            {rows.map(r => {
              const opportunity = r.clients.length === 0 && r.leads.length > 0;
              const contested = r.competitors.length > r.clients.length && r.competitors.length > 0;
              return (
                <tr key={r.region} className="hover:bg-[#FBFBF9]">
                  <td className="px-4 py-1.5">
                    <div className="font-medium text-[#111]">{r.region}</div>
                    {r.zones.size > 0 && <div className="text-[10.5px] text-[#999]">{[...r.zones].join(' · ')}</div>}
                  </td>
                  <td className="text-right px-2 py-1.5 text-emerald-700 font-medium">{r.clients.length || '—'}</td>
                  <td className="text-right px-2 py-1.5 text-blue-700 font-medium">{r.leads.length || '—'}</td>
                  <td className="text-right px-2 py-1.5">{r.workers ? r.workers.toLocaleString('vi-VN') : '—'}</td>
                  <td className="text-right px-2 py-1.5">
                    {r.wageMin != null || r.wageMax != null ? `${fmtTr(r.wageMin) ?? '—'}–${fmtTr(r.wageMax) ?? '—'}tr` : '—'}
                  </td>
                  <td className="text-right px-2 py-1.5 text-red-600 font-medium">{r.competitors.length || '—'}</td>
                  <td className="px-4 py-1.5">
                    {opportunity && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700"><Sparkles size={9} /> Cơ hội chưa khai thác</span>}
                    {contested && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-700 ml-1"><Eye size={9} /> Cạnh tranh gắt</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {indCompetitors.length > 0 && (
        <div className="border-t border-[#E8E7E2] p-3">
          <div className="text-[11.5px] font-medium text-[#666] mb-2">Đối thủ đang phục vụ ngành này</div>
          <div className="grid grid-cols-2 gap-2">
            {indCompetitors.map(cp => (
              <div key={cp.id} className="bg-[#F9F9F7] rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[#111] truncate">{cp.company_name}</span>
                  <span className="text-[11px] text-red-600 font-medium shrink-0">{fee(cp)}/người</span>
                </div>
                <div className="text-[10.5px] text-[#888] mt-0.5 truncate">{cp.zone_name}{cp.total_workers ? ` · ${cp.total_workers.toLocaleString('vi-VN')} LĐ` : ''}</div>
                {cp.weaknesses && <div className="text-[10.5px] text-emerald-700 mt-1 line-clamp-2">Điểm yếu: {cp.weaknesses}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
