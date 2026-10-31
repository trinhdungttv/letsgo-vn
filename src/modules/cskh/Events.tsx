// ============================================================================
// Sự kiện & Quà tặng (port PRM OccasionsPage).
// ----------------------------------------------------------------------------
// • Sự kiện sắp tới: ngày dương lần tới (âm lịch đã quy đổi), đếm ngược, nút Thêm vào
//   Google Calendar (link điền sẵn, sự kiện cả ngày — không cần OAuth). Mặc định chỉ
//   người đang chăm sóc. Sinh nhật trong hồ sơ hiện kèm (sửa ở hồ sơ).
// • Lịch sử quà — tránh tặng trùng: Đã tặng / Đã nhận, giá trị, gắn sự kiện. Quà ghi từ Nhật ký
//   (hình thức "Quà tặng") cũng nằm ở đây; dòng "Quà tặng" cũ chưa có món quà được nhắc ở đầu trang
//   để ghi bổ sung.
// • Ngày của CÔNG TY (migration 185, chỉ trang khách): thành lập / kỷ niệm / ngày lễ riêng +
//   ngày lễ quốc gia người đứng đầu, của công ty đang hợp tác trong phạm vi lọc (chi nhánh,
//   người quản lý KH). Nhập ở Khách hàng → "Ngày lễ KH"; nút "Ngày lễ công ty" ở đây mở cùng form.
// Xoá = lưu trữ (xoá mềm), khôi phục được ở trang Lịch sử.
// ============================================================================
import { useMemo, useState } from 'react';
import { Building2, CalendarHeart, CalendarPlus, Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { ICON_TILE, TINT } from '../../components/workspace/wsTheme';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { useAuth } from '../../lib/auth';
import { branchOf } from '../../lib/branchRef';
import { useCompanyDates } from '../../hooks/useCompanyDates';
import { buildCompanyAgenda, type CompanyAgendaItem } from '../../lib/cskh/companyDates';
import { isCooperatingClient } from '../../lib/cskh/seedTiers';
import CompanyDatesQuickModal from '../../components/clients/CompanyDatesQuickModal';
import { formatCurrencyFull } from '../../lib/format';
import { formatDateVN, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { logOfGift, logsMissingGift } from '../../lib/cskh/logGift';
import { diffDays, nextOccurrenceIso } from '../../lib/cskh/lunar';
import type { CskhGift, CskhInteraction, CskhOccasion, GiftDirection } from '../../lib/cskh/types';
import { GIFT_DIRECTION_LABEL, OCCASION_LABEL } from '../../lib/cskh/types';
import { archiveGift, archiveOccasion, saveGift, saveOccasion, updateInteraction } from './data/api';
import { useCskh } from './context';
import {
  chipStyle, daysUntilLabel, gcalTemplateUrl, PANEL, PILL_PRIMARY, PILL_TINTED, PURPLE, ROUND_ICON,
} from './ui';
import { useCareScope } from './useCareScope';
import { MigrationBanner, Spinner } from './components/Card';
import { CompanyTag, MoreButton, PageTitle, Panel, Quiet, Row, Segmented, Switch } from './components/apple';
import { CareScopeBar } from './components/CareScopeBar';
import { CompanyEventRow } from './components/CompanyEventRow';
import { GiftForm } from './components/GiftForm';
import { LogInteractionModal } from './components/LogInteractionModal';
import { OccasionForm } from './components/OccasionForm';

const PAGE = 30;

type EventFilter = 'all' | 'people' | 'company';
type EventRow =
  | { kind: 'person'; key: string; nextIso: string; daysUntil: number; o: CskhOccasion }
  | { kind: 'company'; key: string; nextIso: string; daysUntil: number; item: CompanyAgendaItem };

export default function CskhEvents() {
  const { space, data, loading, clients, toast, openProfile, openClient } = useCskh();
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const today = todayVN();
  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const contactById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);
  const clientName = (id: string | null) => (id ? clients.find(c => c.id === id)?.name ?? '' : '');
  const scope = useCareScope(contacts, clients, space);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [eventLimit, setEventLimit] = useState(PAGE);
  const [giftLimit, setGiftLimit] = useState(PAGE);
  const [giftDir, setGiftDir] = useState<'all' | GiftDirection>('all');
  const [occForm, setOccForm] = useState<{ existing: CskhOccasion | null } | null>(null);
  const [giftForm, setGiftForm] = useState<{ existing: CskhGift | null } | null>(null);
  const [fixingLog, setFixingLog] = useState<CskhInteraction | null>(null);
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [datesModal, setDatesModal] = useState<{ onlyClientIds?: string[]; tab: 'company' | 'country' } | null>(null);
  const { data: dates } = useCompanyDates();
  const isClientSpace = space === 'client';

  const scopedIds = useMemo(() => new Set(scope.scoped.map(c => c.id)), [scope.scoped]);

  // Mặc định chỉ sự kiện của người ĐANG CHĂM SÓC (thuộc phạm vi lọc, chưa nghỉ)
  const upcoming = useMemo(() => (data?.occasions ?? [])
    .filter(o => {
      const c = contactById.get(o.contactId);
      return !o.isArchived && !!c && !c.isArchived && scopedIds.has(c.id) && (showAllPeople || c.tier !== 'unclassified');
    })
    .map(o => {
      const nextIso = nextOccurrenceIso(o.day, o.month, o.isLunar, today);
      return { o, nextIso, daysUntil: diffDays(today, nextIso) };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil), [data, contactById, scopedIds, showAllPeople, today]);
  const hiddenUnclassified = (data?.occasions ?? []).filter(o => !o.isArchived && contactById.get(o.contactId)?.tier === 'unclassified').length;

  // Ngày của công ty đang hợp tác, theo bộ lọc chi nhánh / người quản lý KH (người phụ trách không áp cho công ty)
  const { branch, manager } = scope.filters;
  const companyItems = useMemo(() => {
    if (!isClientSpace || !dates.ready) return [];
    const lites = clients
      .filter(isCooperatingClient)
      .filter(c => (branch === 'all' || branchOf(c, branches)?.id === branch) && (manager === 'all' || (c.manager ?? '').trim() === manager))
      .map(c => ({ id: c.id, name: c.name, leaderCountry: dates.countryByClient.get(c.id) ?? null }));
    return buildCompanyAgenda({ clients: lites, occasions: dates.occasions, holidays: dates.holidays, today, withinDays: 366 });
  }, [isClientSpace, dates, clients, branches, branch, manager, today]);

  const eventRows = useMemo<EventRow[]>(() => [
    ...(eventFilter === 'company' ? [] : upcoming.map(u => ({ kind: 'person' as const, key: u.o.id, ...u }))),
    ...(eventFilter === 'people' ? [] : companyItems.map(item => ({ kind: 'company' as const, key: item.key, nextIso: item.nextIso, daysUntil: item.daysUntil, item }))),
  ].sort((a, b) => a.daysUntil - b.daysUntil), [upcoming, companyItems, eventFilter]);

  const gifts = useMemo(() => (data?.gifts ?? [])
    .filter(g => !g.isArchived && (giftDir === 'all' || g.direction === giftDir) && (!g.contactId || scopedIds.has(g.contactId)))
    .sort((a, b) => b.givenAt.localeCompare(a.givenAt)), [data, giftDir, scopedIds]);
  // Dòng nhật ký "Quà tặng" lẻ chưa có món quà trong Lịch sử quà (trong phạm vi đang xem)
  const missingGift = useMemo(
    () => logsMissingGift(data?.interactions ?? [], data?.gifts ?? []).filter(i => i.contactId && scopedIds.has(i.contactId)),
    [data, scopedIds],
  );
  const givenYear = (data?.gifts ?? []).filter(g => !g.isArchived && g.direction === 'given' && diffDays(g.givenAt, today) <= 365 && diffDays(g.givenAt, today) >= 0);
  const givenYearValue = givenYear.reduce((s, g) => s + (g.estimatedValue ?? 0), 0);

  const run = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      emitCskhDataChanged();
      toast(ok);
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const openGcal = (o: CskhOccasion, nextIso: string) => {
    const c = contactById.get(o.contactId);
    const who = `${o.relatedPerson ? `${o.relatedPerson} của ` : ''}${c?.fullName ?? ''}`;
    window.open(gcalTemplateUrl({
      title: `${o.title} — ${who}`,
      dateIso: nextIso,
      location: c ? (c.mapUrl || c.address || c.organization) : '',
      details: [
        `${OCCASION_LABEL[o.occasionType]}${o.isLunar ? ` (âm lịch ${o.day}/${o.month})` : ''}`,
        c?.organization ? `Công ty: ${c.organization}` : '',
        o.note,
        'Tạo từ CSKH LetsGo',
      ].filter(Boolean).join('\n'),
    }), '_blank', 'noopener');
  };

  if (!data) return loading ? <Spinner /> : <p className="py-16 text-center text-[13px] text-[#86868B]">Chưa tải được dữ liệu CSKH.</p>;

  const soon = upcoming.filter(u => u.daysUntil <= 30).length + companyItems.filter(i => i.daysUntil <= 30).length;

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle
        eyebrow="Ghi nhớ dịp quan trọng"
        title="Sự kiện & Quà tặng"
        subtitle={<>{soon} sự kiện trong 30 ngày tới · đã tặng {givenYear.length} món trong 12 tháng{givenYearValue > 0 && ` (${formatCurrencyFull(givenYearValue)})`}</>}
        actions={(
          <>
            {isClientSpace && (
              <button type="button" onClick={() => setDatesModal({ tab: 'company' })} className={PILL_TINTED} title="Ngày thành lập, ngày lễ công ty, quốc gia người đứng đầu — cùng form với Khách hàng → Ngày lễ KH">
                <Building2 size={15} strokeWidth={2.2} /> Ngày lễ công ty
              </button>
            )}
            <button type="button" onClick={() => setGiftForm({ existing: null })} className={PILL_TINTED}>
              <Gift size={15} strokeWidth={2.2} /> Ghi quà
            </button>
            <button type="button" onClick={() => setOccForm({ existing: null })} className={PILL_PRIMARY}>
              <Plus size={15} strokeWidth={2.4} /> Thêm sự kiện
            </button>
          </>
        )}
      />

      {!data.migrationReady && <MigrationBanner />}
      <CareScopeBar scope={scope} users={data.users} total={contacts.length} />

      {missingGift.length > 0 && (
        <section className={`${PANEL} px-4 md:px-5 py-3`} aria-label="Nhật ký quà tặng chưa có món quà">
          <p className="text-[13.5px] font-semibold text-[#1D1D1F]">
            {missingGift.length} dòng nhật ký “Quà tặng” chưa có món quà trong Lịch sử quà
          </p>
          <p className="text-[12px] text-[#86868B] mt-0.5">Ghi trước khi có ô chọn món quà — bấm “Ghi món quà” để bổ sung (không mất nhật ký).</p>
          <div className="mt-1">
            {(showAllMissing ? missingGift : missingGift.slice(0, 4)).map((i, idx) => {
              const c = i.contactId ? contactById.get(i.contactId) : undefined;
              return (
                <Row key={i.id} first={idx === 0} inset={0} align="start">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-[#1D1D1F] leading-snug">
                      {c?.fullName || i.contactPerson || 'Không rõ người'}
                      {(c?.organization || i.clientName) && <>{' '}<CompanyTag name={c?.organization || i.clientName} /></>}
                    </p>
                    <p className="text-[12px] text-[#86868B] mt-0.5 line-clamp-2">{formatDateVN(i.occurredAt)}{i.content ? ` · ${i.content}` : ''}</p>
                  </div>
                  <button type="button" onClick={() => setFixingLog(i)} className={PILL_TINTED}>
                    <Gift size={14} strokeWidth={2.2} /> Ghi món quà
                  </button>
                </Row>
              );
            })}
          </div>
          {missingGift.length > 4 && !showAllMissing && (
            <MoreButton onClick={() => setShowAllMissing(true)}>Hiện thêm (còn {missingGift.length - 4})</MoreButton>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 items-start">
        <Panel title="Sự kiện sắp tới" count={soon}
          icon={<span className={`w-7 h-7 rounded-[8px] ${ICON_TILE.red} text-white flex items-center justify-center`}><CalendarHeart size={15} /></span>}
          meta="Xếp theo ngày gần nhất · âm lịch đã quy đổi sang dương"
          footer={eventRows.length > eventLimit && (
            <MoreButton onClick={() => setEventLimit(eventLimit + PAGE)}>Hiện thêm (còn {eventRows.length - eventLimit})</MoreButton>
          )}>
          {isClientSpace && (
            <div className="pb-1.5">
              <Segmented label="Lọc sự kiện" value={eventFilter} onChange={setEventFilter} options={[
                { key: 'all', label: 'Tất cả' },
                { key: 'people', label: 'Người liên hệ', badge: upcoming.length },
                { key: 'company', label: 'Công ty', badge: companyItems.length },
              ]} />
            </div>
          )}
          {eventFilter !== 'company' && (
            <div className="pb-1">
              <Switch checked={showAllPeople} onChange={setShowAllPeople}
                label={<span className="text-[12.5px] text-[#6E6E73]">Cả người chưa chăm sóc{hiddenUnclassified ? ` (${hiddenUnclassified})` : ''}</span>} />
            </div>
          )}
          {isClientSpace && !dates.ready && eventFilter !== 'people' && (
            <p className="text-[12px] text-[#86868B] pb-1">Chưa chạy migration 185 — chưa có ngày lễ công ty.</p>
          )}
          {eventRows.length === 0 ? (
            <Quiet icon={<CalendarHeart size={18} />}>
              {eventFilter === 'company' ? 'Chưa có ngày lễ công ty — bấm "Ngày lễ công ty" để nhập.' : 'Chưa có sự kiện nào — bấm "Thêm sự kiện".'}
            </Quiet>
          ) : (
            <div>
              {eventRows.slice(0, eventLimit).map((r, idx) => {
                if (r.kind === 'company') {
                  return (
                    <CompanyEventRow key={r.key} item={r.item} first={idx === 0} onOpenClient={openClient}
                      onEdit={it => setDatesModal(it.type === 'national' ? { tab: 'country' } : { tab: 'company', onlyClientIds: [it.client.id] })} />
                  );
                }
                const { o, nextIso, daysUntil } = r;
                const c = contactById.get(o.contactId);
                return (
                  <Row key={o.id} first={idx === 0} inset={56}>
                    <span className="w-11 shrink-0 rounded-[10px] bg-white overflow-hidden text-center leading-none shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.06)]" aria-hidden>
                      <small className="block bg-[#FF3B30] text-white text-[9.5px] font-semibold uppercase py-[3px]">Th{Number(nextIso.slice(5, 7))}</small>
                      <b className="block text-[18px] font-semibold text-[#1D1D1F] py-[5px] tabular-nums">{Number(nextIso.slice(8, 10))}</b>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-[#1D1D1F] leading-snug">
                        {o.title}{o.relatedPerson && !o.title.toLowerCase().includes(o.relatedPerson.toLowerCase()) ? ` của ${o.relatedPerson}` : ''}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1">
                        <span className="px-2 rounded-full text-[11px] font-medium" style={chipStyle(PURPLE)}>{OCCASION_LABEL[o.occasionType]}</span>
                        {o.isLunar && <span className={`px-2 rounded-full text-[11px] font-medium ${TINT.yellow}`}>Âm {o.day}/{o.month}</span>}
                        <span className={`sm:hidden px-2 rounded-full text-[11px] font-medium ${daysUntil <= 7 ? TINT.red : TINT.gray}`}>{daysUntilLabel(daysUntil)}</span>
                      </p>
                      <p className="text-[12px] text-[#86868B] truncate mt-0.5">
                        <button type="button" onClick={() => openProfile(o.contactId)} className="text-[#3A3A3C] font-medium hover:text-[#0066CC] transition-colors">{c?.fullName}</button>
                        {c?.organization && <>{' '}<CompanyTag name={c.organization} /></>}
                        {o.year ? ` · từ ${o.year}` : ''} · nhắc trước {o.remindDaysBefore} ngày
                        {o.source === 'birthday' ? ' · ngày sinh trong hồ sơ' : ''}
                      </p>
                    </div>
                    <span className={`hidden sm:inline shrink-0 px-2.5 py-0.5 rounded-full text-[12px] font-medium ${daysUntil <= 7 ? TINT.red : TINT.gray}`}>{daysUntilLabel(daysUntil)}</span>
                    <button type="button" onClick={() => openGcal(o, nextIso)} title="Thêm vào Google Calendar" aria-label={`Thêm ${o.title} vào Google Calendar`}
                      className={`${ROUND_ICON} hover:!text-[#0066CC]`}><CalendarPlus size={15} /></button>
                    {o.source === 'special_date' ? (
                      <>
                        <button type="button" onClick={() => setOccForm({ existing: o })} title="Sửa" aria-label={`Sửa ${o.title}`}
                          className={`${ROUND_ICON} hidden sm:inline-flex`}><Pencil size={14} /></button>
                        <button type="button" disabled={busyId === o.id} title="Xoá" aria-label={`Xoá ${o.title}`}
                          onClick={() => { if (confirm(`Xoá sự kiện "${o.title}" của ${c?.fullName}?`)) void run(o.id, () => archiveOccasion(o, user), 'Đã xoá sự kiện'); }}
                          className={`${ROUND_ICON} hover:!text-[#D70015] hover:!bg-[#FF3B30]/10`}><Trash2 size={14} /></button>
                      </>
                    ) : (
                      <button type="button" onClick={() => openProfile(o.contactId)} title="Sửa ngày sinh trong hồ sơ"
                        className={`${ROUND_ICON} hidden sm:inline-flex`}><Pencil size={14} /></button>
                    )}
                  </Row>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Lịch sử quà" count={gifts.length}
          icon={<span className={`w-7 h-7 rounded-[8px] ${ICON_TILE.orange} text-white flex items-center justify-center`}><Gift size={15} /></span>}
          meta="Tránh tặng trùng, thể hiện sự tinh tế"
          footer={gifts.length > giftLimit && (
            <MoreButton onClick={() => setGiftLimit(giftLimit + PAGE)}>Hiện thêm (còn {gifts.length - giftLimit})</MoreButton>
          )}>
          <div className="pb-1.5">
            <Segmented label="Lọc theo chiều quà" value={giftDir} onChange={setGiftDir}
              options={(['all', 'given', 'received'] as const).map(d => ({ key: d, label: d === 'all' ? 'Tất cả' : GIFT_DIRECTION_LABEL[d] }))} />
          </div>
          {gifts.length === 0 ? <Quiet icon={<Gift size={18} />}>Chưa ghi món quà nào.</Quiet> : (
            <div>
              {gifts.slice(0, giftLimit).map((g, idx) => {
                const c = g.contactId ? contactById.get(g.contactId) : undefined;
                const occ = g.occasionId ? data.occasions.find(o => o.id === g.occasionId) : undefined;
                return (
                  <Row key={g.id} first={idx === 0} inset={0} align="start">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[14px] font-semibold text-[#1D1D1F]">{g.item}</span>
                        {g.estimatedValue != null && <span className="text-[13px] text-[#6E6E73] tabular-nums">{formatCurrencyFull(g.estimatedValue)}</span>}
                        <span className={`px-2 rounded-full text-[11px] font-medium ${g.direction === 'given' ? TINT.blue : TINT.green}`}>{GIFT_DIRECTION_LABEL[g.direction]}</span>
                      </p>
                      <p className="text-[12px] text-[#86868B] mt-0.5">
                        {formatDateVN(g.givenAt)} ·{' '}
                        {c ? <button type="button" onClick={() => openProfile(c.id)} className="text-[#3A3A3C] font-medium hover:text-[#0066CC] transition-colors">{c.fullName}</button> : (g.recipientName || 'Không rõ người')}
                        {clientName(g.clientId) ? ` · ${clientName(g.clientId)}` : ''}
                        {occ ? ` · dịp ${occ.title}` : ''}
                      </p>
                      {g.note && <p className="text-[12.5px] text-[#6E6E73] mt-0.5">{g.note}</p>}
                    </div>
                    {c && (
                      <button type="button" onClick={() => setGiftForm({ existing: g })} title="Sửa" aria-label={`Sửa quà ${g.item}`}
                        className={ROUND_ICON}><Pencil size={14} /></button>
                    )}
                    <button type="button" disabled={busyId === g.id} title="Xoá" aria-label={`Xoá quà ${g.item}`}
                      onClick={() => {
                        const log = logOfGift(data.interactions, g);
                        const also = log ? `\n\nDòng “Quà tặng” ngày ${formatDateVN(log.occurredAt)} trong Nhật ký${log.followUpAction.trim() && !log.followUpDone ? ' (và việc đã hứa chưa xong của dòng đó)' : ''} cũng bị xoá.` : '';
                        if (confirm(`Xoá món quà "${g.item}"?${also}\n\nKhôi phục được ở trang Lịch sử.`)) void run(g.id, () => archiveGift(g, user, data.interactions), log ? 'Đã xoá món quà + dòng nhật ký' : 'Đã xoá món quà');
                      }}
                      className={`${ROUND_ICON} hover:!text-[#D70015] hover:!bg-[#FF3B30]/10`}><Trash2 size={14} /></button>
                  </Row>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {datesModal && (
        <CompanyDatesQuickModal clients={clients} onlyClientIds={datesModal.onlyClientIds} initialTab={datesModal.tab}
          onClose={() => setDatesModal(null)} toast={toast} />
      )}
      {occForm && (
        <OccasionForm
          contacts={contacts}
          existing={occForm.existing}
          onClose={() => setOccForm(null)}
          onSave={async input => {
            try { await saveOccasion(input, occForm.existing, user); } catch (e) { return (e as Error).message; }
            setOccForm(null);
            emitCskhDataChanged();
            toast(occForm.existing ? 'Đã lưu sự kiện' : 'Đã thêm sự kiện');
            return null;
          }}
        />
      )}
      {fixingLog && (
        <LogInteractionModal
          contacts={contacts}
          clients={clients}
          gifts={data.gifts}
          occasions={data.occasions}
          existing={fixingLog}
          today={today}
          onClose={() => setFixingLog(null)}
          onUpdate={async edit => {
            const contact = fixingLog.contactId ? contactById.get(fixingLog.contactId) ?? null : null;
            try { await updateInteraction(fixingLog, edit, contact, { user, clients, branches }, data.gifts); } catch (e) { return (e as Error).message; }
            setFixingLog(null);
            emitCskhDataChanged();
            toast(edit.gift?.item.trim() ? 'Đã ghi món quà vào Lịch sử quà' : 'Đã lưu nhật ký');
            return null;
          }}
        />
      )}
      {giftForm && (
        <GiftForm
          contacts={contacts}
          clients={clients}
          occasions={data.occasions}
          gifts={data.gifts}
          existing={giftForm.existing}
          linkedLog={!!giftForm.existing && !!logOfGift(data.interactions, giftForm.existing)}
          onClose={() => setGiftForm(null)}
          onSave={async input => {
            try { await saveGift(input, giftForm.existing, { user, clients, branches }, data.interactions); } catch (e) { return (e as Error).message; }
            setGiftForm(null);
            emitCskhDataChanged();
            toast(giftForm.existing ? 'Đã lưu món quà' : 'Đã ghi món quà + 1 dòng vào Nhật ký');
            return null;
          }}
        />
      )}
    </div>
  );
}
