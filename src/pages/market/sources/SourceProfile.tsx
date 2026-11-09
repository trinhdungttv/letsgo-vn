// Hồ sơ 1 đơn vị nguồn (trường / trung tâm / địa phương) — kiểu Apple như hồ sơ CSKH.
// Mở ra là tự tính đường xe khách tới mọi KCN / công ty / chi nhánh còn thiếu (lưu chung, lần sau hiện ngay).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bell, BellOff, Building2, CalendarRange, ExternalLink, Globe, GraduationCap, Map as MapIcon, MapPin, Pencil, Phone, Plus,
  Route as RouteIcon, Send, Trash2, Users,
} from 'lucide-react';
import { Sheet } from '../../../modules/cskh/components/Sheet';
import { MoreButton, Panel, Quiet, Row } from '../../../modules/cskh/components/apple';
import { ROUND_ADD } from '../../../modules/cskh/ui';
import { deleteSource, openInCskh } from '../../../lib/laborSources/api';
import { batchStats, MAX, monthsLabel, scoreMatch, type MatchContext } from '../../../lib/laborSources/match';
import { ensureFromSource, hasLL } from '../../../lib/laborSources/targets';
import { fetchRouteShape, fmtDuration, fmtKm, ENGINE_NOTE } from '../../../lib/laborSources/routing';
import { daysBetween, nextOccurrence } from '../../../lib/laborSources/windows';
import {
  BATCH_STATUS_LABEL, KIND_LABEL, LEVEL_LABEL, OWNERSHIP_LABEL, requirementLabel, isSchoolKind,
  type InternWindow, type LaborSource, type SourceBatch, type SourceProgram,
} from '../../../lib/laborSources/types';
import { useLabor } from './context';
import { FOOT_GRAY, FOOT_RED, SheetFooter } from './form';
import { BatchForm, ContactSheet, ProgramForm, WindowForm } from './ChildForms';
import RouteMiniMap, { type MiniPoint } from './RouteMiniMap';
import {
  BusChip, KIND_COLOR, KindPill, Metric, Pill, RateBar, ReasonChips, ScoreRing, SourceAvatar, Stars, StatusPill, fmtDateVN, fmtDayMonth,
} from './parts';

type Child =
  | { kind: 'program'; item: SourceProgram | null }
  | { kind: 'window'; item: InternWindow | null }
  | { kind: 'batch'; item: SourceBatch | null; preset?: { type: 'client' | 'lead'; id: string } }
  | { kind: 'contact' };

const ZONE_COLOR = '#D97706';
const CLIENT_COLOR = '#059669';

export default function SourceProfile({ source, onClose }: { source: LaborSource; onClose: () => void }) {
  const L = useLabor();
  const [child, setChild] = useState<Child | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Map<string, [number, number][]>>(new Map());
  const [moreCompanies, setMoreCompanies] = useState(false);
  const [moreZones, setMoreZones] = useState(false);

  const programs = useMemo(() => L.programsBy.get(source.id) ?? [], [L.programsBy, source.id]);
  const windows = L.windowsBy.get(source.id) ?? [];
  const batches = L.batchesBy.get(source.id) ?? [];
  const contacts = L.contactsBy.get(source.id) ?? [];
  const months = useMemo(() => L.monthsBy.get(source.id) ?? [], [L.monthsBy, source.id]);
  const stats = batchStats(batches);
  const located = hasLL(source);
  const school = isSchoolKind(source.kind);

  // Tính đường xe còn thiếu khi mở hồ sơ
  useEffect(() => {
    if (!located) return;
    let alive = true;
    ensureFromSource(source, L.targets, L.routeIdx, (done, total) => {
      if (alive && total > 0) L.setRouting(`Đang tính đường xe khách ${done}/${total}…`);
    })
      .then(rows => { if (alive) L.addRoutes(rows); })
      .catch(() => { if (alive) L.toast('Chưa tính được đường xe — kiểm tra mạng rồi mở lại hồ sơ'); })
      .finally(() => L.setRouting(null));
    return () => { alive = false; };
    // Chỉ chạy khi mở / đổi toạ độ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, source.lat, source.lng]);

  // ── Đường xe tới KCN + chi nhánh gần nhất ──
  const zoneRoutes = useMemo(() => L.zones.filter(hasLL).map(z => ({ z, r: L.route(source.id, 'zone', z.id) ?? null }))
    .sort((a, b) => (a.r?.duration_min ?? Number.POSITIVE_INFINITY) - (b.r?.duration_min ?? Number.POSITIVE_INFINITY)), [L, source.id]);
  const nearestBranch = useMemo(() => L.branches.filter(hasLL).map(b => ({ b, r: L.route(source.id, 'branch', b.id) }))
    .filter(x => x.r?.duration_min != null).sort((a, b) => a.r!.duration_min! - b.r!.duration_min!)[0] ?? null, [L, source.id]);
  const ownBranch = source.branch_id ? L.branches.find(b => b.id === source.branch_id) ?? null : null;

  // ── Công ty phù hợp ──
  const matches = useMemo(() => {
    const companyIndustry = new Map(L.companies.map(c => [`${c.type}:${c.id}`, c.industryId]));
    const seasons = new Map(L.industries.map(i => [i.id, i.season_levels ?? null]));
    const ctx: MatchContext = {
      batches: L.data.batches,
      batchIndustry: b => companyIndustry.get(b.client_id ? `client:${b.client_id}` : `lead:${b.lead_id}`) ?? null,
      seasonOf: id => seasons.get(id) ?? null,
    };
    const ms = { id: source.id, lat: source.lat, lng: source.lng, industryIds: new Set(programs.flatMap(p => p.industry_ids)), months };
    return L.companies.map(c => {
      const r = L.route(source.id, c.type, c.id);
      return { c, m: scoreMatch(ms, c, r ? { distanceKm: r.distance_km, durationMin: r.duration_min } : null, ctx) };
    }).sort((a, b) => b.m.score - a.m.score);
  }, [L, source.id, source.lat, source.lng, programs, months]);

  // ── Bản đồ nhỏ ──
  const mapPoints = useMemo<MiniPoint[]>(() => [
    ...L.zones.filter(hasLL).map(z => ({ id: `zone:${z.id}`, lat: z.lat as number, lng: z.lng as number, label: z.name, color: ZONE_COLOR, sub: 'KCN' })),
    ...matches.slice(0, 8).filter(x => x.c.lat != null && x.c.lng != null)
      .map(x => ({ id: `${x.c.type}:${x.c.id}`, lat: x.c.lat as number, lng: x.c.lng as number, label: x.c.name, color: CLIENT_COLOR, sub: `Phù hợp ${x.m.score}/100` })),
  ], [L.zones, matches]);

  const showRoute = async (key: string, lat: number, lng: number) => {
    setFocus(key);
    if (!located || shapes.has(key)) return;
    const shape = await fetchRouteShape({ lat: source.lat as number, lng: source.lng as number }, { lat, lng });
    if (shape) setShapes(prev => new Map(prev).set(key, shape.points));
    else L.toast('Không lấy được hình tuyến đường — thử lại sau');
  };

  const pickOnMap = (id: string) => {
    const p = mapPoints.find(x => x.id === id);
    if (p) void showRoute(id, p.lat, p.lng);
  };

  const remove = async () => {
    if (!confirm(`Xoá "${source.name}"?\n\nNgành, lịch thực tập, đợt gửi SV vẫn giữ — khôi phục được ở Danh sách → Đã xoá.`)) return;
    try { await deleteSource(source, L.user); L.toast('Đã xoá (khôi phục được)'); onClose(); await L.reload(); }
    catch (e) { L.toast((e as Error).message); }
  };

  const viewOnMap = () => {
    if (!located) return;
    try { sessionStorage.setItem('lgmap_focus', JSON.stringify({ lat: source.lat, lng: source.lng, zoom: 13, group: 'source' })); } catch { /* bỏ qua */ }
    onClose();
    L.goTab('map');
  };

  const nextWin = windows.map(w => ({ w, o: nextOccurrence(w, L.today) })).filter(x => x.o.end >= L.today).sort((a, b) => a.o.start.localeCompare(b.o.start))[0] ?? null;
  const mouState = source.mou_signed_at
    ? (source.mou_expires_at && source.mou_expires_at < L.today ? { t: 'MOU hết hạn', tint: 'red' as const } : { t: 'Đã ký MOU', tint: 'green' as const })
    : null;
  const owner = source.owner_id ? L.users.find(u => u.id === source.owner_id)?.full_name : null;

  return (
    <>
      <Sheet label={`Hồ sơ ${source.name}`} onClose={onClose} wide="xl">
        {/* ── Đầu hồ sơ ── */}
        <div className="flex items-start gap-3.5 md:pr-10">
          <SourceAvatar kind={source.kind} logo={source.logo_url} size={60} />
          <div className="min-w-0 flex-1">
            <p className="text-[22px] md:text-[24px] font-bold tracking-[-0.02em] leading-tight text-[#1D1D1F]">{source.name}</p>
            <p className="text-[13.5px] text-[#6E6E73] mt-0.5">
              {[source.short_name, KIND_LABEL[source.kind], source.ownership ? OWNERSHIP_LABEL[source.ownership] : '', source.province].filter(Boolean).join(' · ')}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <KindPill kind={source.kind} />
              <StatusPill status={source.status} />
              {mouState && <Pill tint={mouState.tint}>{mouState.t}</Pill>}
              {source.priority ? <Stars value={source.priority} size={14} /> : null}
              {source.tags.map(t => <Pill key={t}>#{t}</Pill>)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" onClick={() => L.editSource(source)} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[13px] font-medium"><Pencil size={14} /> Sửa hồ sơ</button>
          <button type="button" onClick={() => setChild({ kind: 'batch', item: null })} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold"><Send size={14} /> Ghi đợt gửi SV</button>
          {located && <button type="button" onClick={viewOnMap} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-black/[0.05] text-[#1D1D1F] text-[13px] font-medium"><MapIcon size={14} /> Xem trên Bản đồ</button>}
          {source.phone && <a href={`tel:${source.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-black/[0.05] text-[#1D1D1F] text-[13px] font-medium"><Phone size={14} /> Gọi</a>}
          {source.website && <a href={source.website.startsWith('http') ? source.website : `https://${source.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-black/[0.05] text-[#1D1D1F] text-[13px] font-medium"><Globe size={14} /> Website</a>}
        </div>

        <div className="mt-5 space-y-4">
          {/* ── Chỉ số ── */}
          <div className="rounded-[16px] bg-white md:bg-[#F5F5F7] grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-black/[0.06]">
            <Metric label="Đợt đã gửi" value={stats.count} />
            <Metric label="SV gửi đi" value={stats.sent.toLocaleString('vi-VN')} tone="blue" />
            <Metric label="Đạt" value={stats.passed.toLocaleString('vi-VN')} tone="green" />
            <Metric label="Tỷ lệ đạt" value={stats.rate == null ? '—' : `${Math.round(stats.rate * 100)}%`}
              tone={stats.rate == null ? undefined : stats.rate >= 0.6 ? 'green' : 'orange'}
              sub={nextWin ? `Mùa tới ${fmtDayMonth(nextWin.o.start)}${nextWin.o.start > L.today ? ` · còn ${daysBetween(L.today, nextWin.o.start)} ngày` : ' · đang diễn ra'}` : school ? 'Chưa nhập lịch thực tập' : undefined} />
          </div>

          {/* ── Bản đồ + đường xe tới KCN ── */}
          <Panel title="Đường xe khách tới KCN" icon={<RouteIcon size={16} className="text-[#0071E3]" />}
            meta={located ? 'Xe 16–45 chỗ · bấm 1 KCN để xem tuyến trên bản đồ' : undefined} flush>
            {!located ? (
              <div className="px-4 md:px-5 pb-4"><Quiet icon={<MapPin size={18} />}>Chưa có vị trí — bấm "Sửa hồ sơ" và dán link Google Maps để tính đường xe tới KCN / công ty.</Quiet></div>
            ) : (
              <div className="grid md:grid-cols-[1.1fr_1fr] gap-3 px-4 md:px-5 pb-4">
                <RouteMiniMap className="h-[240px] md:h-[300px]" home={{ lat: source.lat as number, lng: source.lng as number, label: source.short_name || source.name }}
                  homeColor={KIND_COLOR[source.kind]} points={mapPoints} route={focus ? shapes.get(focus) ?? null : null} focusId={focus} onPick={pickOnMap} />
                <div className="min-w-0">
                  {zoneRoutes.slice(0, moreZones ? 40 : 6).map(({ z, r }, i) => (
                    <Row key={z.id} first={i === 0} inset={0}>
                      <button type="button" onClick={() => void showRoute(`zone:${z.id}`, z.lat as number, z.lng as number)} title="Xem tuyến xe trên bản đồ"
                        className="min-w-0 flex-1 flex items-center gap-3 text-left rounded-[10px] hover:bg-[#FAFAFC] -my-1 py-1">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${focus === `zone:${z.id}` ? 'bg-[#0071E3]' : 'bg-[#D97706]'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium text-[#1D1D1F] truncate">{z.name}</span>
                          {r && <span className="block text-[11.5px] text-[#86868B] truncate" title={ENGINE_NOTE[r.engine]}>{fmtKm(r.distance_km)}{r.engine === 'osrm-car' ? ' · ước giờ xe khách' : ''}</span>}
                        </span>
                        <BusChip route={r} compact />
                      </button>
                      <button type="button" title="Mở Khảo sát KCN này" onClick={() => { onClose(); L.goTab('survey', z.name); }}
                        className="shrink-0 w-8 h-8 rounded-full hover:bg-black/[0.05] text-[#86868B] flex items-center justify-center"><RouteIcon size={14} /></button>
                    </Row>
                  ))}
                  {zoneRoutes.length > 6 && <MoreButton onClick={() => setMoreZones(v => !v)}>{moreZones ? 'Thu gọn' : `Xem cả ${zoneRoutes.length} KCN`}</MoreButton>}
                  {(nearestBranch || ownBranch) && (
                    <p className="mt-2 text-[12.5px] text-[#6E6E73] flex items-center gap-1.5">
                      <Building2 size={13} className="text-[#86868B]" />
                      {ownBranch && <>Phụ trách: <b className="font-medium text-[#1D1D1F]">{ownBranch.name}</b>{nearestBranch && nearestBranch.b.id !== ownBranch.id ? ' · ' : ''}</>}
                      {nearestBranch && nearestBranch.b.id !== ownBranch?.id && <>Gần nhất: <b className="font-medium text-[#1D1D1F]">{nearestBranch.b.name}</b> ({fmtDuration(nearestBranch.r!.duration_min)})</>}
                    </p>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* ── Công ty phù hợp ── */}
          <Panel title="Công ty phù hợp" icon={<Building2 size={16} className="text-[#34C759]" />}
            meta={`Ngành ${MAX.industry} · đường xe ${MAX.distance} · kết quả đợt trước ${MAX.history} · đúng mùa ${MAX.season} điểm`}>
            {matches.length === 0 ? <Quiet>Chưa có công ty nào trong Khách hàng / Công ty-Dự án</Quiet> : (
              <>
                {matches.slice(0, moreCompanies ? 25 : 6).map(({ c, m }, i) => (
                  <Row key={`${c.type}:${c.id}`} first={i === 0} inset={56} align="start">
                    <ScoreRing score={m.score} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-[#1D1D1F] truncate">{c.name}</p>
                      <p className="text-[12px] text-[#86868B] mb-1">{c.type === 'client' ? 'Khách hàng' : 'Công ty / Dự án'}{c.industryName ? ` · ${c.industryName}` : ''}{c.zoneId ? ` · ${L.zones.find(z => z.id === c.zoneId)?.name ?? ''}` : ''}</p>
                      <ReasonChips reasons={m.reasons} />
                    </div>
                    <button type="button" title="Ghi đợt gửi SV vào công ty này" onClick={() => setChild({ kind: 'batch', item: null, preset: { type: c.type, id: c.id } })} className={ROUND_ADD}><Plus size={16} /></button>
                  </Row>
                ))}
                {matches.length > 6 && <MoreButton onClick={() => setMoreCompanies(v => !v)}>{moreCompanies ? 'Thu gọn' : `Xem thêm (${Math.min(25, matches.length)} công ty)`}</MoreButton>}
              </>
            )}
          </Panel>

          {/* ── Ngành đào tạo ── */}
          {school && (
            <Panel title="Ngành đào tạo" icon={<GraduationCap size={16} className="text-[#5856D6]" />} count={programs.length}
              action={<button type="button" onClick={() => setChild({ kind: 'program', item: null })} className={ROUND_ADD} aria-label="Thêm ngành"><Plus size={16} /></button>}>
              {programs.length === 0 ? <Quiet>Thêm ngành (Điện tử, Cơ điện tử, Tự động hoá…) và gắn ngành công ty phù hợp để hệ thống gợi ý ghép.</Quiet>
                : programs.map((p, i) => (
                  <Row key={p.id} first={i === 0} inset={0} onClick={() => setChild({ kind: 'program', item: p })}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-[#1D1D1F]">{p.name} <span className="font-normal text-[#86868B]">· {LEVEL_LABEL[p.level]}{p.students_per_year ? ` · ~${p.students_per_year} SV/khoá` : ''}</span></p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {p.industry_ids.length
                          ? p.industry_ids.map(id => <Pill key={id} tint="blue">{L.industries.find(x => x.id === id)?.name ?? '?'}</Pill>)
                          : <span className="text-[12px] text-[#B25000]">Chưa gắn ngành công ty</span>}
                      </div>
                    </div>
                  </Row>
                ))}
            </Panel>
          )}

          {/* ── Lịch thực tập ── */}
          <Panel title="Lịch thực tập" icon={<CalendarRange size={16} className="text-[#FF9500]" />} count={windows.length}
            meta={months.length ? `12 tháng tới có SV đi thực tập: ${monthsLabel(months)}` : undefined}
            action={<button type="button" onClick={() => setChild({ kind: 'window', item: null })} className={ROUND_ADD} aria-label="Thêm lịch"><Plus size={16} /></button>}>
            {windows.length === 0 ? <Quiet>Ghi mùa thực tập (ngày bắt đầu – kết thúc, số SV dự kiến). Trước mùa app tự nhắc việc trong Workspace.</Quiet>
              : windows.map((w, i) => {
                const o = nextOccurrence(w, L.today);
                const past = o.end < L.today;
                const progNames = w.program_ids.map(id => programs.find(p => p.id === id)?.name).filter(Boolean);
                return (
                  <Row key={w.id} first={i === 0} inset={0} onClick={() => setChild({ kind: 'window', item: w })}>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[14px] font-medium ${past ? 'text-[#86868B]' : 'text-[#1D1D1F]'}`}>
                        {fmtDateVN(o.start)} → {fmtDateVN(o.end)}{w.cohort ? <span className="font-normal text-[#6E6E73]"> · {w.cohort}</span> : null}
                      </p>
                      <p className="text-[12px] text-[#86868B]">
                        {[w.expected_count ? `Dự kiến ${w.expected_count} SV` : '', progNames.length ? progNames.join(', ') : 'Cả trường', w.repeat_yearly ? 'Lặp hằng năm' : 'Chỉ 1 lần'].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12px] text-[#86868B] inline-flex items-center gap-1" title={w.remind_days ? `Nhắc trước ${w.remind_days} ngày` : 'Không nhắc'}>
                      {w.remind_days ? <><Bell size={13} />{w.reminder_for === o.start ? 'Đã nhắc' : `${w.remind_days} ngày`}</> : <BellOff size={13} />}
                    </span>
                  </Row>
                );
              })}
          </Panel>

          {/* ── Đợt gửi SV ── */}
          <Panel title="Đợt gửi sinh viên" icon={<Send size={16} className="text-[#0071E3]" />} count={batches.length}
            meta="Chỉ số lượng: gửi đi bao nhiêu, đạt bao nhiêu"
            action={<button type="button" onClick={() => setChild({ kind: 'batch', item: null })} className={ROUND_ADD} aria-label="Thêm đợt"><Plus size={16} /></button>}>
            {batches.length === 0 ? <Quiet>Chưa có đợt nào.</Quiet> : batches.map((b, i) => (
              <Row key={b.id} first={i === 0} inset={0} onClick={() => setChild({ kind: 'batch', item: b })}>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[#1D1D1F] truncate">{b.company_name || 'Chưa ghi công ty'}</p>
                  <p className="text-[12px] text-[#86868B] truncate">
                    {[b.start_date ? `${fmtDateVN(b.start_date)}${b.end_date ? ` → ${fmtDateVN(b.end_date)}` : ''}` : '', L.zones.find(z => z.id === b.zone_id)?.name ?? '', BATCH_STATUS_LABEL[b.status]].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <RateBar sent={b.sent_count} passed={b.passed_count} />
              </Row>
            ))}
          </Panel>

          {/* ── Người liên hệ ── */}
          <Panel title="Người liên hệ" icon={<Users size={16} className="text-[#FF2D55]" />} count={contacts.length}
            meta="CSKH tệp Sale / CTV — sinh nhật, nhật ký, quà chăm sóc ở CSKH"
            action={<button type="button" onClick={() => setChild({ kind: 'contact' })} className={ROUND_ADD} aria-label="Thêm người liên hệ"><Plus size={16} /></button>}>
            {contacts.length === 0 ? <Quiet>Thêm Ban giám hiệu, phòng Quan hệ doanh nghiệp, giảng viên phụ trách thực tập…</Quiet>
              : contacts.map((c, i) => (
                <Row key={c.id} first={i === 0} inset={48}>
                  <button type="button" onClick={() => openInCskh(c.id)} title="Mở hồ sơ ở CSKH (tệp Sale / CTV)"
                    className="min-w-0 flex-1 flex items-center gap-3 text-left rounded-[10px] hover:bg-[#FAFAFC]">
                    {c.avatar_url
                      ? <img src={c.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                      : <span className="w-9 h-9 rounded-full bg-gradient-to-b from-[#A1A1A6] to-[#8E8E93] text-white text-[13px] font-semibold flex items-center justify-center shrink-0">{c.name.trim().split(/\s+/).pop()?.[0]?.toUpperCase()}</span>}
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[14px] font-medium truncate ${c.is_active ? 'text-[#1D1D1F]' : 'text-[#86868B] line-through'}`}>{c.name}</span>
                      <span className="block text-[12px] text-[#86868B] truncate">{[c.role, L.groups.find(g => g.id === c.group_id)?.name].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    <ExternalLink size={14} className="text-[#C7C7CC] shrink-0" />
                  </button>
                  {c.phone && <a href={`tel:${c.phone.split(/[,;/]/)[0].replace(/\s+/g, '')}`} className="shrink-0 w-9 h-9 rounded-full bg-[#34C759]/[0.14] text-[#248A3D] flex items-center justify-center" aria-label={`Gọi ${c.name}`}><Phone size={15} /></a>}
                </Row>
              ))}
          </Panel>

          {/* ── Thông tin ── */}
          <Panel title="Thông tin">
            <InfoRow first label="Địa chỉ">{[source.address, source.province].filter(Boolean).join(', ') || '—'}</InfoRow>
            <InfoRow label="Điện thoại / Email">{[source.phone, source.email].filter(Boolean).join(' · ') || '—'}</InfoRow>
            {source.fanpage && <InfoRow label="Fanpage"><a href={source.fanpage} target="_blank" rel="noreferrer" className="text-[#0066CC] break-all">{source.fanpage}</a></InfoRow>}
            <InfoRow label="Quy mô">{[source.student_total ? `${source.student_total.toLocaleString('vi-VN')} người học` : '', source.intern_per_year ? `~${source.intern_per_year.toLocaleString('vi-VN')} SV thực tập/năm` : ''].filter(Boolean).join(' · ') || '—'}</InfoRow>
            <InfoRow label="Ký túc xá">{source.has_dorm == null ? 'Chưa rõ' : source.has_dorm ? 'Có' : 'Không'}</InfoRow>
            <InfoRow label="Trường yêu cầu DN">
              {source.requirements.length ? <span className="flex flex-wrap gap-1">{source.requirements.map(r => <Pill key={r} tint="orange">{requirementLabel(r)}</Pill>)}</span> : '—'}
              {source.requirements_note && <p className="mt-1 text-[12.5px] text-[#6E6E73] whitespace-pre-line">{source.requirements_note}</p>}
            </InfoRow>
            <InfoRow label="Thoả thuận (MOU)">{source.mou_signed_at ? `Ký ${fmtDateVN(source.mou_signed_at)}${source.mou_expires_at ? ` · hết hạn ${fmtDateVN(source.mou_expires_at)}` : ''}` : 'Chưa ký'}{source.mou_note ? ` · ${source.mou_note}` : ''}</InfoRow>
            <InfoRow label="Phụ trách">{[ownBranch?.name, owner].filter(Boolean).join(' · ') || '—'}</InfoRow>
            {source.notes && <InfoRow label="Ghi chú"><span className="whitespace-pre-line">{source.notes}</span></InfoRow>}
          </Panel>
        </div>

        <SheetFooter>
          <button type="button" onClick={() => void remove()} className={FOOT_RED}><Trash2 size={14} /> Xoá</button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={FOOT_GRAY}>Đóng</button>
        </SheetFooter>
      </Sheet>

      {child?.kind === 'program' && <ProgramForm source={source} program={child.item} onClose={() => setChild(null)} />}
      {child?.kind === 'window' && <WindowForm source={source} win={child.item} onClose={() => setChild(null)} />}
      {child?.kind === 'batch' && <BatchForm source={source} batch={child.item} preset={child.preset} onClose={() => setChild(null)} />}
      {child?.kind === 'contact' && <ContactSheet source={source} onClose={() => setChild(null)} />}
    </>
  );
}

function InfoRow({ label, children, first = false }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <Row first={first} inset={0} align="start">
      <span className="w-[128px] md:w-[150px] shrink-0 text-[13px] text-[#86868B]">{label}</span>
      <span className="min-w-0 flex-1 text-[13.5px] text-[#1D1D1F]">{children}</span>
    </Row>
  );
}
