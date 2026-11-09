// Danh sách đơn vị nguồn: tìm, lọc (loại / trạng thái / tỉnh / ngành), sắp theo đường xe tới 1 KCN.
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, RotateCcw, School, Trash2 } from 'lucide-react';
import { foldVn } from '../../../lib/companyMatch';
import { restoreSource } from '../../../lib/laborSources/api';
import { batchStats, estimateBusMinutes, monthsLabel } from '../../../lib/laborSources/match';
import { ensureToTarget, hasLL, routeLookupKey } from '../../../lib/laborSources/targets';
import { KIND_LABEL, SOURCE_KINDS, SOURCE_STATUSES, STATUS_LABEL, type LaborSource } from '../../../lib/laborSources/types';
import { MoreButton, Panel, PillSelect, Quiet, Row, SearchField } from '../../../modules/cskh/components/apple';
import { useLabor } from './context';
import { BusChip, CompetitorPill, KindPill, PursuitPill, RateBar, SourceAvatar, Stars, StatusPill } from './parts';

type Sort = 'name' | 'priority' | 'near' | 'rate' | 'season';
const PAGE = 40;

export default function ListView({ initialZoneId }: { initialZoneId: string }) {
  const L = useLabor();
  const { data, programsBy, batchesBy, monthsBy, zones, industries, routeIdx } = L;
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [province, setProvince] = useState('all');
  const [industry, setIndustry] = useState('all');
  /** Nhãn / đối thủ: all | uu_tien | lien_he_sau | none | comp | free */
  const [tagF, setTagF] = useState('all');
  const [zoneId, setZoneId] = useState(initialZoneId);
  const [sort, setSort] = useState<Sort>(initialZoneId ? 'near' : 'priority');
  const [limit, setLimit] = useState(PAGE);
  const [showTrash, setShowTrash] = useState(false);

  const zone = zones.find(z => z.id === zoneId) ?? null;
  const zoneTarget = useMemo(() => (zone && hasLL(zone) ? { type: 'zone' as const, id: zone.id, lat: zone.lat, lng: zone.lng } : null), [zone]);

  // Chọn KCN → tính đường xe từ mọi đơn vị tới KCN đó (1–2 lượt gọi), lưu lại dùng chung
  useEffect(() => {
    if (!zoneTarget) return;
    let alive = true;
    const pending = data.sources.filter(s => hasLL(s) && !routeIdx.has(routeLookupKey(s.id, 'zone', zoneTarget.id))).length;
    if (pending) L.setRouting(`Đang tính đường xe tới ${zone!.name}…`);
    ensureToTarget(zoneTarget, data.sources, routeIdx)
      .then(rows => { if (alive) L.addRoutes(rows); })
      .catch(() => { if (alive) L.toast('Chưa tính được đường xe — kiểm tra mạng rồi thử lại'); })
      .finally(() => L.setRouting(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTarget?.id, data.sources.length]);

  const provinces = useMemo(() => [...new Set(data.sources.map(s => s.province.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [data.sources]);
  const usedIndustries = useMemo(() => {
    const ids = new Set(data.programs.flatMap(p => p.industry_ids));
    return industries.filter(i => ids.has(i.id));
  }, [data.programs, industries]);

  const rows = useMemo(() => {
    const k = foldVn(q).trim();
    const list = data.sources.filter(s => {
      if (kind !== 'all' && s.kind !== kind) return false;
      if (status !== 'all' && s.status !== status) return false;
      if (province !== 'all' && s.province.trim() !== province) return false;
      const progs = programsBy.get(s.id) ?? [];
      if (industry !== 'all' && !progs.some(p => p.industry_ids.includes(industry))) return false;
      if (tagF === 'uu_tien' || tagF === 'lien_he_sau') { if (s.pursuit !== tagF) return false; }
      else if (tagF === 'none' && s.pursuit) return false;
      else if (tagF === 'comp' && !s.competitor_ids.length) return false;
      else if (tagF === 'free' && s.competitor_ids.length) return false;
      if (k) {
        const hay = foldVn([s.name, s.short_name, s.province, s.address, ...s.tags, ...progs.map(p => p.name), ...L.competitorNames(s.competitor_ids)].join(' '));
        if (!hay.includes(k)) return false;
      }
      return true;
    }).map(s => {
      const route = zoneTarget ? routeIdx.get(routeLookupKey(s.id, 'zone', zoneTarget.id)) ?? null : null;
      const est = zoneTarget && !route && hasLL(s) ? estimateBusMinutes(s as { lat: number; lng: number }, zoneTarget) : null;
      return { s, route, est, stats: batchStats(batchesBy.get(s.id) ?? []), months: monthsBy.get(s.id) ?? [], progs: programsBy.get(s.id) ?? [] };
    });
    const rank = (s: LaborSource) => (s.pursuit === 'uu_tien' ? 0 : s.pursuit === 'lien_he_sau' ? 2 : 1) + (s.competitor_ids.length ? 3 : 0);
    const minOf = (r: typeof list[number]) => r.route?.duration_min ?? r.est?.min ?? Number.POSITIVE_INFINITY;
    const firstMonth = (r: typeof list[number]) => {
      const now = +L.today.slice(5, 7);
      return r.months.length ? Math.min(...r.months.map(m => (m - now + 12) % 12)) : 99;
    };
    list.sort((a, b) => {
      switch (sort) {
        case 'near': return minOf(a) - minOf(b);
        case 'rate': return (b.stats.rate ?? -1) - (a.stats.rate ?? -1) || b.stats.sent - a.stats.sent;
        case 'season': return firstMonth(a) - firstMonth(b);
        // Ưu tiên triển khai lên đầu, trường đối thủ đã làm / để liên hệ sau xuống dưới
        case 'priority': return rank(a.s) - rank(b.s) || (b.s.priority ?? 0) - (a.s.priority ?? 0) || (a.s.status === 'partner' ? -1 : 0) - (b.s.status === 'partner' ? -1 : 0) || a.s.name.localeCompare(b.s.name, 'vi');
        default: return a.s.name.localeCompare(b.s.name, 'vi');
      }
    });
    return list;
  }, [data.sources, kind, status, province, industry, tagF, q, programsBy, batchesBy, monthsBy, zoneTarget, routeIdx, sort, L]);

  const doRestore = async (s: LaborSource) => {
    try { await restoreSource(s, L.user); L.toast(`Đã khôi phục "${s.name}"`); await L.reload(); }
    catch (e) { L.toast((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <SearchField value={q} onChange={v => { setQ(v); setLimit(PAGE); }} placeholder="Tìm tên trường, ngành, tỉnh, thẻ…" className="md:w-[320px]" />
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap">
          <PillSelect label="Loại" value={kind} active={kind !== 'all'} onChange={setKind}>
            <option value="all">Mọi loại</option>
            {SOURCE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </PillSelect>
          <PillSelect label="Trạng thái" value={status} active={status !== 'all'} onChange={setStatus}>
            <option value="all">Mọi trạng thái</option>
            {SOURCE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </PillSelect>
          <PillSelect label="Nhãn / đối thủ" value={tagF} active={tagF !== 'all'} onChange={setTagF}>
            <option value="all">Mọi nhãn</option>
            <option value="uu_tien">Ưu tiên triển khai</option>
            <option value="lien_he_sau">Để liên hệ sau</option>
            <option value="none">Chưa đánh giá</option>
            <option value="comp">Đối thủ đã làm</option>
            <option value="free">Chưa có đối thủ</option>
          </PillSelect>
          <PillSelect label="Tỉnh" value={province} active={province !== 'all'} onChange={setProvince}>
            <option value="all">Mọi tỉnh</option>
            {provinces.map(p => <option key={p} value={p}>{p}</option>)}
          </PillSelect>
          <PillSelect label="Ngành" value={industry} active={industry !== 'all'} onChange={setIndustry} disabled={!usedIndustries.length}>
            <option value="all">Mọi ngành</option>
            {usedIndustries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </PillSelect>
          <PillSelect label="Gần KCN" value={zoneId} active={!!zoneId} onChange={v => { setZoneId(v); if (v) setSort('near'); else if (sort === 'near') setSort('priority'); }}>
            <option value="">Gần KCN…</option>
            {zones.map(z => <option key={z.id} value={z.id} disabled={!hasLL(z)}>{z.name}{hasLL(z) ? '' : ' (chưa có toạ độ)'}</option>)}
          </PillSelect>
          <PillSelect label="Sắp xếp" value={sort} active={false} onChange={v => setSort(v as Sort)}>
            <option value="priority">Ưu tiên</option>
            <option value="name">Tên A–Z</option>
            <option value="near" disabled={!zoneTarget}>Gần KCN nhất (xe khách)</option>
            <option value="rate">Tỷ lệ đạt cao</option>
            <option value="season">Sắp vào mùa thực tập</option>
          </PillSelect>
        </div>
      </div>

      <Panel title={showTrash ? 'Đã xoá' : zone ? `Đơn vị nguồn · gần ${zone.name}` : 'Đơn vị nguồn'} count={showTrash ? data.trash.length : rows.length}
        meta={showTrash ? 'Khôi phục để hiện lại cùng ngành, lịch, đợt đã nhập' : zone ? 'Thời gian đi xe khách 16–45 chỗ từ trường tới KCN' : undefined}
        action={data.trash.length > 0 ? (
          <button type="button" onClick={() => setShowTrash(v => !v)} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0066CC] hover:opacity-70 min-h-[36px] md:min-h-0">
            {showTrash ? 'Xem danh sách' : <><Trash2 size={13} /> Đã xoá ({data.trash.length})</>}
          </button>
        ) : undefined}>
        {showTrash ? (
          data.trash.map((s, i) => (
            <Row key={s.id} first={i === 0} inset={60}>
              <SourceAvatar kind={s.kind} logo={s.logo_url} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-[#1D1D1F] truncate">{s.name}</p>
                <p className="text-[12px] text-[#86868B]">Xoá {s.deleted_at ? new Date(s.deleted_at).toLocaleDateString('vi-VN') : ''}</p>
              </div>
              <button type="button" onClick={() => void doRestore(s)} className="inline-flex items-center gap-1 h-8 px-3 rounded-full bg-[#34C759]/[0.14] text-[#248A3D] text-[12.5px] font-medium">
                <RotateCcw size={13} /> Khôi phục
              </button>
            </Row>
          ))
        ) : rows.length === 0 ? (
          <Quiet icon={<School size={18} />}>{data.sources.length ? 'Không có đơn vị nào khớp bộ lọc' : 'Chưa có đơn vị nguồn nào — bấm "Thêm đơn vị nguồn" để bắt đầu'}</Quiet>
        ) : (
          <>
            {rows.slice(0, limit).map((r, i) => (
              <Row key={r.s.id} first={i === 0} inset={60} onClick={() => L.openSource(r.s.id)} align="start">
                <SourceAvatar kind={r.s.kind} logo={r.s.logo_url} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[15px] font-semibold text-[#1D1D1F] leading-snug">{r.s.short_name || r.s.name}</p>
                    {r.s.priority ? <Stars value={r.s.priority} size={12} /> : null}
                  </div>
                  <p className="text-[12.5px] text-[#6E6E73] truncate">{[r.s.short_name ? r.s.name : '', r.s.province].filter(Boolean).join(' · ') || 'Chưa ghi tỉnh'}</p>
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <KindPill kind={r.s.kind} />
                    <StatusPill status={r.s.status} />
                    <PursuitPill pursuit={r.s.pursuit} recontactAt={r.s.recontact_at} />
                    <CompetitorPill names={L.competitorNames(r.s.competitor_ids)} />
                    {r.progs.length > 0 && <span className="text-[12px] text-[#6E6E73] truncate max-w-[260px]">{r.progs.slice(0, 3).map(p => p.name).join(', ')}{r.progs.length > 3 ? ` +${r.progs.length - 3}` : ''}</span>}
                    {r.months.length > 0 && <span className="text-[12px] text-[#0066CC]">· TT {monthsLabel(r.months)}</span>}
                    {!hasLL(r.s) && <span className="text-[12px] text-[#B25000]">· chưa có vị trí</span>}
                  </div>
                  {/* Điện thoại: tỷ lệ đạt xuống dòng dưới cho cột phải gọn */}
                  {r.stats.sent > 0 && <div className="md:hidden mt-1.5"><RateBar sent={r.stats.sent} passed={r.stats.passed} /></div>}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5 pt-0.5">
                  {zoneTarget && <BusChip route={r.route} estimate={r.est} compact />}
                  {r.stats.sent > 0 && <span className="hidden md:inline-flex"><RateBar sent={r.stats.sent} passed={r.stats.passed} /></span>}
                  {!zoneTarget && <ChevronRight size={16} className={`text-[#C7C7CC] mt-2 ${r.stats.sent > 0 ? 'md:hidden' : ''}`} />}
                </div>
              </Row>
            ))}
            {rows.length > limit && <MoreButton onClick={() => setLimit(l => l + PAGE)}>Hiện thêm {Math.min(PAGE, rows.length - limit)} (còn {rows.length - limit})</MoreButton>}
          </>
        )}
      </Panel>
    </div>
  );
}
