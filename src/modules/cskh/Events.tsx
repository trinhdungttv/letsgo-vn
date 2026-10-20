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
import { useAuth } from '../../lib/auth';
import { formatCurrencyFull } from '../../lib/format';
import { formatDateVN, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { diffDays, nextOccurrenceIso } from '../../lib/cskh/lunar';
import type { CskhGift, CskhOccasion, GiftDirection } from '../../lib/cskh/types';
import { GIFT_DIRECTION_LABEL, OCCASION_LABEL } from '../../lib/cskh/types';
import { archiveGift, archiveOccasion, saveGift, saveOccasion } from './data/api';
import { useCskh } from './context';
import { chipStyle, daysUntilLabel, gcalTemplateUrl, GREEN, PURPLE } from './ui';
import { useCareScope } from './useCareScope';
import { Card, Empty, MigrationBanner, Spinner } from './components/Card';
import { CareScopeBar } from './components/CareScopeBar';
import { GiftForm } from './components/GiftForm';
import { OccasionForm } from './components/OccasionForm';

const PAGE = 30;
const iconBtn = 'shrink-0 w-9 h-9 md:w-7 md:h-7 rounded-lg flex items-center justify-center';

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

  if (!data) return loading ? <Spinner /> : <p className="py-16 text-center text-[12.5px] text-[#999]">Chưa tải được dữ liệu CSKH.</p>;

  return (
    <div className="space-y-3 md:space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[19px] md:text-[20px] font-bold text-[#111] leading-tight">Sự kiện &amp; Quà tặng</h1>
          <p className="text-[12.5px] text-[#666] mt-0.5">
            {upcoming.filter(u => u.daysUntil <= 30).length} sự kiện trong 30 ngày tới · đã tặng {givenYear.length} món trong 12 tháng
            {givenYearValue > 0 && ` (${formatCurrencyFull(givenYearValue)})`}
          </p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button type="button" onClick={() => setGiftForm({ existing: null })}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg border border-gray-300 bg-white text-[12.5px] font-medium text-[#333]">
            <Gift size={14} /> Ghi quà
          </button>
          <button type="button" onClick={() => setOccForm({ existing: null })}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-1.5 h-10 md:h-8 px-3 rounded-lg bg-[#1D4ED8] text-white text-[12.5px] font-semibold">
            <Plus size={14} /> Thêm sự kiện
          </button>
        </div>
      </header>

      {!data.migrationReady && <MigrationBanner />}
      <CareScopeBar scope={scope} users={data.users} total={contacts.length} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4 items-start">
        <Card icon={<CalendarHeart size={14} />} title="Sự kiện sắp tới" count={upcoming.filter(u => u.daysUntil <= 30).length}
          right={(
            <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#666] cursor-pointer min-h-[32px]">
              <input type="checkbox" checked={showAllPeople} onChange={e => setShowAllPeople(e.target.checked)} className="w-4 h-4 accent-blue-600" />
              Cả người chưa chăm sóc{hiddenUnclassified ? ` (${hiddenUnclassified})` : ''}
            </label>
          )}
          sub="Xếp theo ngày gần nhất · âm lịch đã quy đổi sang dương"
          footer={upcoming.length > eventLimit && (
            <button type="button" onClick={() => setEventLimit(eventLimit + PAGE)} className="text-[12px] text-[#1D4ED8] hover:underline min-h-[32px] md:min-h-0">
              Hiện thêm (còn {upcoming.length - eventLimit})
            </button>
          )}>
          {upcoming.length === 0 ? <Empty>Chưa có sự kiện nào — bấm "Thêm sự kiện".</Empty> : (
            <div className="divide-y divide-[#F0EFEB]">
              {upcoming.slice(0, eventLimit).map(({ o, nextIso, daysUntil }) => {
                const c = contactById.get(o.contactId);
                return (
                  <div key={o.id} className="flex items-center gap-2.5 py-2">
                    <span className="w-11 shrink-0 rounded-lg border border-[#E8E7E2] text-center leading-tight py-0.5" aria-hidden>
                      <small className="block text-[9.5px] uppercase text-red-600 font-semibold">Th{Number(nextIso.slice(5, 7))}</small>
                      <b className="block text-[15px] text-[#111]">{Number(nextIso.slice(8, 10))}</b>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-[#111] leading-snug">
                        {o.title}{o.relatedPerson && !o.title.toLowerCase().includes(o.relatedPerson.toLowerCase()) ? ` của ${o.relatedPerson}` : ''}
                        <span className="ml-1.5 inline-flex gap-1 align-middle">
                          <span className="px-1.5 rounded-full text-[10px] font-medium" style={chipStyle(PURPLE)}>{OCCASION_LABEL[o.occasionType]}</span>
                          {o.isLunar && <span className="px-1.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-800">Âm {o.day}/{o.month}</span>}
                        </span>
                      </p>
                      <p className="text-[11px] text-[#999] truncate">
                        <button type="button" onClick={() => openProfile(o.contactId)} className="hover:text-[#1D4ED8] hover:underline">{c?.fullName}</button>
                        {c?.organization ? ` · ${c.organization}` : ''}
                        {o.year ? ` · từ ${o.year}` : ''} · nhắc trước {o.remindDaysBefore} ngày
                        {o.source === 'birthday' ? ' · ngày sinh trong hồ sơ' : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${daysUntil <= 7 ? 'bg-red-50 text-red-700' : 'bg-[#F4F3EF] text-[#666]'}`}>{daysUntilLabel(daysUntil)}</span>
                    <button type="button" onClick={() => openGcal(o, nextIso)} title="Thêm vào Google Calendar" aria-label={`Thêm ${o.title} vào Google Calendar`}
                      className={`${iconBtn} text-[#666] hover:text-[#1D4ED8] hover:bg-blue-50`}><CalendarPlus size={14} /></button>
                    {o.source === 'special_date' ? (
                      <>
                        <button type="button" onClick={() => setOccForm({ existing: o })} title="Sửa" aria-label={`Sửa ${o.title}`}
                          className={`${iconBtn} text-[#666] hover:bg-[#F4F3EF] hidden sm:flex`}><Pencil size={13} /></button>
                        <button type="button" disabled={busyId === o.id} title="Xoá" aria-label={`Xoá ${o.title}`}
                          onClick={() => { if (confirm(`Xoá sự kiện "${o.title}" của ${c?.fullName}?`)) void run(o.id, () => archiveOccasion(o, user), 'Đã xoá sự kiện'); }}
                          className={`${iconBtn} text-[#bbb] hover:text-red-600 hover:bg-red-50`}><Trash2 size={13} /></button>
                      </>
                    ) : (
                      <button type="button" onClick={() => openProfile(o.contactId)} title="Sửa ngày sinh trong hồ sơ"
                        className={`${iconBtn} text-[#666] hover:bg-[#F4F3EF] hidden sm:flex`}><Pencil size={13} /></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card icon={<Gift size={14} />} title="Lịch sử quà" count={gifts.length}
          right={(
            <div className="flex gap-0.5 bg-[#F4F3EF] border border-[#E8E7E2] rounded-lg p-0.5" role="group" aria-label="Lọc theo chiều quà">
              {(['all', 'given', 'received'] as const).map(d => (
                <button key={d} type="button" onClick={() => setGiftDir(d)} aria-pressed={giftDir === d}
                  className={`px-2.5 h-8 md:h-6 rounded-md text-[11.5px] ${giftDir === d ? 'bg-white text-[#333] font-medium border border-[#E0DFDA]' : 'text-[#888]'}`}>
                  {d === 'all' ? 'Tất cả' : GIFT_DIRECTION_LABEL[d]}
                </button>
              ))}
            </div>
          )}
          sub="Tránh tặng trùng, thể hiện sự tinh tế"
          footer={gifts.length > giftLimit && (
            <button type="button" onClick={() => setGiftLimit(giftLimit + PAGE)} className="text-[12px] text-[#1D4ED8] hover:underline min-h-[32px] md:min-h-0">
              Hiện thêm (còn {gifts.length - giftLimit})
            </button>
          )}>
          {gifts.length === 0 ? <Empty>Chưa ghi món quà nào.</Empty> : (
            <div className="divide-y divide-[#F0EFEB]">
              {gifts.slice(0, giftLimit).map(g => {
                const c = g.contactId ? contactById.get(g.contactId) : undefined;
                const occ = g.occasionId ? data.occasions.find(o => o.id === g.occasionId) : undefined;
                return (
                  <div key={g.id} className="flex items-start gap-2.5 py-2">
                    <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
                      style={chipStyle(g.direction === 'given' ? '#2563EB' : GREEN)}>{GIFT_DIRECTION_LABEL[g.direction]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-[#111]">
                        {g.item}{g.estimatedValue != null && <span className="text-[#888] font-normal"> · {formatCurrencyFull(g.estimatedValue)}</span>}
                      </p>
                      <p className="text-[11px] text-[#999]">
                        {formatDateVN(g.givenAt)} ·{' '}
                        {c ? <button type="button" onClick={() => openProfile(c.id)} className="hover:text-[#1D4ED8] hover:underline">{c.fullName}</button> : (g.recipientName || 'Không rõ người')}
                        {clientName(g.clientId) ? ` · ${clientName(g.clientId)}` : ''}
                        {occ ? ` · dịp ${occ.title}` : ''}
                      </p>
                      {g.note && <p className="text-[11.5px] text-[#666] mt-0.5">{g.note}</p>}
                    </div>
                    {c && (
                      <button type="button" onClick={() => setGiftForm({ existing: g })} title="Sửa" aria-label={`Sửa quà ${g.item}`}
                        className={`${iconBtn} text-[#666] hover:bg-[#F4F3EF]`}><Pencil size={13} /></button>
                    )}
                    <button type="button" disabled={busyId === g.id} title="Xoá" aria-label={`Xoá quà ${g.item}`}
                      onClick={() => { if (confirm(`Xoá món quà "${g.item}"?`)) void run(g.id, () => archiveGift(g, user), 'Đã xoá món quà'); }}
                      className={`${iconBtn} text-[#bbb] hover:text-red-600 hover:bg-red-50`}><Trash2 size={13} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
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
