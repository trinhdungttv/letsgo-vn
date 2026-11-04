// Pháp lý — PHÁP NHÂN: danh sách công ty bên trái; bên phải là Tổng quan (tất cả công ty, giấy phép sắp hết hạn,
// dòng thời gian chung) hoặc hồ sơ 1 công ty với 4 tab: Tổng quan · Dòng thời gian · Sơ đồ · Hồ sơ giấy tờ.
import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Building2, CalendarClock, ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, Folder, Landmark, LayoutGrid,
  MapPin, Network, Pencil, Plus, Scale, Star, Trash2, Users,
} from 'lucide-react';
import { archive, saveDoc } from '../../lib/legal/api';
import { copyText } from '../../lib/clipboard';
import { entityOverviewMap, ownershipMap } from '../../lib/legal/maps';
import {
  changesSummary, companyAge, fmtDate, fmtMoney, fmtMoneyShort, licenseAlerts, licenseState, ownerShares, sortMilestones,
} from '../../lib/legal/timeline';
import { ENTITY_DOC_CATEGORIES, ENTITY_STATUS, MILESTONE_KINDS, type LegalEntity } from '../../lib/legal/types';
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from '../workspace/wsTheme';
import type { LegalCtx } from './ctx';
import { DocRow } from './DocCard';
import EntityForm from './EntityForm';
import EntityTimeline from './EntityTimeline';
import FileViewer, { FileIconButton } from './FileViewer';
import { ColorTile, Confirm, Empty, EntityLogo, MoreMenu, Pill, Section, shade, soft } from './ui';

export type EntityTab = 'overview' | 'timeline' | 'maps' | 'docs';
const TABS: { id: EntityTab; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' }, { id: 'timeline', label: 'Dòng thời gian' }, { id: 'maps', label: 'Sơ đồ' }, { id: 'docs', label: 'Hồ sơ giấy tờ' },
];
const OWNER_COLORS = ['#0071E3', '#AF52DE', '#FF9500', '#34C759', '#FF2D55', '#30B0C7', '#5856D6', '#A2845E'];

function Copyable({ value, ctx, children }: { value: string; ctx: LegalCtx; children?: ReactNode }) {
  if (!value) return <span className="text-[#AEAEB2]">—</span>;
  return (
    <button type="button" onClick={async () => { if (await copyText(value)) ctx.toast('Đã chép'); }} title="Bấm để chép"
      className="group inline-flex items-center gap-1.5 text-left hover:text-[#0066CC] min-w-0">
      <span className="min-w-0 break-words">{children ?? value}</span>
      <Copy size={12} className="shrink-0 opacity-0 group-hover:opacity-60" />
    </button>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] md:grid-cols-[130px_1fr] gap-2 py-1.5 border-b border-black/[0.05] last:border-0 text-[13px]">
      <span className="text-[#86868B]">{label}</span>
      <span className="text-[#1D1D1F] min-w-0">{children}</span>
    </div>
  );
}

// ── Tổng quan tất cả pháp nhân ─────────────────────────────────────────────
function AllEntities({ ctx, onOpen, onAdd }: { ctx: LegalCtx; onOpen: (id: string) => void; onAdd: () => void }) {
  const { store } = ctx;
  const active = store.entities.filter(e => e.status !== 'dissolved');
  const totalCapital = active.reduce((s, e) => s + (e.charter_capital ?? 0), 0);
  const year = new Date().getFullYear().toString();
  const alerts = licenseAlerts(store.entities);
  const recent = sortMilestones(store.milestones.filter(m => store.entities.some(e => e.id === m.entity_id))).slice(0, 12);
  const stats = [
    { label: 'Pháp nhân hoạt động', value: String(active.length), color: '#0071E3' },
    { label: 'Tổng vốn điều lệ', value: fmtMoneyShort(totalCapital) || '—', color: '#34C759' },
    { label: `Mốc năm ${year}`, value: String(store.milestones.filter(m => m.event_date.startsWith(year)).length), color: '#AF52DE' },
    { label: 'Giấy phép cần chú ý', value: String(alerts.length), color: alerts.length ? '#FF3B30' : '#8E8E93' },
  ];

  if (!store.entities.length) {
    return (
      <Empty icon={<Building2 size={26} />} title="Chưa có pháp nhân nào"
        text="Thêm 5–6 công ty của bạn: tên, MST, vốn, người đại diện, ngành nghề, giấy phép… rồi ghi lại từng lần thay đổi trên dòng thời gian."
        action={ctx.canEdit && <button type="button" onClick={onAdd} className={`${BTN_PRIMARY} h-10 px-5 text-[14px]`}><Plus size={16} /> Thêm pháp nhân</button>} />
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-5">
        {stats.map(s => (
          <div key={s.label} className={`${CARD} px-4 py-3`}>
            <div className="text-[24px] md:text-[28px] font-semibold tracking-[-0.03em] tabular-nums leading-none" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[12px] text-[#86868B] mt-1.5">{s.label}</div>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <div className="rounded-[18px] bg-[#FFF4F2] p-3.5 md:p-4 mb-5 shadow-[inset_0_0_0_0.5px_rgba(255,59,48,0.25)]">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[#D70015] mb-2"><AlertTriangle size={15} /> Giấy phép hết hạn / sắp hết hạn (90 ngày)</div>
          <div className="space-y-1">
            {alerts.map(a => (
              <button key={a.entity.id + a.license.id} type="button" onClick={() => onOpen(a.entity.id)} className="w-full flex items-center gap-2 text-left text-[13px] py-1 hover:underline">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.entity.color }} />
                <span className="font-medium text-[#1D1D1F] truncate">{a.license.name}</span>
                <span className="text-[#86868B] truncate">· {a.entity.short_name || a.entity.name}</span>
                <span className={`ml-auto shrink-0 font-semibold ${a.daysLeft < 0 ? 'text-[#D70015]' : 'text-[#B25000]'}`}>{a.daysLeft < 0 ? `Hết hạn ${-a.daysLeft} ngày` : `Còn ${a.daysLeft} ngày`}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3 mb-6">
        {store.entities.map(e => {
          const ms = sortMilestones(store.milestones.filter(m => m.entity_id === e.id));
          const lastChange = ms.find(m => m.kind === 'thay_doi' && m.status === 'done');
          const st = ENTITY_STATUS[e.status];
          return (
            <button key={e.id} type="button" onClick={() => onOpen(e.id)} className={`${CARD} group text-left overflow-hidden hover:-translate-y-0.5 transition`}>
              <div className="h-[58px] relative" style={{ background: `linear-gradient(120deg, ${shade(e.color, 0.1)} 0%, ${e.color} 70%, ${shade(e.color, -0.2)} 100%)` }}>
                <span className="absolute right-3 top-2.5"><Pill tint={st.tint} className="!bg-white/90">{st.label}</Pill></span>
              </div>
              <div className="px-4 pb-4 -mt-7">
                <EntityLogo name={e.short_name || e.name} color={e.color} url={e.logo_url} size={52} />
                <div className="mt-2 text-[15.5px] font-semibold text-[#1D1D1F] leading-snug line-clamp-2">{e.name}</div>
                <div className="text-[12px] text-[#86868B] mt-0.5 truncate">{[e.tax_code && `MST ${e.tax_code}`, e.business_type].filter(Boolean).join(' · ') || '—'}</div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div><div className="text-[11px] text-[#86868B]">Vốn</div><div className="text-[13px] font-semibold text-[#1D1D1F] truncate">{fmtMoneyShort(e.charter_capital) || '—'}</div></div>
                  <div><div className="text-[11px] text-[#86868B]">Tuổi</div><div className="text-[13px] font-semibold text-[#1D1D1F] truncate">{companyAge(e.founded_date) || '—'}</div></div>
                  <div><div className="text-[11px] text-[#86868B]">Thay đổi</div><div className="text-[13px] font-semibold text-[#1D1D1F]">{lastChange?.change_no ? `Lần ${lastChange.change_no}` : '—'}</div></div>
                </div>
                {ms[0] && (
                  <div className="mt-3 pt-3 border-t border-black/[0.05] flex items-center gap-2 text-[12px] text-[#6E6E73] min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: MILESTONE_KINDS[ms[0].kind].color }} />
                    <span className="truncate">{fmtDate(ms[0].event_date)} · {ms[0].title}</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {recent.length > 0 && (
        <Section title="Dòng thời gian chung — mọi pháp nhân" icon={<CalendarClock size={15} />}>
          <ol className="relative border-l-2 border-black/[0.07] ml-1.5 pl-5 space-y-3 pt-1">
            {recent.map(m => {
              const e = store.entities.find(x => x.id === m.entity_id)!;
              const k = MILESTONE_KINDS[m.kind];
              return (
                <li key={m.id} className="relative">
                  <span className="absolute -left-[27px] top-1 w-3 h-3 rounded-full border-2 border-white" style={{ background: k.color }} />
                  <button type="button" onClick={() => onOpen(e.id)} className="text-left w-full group">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span className="font-semibold text-[#1D1D1F] tabular-nums">{fmtDate(m.event_date)}</span>
                      <span className="h-[20px] px-2 rounded-full inline-flex items-center font-medium text-white" style={{ background: e.color }}>{e.short_name || e.name}</span>
                      <span style={{ color: k.color }} className="font-medium">{k.label}</span>
                    </div>
                    <div className="text-[13.5px] text-[#1D1D1F] mt-0.5 group-hover:underline">{m.title}{m.changes.length ? <span className="text-[#86868B]"> — {changesSummary(m.changes)}</span> : null}</div>
                  </button>
                </li>
              );
            })}
          </ol>
        </Section>
      )}
    </div>
  );
}

// ── Hồ sơ 1 pháp nhân ─────────────────────────────────────────────────────
function EntityOverview({ ctx, e, goTab }: { ctx: LegalCtx; e: LegalEntity; goTab: (t: EntityTab) => void }) {
  const ms = sortMilestones(ctx.store.milestones.filter(m => m.entity_id === e.id));
  const lastChange = ms.find(m => m.kind === 'thay_doi' && m.status === 'done');
  const shares = ownerShares(e.info.owners, e.charter_capital);
  const [allInd, setAllInd] = useState(false);
  const [viewing, setViewing] = useState<{ title: string; url: string } | null>(null);
  const inds = [...e.info.industries].sort((a, b) => Number(b.main) - Number(a.main));
  const mapUrl = e.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.address)}` : '';

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Section title="Đăng ký doanh nghiệp" icon={<FileText size={15} />}>
        <InfoRow label="Giấy chứng nhận ĐKDN">
          {e.info.registrationUrl
            ? <span className="inline-flex items-center gap-2"><FileIconButton url={e.info.registrationUrl} label="Xem Giấy chứng nhận ĐKDN" onOpen={() => setViewing({ title: `Giấy chứng nhận ĐKDN – ${e.short_name || e.name}`, url: e.info.registrationUrl })} /><span className="text-[12px] text-[#86868B]">Bấm icon để xem file gốc</span></span>
            : <span className="text-[#AEAEB2]">Chưa gắn link — Sửa hồ sơ → Đăng ký doanh nghiệp</span>}
        </InfoRow>
        <InfoRow label="Mã số DN / MST"><Copyable ctx={ctx} value={e.tax_code}><span className="font-semibold tabular-nums">{e.tax_code}</span></Copyable></InfoRow>
        <InfoRow label="Tên đầy đủ"><Copyable ctx={ctx} value={e.name} /></InfoRow>
        {e.english_name && <InfoRow label="Tên tiếng Anh"><Copyable ctx={ctx} value={e.english_name} /></InfoRow>}
        <InfoRow label="Loại hình">{e.business_type || <span className="text-[#AEAEB2]">—</span>}</InfoRow>
        <InfoRow label="Ngày cấp lần đầu">{fmtDate(e.founded_date) || <span className="text-[#AEAEB2]">—</span>}{e.founded_date && <span className="text-[#86868B]"> · {companyAge(e.founded_date)}</span>}</InfoRow>
        <InfoRow label="Nơi cấp">{e.registry_office || <span className="text-[#AEAEB2]">—</span>}</InfoRow>
        <InfoRow label="Thay đổi gần nhất">
          {lastChange ? <button type="button" onClick={() => goTab('timeline')} className="text-[#0066CC] hover:underline text-left">Lần {lastChange.change_no ?? '?'} · {fmtDate(lastChange.event_date)}</button> : <span className="text-[#AEAEB2]">Chưa ghi</span>}
        </InfoRow>
      </Section>

      <Section title="Trụ sở & liên hệ" icon={<MapPin size={15} />}>
        <InfoRow label="Địa chỉ">
          <Copyable ctx={ctx} value={e.address} />
          {mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-[12px] text-[#0066CC] hover:underline">Bản đồ <ExternalLink size={11} /></a>}
        </InfoRow>
        <InfoRow label="Điện thoại"><Copyable ctx={ctx} value={e.phone} /></InfoRow>
        <InfoRow label="Email"><Copyable ctx={ctx} value={e.email} /></InfoRow>
        <InfoRow label="Website">{e.website ? <a href={/^https?:/.test(e.website) ? e.website : `https://${e.website}`} target="_blank" rel="noreferrer" className="text-[#0066CC] hover:underline break-all">{e.website}</a> : <span className="text-[#AEAEB2]">—</span>}</InfoRow>
        <InfoRow label="Người đại diện"><span className="font-semibold">{e.legal_rep || '—'}</span>{e.legal_rep_title && <span className="text-[#86868B]"> · {e.legal_rep_title}</span>}</InfoRow>
      </Section>

      <Section title="Vốn & thành viên góp vốn" icon={<Users size={15} />}>
        <div className="flex items-baseline gap-2">
          <span className="text-[26px] font-semibold tracking-[-0.03em] text-[#1D1D1F]">{fmtMoneyShort(e.charter_capital) || '—'}</span>
          {e.charter_capital != null && <span className="text-[12px] text-[#86868B]">{fmtMoney(e.charter_capital)}</span>}
        </div>
        {shares.length > 0 && (
          <>
            <div className="flex h-3 rounded-full overflow-hidden mt-3 bg-black/[0.05]">
              {shares.map((o, i) => o.pct > 0 && <div key={o.id} title={`${o.name}: ${o.pct}%`} style={{ width: `${o.pct}%`, background: OWNER_COLORS[i % OWNER_COLORS.length] }} />)}
            </div>
            <div className="mt-3 space-y-1.5">
              {e.info.owners.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2 text-[13px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OWNER_COLORS[i % OWNER_COLORS.length] }} />
                  <span className="flex-1 min-w-0 truncate text-[#1D1D1F]">{o.name}</span>
                  {o.capital != null && <span className="text-[#86868B] tabular-nums">{fmtMoneyShort(o.capital)}</span>}
                  <span className="w-14 text-right font-semibold tabular-nums text-[#1D1D1F]">{shares[i]?.pct ? `${shares[i].pct}%` : ''}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {!shares.length && <div className="text-[12.5px] text-[#86868B] mt-1">Chưa nhập thành viên góp vốn.</div>}
      </Section>

      <Section title={`Giấy phép con (${e.info.licenses.length})`} icon={<Scale size={15} />}>
        {!e.info.licenses.length && <div className="text-[12.5px] text-[#86868B]">Chưa có.</div>}
        <div className="space-y-2">
          {e.info.licenses.map(l => {
            const st = licenseState(l.expires);
            return (
              <div key={l.id} className="rounded-[12px] bg-black/[0.025] px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-[#1D1D1F]">{l.name}</div>
                    <div className="text-[12px] text-[#86868B]">{[l.number && `Số ${l.number}`, l.issuer, l.issued && `cấp ${fmtDate(l.issued)}`].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Pill tint={st.tint}>{st.label}</Pill>
                  <FileIconButton url={l.url} label="Xem file giấy phép" onOpen={() => setViewing({ title: l.name || 'Giấy phép', url: l.url })} />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`Ngành nghề kinh doanh (${inds.length})`} icon={<Star size={15} />} className="lg:col-span-2">
        {!inds.length && <div className="text-[12.5px] text-[#86868B]">Chưa nhập — Sửa hồ sơ → Ngành nghề → Dán danh sách.</div>}
        <div className="grid md:grid-cols-2 gap-x-6">
          {(allInd ? inds : inds.slice(0, 8)).map(i => (
            <div key={i.id} className="flex items-start gap-2 py-1.5 border-b border-black/[0.04] text-[13px]">
              <span className={`shrink-0 min-w-[46px] h-[20px] px-1.5 rounded-[6px] text-[11.5px] font-semibold inline-flex items-center justify-center tabular-nums ${i.main ? 'bg-[#FF9500] text-white' : 'bg-black/[0.05] text-[#3A3A3C]'}`}>{i.code || '—'}</span>
              <span className={`min-w-0 ${i.main ? 'font-semibold text-[#1D1D1F]' : 'text-[#3A3A3C]'}`}>{i.name}{i.main && <span className="text-[#B25000] font-medium"> · ngành chính</span>}</span>
            </div>
          ))}
        </div>
        {inds.length > 8 && <button type="button" onClick={() => setAllInd(a => !a)} className="mt-2 text-[12.5px] font-medium text-[#0066CC] hover:underline">{allInd ? 'Thu gọn' : `Xem tất cả ${inds.length} ngành`}</button>}
      </Section>

      {e.info.banks.length > 0 && (
        <Section title="Tài khoản ngân hàng" icon={<Landmark size={15} />}>
          {e.info.banks.map(b => (
            <InfoRow key={b.id} label={b.bank || 'Ngân hàng'}><Copyable ctx={ctx} value={b.number}><span className="font-semibold tabular-nums">{b.number}</span></Copyable>{b.branch && <span className="text-[#86868B]"> · {b.branch}</span>}</InfoRow>
          ))}
        </Section>
      )}

      <Section title="Mốc gần nhất" icon={<CalendarClock size={15} />} action={<button type="button" onClick={() => goTab('timeline')} className="text-[12.5px] text-[#0066CC] hover:underline inline-flex items-center">Dòng thời gian <ChevronRight size={13} /></button>}>
        {!ms.length && <div className="text-[12.5px] text-[#86868B]">Chưa có mốc nào.</div>}
        {ms.slice(0, 4).map(m => (
          <button key={m.id} type="button" onClick={() => goTab('timeline')} className="w-full flex items-center gap-2.5 py-1.5 text-left text-[13px] hover:bg-black/[0.02] rounded-lg">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: MILESTONE_KINDS[m.kind].color }} />
            <span className="tabular-nums text-[#86868B] shrink-0">{fmtDate(m.event_date)}</span>
            <span className="truncate text-[#1D1D1F]">{m.title}</span>
          </button>
        ))}
      </Section>

      {viewing && <FileViewer title={viewing.title} url={viewing.url} onClose={() => setViewing(null)} />}
      {e.note && <Section title="Ghi chú" className="lg:col-span-2"><p className="text-[13.5px] text-[#3A3A3C] whitespace-pre-wrap leading-relaxed">{e.note}</p></Section>}
    </div>
  );
}

function EntityMaps({ ctx, e }: { ctx: LegalCtx; e: LegalEntity }) {
  const maps = ctx.store.docs.filter(d => d.entity_id === e.id && d.kind === 'mindmap').sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const [busy, setBusy] = useState(false);
  const quick = async (kind: 'overview' | 'ownership') => {
    setBusy(true);
    try {
      const content = kind === 'overview' ? entityOverviewMap(e, ctx.store.milestones.filter(m => m.entity_id === e.id)) : ownershipMap(e, e.short_name || e.name);
      const doc = await saveDoc({
        kind: 'mindmap', title: `${kind === 'overview' ? 'Tổng quan' : 'Cơ cấu sở hữu'} – ${e.short_name || e.name}`, entity_id: e.id, category: 'dieu_le', content, color: e.color,
      }, ctx.userName);
      ctx.store.putDoc(doc);
      ctx.openDoc(doc.id);
    } catch (err) { ctx.toast((err as Error).message); }
    setBusy(false);
  };
  return (
    <div>
      {ctx.canEdit && (
        <div className="grid gap-2.5 sm:grid-cols-3 mb-5">
          {([
            ['overview', 'Sơ đồ tổng quan', 'Tự dựng từ hồ sơ + dòng thời gian', '#AF52DE'],
            ['ownership', 'Cơ cấu sở hữu', 'Thành viên góp vốn + tỉ lệ', '#0071E3'],
          ] as const).map(([k, label, hint, color]) => (
            <button key={k} type="button" disabled={busy} onClick={() => void quick(k)} className={`${CARD} p-3.5 text-left flex items-start gap-3 hover:-translate-y-0.5 transition disabled:opacity-50`}>
              <ColorTile color={color} size={38} radius={11}><Network size={18} /></ColorTile>
              <span><span className="block text-[13.5px] font-semibold text-[#1D1D1F]">{label}</span><span className="block text-[12px] text-[#86868B]">{hint}</span></span>
            </button>
          ))}
          <button type="button" onClick={() => ctx.newDoc({ entityId: e.id, kind: 'mindmap', category: 'khac', template: 'blank' })} className={`${CARD} p-3.5 text-left flex items-start gap-3 hover:-translate-y-0.5 transition`}>
            <ColorTile color="#8E8E93" size={38} radius={11}><Plus size={18} /></ColorTile>
            <span><span className="block text-[13.5px] font-semibold text-[#1D1D1F]">Sơ đồ khác</span><span className="block text-[12px] text-[#86868B]">Trống hoặc theo mẫu (quy trình, so sánh…)</span></span>
          </button>
        </div>
      )}
      {maps.length ? (
        <div className="bg-white rounded-[18px] p-1.5 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06)]">
          {maps.map((d, i) => <DocRow key={d.id} ctx={ctx} doc={d} first={i === 0} />)}
        </div>
      ) : (
        <Empty icon={<Network size={26} />} title="Chưa có sơ đồ" text="Bấm 1 thẻ phía trên — sơ đồ dựng sẵn từ dữ liệu, sau đó kéo thả, đổi màu, thêm ghi chú như XMind." />
      )}
    </div>
  );
}

function EntityDocs({ ctx, e }: { ctx: LegalCtx; e: LegalEntity }) {
  const docs = ctx.store.docs.filter(d => d.entity_id === e.id && d.kind !== 'mindmap');
  const milestoneTitle = (id: string | null) => (id ? ctx.store.milestones.find(m => m.id === id)?.title : undefined);
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {e.drive_url && <a href={e.drive_url} target="_blank" rel="noreferrer" className={`${BTN_SECONDARY} h-9 px-4 text-[13px]`}><Folder size={14} /> Thư mục Drive <ExternalLink size={12} /></a>}
        {ctx.canEdit && <button type="button" onClick={() => ctx.newDoc({ entityId: e.id, kind: 'drive', category: 'dkkd' })} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={15} /> Thêm giấy tờ</button>}
      </div>
      {!docs.length && (
        <Empty icon={<Folder size={26} />} title="Chưa có giấy tờ"
          text="Dán link Google Drive của Giấy chứng nhận ĐKDN, Điều lệ, giấy phép, quyết định… — xem ngay trong app. File đính kèm ở từng mốc thời gian cũng hiện ở đây." />
      )}
      <div className="space-y-4">
        {ENTITY_DOC_CATEGORIES.map(c => {
          const list = docs.filter(d => (d.category || 'khac') === c.key).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
          if (!list.length) return null;
          return (
            <section key={c.key}>
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                <h4 className="text-[13px] font-semibold text-[#1D1D1F]">{c.label}</h4>
                <span className="text-[12px] text-[#86868B]">{list.length}</span>
              </div>
              <div className="bg-white rounded-[18px] p-1.5 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06)]">
                {list.map((d, i) => <DocRow key={d.id} ctx={ctx} doc={d} first={i === 0} extra={milestoneTitle(d.milestone_id)} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function EntitiesView({ ctx, entityId, setEntityId, tab, setTab }: {
  ctx: LegalCtx; entityId: string | null; setEntityId: (id: string | null) => void; tab: EntityTab; setTab: (t: EntityTab) => void;
}) {
  const { store, canEdit, mobile, userName, toast } = ctx;
  const [form, setForm] = useState<{ initial: LegalEntity | null } | null>(null);
  const [del, setDel] = useState<LegalEntity | null>(null);
  const entity = entityId ? store.entities.find(e => e.id === entityId) ?? null : null;
  const counts = useMemo(() => {
    const m = new Map<string, { ms: number; docs: number; maps: number }>();
    for (const e of store.entities) m.set(e.id, { ms: 0, docs: 0, maps: 0 });
    for (const x of store.milestones) { const c = m.get(x.entity_id); if (c) c.ms += 1; }
    for (const d of store.docs) { const c = d.entity_id ? m.get(d.entity_id) : null; if (c) { if (d.kind === 'mindmap') c.maps += 1; else c.docs += 1; } }
    return m;
  }, [store.entities, store.milestones, store.docs]);

  const remove = async (e: LegalEntity) => {
    await archive('legal_entities', [e.id], userName);
    store.drop('entity', [e.id]);
    setEntityId(null);
    toast('Đã chuyển pháp nhân vào Thùng rác');
  };

  const rail = !mobile && (
    <aside className="w-[260px] xl:w-[290px] shrink-0 border-r border-black/[0.06] bg-[#FBFBFD]/70 overflow-y-auto">
      <div className="p-2.5 space-y-1">
        <button type="button" onClick={() => setEntityId(null)}
          className={`w-full flex items-center gap-2.5 h-11 px-2.5 rounded-[12px] text-left transition ${!entityId ? 'bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_2px_8px_-4px_rgba(0,0,0,0.15)]' : 'hover:bg-black/[0.04]'}`}>
          <ColorTile color="#1D1D1F" size={30} radius={8}><LayoutGrid size={15} /></ColorTile>
          <span className="text-[13.5px] font-semibold text-[#1D1D1F]">Tổng quan</span>
        </button>
        <div className="flex items-center justify-between px-2 pt-3 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#86868B]">Pháp nhân · {store.entities.length}</span>
          {canEdit && <button type="button" onClick={() => setForm({ initial: null })} className="inline-flex items-center gap-0.5 text-[12px] font-medium text-[#0066CC] hover:underline"><Plus size={13} /> Thêm</button>}
        </div>
        {store.entities.map(e => {
          const on = e.id === entityId;
          const c = counts.get(e.id);
          return (
            <button key={e.id} type="button" onClick={() => setEntityId(e.id)}
              className={`w-full flex items-center gap-2.5 p-2 rounded-[12px] text-left transition ${on ? 'bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_2px_8px_-4px_rgba(0,0,0,0.15)]' : 'hover:bg-black/[0.04]'}`}
              style={on ? { boxShadow: `inset 3px 0 0 ${e.color}, 0 0 0 0.5px rgba(0,0,0,0.06), 0 2px 8px -4px rgba(0,0,0,0.15)` } : undefined}>
              <EntityLogo name={e.short_name || e.name} color={e.color} url={e.logo_url} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-[#1D1D1F] truncate">{e.short_name || e.name}</span>
                <span className="block text-[11.5px] text-[#86868B] truncate">{e.tax_code ? `MST ${e.tax_code}` : e.business_type || '—'}{c?.ms ? ` · ${c.ms} mốc` : ''}</span>
              </span>
              {e.status !== 'active' && <span className={`w-2 h-2 rounded-full shrink-0 ${e.status === 'paused' ? 'bg-[#FF9500]' : 'bg-[#C7C7CC]'}`} title={ENTITY_STATUS[e.status].label} />}
            </button>
          );
        })}
      </div>
    </aside>
  );

  let main: ReactNode;
  if (!entity) {
    main = (
      <>
        <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
          <div>
            <h2 className="text-[24px] md:text-[30px] font-semibold tracking-[-0.025em] leading-tight text-[#1D1D1F]">Pháp nhân</h2>
            <p className="text-[13.5px] text-[#86868B] mt-0.5">Hồ sơ pháp lý các công ty trong hệ thống — mỗi công ty có dòng thời gian thay đổi riêng</p>
          </div>
          {canEdit && store.entities.length > 0 && <button type="button" onClick={() => setForm({ initial: null })} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={15} /> Pháp nhân</button>}
        </div>
        <AllEntities ctx={ctx} onOpen={id => setEntityId(id)} onAdd={() => setForm({ initial: null })} />
      </>
    );
  } else {
    const c = counts.get(entity.id);
    const st = ENTITY_STATUS[entity.status];
    const tabCount: Record<EntityTab, number | undefined> = { overview: undefined, timeline: c?.ms, maps: c?.maps, docs: c?.docs };
    main = (
      <>
        {/* ── đầu hồ sơ ── */}
        <div className="relative overflow-hidden rounded-[24px] mb-4" style={{ background: `linear-gradient(120deg, ${soft(entity.color, 0.2)} 0%, ${soft(entity.color, 0.06)} 55%, rgba(255,255,255,0.7) 100%)` }}>
          <div className="absolute -right-20 -top-24 w-72 h-72 rounded-full" style={{ background: soft(entity.color, 0.14) }} />
          <div className="relative p-4 md:p-6">
            {mobile && <button type="button" onClick={() => setEntityId(null)} className="inline-flex items-center text-[#0071E3] text-[14px] font-medium -ml-1.5 mb-2"><ChevronLeft size={20} /> Pháp nhân</button>}
            <div className="flex items-start gap-3.5 md:gap-4">
              <EntityLogo name={entity.short_name || entity.name} color={entity.color} url={entity.logo_url} size={mobile ? 54 : 68} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[19px] md:text-[25px] font-semibold tracking-[-0.025em] leading-tight text-[#1D1D1F]">{entity.name}</h2>
                {entity.english_name && <div className="text-[12.5px] text-[#6E6E73] mt-0.5 truncate">{entity.english_name}</div>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Pill tint={st.tint}>{st.label}</Pill>
                  {entity.tax_code && <Pill tint="gray"><Copyable ctx={ctx} value={entity.tax_code}>MST {entity.tax_code}</Copyable></Pill>}
                  {entity.business_type && <Pill tint="gray">{entity.business_type}</Pill>}
                  {entity.founded_date && <Pill tint="gray">{companyAge(entity.founded_date)}</Pill>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {entity.drive_url && <a href={entity.drive_url} target="_blank" rel="noreferrer" title="Thư mục Google Drive" className={`${BTN_SECONDARY} h-9 w-9 md:w-auto md:px-3.5 text-[13px] !bg-white/70`}><Folder size={15} /><span className="hidden md:inline">Drive</span></a>}
                {canEdit && <button type="button" onClick={() => setForm({ initial: entity })} className={`${BTN_SECONDARY} h-9 w-9 md:w-auto md:px-3.5 text-[13px] !bg-white/70`} title="Sửa hồ sơ"><Pencil size={14} /><span className="hidden md:inline">Sửa</span></button>}
                {canEdit && <MoreMenu items={[{ label: 'Xoá pháp nhân', icon: <Trash2 size={14} />, danger: true, onClick: () => setDel(entity) }]} />}
              </div>
            </div>
          </div>
        </div>

        {/* ── tab ── */}
        <div className="flex gap-1 mb-4 overflow-x-auto no-scrollbar bg-[#767680]/[0.1] rounded-[11px] p-[3px] w-full md:w-fit">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`shrink-0 whitespace-nowrap flex-1 md:flex-none h-8 px-3.5 rounded-[8px] text-[13px] font-medium transition ${tab === t.id ? 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] text-[#1D1D1F]' : 'text-[#3A3A3C] hover:text-[#1D1D1F]'}`}>
              {t.label}{tabCount[t.id] ? <span className="ml-1 text-[#86868B] tabular-nums">{tabCount[t.id]}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'overview' && <EntityOverview ctx={ctx} e={entity} goTab={setTab} />}
        {tab === 'timeline' && <EntityTimeline ctx={ctx} entity={entity} />}
        {tab === 'maps' && <EntityMaps ctx={ctx} e={entity} />}
        {tab === 'docs' && <EntityDocs ctx={ctx} e={entity} />}
      </>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {rail}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[1280px] mx-auto px-3 md:px-6 xl:px-8 py-4 md:py-6 pb-10">
          {mobile && !entity && store.entities.length > 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-3 px-3 mb-4">
              {store.entities.map(e => (
                <button key={e.id} type="button" onClick={() => setEntityId(e.id)} className="shrink-0 flex items-center gap-2 h-11 pl-1.5 pr-3.5 rounded-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]">
                  <EntityLogo name={e.short_name || e.name} color={e.color} url={e.logo_url} size={30} />
                  <span className="text-[13px] font-semibold text-[#1D1D1F] whitespace-nowrap">{e.short_name || e.name}</span>
                </button>
              ))}
            </div>
          )}
          {main}
        </div>
      </main>
      {form && (
        <EntityForm initial={form.initial} count={store.entities.length} userName={userName} toast={toast}
          onClose={() => setForm(null)} onSaved={e => { store.putEntity(e); setForm(null); setEntityId(e.id); toast('Đã lưu hồ sơ pháp nhân'); }} />
      )}
      {del && (
        <Confirm title={`Xoá "${del.short_name || del.name}"?`} confirmLabel="Xoá" onClose={() => setDel(null)} onConfirm={() => remove(del)}
          text={<>Pháp nhân vào <b>Thùng rác</b> — khôi phục được. Các mốc thời gian và giấy tờ của công ty vẫn giữ nguyên, hiện lại khi khôi phục.</>} />
      )}
    </div>
  );
}
