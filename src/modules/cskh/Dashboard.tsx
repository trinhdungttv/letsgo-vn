// ============================================================================
// Dashboard CSKH (port PRM PrmDashboardPage) — phong cách Apple, gọn 3 khối:
//   • Đầu trang: ngày · "Tổng quan" · câu tóm tắt việc hôm nay · 2 nút pill
//   • Dải 4 chỉ số trong 1 thẻ: sức khỏe · đang chăm sóc · tương tác 30 ngày · sự kiện 30 ngày
//   • Trái: Hôm nay cần liên hệ (tối đa 7)
//   • Phải: Sắp tới (Việc đã hứa / Sự kiện / Gần đây) · Sức khỏe quan hệ (Theo nhóm / Cần đầu tư)
// Bộ lọc Chi nhánh / Người phụ trách / Người quản lý KH thay cho "Cá nhân · Công việc" của PRM.
// ============================================================================
import { useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Check, ChevronRight, PenLine, TrendingDown, TrendingUp, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useBranchLookup } from '../../hooks/useBranchLookup';
import { branchOf } from '../../lib/branchRef';
import { buildContactStats, CARE_STATUS_LABEL } from '../../lib/cskh/cadence';
import { formatDateVN, longDateVN, relativeDayLabel, todayVN } from '../../lib/cskh/dates';
import { requestQuickLog, emitCskhDataChanged } from '../../lib/cskh/events';
import { groupBaseTier } from '../../lib/cskh/mappers';
import { diffDays, nextOccurrenceIso } from '../../lib/cskh/lunar';
import { SCORE_GRADE_LABEL, scoreGrade, weakestPart } from '../../lib/cskh/score';
import { isCooperatingClient } from '../../lib/cskh/seedTiers';
import { buildTodayQueue, TODAY_QUEUE_LIMIT, type TodayQueueItem } from '../../lib/cskh/todayQueue';
import type { CskhContact, CskhInteraction, RelationshipScore } from '../../lib/cskh/types';
import { CLASSIFIED_TIERS, INTERACTION_LABEL, TIER_LABEL } from '../../lib/cskh/types';
import { setFollowUpDone } from './data/api';
import { useCskh } from './context';
import { markContactLaunched } from './launch';
import { useCareScope } from './useCareScope';
import {
  CARE_STATUS_COLOR, daysUntilLabel, GREEN, GROUP_COLOR, groupDisplayOf, INTERACTION_ICON, ORANGE, RED,
  scoreColor, TIER_COLOR,
} from './ui';
import { MigrationBanner, Spinner } from './components/Card';
import { CareScopeBar } from './components/CareScopeBar';
import { ContactAvatar } from './components/ContactAvatar';
import { ContactBriefSheet } from './components/ContactBriefSheet';
import { TodayQueue } from './components/TodayQueue';

/** Số tuần trên cột tuần của ô "Tương tác 30 ngày". */
const SPARK_WEEKS = 8;
/** Hợp đồng còn ≤ bấy nhiêu ngày thì nhắc "sắp hết" (cùng mốc với Workspace). */
const RENEWAL_WINDOW_DAYS = 30;
/** Mỗi danh sách bên phải hiện tối đa bấy nhiêu dòng. */
const LIST_LIMIT = 5;
const HEALTH_PANEL_ID = 'cskh-health-panel';

// ── Kiểu Apple: thẻ trắng bo 18px, bóng rất nhẹ, đường kẻ mảnh, chữ xám hệ thống ──
const panelCls = 'bg-white rounded-[18px] ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.10)]';
const linkCls = 'inline-flex items-center gap-0.5 text-[13px] font-medium text-[#1D4ED8] hover:opacity-70 transition min-h-[36px] md:min-h-0 shrink-0';
const bigNum = 'text-[28px] md:text-[30px] leading-none font-semibold tracking-[-0.02em] text-[#1D1D1F] tabular-nums';
const caption = 'text-[12px] text-[#86868B] leading-snug';

type AgendaKey = 'promises' | 'events' | 'recent';
type HealthKey = 'groups' | 'invest';

export default function CskhDashboard() {
  const { data, loading, clients, toast, openProfile, openLog, openPicker, goTab, openWorkspace } = useCskh();
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const [brief, setBrief] = useState<{ contactId: string; item: TodayQueueItem | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** null = tự chọn đoạn có việc (việc đã hứa → sự kiện → gần đây). */
  const [agendaTab, setAgendaTab] = useState<AgendaKey | null>(null);
  const [healthTab, setHealthTab] = useState<HealthKey>('groups');
  // Giờ Việt Nam, tính lại mỗi lần vẽ (qua nửa đêm vẫn đúng ngày)
  const today = todayVN();

  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const interactions = useMemo(() => (data?.interactions ?? []).filter(i => !i.isArchived), [data]);
  const occasions = useMemo(() => (data?.occasions ?? []).filter(o => !o.isArchived), [data]);
  const gifts = useMemo(() => (data?.gifts ?? []).filter(g => !g.isArchived), [data]);
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const cadence = data?.settings.cadence;
  const contactById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);
  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const userName = useMemo(() => new Map((data?.users ?? []).map(u => [u.id, u.full_name])), [data]);
  const scope = useCareScope(contacts, clients);
  const { scoped, filters } = scope;

  // ── Số liệu ───────────────────────────────────────────────────────────────
  const stats = useMemo(
    () => (cadence ? buildContactStats(scoped, interactions, gifts, occasions, cadence, today) : new Map()),
    [scoped, interactions, gifts, occasions, cadence, today],
  );

  const fullQueue = useMemo(
    () => (cadence
      ? buildTodayQueue({ contacts: scoped, interactions, occasions, gifts, cadence, today }, Number.MAX_SAFE_INTEGER).items
      : []),
    [scoped, interactions, occasions, gifts, cadence, today],
  );
  const queueItems = fullQueue.slice(0, TODAY_QUEUE_LIMIT);
  const hiddenCount = Math.max(0, fullQueue.length - TODAY_QUEUE_LIMIT);

  const view = useMemo(() => {
    const scopedIds = new Set(scoped.map(c => c.id));
    const classified = scoped.filter(c => c.tier !== 'unclassified' && !c.isArchived);
    const careIds = new Set(classified.map(c => c.id));

    const status = { overdue: 0, due_soon: 0, ok: 0 };
    const bands = { good: 0, attention: 0, weak: 0 };
    let scoreSum = 0;
    const worst: Array<{ contact: CskhContact; score: RelationshipScore }> = [];
    for (const c of classified) {
      const st = stats.get(c.id);
      if (!st) continue;
      if (st.status !== 'unclassified') status[st.status as keyof typeof status] += 1;
      if (st.score) {
        scoreSum += st.score.total;
        bands[scoreGrade(st.score.total)] += 1;
        worst.push({ contact: c, score: st.score });
      }
    }
    worst.sort((a, b) => a.score.total - b.score.total);

    const groupRows = [
      ...CLASSIFIED_TIERS.map(t => ({ key: t as string, label: TIER_LABEL[t], color: TIER_COLOR[t], cadence: cadence?.[t] ?? 0 })),
      ...groups.map(g => ({ key: `g:${g.id}`, label: g.name, color: GROUP_COLOR[g.color], cadence: cadence?.[groupBaseTier(g)] ?? 0 })),
    ].map(row => {
      const list = classified.filter(c => groupDisplayOf(c, groupById).key === row.key);
      const scores = list.map(c => stats.get(c.id)?.score?.total).filter((s): s is number => typeof s === 'number');
      return {
        ...row,
        count: list.length,
        avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        overdue: list.filter(c => stats.get(c.id)?.status === 'overdue').length,
      };
    }).filter(r => r.count > 0);

    // Sự kiện chỉ của người ĐANG CHĂM SÓC
    const upcoming = occasions
      .filter(o => careIds.has(o.contactId))
      .map(o => {
        const nextIso = nextOccurrenceIso(o.day, o.month, o.isLunar, today);
        return { occasion: o, nextIso, daysUntil: diffDays(today, nextIso) };
      })
      .filter(x => x.daysUntil >= 0 && x.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    const mine = interactions.filter(i => i.contactId !== null && scopedIds.has(i.contactId));
    const followUps = mine
      .filter(i => i.followUpAction.trim() !== '' && !i.followUpDone)
      .sort((a, b) => {
        if (a.followUpDue && b.followUpDue) return a.followUpDue.localeCompare(b.followUpDue);
        if (a.followUpDue) return -1;
        if (b.followUpDue) return 1;
        return b.occurredAt.localeCompare(a.occurredAt);
      });

    let last30 = 0;
    let prev30 = 0;
    const weeks = new Array<number>(SPARK_WEEKS).fill(0);
    const contactedToday = new Set<string>();
    for (const i of mine) {
      const ago = diffDays(i.occurredAt, today);
      if (ago < 0) continue;
      if (ago === 0) contactedToday.add(i.contactId as string);
      if (ago < 30) last30 += 1;
      else if (ago < 60) prev30 += 1;
      const w = Math.floor(ago / 7);
      if (w < SPARK_WEEKS) weeks[SPARK_WEEKS - 1 - w] += 1;
    }

    return {
      classified,
      status,
      bands,
      scored: worst.length,
      avgScore: worst.length ? Math.round(scoreSum / worst.length) : 0,
      worst: worst.slice(0, LIST_LIMIT),
      groupRows,
      upcoming,
      followUps,
      dueFollowUps: followUps.filter(i => i.followUpDue !== null && i.followUpDue <= today).length,
      recent: mine.slice(0, LIST_LIMIT),
      last30,
      prev30,
      weeks,
      contactedToday: contactedToday.size,
    };
  }, [scoped, stats, interactions, occasions, groups, groupById, cadence, today]);

  // "Sắp hết HĐ → Tái ký" đã có luồng riêng ở Workspace — chỉ nhắc 1 dòng, không tạo việc trùng
  const expiringContracts = useMemo(() => clients.filter(c => {
    if (!isCooperatingClient(c) || !c.contract_end) return false;
    if (filters.branch !== 'all' && branchOf(c, branches)?.id !== filters.branch) return false;
    return diffDays(today, c.contract_end.slice(0, 10)) <= RENEWAL_WINDOW_DAYS;
  }).length, [clients, filters.branch, branches, today]);

  // ── Thao tác ──────────────────────────────────────────────────────────────
  const completeFollowUp = async (it: CskhInteraction) => {
    setBusyId(it.id);
    try {
      await setFollowUpDone(it, true, user);
      emitCskhDataChanged();
      toast(it.followUpTaskId ? 'Đã xong việc đã hứa — việc trong Workspace cũng đã đóng' : 'Đã xong việc đã hứa');
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const completeById = (id: string | undefined) => {
    const it = id ? interactions.find(i => i.id === id) : undefined;
    if (it) void completeFollowUp(it);
  };

  const nameOf = (i: CskhInteraction) => (i.contactId ? contactById.get(i.contactId)?.fullName ?? i.contactPerson : i.contactPerson);

  const careCountAll = contacts.filter(c => c.tier !== 'unclassified' && !c.isArchived).length;
  const queueTotal = fullQueue.length;
  const eventsThisWeek = view.upcoming.filter(u => u.daysUntil <= 7).length;
  const summary = [
    queueTotal > 0 ? `${queueTotal} người cần liên hệ` : 'không ai cần liên hệ',
    view.dueFollowUps > 0 && `${view.dueFollowUps} việc đã hứa đến hạn`,
    eventsThisWeek > 0 && `${eventsThisWeek} sự kiện trong tuần`,
  ].filter(Boolean).join(' · ');
  const nextEvent = view.upcoming[0];
  const delta = view.last30 - view.prev30;
  const careTotal = view.status.overdue + view.status.due_soon + view.status.ok;
  const briefContact = brief ? contactById.get(brief.contactId) ?? null : null;
  const agenda: AgendaKey = agendaTab
    ?? (view.followUps.length > 0 ? 'promises' : view.upcoming.length > 0 ? 'events' : 'recent');
  const healthColor = view.scored ? scoreColor(view.avgScore) : '#C7C7CC';

  if (!data) {
    return loading ? <Spinner /> : <p className="py-16 text-center text-[13px] text-[#86868B]">Chưa tải được dữ liệu CSKH.</p>;
  }

  return (
    <div className="space-y-4 md:space-y-5">
      {/* ── Đầu trang ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#86868B]">{longDateVN(today)}</p>
          <h1 className="text-[26px] md:text-[30px] font-bold tracking-[-0.025em] leading-[1.1] text-[#1D1D1F] mt-1">Tổng quan</h1>
          <p className="text-[14px] md:text-[15px] text-[#6E6E73] mt-1">
            {careCountAll === 0
              ? 'Chăm sóc người đại diện của các công ty đang ký hợp đồng cung ứng lao động.'
              : `Hôm nay: ${summary}.`}
          </p>
        </div>
        {contacts.length > 0 && (
          <div className="flex gap-2 w-full md:w-auto">
            <button type="button" onClick={openPicker} aria-label="Chọn người chăm sóc"
              className="flex-1 md:flex-none whitespace-nowrap inline-flex items-center justify-center gap-1.5 h-10 md:h-9 px-4 rounded-full bg-[rgba(29,78,216,0.09)] text-[13px] font-semibold text-[#1D4ED8] hover:bg-[rgba(29,78,216,0.15)] transition">
              <UserPlus size={15} strokeWidth={2.2} /> <span className="md:hidden">Chọn người</span><span className="hidden md:inline">Chọn người chăm sóc</span>
            </button>
            <button type="button" onClick={() => openLog()}
              className="flex-1 md:flex-none whitespace-nowrap inline-flex items-center justify-center gap-1.5 h-10 md:h-9 px-4 rounded-full bg-[#1D4ED8] text-[13px] font-semibold text-white hover:bg-[#1E40AF] transition">
              <PenLine size={15} strokeWidth={2.2} /> Ghi tương tác
            </button>
          </div>
        )}
      </header>

      {!data.migrationReady && <MigrationBanner />}

      <CareScopeBar scope={scope} users={data.users} total={contacts.length} variant="pill" />

      {/* ── Trạng thái trống có hướng dẫn ── */}
      {contacts.length === 0 && !loading && (
        <Welcome icon={<Users size={22} />} title="Chưa có người liên hệ nào"
          text="Thêm người đại diện của các công ty khách hàng ở tab Ma trận Khách hàng."
          action="Mở Ma trận Khách hàng" onAction={() => goTab('matrix')} />
      )}
      {contacts.length > 0 && careCountAll === 0 && (
        <Welcome icon={<UserPlus size={22} />} title="Chưa chọn ai để chăm sóc"
          text={`Danh bạ có ${contacts.length} người. Chỉ cần chọn những người quan trọng — hệ thống sẽ nhắc liên hệ, sinh nhật và việc đã hứa cho họ. Hạng được gợi ý sẵn theo chức vụ.`}
          action="Chọn người chăm sóc" onAction={openPicker} />
      )}

      {careCountAll > 0 && (
        <>
          {/* ── Dải 4 chỉ số: 1 thẻ, chia bằng đường kẻ mảnh ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#E5E5EA] rounded-[18px] overflow-hidden ring-1 ring-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.10)]">
            <Metric label="Sức khỏe quan hệ" hint="Xem người cần đầu tư thêm" onClick={() => {
              setHealthTab('invest');
              document.getElementById(HEALTH_PANEL_ID)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}>
              <span className="flex items-end justify-between gap-2">
                <span className="flex items-baseline gap-1">
                  <b className={bigNum}>{view.scored ? view.avgScore : '–'}</b>
                  <small className="text-[13px] text-[#86868B]">/100</small>
                </span>
                <Ring value={view.scored ? view.avgScore : 0} color={healthColor}
                  label={view.scored ? `Điểm trung bình ${view.avgScore} trên 100` : 'Chưa có điểm'} />
              </span>
              <span className="text-[12px] font-medium truncate" style={{ color: view.scored ? healthColor : '#86868B' }}>
                {view.scored ? `${SCORE_GRADE_LABEL[scoreGrade(view.avgScore)]} · ${view.scored} người` : 'Chưa có điểm'}
              </span>
            </Metric>

            <Metric label="Đang chăm sóc" onClick={() => goTab('matrix')}>
              <span className="flex items-baseline gap-1">
                <b className={bigNum}>{view.classified.length}</b>
                <small className="text-[13px] text-[#86868B] tabular-nums">/ {scoped.length}</small>
              </span>
              {careTotal > 0 ? (
                <>
                  <span className="flex h-1 gap-[2px] rounded-full overflow-hidden" role="img" aria-label="Phân bố trạng thái chăm sóc">
                    {(['overdue', 'due_soon', 'ok'] as const).map(s => view.status[s] > 0 && (
                      <i key={s} style={{ flex: view.status[s], background: CARE_STATUS_COLOR[s] }} title={`${CARE_STATUS_LABEL[s]}: ${view.status[s]}`} />
                    ))}
                  </span>
                  <span className={`${caption} truncate`}>
                    {view.status.overdue > 0
                      ? <span className="font-medium" style={{ color: RED }}>{view.status.overdue} quá hạn</span>
                      : 'Không ai quá hạn'}
                    {view.status.due_soon > 0 && ` · ${view.status.due_soon} sắp đến hạn`}
                  </span>
                </>
              ) : <span className={caption}>Chưa có ai trong phạm vi lọc</span>}
            </Metric>

            <Metric label="Tương tác 30 ngày" onClick={() => goTab('log')}>
              <span className="flex items-end justify-between gap-2">
                <b className={bigNum}>{view.last30}</b>
                <Spark weeks={view.weeks} />
              </span>
              <span className={`${caption} truncate`}>
                {view.last30 === 0 && view.prev30 === 0 ? 'Chưa ghi nhận tương tác'
                  : delta === 0 ? 'Bằng 30 ngày trước'
                    : (
                      <>
                        <span className="font-medium" style={{ color: delta > 0 ? GREEN : RED }}>
                          {delta > 0 ? <TrendingUp size={12} className="inline -mt-0.5" /> : <TrendingDown size={12} className="inline -mt-0.5" />}{' '}
                          {delta > 0 ? '+' : '−'}{Math.abs(delta)}
                        </span>{' '}so với 30 ngày trước
                      </>
                    )}
              </span>
            </Metric>

            <Metric label="Sự kiện 30 ngày" onClick={() => goTab('events')}>
              <b className={bigNum}>{view.upcoming.length}</b>
              <span className={`${caption} truncate`}>
                {nextEvent
                  ? `${nextEvent.occasion.title} · ${contactById.get(nextEvent.occasion.contactId)?.fullName ?? ''} · ${daysUntilLabel(nextEvent.daysUntil).toLowerCase()}`
                  : 'Không có sự kiện sắp tới'}
              </span>
            </Metric>
          </div>

          {/* ── Lưới 2 cột (điện thoại 1 cột) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 md:gap-5 items-start">
            <Panel title="Hôm nay cần liên hệ" count={queueTotal}
              meta="Ưu tiên việc đã hứa quá hạn, rồi sự kiện trong 7 ngày, rồi người quá nhịp chăm sóc."
              action={view.contactedToday > 0 && (
                <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-[rgba(52,199,89,0.14)] text-[12px] font-semibold text-[#248A3D] shrink-0">
                  <Check size={13} strokeWidth={2.6} /> {view.contactedToday} đã liên hệ
                </span>
              )}
              footer={(hiddenCount > 0 || expiringContracts > 0) && (
                <div className="flex flex-col">
                  {hiddenCount > 0 && (
                    <button type="button" onClick={() => goTab('cadence')}
                      className="flex items-center gap-2 py-1.5 min-h-[40px] md:min-h-[32px] text-left text-[13px] hover:opacity-70 transition">
                      <span className="flex-1 font-medium text-[#1D4ED8]">Còn {hiddenCount} người khác đang chờ</span>
                      <span className="inline-flex items-center text-[#86868B]">Nhịp độ <ChevronRight size={14} /></span>
                    </button>
                  )}
                  {expiringContracts > 0 && (
                    <button type="button" onClick={openWorkspace}
                      className="flex items-center gap-2 py-1.5 min-h-[40px] md:min-h-[32px] text-left text-[13px] text-[#C93400] hover:opacity-70 transition">
                      <CalendarClock size={15} className="shrink-0" />
                      <span className="flex-1">{expiringContracts} hợp đồng hết hạn trong {RENEWAL_WINDOW_DAYS} ngày — tái ký ở Workspace</span>
                      <ChevronRight size={14} className="text-[#86868B]" />
                    </button>
                  )}
                </div>
              )}>
              <TodayQueue
                items={queueItems}
                contactById={contactById}
                groupById={groupById}
                loading={loading}
                busyId={busyId}
                onLaunch={(c, channel) => markContactLaunched(c.id, channel)}
                onMarkContacted={c => requestQuickLog({ contactId: c.id, channel: null })}
                onDoneFollowUp={item => completeById(item.interactionId)}
                onOpenBrief={(c, item) => setBrief({ contactId: c.id, item })}
              />
            </Panel>

            <div className="space-y-4 md:space-y-5 min-w-0">
              {/* ── Sắp tới ── */}
              <Panel title="Sắp tới"
                action={(
                  <button type="button" onClick={() => goTab(agenda === 'events' ? 'events' : 'log')} className={linkCls}>
                    {agenda === 'events' ? 'Sự kiện & Quà' : 'Nhật ký'} <ChevronRight size={14} />
                  </button>
                )}>
                <Segmented label="Sắp tới" value={agenda} onChange={setAgendaTab} options={[
                  { key: 'promises', label: 'Việc đã hứa', badge: view.followUps.length },
                  { key: 'events', label: 'Sự kiện', badge: view.upcoming.length },
                  { key: 'recent', label: 'Gần đây' },
                ]} />
                <div className="mt-1.5">
                  {agenda === 'promises' && (view.followUps.length === 0 ? <Quiet>Không có việc nào đang chờ.</Quiet>
                    : view.followUps.slice(0, LIST_LIMIT).map((i, idx) => {
                      const late = i.followUpDue !== null ? diffDays(i.followUpDue, today) : null;
                      return (
                        <Row key={i.id} first={idx === 0} inset={36}>
                          <button type="button" disabled={busyId === i.id} onClick={() => completeFollowUp(i)}
                            aria-label={`Đánh dấu xong: ${i.followUpAction}`} title="Đánh dấu xong"
                            className="group w-9 h-9 -ml-1.5 -my-1 shrink-0 flex items-center justify-center disabled:opacity-50">
                            <span className="w-[22px] h-[22px] rounded-full border-[1.5px] border-[#C7C7CC] flex items-center justify-center text-transparent group-hover:border-[#34C759] group-hover:text-[#34C759] transition">
                              <Check size={12} strokeWidth={3} />
                            </span>
                          </button>
                          <button type="button" onClick={() => i.contactId && setBrief({ contactId: i.contactId, item: null })} className="min-w-0 flex-1 text-left">
                            <span className="block text-[14px] text-[#1D1D1F] leading-snug line-clamp-2">{i.followUpAction}</span>
                            <span className={`block ${caption} truncate`}>
                              {nameOf(i)}
                              {i.followUpDue && late !== null && (
                                late > 0 ? <span className="font-medium" style={{ color: RED }}> · trễ {late} ngày</span>
                                  : late === 0 ? <span className="font-medium" style={{ color: ORANGE }}> · hạn hôm nay</span>
                                    : ` · hạn ${formatDateVN(i.followUpDue)}`
                              )}
                            </span>
                          </button>
                        </Row>
                      );
                    }))}

                  {agenda === 'events' && (view.upcoming.length === 0 ? <Quiet>Không có sự kiện nào trong 30 ngày tới.</Quiet>
                    : view.upcoming.slice(0, LIST_LIMIT).map(({ occasion: o, nextIso, daysUntil }, idx) => (
                      <Row key={o.id} first={idx === 0} inset={52}>
                        <span className="w-10 shrink-0 rounded-[10px] bg-white ring-1 ring-black/[0.08] text-center leading-none overflow-hidden" aria-hidden>
                          <small className="block text-[9px] font-semibold uppercase tracking-wide text-[#FF3B30] pt-1">Th{Number(nextIso.slice(5, 7))}</small>
                          <b className="block text-[16px] font-semibold text-[#1D1D1F] pt-0.5 pb-1 tabular-nums">{Number(nextIso.slice(8, 10))}</b>
                        </span>
                        <button type="button" onClick={() => setBrief({ contactId: o.contactId, item: null })} className="min-w-0 flex-1 text-left">
                          <span className="block text-[14px] font-medium text-[#1D1D1F] truncate">{o.title}</span>
                          <span className={`block ${caption} truncate`}>
                            {o.relatedPerson ? `${o.relatedPerson} của ` : ''}{contactById.get(o.contactId)?.fullName ?? ''}{o.isLunar ? ' · âm lịch' : ''}
                          </span>
                        </button>
                        <span className={`shrink-0 h-6 px-2.5 inline-flex items-center rounded-full text-[12px] font-medium ${daysUntil <= 7 ? 'bg-[rgba(255,59,48,0.12)] text-[#D70015]' : 'bg-[#F2F2F7] text-[#6E6E73]'}`}>
                          {daysUntilLabel(daysUntil)}
                        </span>
                      </Row>
                    )))}

                  {agenda === 'recent' && (view.recent.length === 0 ? <Quiet>Chưa ghi nhận tương tác nào.</Quiet>
                    : view.recent.map((i, idx) => {
                      const Icon = INTERACTION_ICON[i.type];
                      return (
                        <Row key={i.id} first={idx === 0} inset={44}>
                          <span className="w-8 h-8 shrink-0 rounded-full bg-[#F2F2F7] text-[#1D4ED8] flex items-center justify-center"><Icon size={15} /></span>
                          <button type="button" onClick={() => i.contactId && setBrief({ contactId: i.contactId, item: null })} className="min-w-0 flex-1 text-left">
                            <span className="block text-[14px] font-medium text-[#1D1D1F] truncate">{nameOf(i)}</span>
                            <span className={`block ${caption} truncate`}>
                              {INTERACTION_LABEL[i.type]}{i.createdByName ? ` · ${i.createdByName}` : ''}{i.content.trim() ? ` · ${i.content.trim()}` : ''}
                            </span>
                          </button>
                          <span className="text-[12px] text-[#86868B] shrink-0">{relativeDayLabel(i.occurredAt, today)}</span>
                        </Row>
                      );
                    }))}
                </div>
              </Panel>

              {/* ── Sức khỏe quan hệ ── */}
              <Panel id={HEALTH_PANEL_ID} title="Sức khỏe quan hệ"
                meta={view.scored > 0 && (
                  <span className="inline-flex flex-wrap gap-x-2.5">
                    <span><Dot color={GREEN} />Tốt {view.bands.good}</span>
                    <span><Dot color={ORANGE} />Cần chú ý {view.bands.attention}</span>
                    <span><Dot color={RED} />Yếu {view.bands.weak}</span>
                  </span>
                )}
                action={<button type="button" onClick={() => goTab('matrix')} className={linkCls}>Ma trận <ChevronRight size={14} /></button>}>
                <Segmented label="Sức khỏe quan hệ" value={healthTab} onChange={setHealthTab} options={[
                  { key: 'groups', label: 'Theo nhóm' },
                  { key: 'invest', label: 'Cần đầu tư' },
                ]} />
                <div className="mt-1.5">
                  {healthTab === 'groups' && (view.groupRows.length === 0 ? <Quiet>Chưa có ai trong danh sách chăm sóc.</Quiet>
                    : view.groupRows.map((r, idx) => (
                      <Row key={r.key} first={idx === 0} inset={22}>
                        <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-medium text-[#1D1D1F] truncate">{r.label}</span>
                          <span className={`block ${caption} truncate`}>
                            {r.count} người · nhịp {r.cadence} ngày
                            {r.overdue > 0 && <span className="font-medium" style={{ color: RED }}> · {r.overdue} quá hạn</span>}
                          </span>
                        </span>
                        <span className="w-[96px] shrink-0 flex items-center gap-2">
                          {r.avg === null ? <span className="ml-auto text-[13px] text-[#C7C7CC]">–</span> : (
                            <>
                              <span className="flex-1 h-1.5 rounded-full bg-[#EDEDF0] overflow-hidden">
                                <span className="block h-full rounded-full" style={{ width: `${r.avg}%`, background: scoreColor(r.avg) }} />
                              </span>
                              <b className="w-6 text-right text-[13px] font-semibold tabular-nums" style={{ color: scoreColor(r.avg) }}>{r.avg}</b>
                            </>
                          )}
                        </span>
                      </Row>
                    )))}

                  {healthTab === 'invest' && (view.worst.length === 0 ? <Quiet>Chưa có người liên hệ nào được chấm điểm.</Quiet>
                    : view.worst.map(({ contact: c, score }, idx) => {
                      const weak = weakestPart(score);
                      const color = scoreColor(score.total);
                      return (
                        <Row key={c.id} first={idx === 0} inset={44} onClick={() => openProfile(c.id)} title="Mở hồ sơ để bổ sung">
                          <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={32} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] font-medium text-[#1D1D1F] truncate">{c.fullName}</span>
                            <span className={`block ${caption} truncate`}>
                              Yếu nhất: {weak.label} {score.breakdown[weak.key]}/{weak.max} — {weak.hint}
                            </span>
                          </span>
                          <span className="text-right shrink-0">
                            <b className="block text-[17px] font-semibold leading-none tabular-nums" style={{ color }}>{score.total}</b>
                            <small className="text-[11px]" style={{ color }}>{SCORE_GRADE_LABEL[scoreGrade(score.total)]}</small>
                          </span>
                        </Row>
                      );
                    }))}
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}

      {brief && briefContact && (
        <ContactBriefSheet
          contact={briefContact}
          item={brief.item}
          recent={interactions.filter(i => i.contactId === briefContact.id)}
          groupLabel={groupDisplayOf(briefContact, groupById).label}
          ownerName={briefContact.ownerId ? userName.get(briefContact.ownerId) ?? null : null}
          busyId={busyId}
          onLaunch={(c, channel) => markContactLaunched(c.id, channel)}
          onMarkContacted={c => requestQuickLog({ contactId: c.id, channel: null })}
          onDoneFollowUp={it => void completeFollowUp(it)}
          onOpenProfile={c => { setBrief(null); openProfile(c.id); }}
          onClose={() => setBrief(null)}
        />
      )}
    </div>
  );
}

// ── Khối giao diện nhỏ (chỉ dùng trong Dashboard) ───────────────────────────

function Panel({ id, title, count, meta, action, footer, children }: {
  id?: string;
  title: string;
  count?: number;
  meta?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`${panelCls} scroll-mt-4`} aria-label={title}>
      <header className="flex items-start justify-between gap-3 px-4 md:px-5 pt-4 pb-2.5">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#1D1D1F]">
            {title}
            {count !== undefined && count > 0 && <span className="ml-1.5 font-normal text-[#86868B] tabular-nums">{count}</span>}
          </h2>
          {meta && <p className={`${caption} mt-0.5`}>{meta}</p>}
        </div>
        {action}
      </header>
      <div className="px-4 md:px-5 pb-2">{children}</div>
      {footer && <div className="mx-4 md:mx-5 py-1.5 border-t border-[#E5E5EA]">{footer}</div>}
    </section>
  );
}

/** Ô chỉ số trong dải chỉ số; bấm được thì có mũi tên. */
function Metric({ label, onClick, hint, children }: {
  label: string;
  onClick?: () => void;
  hint?: string;
  children: ReactNode;
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-1 text-[12px] font-medium text-[#86868B]">
        <span className="truncate">{label}</span>
        {onClick && <ChevronRight size={14} className="text-[#C7C7CC] shrink-0" />}
      </span>
      {children}
    </>
  );
  const cls = 'bg-white text-left p-4 md:p-5 flex flex-col gap-2 min-w-0';
  return onClick
    ? <button type="button" onClick={onClick} title={hint} className={`${cls} hover:bg-[#FAFAFC] transition`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/** Điều khiển phân đoạn kiểu iOS. */
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ key: T; label: string; badge?: number }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex p-[2px] rounded-[9px] bg-[rgba(118,118,128,0.12)]">
      {options.map(o => {
        const active = o.key === value;
        return (
          <button key={o.key} type="button" role="tab" aria-selected={active} onClick={() => onChange(o.key)}
            className={`flex-1 min-w-0 h-9 md:h-7 px-2 rounded-[7px] text-[13px] whitespace-nowrap truncate transition ${active
              ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_3px_8px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]'
              : 'text-[#3C3C43]/80 font-medium hover:text-[#1D1D1F]'}`}>
            {o.label}
            {o.badge !== undefined && o.badge > 0 && <span className="ml-1 font-normal text-[#86868B] tabular-nums">{o.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 1 dòng danh sách, đường kẻ mảnh thụt vào từ chỗ bắt đầu chữ (kiểu bảng iOS). */
function Row({ first, inset, onClick, title, children }: {
  first: boolean;
  inset: number;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  const line = !first && <span aria-hidden className="absolute top-0 right-0 h-px bg-[#E5E5EA]" style={{ left: inset }} />;
  const cls = 'relative w-full flex items-center gap-3 py-2.5 text-left';
  return onClick
    ? <button type="button" onClick={onClick} title={title} className={`${cls} hover:bg-[#FAFAFC] rounded-[10px] transition`}>{line}{children}</button>
    : <div className={cls}>{line}{children}</div>;
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="py-8 text-center text-[13px] text-[#86868B]">{children}</p>
);

const Dot = ({ color }: { color: string }) => (
  <i className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle -mt-px" style={{ background: color }} />
);

/** Vòng điểm kiểu Apple Fitness. */
function Ring({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 14;
  const len = 2 * Math.PI * r;
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" className="-rotate-90 shrink-0" role="img" aria-label={label}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="#EDEDF0" strokeWidth="4.5" />
      {value > 0 && (
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round"
          strokeDasharray={`${(Math.min(100, value) / 100) * len} ${len}`} />
      )}
    </svg>
  );
}

/** Cột tuần nhỏ: tuần này đậm, các tuần trước nhạt. */
function Spark({ weeks }: { weeks: readonly number[] }) {
  const max = Math.max(1, ...weeks);
  const last = weeks.length - 1;
  return (
    <span className="flex items-end gap-[3px] h-7 w-[68px] shrink-0" role="img"
      aria-label={`Số tương tác ${weeks.length} tuần gần nhất: ${weeks.join(', ')}`}>
      {weeks.map((n, i) => (
        <i key={i} className="flex-1 rounded-[2px]"
          style={{ height: `${Math.max(12, (n / max) * 100)}%`, background: i === last ? '#1D4ED8' : 'rgba(29,78,216,0.18)' }}
          title={`${i === last ? 'Tuần này' : `${last - i} tuần trước`}: ${n}`} />
      ))}
    </span>
  );
}

function Welcome({ icon, title, text, action, onAction }: {
  icon: ReactNode;
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <section className={`${panelCls} px-6 py-10 text-center`}>
      <span className="mx-auto mb-3 w-12 h-12 rounded-full bg-[rgba(29,78,216,0.09)] text-[#1D4ED8] flex items-center justify-center">{icon}</span>
      <h2 className="text-[17px] font-semibold text-[#1D1D1F]">{title}</h2>
      <p className="text-[14px] text-[#6E6E73] mt-1 max-w-[480px] mx-auto">{text}</p>
      <button type="button" onClick={onAction}
        className="mt-4 h-10 md:h-9 px-5 rounded-full bg-[#1D4ED8] text-white text-[14px] font-semibold hover:bg-[#1E40AF] transition">
        {action}
      </button>
    </section>
  );
}
