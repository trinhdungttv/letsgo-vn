// ============================================================================
// Khối "Sức khỏe CSKH" ở hồ sơ Khách hàng (tab Hồ sơ chăm sóc) — góc nhìn cấp công ty
// của CSKH (thay Relationship Radar cũ): điểm TB các người liên hệ đang chăm sóc, ai
// quá hạn, việc đã hứa đang mở, sự kiện sắp tới, quà đã tặng, nhật ký gần đây.
// Bấm người → hồ sơ; nút + → ghi tương tác ngay tại đây.
// Kèm "Ngày lễ & kỷ niệm" của chính công ty (migration 185): quốc gia người đứng đầu, ngày
// thành lập, ngày riêng, ngày lễ của nước đó — nút Sửa mở cùng form nhập nhanh bên Khách hàng.
// ============================================================================
import { useMemo, useState } from 'react';
import { CalendarHeart, ChevronRight, Globe2, HeartPulse, Pencil, Plus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { formatCurrencyFull } from '../../lib/format';
import type { Client } from '../../lib/types';
import { buildContactStats, dueLabel } from '../../lib/cskh/cadence';
import { agendaTitle, buildCompanyAgenda, COMPANY_OCCASION_LABEL } from '../../lib/cskh/companyDates';
import { useCompanyDates } from '../../hooks/useCompanyDates';
import CompanyDatesQuickModal from '../../components/clients/CompanyDatesQuickModal';
import { formatDateVN, relativeDayLabel, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { diffDays, nextOccurrenceIso } from '../../lib/cskh/lunar';
import { SCORE_GRADE_LABEL, scoreGrade } from '../../lib/cskh/score';
import type { CskhInteraction } from '../../lib/cskh/types';
import { INTERACTION_LABEL } from '../../lib/cskh/types';
import { addInteraction, setFollowUpDone, expandOpenExtras, logToast } from './data/api';
import { useCskhData } from './data/useCskhData';
import {
  CARE_STATUS_COLOR, chipStyle, groupDisplayOf, LINK, PANEL, ROUND_ADD, scoreColor,
} from './ui';
import { ICON_TILE } from '../../components/workspace/wsTheme';
import { ContactAvatar } from './components/ContactAvatar';
import { TaskCheck } from './components/apple';
import { ContactProfileModal } from './components/ContactProfileModal';
import { LogInteractionModal } from './components/LogInteractionModal';

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] font-medium text-[#86868B] truncate">{label}</div>
      <div className="text-[20px] font-semibold tracking-[-0.02em] leading-tight tabular-nums" style={{ color: color ?? '#1D1D1F' }}>{value}</div>
      {sub && <div className="text-[11.5px] text-[#86868B] truncate">{sub}</div>}
    </div>
  );
}

export default function ClientCareBlock({ client, clients, toast }: { client: Client; clients: Client[]; toast: (m: string) => void }) {
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const { data, loading } = useCskhData(toast);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editDates, setEditDates] = useState(false);
  const { data: dates } = useCompanyDates();
  const today = todayVN();
  const leaderCountry = dates.countryByClient.get(client.id) ?? null;
  const companyDates = useMemo(() => buildCompanyAgenda({
    clients: [{ id: client.id, name: client.name, leaderCountry }],
    occasions: dates.occasions, holidays: dates.holidays, today, withinDays: 366,
  }), [client.id, client.name, leaderCountry, dates, today]);

  const view = useMemo(() => {
    if (!data) return null;
    const people = data.contacts.filter(c => c.clientIds.includes(client.id));
    const ids = new Set(people.map(c => c.id));
    const stats = buildContactStats(people, data.interactions, data.gifts, data.occasions, data.settings.cadence, today);
    const groupById = new Map(data.groups.map(g => [g.id, g]));
    const cared = people.filter(c => c.tier !== 'unclassified' && !c.isArchived);
    const scores = cared.map(c => stats.get(c.id)?.score?.total).filter((s): s is number => typeof s === 'number');
    const logs = data.interactions.filter(i => !i.isArchived && (i.clientId === client.id || (i.contactId !== null && ids.has(i.contactId) && !i.clientId)));
    const careIds = new Set(cared.map(c => c.id));
    const upcoming = data.occasions
      .filter(o => !o.isArchived && careIds.has(o.contactId))
      .map(o => ({ o, daysUntil: diffDays(today, nextOccurrenceIso(o.day, o.month, o.isLunar, today)) }))
      .filter(x => x.daysUntil >= 0 && x.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil);
    const giftsYear = data.gifts.filter(g => !g.isArchived && g.clientId === client.id && g.direction === 'given' && diffDays(g.givenAt, today) <= 365);
    return {
      people: people.sort((a, b) => Number(b.tier !== 'unclassified') - Number(a.tier !== 'unclassified') || (stats.get(a.id)?.daysUntilDue ?? 9999) - (stats.get(b.id)?.daysUntilDue ?? 9999)),
      stats,
      groupById,
      caredCount: cared.length,
      avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      overdue: cared.filter(c => stats.get(c.id)?.status === 'overdue').length,
      openFollowUps: [...logs, ...expandOpenExtras(logs)].filter(i => i.followUpAction.trim() && !i.followUpDone),
      recent: logs.slice(0, 5),
      upcoming,
      giftsYear,
      giftsValue: giftsYear.reduce((s, g) => s + (g.estimatedValue ?? 0), 0),
    };
  }, [data, client.id, today]);

  const completeFollowUp = async (it: CskhInteraction) => {
    setBusyId(it.id);
    try {
      await setFollowUpDone(it, true, user);
      emitCskhDataChanged();
      toast('Đã xong việc đã hứa');
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (!data || !view) {
    return loading ? <div className="text-[12px] text-[#86868B] text-center py-4">Đang tải CSKH…</div> : null;
  }

  return (
    <section className={PANEL} aria-label="Sức khỏe CSKH">
      <div className="flex items-center justify-between gap-2 px-4 md:px-5 pt-4 pb-2.5">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#1D1D1F] flex items-center gap-2"><span className={`w-7 h-7 rounded-[8px] ${ICON_TILE.red} text-white flex items-center justify-center`}><HeartPulse size={15} /></span> Sức khỏe CSKH</h2>
        <a href="#/crm-leads/matrix" className={LINK}>Mở CSKH <ChevronRight size={14} /></a>
      </div>
      {!data.migrationReady && (
        <p className="mx-4 md:mx-5 mb-2 text-[12.5px] text-[#7A3E00] bg-[#FF9500]/[0.12] rounded-[12px] px-3.5 py-2.5">
          Chưa chạy migration CSKH 168–173 — chưa lưu được nhóm, nhật ký, việc đã hứa.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mx-4 md:mx-5 mb-3 p-3 rounded-[14px] bg-[#F5F5F7]">
        <Stat label="Điểm TB" value={view.avg === null ? '–' : String(view.avg)} color={view.avg === null ? '#999' : scoreColor(view.avg)}
          sub={view.avg === null ? 'Chưa ai được chấm' : SCORE_GRADE_LABEL[scoreGrade(view.avg)]} />
        <Stat label="Đang chăm sóc" value={`${view.caredCount}/${view.people.length}`} sub="người liên hệ" />
        <Stat label="Quá hạn" value={String(view.overdue)} color={view.overdue ? CARE_STATUS_COLOR.overdue : undefined} sub="chưa liên hệ đúng nhịp" />
        <Stat label="Việc đã hứa" value={String(view.openFollowUps.length)} color={view.openFollowUps.length ? CARE_STATUS_COLOR.due_soon : undefined} sub="đang mở" />
        <Stat label="Quà 12 tháng" value={String(view.giftsYear.length)} sub={view.giftsValue ? formatCurrencyFull(view.giftsValue) : `${view.upcoming.length} sự kiện sắp tới`} />
      </div>

      {view.people.length === 0 ? (
        <p className="px-4 md:px-5 py-4 text-[13px] text-[#86868B]">Chưa có người liên hệ — thêm ở khối "Người liên hệ" bên dưới, rồi chọn người chăm sóc trong CSKH.</p>
      ) : (
        <div className="divide-y divide-black/[0.06]">
          {view.people.map(c => {
            const st = view.stats.get(c.id);
            const g = groupDisplayOf(c, view.groupById);
            return (
              <div key={c.id} className={`flex items-center gap-2.5 px-4 md:px-5 py-2.5 ${c.isArchived ? 'opacity-60' : ''}`}>
                <button type="button" onClick={() => setProfileId(c.id)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left group">
                  <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={32} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <b className="text-[14px] font-semibold text-[#1D1D1F] truncate group-hover:text-[#0066CC] transition-colors">{c.fullName}</b>
                      {g.key !== 'unclassified' && <span className="shrink-0 px-2 py-px rounded-full text-[11px] font-medium" style={chipStyle(g.color)}>{g.label}</span>}
                      {c.isArchived && <span className="shrink-0 px-2 rounded-full text-[11px] bg-black/[0.05] text-[#6E6E73]">Đã nghỉ</span>}
                    </span>
                    <span className="block text-[12px] text-[#86868B] truncate">
                      {c.jobTitle || '—'}{c.lastInteractionAt ? ` · liên hệ ${relativeDayLabel(c.lastInteractionAt, today).toLowerCase()}` : ''}
                    </span>
                  </span>
                </button>
                {st && st.status !== 'unclassified' && (
                  <span className="shrink-0 px-2.5 py-0.5 rounded-full text-[12px] font-medium whitespace-nowrap" style={chipStyle(CARE_STATUS_COLOR[st.status])}>{dueLabel(st)}</span>
                )}
                {st?.score && <b className="shrink-0 text-[13px] font-semibold w-7 text-right tabular-nums" style={{ color: scoreColor(st.score.total) }}>{st.score.total}</b>}
                {!c.isArchived && (
                  <button type="button" onClick={() => setLogFor(c.id)} title="Ghi tương tác" aria-label={`Ghi tương tác với ${c.fullName}`}
                    className={ROUND_ADD}>
                    <Plus size={15} strokeWidth={2.4} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mx-4 md:mx-5 py-3 border-t border-[#E5E5EA]">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B] flex items-center gap-1.5">
            <CalendarHeart size={13} /> Ngày lễ &amp; kỷ niệm công ty
          </p>
          <button type="button" onClick={() => setEditDates(true)} className={LINK}><Pencil size={13} /> Sửa</button>
        </div>
        {!dates.ready ? (
          <p className="text-[12px] text-[#86868B]">Chưa chạy migration 185 — chưa lưu được ngày lễ công ty.</p>
        ) : (
          <>
            <p className="text-[12.5px] text-[#3A3A3C] flex items-center gap-1.5">
              <Globe2 size={13} className="text-[#86868B]" />
              Người đứng đầu: {leaderCountry ? <b className="font-semibold">{leaderCountry}</b> : <span className="text-[#86868B]">chưa rõ quốc gia</span>}
            </p>
            {companyDates.length === 0 ? (
              <p className="text-[12px] text-[#C7C7CC] mt-1">Chưa có ngày nào — bấm Sửa để nhập ngày thành lập, ngày lễ công ty, quốc gia người đứng đầu.</p>
            ) : (
              <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-6">
                {companyDates.map(it => (
                  <p key={it.key} className="text-[12px] text-[#1D1D1F] py-0.5 flex items-baseline gap-2 min-w-0">
                    <span className="shrink-0 w-11 tabular-nums text-[#86868B]">{it.nextIso.slice(8, 10)}/{it.nextIso.slice(5, 7)}</span>
                    <span className="min-w-0 truncate">
                      {agendaTitle(it)}
                      <span className="text-[#86868B]">
                        {' · '}{it.type === 'national' ? `lễ ${it.holiday.country}` : COMPANY_OCCASION_LABEL[it.occasion.kind].toLowerCase()}
                        {(it.type === 'national' ? it.holiday.isLunar : it.occasion.isLunar) ? ' · âm lịch' : ''}
                      </span>
                    </span>
                    <span className={`ml-auto shrink-0 text-[11.5px] ${it.daysUntil <= 7 ? 'text-[#D70015] font-medium' : 'text-[#86868B]'}`}>
                      {it.daysUntil === 0 ? 'Hôm nay' : `còn ${it.daysUntil} ngày`}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {(view.openFollowUps.length > 0 || view.recent.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mx-4 md:mx-5 py-3 border-t border-[#E5E5EA]">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1.5">Việc đã hứa đang mở</p>
            {view.openFollowUps.length === 0 ? <p className="text-[12px] text-[#C7C7CC]">Không có</p> : view.openFollowUps.map(i => (
              <div key={i.id} className="flex items-center gap-1 -ml-1.5">
                <TaskCheck busy={busyId === i.id} onDone={() => completeFollowUp(i)} label={`Đánh dấu xong: ${i.followUpAction}`} />
                <span className="flex-1 min-w-0 text-[12px] text-[#1D1D1F]">
                  {i.followUpAction}
                  <span className="text-[#86868B]"> — {i.contactPerson}{i.followUpDue ? `, hạn ${formatDateVN(i.followUpDue)}` : ''}</span>
                </span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1.5">Nhật ký CSKH gần đây</p>
            {view.recent.length === 0 ? <p className="text-[12px] text-[#C7C7CC]">Chưa có</p> : view.recent.map(i => (
              <p key={i.id} className="text-[12px] text-[#1D1D1F] py-0.5 truncate">
                <span className="text-[#86868B]">{formatDateVN(i.occurredAt)} · {INTERACTION_LABEL[i.type]} · {i.contactPerson || '—'}</span>
                {i.content ? ` — ${i.content}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}

      {editDates && (
        <CompanyDatesQuickModal clients={clients.some(c => c.id === client.id) ? clients : [client, ...clients]}
          onlyClientIds={[client.id]} onClose={() => setEditDates(false)} toast={toast} />
      )}
      {profileId && data.rawContacts.has(profileId) && data.contacts.some(c => c.id === profileId) && (
        <ContactProfileModal
          key={profileId}
          contactId={profileId}
          data={data}
          clients={clients}
          toast={toast}
          onClose={() => setProfileId(null)}
          onLog={id => { setProfileId(null); setLogFor(id); }}
        />
      )}
      {logFor && (
        <LogInteractionModal
          contacts={data.contacts}
          clients={clients}
          gifts={data.gifts}
          occasions={data.occasions}
          initialContactId={logFor}
          today={today}
          onClose={() => setLogFor(null)}
          onSave={async input => {
            try {
              await addInteraction({ ...input, clientId: input.clientId ?? client.id }, { user, clients, branches });
            } catch (e) {
              return (e as Error).message;
            }
            setLogFor(null);
            emitCskhDataChanged();
            toast(logToast(input));
            return null;
          }}
        />
      )}
    </section>
  );
}
