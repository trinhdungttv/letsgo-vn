// Ghép công ty: chọn 1 công ty (hoặc 1 KCN) → xếp hạng trường / đơn vị nguồn phù hợp nhất theo 4 tiêu chí.
// Công ty có vị trí → tính đường xe khách từ mọi trường tới công ty (1–2 lượt gọi), lưu chung.
import { useEffect, useMemo, useState } from 'react';
import { Building2, Factory, Plus, Sparkles, X } from 'lucide-react';
import { Panel, Quiet, Row, Segmented } from '../../../modules/cskh/components/apple';
import { ROUND_ADD, inputCls } from '../../../modules/cskh/ui';
import { foldVn } from '../../../lib/companyMatch';
import { MAX, scoreMatch, type MatchCompany, type MatchContext, type MatchResult } from '../../../lib/laborSources/match';
import { ensureToTarget, hasLL } from '../../../lib/laborSources/targets';
import type { LaborSource } from '../../../lib/laborSources/types';
import { useLabor } from './context';
import { BatchForm } from './ChildForms';
import { BusChip, KindPill, ReasonChips, ScoreRing, SourceAvatar, StatusPill } from './parts';

type Mode = 'company' | 'zone';
const KEY = 'lgvn_labor_match_v1';

export default function MatchView() {
  const L = useLabor();
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') as { mode?: Mode; company?: string; zone?: string }; } catch { return {}; } })();
  const [mode, setMode] = useState<Mode>(saved.mode ?? 'company');
  const [companyKey, setCompanyKey] = useState(saved.company ?? '');
  const [zoneId, setZoneId] = useState(saved.zone ?? '');
  const [query, setQuery] = useState('');
  const [batchFor, setBatchFor] = useState<{ source: LaborSource; company: MatchCompany } | null>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ mode, company: companyKey, zone: zoneId })); } catch { /* bỏ qua */ } }, [mode, companyKey, zoneId]);

  const company = L.companies.find(c => `${c.type}:${c.id}` === companyKey) ?? null;
  const zone = L.zones.find(z => z.id === zoneId) ?? null;
  const zoneCompanies = useMemo(() => (zone ? L.companies.filter(c => c.zoneId === zone.id) : []), [zone, L.companies]);

  // Tính đường xe từ mọi trường tới đích đang chọn
  useEffect(() => {
    const target = mode === 'company'
      ? (company && company.lat != null && company.lng != null ? { type: company.type, id: company.id, lat: company.lat, lng: company.lng } : null)
      : (zone && hasLL(zone) ? { type: 'zone' as const, id: zone.id, lat: zone.lat, lng: zone.lng } : null);
    if (!target) return;
    let alive = true;
    L.setRouting('Đang tính đường xe khách từ các trường…');
    ensureToTarget(target, L.data.sources, L.routeIdx)
      .then(rows => { if (alive) L.addRoutes(rows); })
      .catch(() => { if (alive) L.toast('Chưa tính được đường xe — kiểm tra mạng rồi thử lại'); })
      .finally(() => L.setRouting(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, companyKey, zoneId, L.data.sources.length]);

  const ctx = useMemo<MatchContext>(() => {
    const ind = new Map(L.companies.map(c => [`${c.type}:${c.id}`, c.industryId]));
    const seasons = new Map(L.industries.map(i => [i.id, i.season_levels ?? null]));
    return {
      batches: L.data.batches,
      batchIndustry: b => ind.get(b.client_id ? `client:${b.client_id}` : `lead:${b.lead_id}`) ?? null,
      seasonOf: id => seasons.get(id) ?? null,
    };
  }, [L.companies, L.industries, L.data.batches]);

  const ranked = useMemo(() => {
    const srcInfo = (s: LaborSource) => ({ id: s.id, lat: s.lat, lng: s.lng, industryIds: new Set((L.programsBy.get(s.id) ?? []).flatMap(p => p.industry_ids)), months: L.monthsBy.get(s.id) ?? [] });
    if (mode === 'company' && company) {
      return L.data.sources.map(s => {
        const r = L.route(s.id, company.type, company.id);
        return { s, company, m: scoreMatch(srcInfo(s), company, r ? { distanceKm: r.distance_km, durationMin: r.duration_min } : null, ctx), route: r ?? null };
      }).sort((a, b) => b.m.score - a.m.score);
    }
    if (mode === 'zone' && zone) {
      // Mỗi trường: công ty trong KCN hợp nhất (công ty chưa có vị trí → dùng đường xe tới KCN)
      const zr = (s: LaborSource) => L.route(s.id, 'zone', zone.id) ?? null;
      return L.data.sources.map(s => {
        const info = srcInfo(s);
        const kcnRoute = zr(s);
        const pool: MatchCompany[] = zoneCompanies.length ? zoneCompanies
          : [{ type: 'client', id: `zone:${zone.id}`, name: zone.name, industryId: null, industryName: '', zoneId: zone.id, lat: zone.lat ?? null, lng: zone.lng ?? null }];
        let best: { c: MatchCompany; m: MatchResult } | null = null;
        for (const c of pool) {
          const own = L.route(s.id, c.type, c.id);
          const r = own ?? kcnRoute;
          const cc = c.lat == null && hasLL(zone) ? { ...c, lat: zone.lat as number, lng: zone.lng as number } : c;
          const m = scoreMatch(info, cc, r ? { distanceKm: r.distance_km, durationMin: r.duration_min } : null, ctx);
          if (!best || m.score > best.m.score) best = { c, m };
        }
        return { s, company: best!.c, m: best!.m, route: kcnRoute };
      }).sort((a, b) => b.m.score - a.m.score);
    }
    return [];
  }, [mode, company, zone, zoneCompanies, L, ctx]);

  const options = useMemo(() => {
    const k = foldVn(query).trim();
    const list = k ? L.companies.filter(c => foldVn(c.name).includes(k)) : L.companies;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'vi')).slice(0, 40);
  }, [query, L.companies]);

  return (
    <div className="space-y-3">
      <Segmented<Mode> label="Ghép theo" value={mode} onChange={setMode} fit
        options={[{ key: 'company', label: 'Theo công ty', icon: <Building2 size={14} /> }, { key: 'zone', label: 'Theo KCN', icon: <Factory size={14} /> }]} />

      <Panel title={mode === 'company' ? 'Công ty cần người' : 'KCN cần người'} icon={<Sparkles size={16} className="text-[#AF52DE]" />}
        meta={`Điểm phù hợp: ngành đào tạo ${MAX.industry} · đường xe khách ${MAX.distance} · kết quả đợt trước ${MAX.history} · đúng mùa ${MAX.season}`}>
        <div className="pb-3">
          {mode === 'company' ? (
            company ? (
              <div className="flex items-center gap-2 rounded-[12px] bg-[#0071E3]/[0.08] px-3 py-2.5">
                <Building2 size={16} className="text-[#0058B0]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-[#0058B0] truncate">{company.name}</p>
                  <p className="text-[12px] text-[#6E6E73]">{company.type === 'client' ? 'Khách hàng' : 'Công ty / Dự án'} · {company.industryName || 'chưa ghi ngành'}{company.zoneId ? ` · ${L.zones.find(z => z.id === company.zoneId)?.name ?? ''}` : ''}{company.lat == null ? ' · chưa có vị trí (dùng ước tính)' : ''}</p>
                </div>
                <button type="button" onClick={() => setCompanyKey('')} className="w-8 h-8 rounded-full hover:bg-black/[0.05] flex items-center justify-center text-[#86868B]" aria-label="Chọn công ty khác"><X size={16} /></button>
              </div>
            ) : (
              <>
                <input value={query} onChange={e => setQuery(e.target.value)} className={inputCls} placeholder="Tìm công ty trong Khách hàng / Công ty-Dự án…" />
                <ul className="mt-2 max-h-[300px] overflow-y-auto rounded-[12px] bg-[#F5F5F7]">
                  {options.map(c => (
                    <li key={`${c.type}:${c.id}`}>
                      <button type="button" onClick={() => { setCompanyKey(`${c.type}:${c.id}`); setQuery(''); }} className="w-full text-left px-3 py-2 text-[13.5px] hover:bg-black/[0.04] flex items-center justify-between gap-2">
                        <span className="truncate">{c.name}</span>
                        <span className="text-[11.5px] text-[#86868B] shrink-0">{c.industryName || (c.type === 'client' ? 'Khách hàng' : 'Công ty/Dự án')}</span>
                      </button>
                    </li>
                  ))}
                  {!options.length && <li className="px-3 py-3 text-[13px] text-[#86868B]">Không thấy công ty nào</li>}
                </ul>
              </>
            )
          ) : (
            <select value={zoneId} onChange={e => setZoneId(e.target.value)} className={inputCls}>
              <option value="">— Chọn KCN —</option>
              {L.zones.map(z => <option key={z.id} value={z.id}>{z.name}{z.location ? ` · ${z.location}` : ''}{hasLL(z) ? '' : ' (chưa có toạ độ)'}</option>)}
            </select>
          )}
          {mode === 'zone' && zone && <p className="mt-2 text-[12px] text-[#86868B]">{zoneCompanies.length ? `${zoneCompanies.length} công ty trong KCN — mỗi trường lấy công ty hợp nhất` : 'Chưa có công ty nào gắn KCN này — chỉ xét đường xe và mùa thực tập'}</p>}
        </div>
      </Panel>

      {(company || zone) && (
        <Panel title="Trường / nguồn phù hợp" count={ranked.length}>
          {ranked.length === 0 ? <Quiet>Chưa có đơn vị nguồn nào.</Quiet> : ranked.slice(0, 30).map(({ s, company: c, m, route }, i) => (
            <Row key={s.id} first={i === 0} inset={56} align="start">
              <ScoreRing score={m.score} />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => L.openSource(s.id)} className="flex items-center gap-2 min-w-0 text-left">
                  <SourceAvatar kind={s.kind} logo={s.logo_url} size={22} />
                  <span className="text-[14.5px] font-semibold text-[#1D1D1F] truncate hover:text-[#0066CC]">{s.short_name || s.name}</span>
                </button>
                <div className="flex flex-wrap items-center gap-1 mt-1 mb-1.5">
                  <KindPill kind={s.kind} /><StatusPill status={s.status} />
                  <BusChip route={route} estimate={!route && m.durationMin != null && m.distanceKm != null ? { min: m.durationMin, km: m.distanceKm } : null} compact />
                  {mode === 'zone' && zoneCompanies.length > 0 && <span className="text-[12px] text-[#6E6E73]">hợp nhất: <b className="font-medium">{c.name}</b></span>}
                </div>
                <ReasonChips reasons={m.reasons} />
              </div>
              {!c.id.startsWith('zone:') && (
                <button type="button" title={`Ghi đợt gửi SV vào ${c.name}`} onClick={() => setBatchFor({ source: s, company: c })} className={ROUND_ADD}><Plus size={16} /></button>
              )}
            </Row>
          ))}
        </Panel>
      )}

      {batchFor && <BatchForm source={batchFor.source} batch={null} preset={{ type: batchFor.company.type, id: batchFor.company.id }} onClose={() => setBatchFor(null)} />}
    </div>
  );
}
