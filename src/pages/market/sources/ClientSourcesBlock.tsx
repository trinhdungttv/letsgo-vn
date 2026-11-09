// Khối "Nguồn sinh viên" trong hồ sơ Khách hàng: trường đã gửi SV cho công ty này (gửi / đạt) +
// trường phù hợp nhất theo 4 tiêu chí (ngành, đường xe khách, kết quả đợt trước, đúng mùa). Bấm tên → hồ sơ ở Nguồn LĐ.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { loadLaborData, type LaborData } from '../../../lib/laborSources/api';
import { batchStats, industryIdByName, scoreMatch, type MatchCompany, type MatchContext } from '../../../lib/laborSources/match';
import { ensureToTarget, mergeRoutes, routeIndex, routeLookupKey } from '../../../lib/laborSources/targets';
import { upcomingMonths } from '../../../lib/laborSources/windows';
import { fmtDuration } from '../../../lib/laborSources/routing';
import type { Client } from '../../../lib/types';
import { todayVN } from '../../../lib/cskh/dates';
import { requestOpenSource } from './context';

interface IndustryRow { id: string; name: string; season_levels: number[] | null }

export default function ClientSourcesBlock({ client }: { client: Client }) {
  const [data, setData] = useState<LaborData | null>(null);
  const [industries, setIndustries] = useState<IndustryRow[]>([]);
  const today = todayVN();

  useEffect(() => {
    let alive = true;
    void loadLaborData().then(d => { if (alive) setData(d); }).catch(() => { if (alive) setData(null); });
    void supabase.from('industries').select('id, name, season_levels').then(({ data: rows, error }) => {
      if (alive && !error) setIndustries((rows ?? []) as IndustryRow[]);
    });
    return () => { alive = false; };
  }, [client.id]);

  // Tính đường xe khách từ mọi trường tới công ty này (nếu công ty có vị trí) — lưu chung
  useEffect(() => {
    if (!data?.ready || client.lat == null || client.lng == null) return;
    let alive = true;
    void ensureToTarget({ type: 'client', id: client.id, lat: client.lat, lng: client.lng }, data.sources, routeIndex(data.routes))
      .then(rows => { if (alive && rows.length) setData(d => (d ? { ...d, routes: mergeRoutes(d.routes, rows) } : d)); })
      .catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.ready, data?.sources.length, client.id, client.lat, client.lng]);

  const view = useMemo(() => {
    if (!data?.ready) return null;
    const byId = new Map(data.sources.map(s => [s.id, s]));
    const mine = data.batches.filter(b => b.client_id === client.id && byId.has(b.source_id));
    const bySource = new Map<string, typeof mine>();
    for (const b of mine) bySource.set(b.source_id, [...(bySource.get(b.source_id) ?? []), b]);
    const history = [...bySource.entries()].map(([id, bs]) => ({ s: byId.get(id)!, st: batchStats(bs) })).filter(x => x.st.sent > 0)
      .sort((a, b) => b.st.passed - a.st.passed);

    const company: MatchCompany = {
      type: 'client', id: client.id, name: client.name,
      industryId: industryIdByName(client.industry, industries), industryName: (client.industry ?? '').trim(),
      zoneId: null, lat: client.lat ?? null, lng: client.lng ?? null,
    };
    const idx = routeIndex(data.routes);
    const seasons = new Map(industries.map(i => [i.id, i.season_levels]));
    const ctx: MatchContext = { batches: data.batches, batchIndustry: () => null, seasonOf: id => seasons.get(id) ?? null };
    const top = data.sources.filter(s => s.status !== 'paused').map(s => {
      const progs = data.programs.filter(p => p.source_id === s.id);
      const r = idx.get(routeLookupKey(s.id, 'client', client.id));
      const m = scoreMatch(
        { id: s.id, lat: s.lat, lng: s.lng, industryIds: new Set(progs.flatMap(p => p.industry_ids)), months: upcomingMonths(data.windows.filter(w => w.source_id === s.id), today) },
        company, r ? { distanceKm: r.distance_km, durationMin: r.duration_min } : null, ctx);
      return { s, m };
    }).sort((a, b) => b.m.score - a.m.score).slice(0, 5);
    return { history, top };
  }, [data, industries, client, today]);

  if (!view || !data?.sources.length) return null;

  return (
    <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12.5px] font-semibold text-[#111]">🎓 Nguồn sinh viên</div>
        <a href="#/market/sources" className="text-[11.5px] text-[#1D4ED8] hover:underline">Nguồn LĐ →</a>
      </div>
      {view.history.length > 0 && (
        <>
          <div className="text-[11px] text-[#888] font-semibold uppercase tracking-wide mb-1">Đã gửi SV vào công ty này</div>
          <div className="space-y-1 mb-3">
            {view.history.map(({ s, st }) => (
              <button key={s.id} onClick={() => requestOpenSource(s.id)} className="w-full flex items-center gap-2 text-left text-[12.5px] px-2 py-1.5 rounded-lg hover:bg-[#F9F9F7]">
                <span className="flex-1 min-w-0 truncate text-[#111]">{s.short_name || s.name}</span>
                <span className="tabular-nums text-[#666]">{st.passed}/{st.sent}</span>
                <span className={`tabular-nums font-semibold ${st.rate! >= 0.6 ? 'text-emerald-600' : 'text-amber-600'}`}>{Math.round(st.rate! * 100)}%</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="text-[11px] text-[#888] font-semibold uppercase tracking-wide mb-1">Trường phù hợp nhất</div>
      <div className="space-y-1">
        {view.top.map(({ s, m }) => (
          <button key={s.id} onClick={() => requestOpenSource(s.id)} title={m.reasons.map(r => r.text).join('\n')}
            className="w-full flex items-center gap-2 text-left text-[12.5px] px-2 py-1.5 rounded-lg hover:bg-[#F9F9F7]">
            <span className={`shrink-0 w-8 text-center rounded-md text-[11px] font-bold py-0.5 ${m.score >= 70 ? 'bg-emerald-50 text-emerald-700' : m.score >= 45 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{m.score}</span>
            <span className="flex-1 min-w-0 truncate text-[#111]">{s.short_name || s.name}</span>
            <span className="shrink-0 text-[11.5px] text-[#888] tabular-nums">{m.durationMin != null ? `${m.estimated ? '≈' : ''}${fmtDuration(m.durationMin)}` : '—'}</span>
          </button>
        ))}
      </div>
      {client.lat == null && <div className="text-[11px] text-[#B45309] mt-2">Công ty chưa có toạ độ — dán link Google Maps để tính đường xe khách chính xác.</div>}
    </div>
  );
}
