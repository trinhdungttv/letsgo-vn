// ============================================================================
// Khối "Sức khỏe CSKH" ở hồ sơ Khách hàng (tab Hồ sơ chăm sóc) — góc nhìn cấp công ty
// của CSKH (thay Relationship Radar cũ): điểm TB các người liên hệ đang chăm sóc, ai
// quá hạn, việc đã hứa đang mở, sự kiện sắp tới, quà đã tặng, nhật ký gần đây.
// Bấm người → hồ sơ; nút + → ghi tương tác ngay tại đây.
// ============================================================================
import { useMemo, useState } from 'react';
import { CheckCheck, ChevronRight, HeartPulse, Plus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { formatCurrencyFull } from '../../lib/format';
import type { Client } from '../../lib/types';
import { buildContactStats, dueLabel } from '../../lib/cskh/cadence';
import { formatDateVN, relativeDayLabel, todayVN } from '../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { diffDays, nextOccurrenceIso } from '../../lib/cskh/lunar';
import { SCORE_GRADE_LABEL, scoreGrade } from '../../lib/cskh/score';
import type { CskhInteraction } from '../../lib/cskh/types';
import { INTERACTION_LABEL } from '../../lib/cskh/types';
import { addInteraction, setFollowUpDone } from './data/api';
import { useCskhData } from './data/useCskhData';
import { CARE_STATUS_COLOR, chipStyle, groupDisplayOf, scoreColor } from './ui';
import { ContactAvatar } from './components/ContactAvatar';
import { ContactProfileModal } from './components/ContactProfileModal';
import { LogInteractionModal } from './components/LogInteractionModal';

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold truncate">{label}</div>
      <div className="text-[17px] font-bold leading-tight" style={{ color: color ?? '#111' }}>{value}</div>
      {sub && <div className="text-[10.5px] text-[#999] truncate">{sub}</div>}
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
  const today = todayVN();

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
      openFollowUps: logs.filter(i => i.followUpAction.trim() && !i.followUpDone),
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
    return loading ? <div className="text-[12px] text-[#999] text-center py-4">Đang tải CSKH…</div> : null;
  }

  return (
    <section className="bg-white border border-[#E8E7E2] rounded-[10px]" aria-label="Sức khỏe CSKH">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-[13px] font-semibold text-[#111] flex items-center gap-1.5"><HeartPulse size={14} className="text-[#888]" /> Sức khỏe CSKH</h2>
        <a href="#/crm-leads/matrix" className="text-[12px] text-[#1D4ED8] hover:underline inline-flex items-center gap-0.5">Mở CSKH <ChevronRight size={12} /></a>
      </div>
      {!data.migrationReady && (
        <p className="mx-4 mb-2 text-[11.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Chưa chạy migration CSKH 168–173 — chưa lưu được nhóm, nhật ký, việc đã hứa.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-4 pb-3 border-b border-[#F0EFEB]">
        <Stat label="Điểm TB" value={view.avg === null ? '–' : String(view.avg)} color={view.avg === null ? '#999' : scoreColor(view.avg)}
          sub={view.avg === null ? 'Chưa ai được chấm' : SCORE_GRADE_LABEL[scoreGrade(view.avg)]} />
        <Stat label="Đang chăm sóc" value={`${view.caredCount}/${view.people.length}`} sub="người liên hệ" />
        <Stat label="Quá hạn" value={String(view.overdue)} color={view.overdue ? CARE_STATUS_COLOR.overdue : undefined} sub="chưa liên hệ đúng nhịp" />
        <Stat label="Việc đã hứa" value={String(view.openFollowUps.length)} color={view.openFollowUps.length ? CARE_STATUS_COLOR.due_soon : undefined} sub="đang mở" />
        <Stat label="Quà 12 tháng" value={String(view.giftsYear.length)} sub={view.giftsValue ? formatCurrencyFull(view.giftsValue) : `${view.upcoming.length} sự kiện sắp tới`} />
      </div>

      {view.people.length === 0 ? (
        <p className="px-4 py-4 text-[12px] text-[#aaa]">Chưa có người liên hệ — thêm ở khối "Người liên hệ" bên dưới, rồi chọn người chăm sóc trong CSKH.</p>
      ) : (
        <div className="divide-y divide-[#F0EFEB]">
          {view.people.map(c => {
            const st = view.stats.get(c.id);
            const g = groupDisplayOf(c, view.groupById);
            return (
              <div key={c.id} className={`flex items-center gap-2.5 px-4 py-2 ${c.isArchived ? 'opacity-60' : ''}`}>
                <button type="button" onClick={() => setProfileId(c.id)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left group">
                  <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={32} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <b className="text-[12.5px] text-[#111] truncate group-hover:text-[#1D4ED8]">{c.fullName}</b>
                      {g.key !== 'unclassified' && <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={chipStyle(g.color)}>{g.label}</span>}
                      {c.isArchived && <span className="shrink-0 px-1.5 rounded-full text-[10px] bg-gray-100 text-gray-600">Đã nghỉ</span>}
                    </span>
                    <span className="block text-[11px] text-[#999] truncate">
                      {c.jobTitle || '—'}{c.lastInteractionAt ? ` · liên hệ ${relativeDayLabel(c.lastInteractionAt, today).toLowerCase()}` : ''}
                    </span>
                  </span>
                </button>
                {st && st.status !== 'unclassified' && (
                  <span className="shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-medium whitespace-nowrap" style={chipStyle(CARE_STATUS_COLOR[st.status])}>{dueLabel(st)}</span>
                )}
                {st?.score && <b className="shrink-0 text-[12px] w-7 text-right" style={{ color: scoreColor(st.score.total) }}>{st.score.total}</b>}
                {!c.isArchived && (
                  <button type="button" onClick={() => setLogFor(c.id)} title="Ghi tương tác" aria-label={`Ghi tương tác với ${c.fullName}`}
                    className="shrink-0 w-9 h-9 md:w-7 md:h-7 rounded-lg border border-[#E8E7E2] bg-white text-[#666] hover:text-[#1D4ED8] flex items-center justify-center">
                    <Plus size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(view.openFollowUps.length > 0 || view.recent.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 py-3 border-t border-[#F0EFEB]">
          <div>
            <p className="text-[10.5px] uppercase tracking-wide font-semibold text-[#999] mb-1">Việc đã hứa đang mở</p>
            {view.openFollowUps.length === 0 ? <p className="text-[12px] text-[#bbb]">Không có</p> : view.openFollowUps.map(i => (
              <div key={i.id} className="flex items-center gap-2 py-1">
                <span className="flex-1 min-w-0 text-[12px] text-[#333]">
                  {i.followUpAction}
                  <span className="text-[#999]"> — {i.contactPerson}{i.followUpDue ? `, hạn ${formatDateVN(i.followUpDue)}` : ''}</span>
                </span>
                <button type="button" disabled={busyId === i.id} onClick={() => completeFollowUp(i)}
                  className="shrink-0 inline-flex items-center gap-1 h-8 md:h-6 px-2 rounded-md border border-emerald-200 text-emerald-700 text-[11px] disabled:opacity-50">
                  <CheckCheck size={12} /> Xong
                </button>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-wide font-semibold text-[#999] mb-1">Nhật ký CSKH gần đây</p>
            {view.recent.length === 0 ? <p className="text-[12px] text-[#bbb]">Chưa có</p> : view.recent.map(i => (
              <p key={i.id} className="text-[12px] text-[#333] py-0.5 truncate">
                <span className="text-[#999]">{formatDateVN(i.occurredAt)} · {INTERACTION_LABEL[i.type]} · {i.contactPerson || '—'}</span>
                {i.content ? ` — ${i.content}` : ''}
              </p>
            ))}
          </div>
        </div>
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
            toast(input.followUpAction.trim() ? 'Đã ghi nhật ký + tạo việc trong Workspace' : 'Đã ghi nhật ký tương tác');
            return null;
          }}
        />
      )}
    </section>
  );
}
