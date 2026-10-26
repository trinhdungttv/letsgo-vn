// ============================================================================
// Sự kiện & Quà tặng (port PRM OccasionsPage).
// ----------------------------------------------------------------------------
// • Sự kiện sắp tới: ngày dương lần tới (âm lịch đã quy đổi), đếm ngược, nút Thêm vào
//   Google Calendar (link điền sẵn, sự kiện cả ngày — không cần OAuth). Mặc định chỉ
//   người đang chăm sóc. Sinh nhật trong hồ sơ hiện kèm (sửa ở hồ sơ).
// • Lịch sử quà — tránh tặng trùng: Đã tặng / Đã nhận, giá trị, gắn sự kiện.
// Xoá = lưu trữ (xoá mềm), khôi phục được ở trang Lịch sử.
// ============================================================================
import { useMemo, useState } from 'react';
import { CalendarHeart, CalendarPlus, Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { ICON_TILE, TINT } from '../../components/workspace/wsTheme';
import { useAuth } from '../../lib/auth';
import { formatCurrencyFull } from '../../lib/format';
import { formatDateVN, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { diffDays, nextOccurrenceIso } from '../../lib/cskh/lunar';
import type { CskhGift, CskhOccasion, GiftDirection } from '../../lib/cskh/types';
import { GIFT_DIRECTION_LABEL, OCCASION_LABEL } from '../../lib/cskh/types';
import { archiveGift, archiveOccasion, saveGift, saveOccasion } from './data/api';
import { useCskh } from './context';
import {
  chipStyle, daysUntilLabel, gcalTemplateUrl, PILL_PRIMARY, PILL_TINTED, PURPLE, ROUND_ICON,
} from './ui';
import { useCareScope } from './useCareScope';
import { MigrationBanner, Spinner } from './components/Card';
import { CompanyTag, MoreButton, PageTitle, Panel, Quiet, Row, Segmented, Switch } from './components/apple';
import { CareScopeBar } from './components/CareScopeBar';
import { GiftForm } from './components/GiftForm';
import { OccasionForm } from './components/OccasionForm';

const PAGE = 30;

export default function CskhEvents() {
  const { data, loading, clients, toast, openProfile } = useCskh();
  const { user } = useAuth();
  const today = todayVN();
  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const contactById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);
  const clientName = (id: string) => clients.find(c => c.id === id)?.name ?? '';
  const scope = useCareScope(contacts, clients);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [eventLimit, setEventLimit] = useState(PAGE);
  const [giftLimit, setGiftLimit] = useState(PAGE);
  const [giftDir, setGiftDir] = useState<'all' | GiftDirection>('all');
  const [occForm, setOccForm] = useState<{ existing: CskhOccasion | null } | null>(null);
  const [giftForm, setGiftForm] = useState<{ existing: CskhGift | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const gifts = useMemo(() => (data?.gifts ?? [])
    .filter(g => !g.isArchived && (giftDir === 'all' || g.direction === giftDir) && (!g.contactId || scopedIds.has(g.contactId)))
    .sort((a, b) => b.givenAt.localeCompare(a.givenAt)), [data, giftDir, scopedIds]);
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

  const soon = upcoming.filter(u => u.daysUntil <= 30).length;

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle
        eyebrow="Ghi nhớ dịp quan trọng"
        title="Sự kiện & Quà tặng"
        subtitle={<>{soon} sự kiện trong 30 ngày tới · đã tặng {givenYear.length} món trong 12 tháng{givenYearValue > 0 && ` (${formatCurrencyFull(givenYearValue)})`}</>}
        actions={(
          <>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 items-start">
        <Panel title="Sự kiện sắp tới" count={soon}
          icon={<span className={`w-7 h-7 rounded-[8px] ${ICON_TILE.red} text-white flex items-center justify-center`}><CalendarHeart size={15} /></span>}
          meta="Xếp theo ngày gần nhất · âm lịch đã quy đổi sang dương"
          footer={upcoming.length > eventLimit && (
            <MoreButton onClick={() => setEventLimit(eventLimit + PAGE)}>Hiện thêm (còn {upcoming.length - eventLimit})</MoreButton>
          )}>
          <div className="pb-1">
            <Switch checked={showAllPeople} onChange={setShowAllPeople}
              label={<span className="text-[12.5px] text-[#6E6E73]">Cả người chưa chăm sóc{hiddenUnclassified ? ` (${hiddenUnclassified})` : ''}</span>} />
          </div>
          {upcoming.length === 0 ? <Quiet icon={<CalendarHeart size={18} />}>Chưa có sự kiện nào — bấm "Thêm sự kiện".</Quiet> : (
            <div>
              {upcoming.slice(0, eventLimit).map(({ o, nextIso, daysUntil }, idx) => {
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
                      onClick={() => { if (confirm(`Xoá món quà "${g.item}"?`)) void run(g.id, () => archiveGift(g, user), 'Đã xoá món quà'); }}
                      className={`${ROUND_ICON} hover:!text-[#D70015] hover:!bg-[#FF3B30]/10`}><Trash2 size={14} /></button>
                  </Row>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

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
      {giftForm && (
        <GiftForm
          contacts={contacts}
          clients={clients}
          occasions={data.occasions}
          gifts={data.gifts}
          existing={giftForm.existing}
          onClose={() => setGiftForm(null)}
          onSave={async input => {
            try { await saveGift(input, giftForm.existing, user); } catch (e) { return (e as Error).message; }
            setGiftForm(null);
            emitCskhDataChanged();
            toast(giftForm.existing ? 'Đã lưu món quà' : 'Đã ghi món quà');
            return null;
          }}
        />
      )}
    </div>
  );
}
