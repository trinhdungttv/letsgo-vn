// Tab Tổng quan: chỉ số dự án, bảng Kế hoạch vs Thực tế (nhà máy × tháng), việc cần làm hôm nay.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CalendarClock, GraduationCap, LifeBuoy, Phone, Rocket, ShieldCheck, UserPlus } from 'lucide-react';
import { errText, loadToday, loadTodayExtra, moveApplications } from '../../lib/recruit/api';
import { formatPhone } from '../../lib/recruit/normalize';
import { buildPlanMatrix, cellTone, monthLabel, monthRange, pctText } from '../../lib/recruit/plan';
import type { PlanMatrix } from '../../lib/recruit/plan';
import type { RecruitApplication, RecruitApplicationFull, TodayExtra, TodayList } from '../../lib/recruit/types';
import { nameOf, useRecruit } from './context';
import CandidateSheet from './CandidateSheet';
import QuickAddSheet from './QuickAddSheet';
import { CAPTION, ErrorBanner, PILL_PRIMARY, PageTitle, Panel, PillSelect, Quiet, Row, Spinner, currentMonth, fmtDate, fmtDateTime, fmtNum, todayIso } from './ui';

export default function OverviewTab() {
  const { boot, project, sites, positions, clients, onTab, canEdit } = useRecruit();
  const [posScope, setPosScope] = useState<string>('all');

  const months = useMemo(() => {
    const range = monthRange(project?.period_from, project?.period_to);
    if (range.length) return range;
    const fromTargets = [...new Set(boot.targets.filter(t => t.project_id === project?.id).map(t => t.month))].sort();
    return fromTargets.length ? monthRange(fromTargets[0], fromTargets[fromTargets.length - 1]) : [];
  }, [project, boot.targets]);

  const matrix = useMemo(() => project ? buildPlanMatrix({
    months, sites, positions,
    targets: boot.targets.filter(t => t.project_id === project.id),
    hires: boot.hires.filter(h => h.project_id === project.id),
    scheduled: boot.scheduled.filter(s => s.project_id === project.id),
    positionId: posScope === 'all' ? undefined : posScope === 'none' ? null : posScope,
  }) : null, [project, months, sites, positions, boot, posScope]);

  if (!project || !matrix) {
    return (
      <div className="space-y-4">
        <PageTitle eyebrow="Tuyển dụng" title="Chưa có dự án tuyển dụng" subtitle="Tạo dự án (VD Co-Herent), thêm nhà máy và dán bảng chỉ tiêu khách gửi." />
        {canEdit && <button type="button" onClick={() => onTab('plan')} className={PILL_PRIMARY}>Tạo dự án đầu tiên</button>}
      </div>
    );
  }

  const inPipeline = boot.pipeline.filter(p => p.project_id === project.id).reduce((s, p) => s + p.n, 0);
  const hiresAll = boot.hires.filter(h => h.project_id === project.id);
  const started = hiresAll.reduce((s, h) => s + h.started, 0);
  const left = hiresAll.reduce((s, h) => s + h.left_count, 0);
  const cm = currentMonth();
  const remaining = Math.max(0, matrix.grand.target - matrix.grand.started);

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle eyebrow="Tổng quan tuyển dụng" title={project.name}
        subtitle={[nameOf(clients, project.client_id), project.contact_name && `đầu mối ${project.contact_name}`].filter(Boolean).join(' · ') || undefined} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Chỉ tiêu" value={fmtNum(matrix.grand.target)} sub={matrix.surveyQty ? `+${fmtNum(matrix.surveyQty)} vị trí khảo sát (chưa tính)` : matrix.grand.confirmed ? 'có ô KH đã xác nhận' : 'dự kiến, chưa xác nhận'} />
        <Kpi label="Đã nhận việc" value={fmtNum(started)} sub={matrix.grand.target ? `${pctText(matrix.grand.started, matrix.grand.target)} kế hoạch${left ? ` · ${fmtNum(left)} đã nghỉ` : ''}` : left ? `${fmtNum(left)} đã nghỉ` : ''} tone="good" />
        <Kpi label="Đang xử lý" value={fmtNum(inPipeline)} sub="hồ sơ chưa đi làm" onClick={() => onTab('pipeline')} />
        <Kpi label="Còn thiếu" value={fmtNum(remaining)} sub={remaining && matrix.grand.scheduled ? `${fmtNum(matrix.grand.scheduled)} đã hẹn ngày nhận việc` : ''} tone={remaining ? 'warn' : 'good'} />
      </div>

      <Panel title="Kế hoạch vs Thực tế" meta="Mỗi ô: đã nhận việc / chỉ tiêu. Đỏ = tháng đã qua còn thiếu · cam = tháng này · xanh = đủ."
        action={positions.length > 0 ? (
          <PillSelect label="Theo vị trí" value={posScope} active={posScope !== 'all'} onChange={setPosScope}>
            <option value="all">Mọi vị trí</option>
            <option value="none">Chưa chia vị trí</option>
            {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </PillSelect>
        ) : undefined} flush>
        {months.length === 0 || sites.length === 0
          ? <div className="px-4 md:px-5"><Quiet>Chưa có nhà máy / khoảng tháng — vào tab Kế hoạch để nhập.</Quiet></div>
          : <PlanMatrixTable matrix={matrix} currentMonth={cm} />}
      </Panel>

      <TodayPanel />
    </div>
  );
}

function Kpi({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn'; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className="text-left bg-white rounded-[16px] px-4 py-3 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_0_0_0.5px_rgba(0,0,0,0.1),0_4px_12px_-4px_rgba(0,0,0,0.1)] transition">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#86868B]">{label}</div>
      <div className={`text-[26px] font-bold tracking-[-0.02em] tabular-nums leading-tight mt-0.5 ${tone === 'good' ? 'text-[#1E7B34]' : tone === 'warn' ? 'text-[#B25000]' : 'text-[#1D1D1F]'}`}>{value || '0'}</div>
      {sub && <div className="text-[11.5px] text-[#86868B] mt-0.5 leading-snug">{sub}</div>}
    </Tag>
  );
}

const TONE_CLS = {
  done: 'bg-[#34C759]/[0.14] text-[#1E7B34]',
  behind: 'bg-[#FF3B30]/10 text-[#D70015]',
  progress: 'bg-[#FF9500]/[0.14] text-[#B25000]',
  future: 'bg-black/[0.03] text-[#6E6E73]',
  none: 'text-[#C7C7CC]',
} as const;

export function PlanMatrixTable({ matrix, currentMonth: cm }: { matrix: PlanMatrix; currentMonth: string }) {
  const cell = (c: PlanMatrix['grand'], month: string | null, bold = false) => {
    const tone = month ? cellTone(c, month, cm) : c.target > 0 ? (c.started >= c.target ? 'done' : 'future') : 'none';
    if (c.target === 0 && c.started === 0) return <span className="text-[#C7C7CC]">—</span>;
    return (
      <span className={`inline-flex flex-col items-center justify-center min-w-[68px] rounded-[8px] px-1.5 py-1 ${TONE_CLS[tone]}`}
        title={`${c.started} đã nhận việc / ${c.target} chỉ tiêu${c.scheduled ? ` · ${c.scheduled} đã hẹn ngày` : ''}${c.confirmed ? ' · KH đã xác nhận' : ''}`}>
        <span className={`tabular-nums text-[12.5px] ${bold ? 'font-bold' : 'font-semibold'}`}>{fmtNum(c.started)}<span className="opacity-60 font-normal">/{fmtNum(c.target)}</span></span>
        {c.scheduled > 0 && <span className="text-[10.5px] opacity-80">+{fmtNum(c.scheduled)} hẹn</span>}
      </span>
    );
  };
  return (
    <div className="overflow-x-auto px-4 md:px-5 pb-4">
      <table className="w-full text-[13px] border-separate border-spacing-y-1">
        <thead>
          <tr className="text-[11.5px] text-[#86868B]">
            <th className="text-left font-semibold pr-3 sticky left-0 bg-white">Nhà máy</th>
            {matrix.months.map(m => <th key={m} className={`font-semibold px-1 text-center ${m === cm ? 'text-[#0066CC]' : ''}`}>{monthLabel(m)}</th>)}
            <th className="font-semibold pl-2 text-center">Tổng</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map(r => (
            <tr key={r.siteId}>
              <td className="pr-3 font-medium text-[#1D1D1F] whitespace-nowrap sticky left-0 bg-white">{r.siteName}</td>
              {matrix.months.map(m => <td key={m} className="px-1 text-center">{cell(r.cells[m], m)}</td>)}
              <td className="pl-2 text-center">{cell(r.total, null, true)}</td>
            </tr>
          ))}
          <tr>
            <td className="pr-3 font-semibold text-[#1D1D1F] sticky left-0 bg-white">Tổng</td>
            {matrix.months.map(m => <td key={m} className="px-1 text-center">{cell(matrix.totals[m], m, true)}</td>)}
            <td className="pl-2 text-center">{cell(matrix.grand, null, true)}</td>
          </tr>
        </tbody>
      </table>
      {matrix.grand.target > 0 && (
        <p className={`${CAPTION} mt-2`}>
          Hoàn thành {pctText(matrix.grand.started, matrix.grand.target)} · lượt tuyển = người đã đi làm (kể cả nghỉ sau đó).
        </p>
      )}
    </div>
  );
}

// ── Việc hôm nay ────────────────────────────────────────────────────────────
function TodayPanel() {
  const { project, sites, toast, canEdit, reload } = useRecruit();
  const [data, setData] = useState<TodayList | null>(null);
  const [extra, setExtra] = useState<TodayExtra | null>(null);
  const [error, setError] = useState('');
  const [openCandidate, setOpenCandidate] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<RecruitApplicationFull | null>(null);
  const [busy, setBusy] = useState(false);
  const projectId = project?.id ?? null;

  const load = useCallback(async () => {
    try {
      const today = todayIso();
      const [d, x] = await Promise.all([loadToday(projectId, today), loadTodayExtra(projectId, today).catch(() => null)]);
      setData(d);
      setExtra(x);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  // đủ ngày tính phí: ngày đủ phí = đúng ngày tới mốc của từng người (không phải hôm nay)
  const confirmFees = async (list: RecruitApplicationFull[]) => {
    setBusy(true);
    try {
      for (const a of list) await moveApplications([a.id], 'fee_ok', { fee_date: a.due, note: 'Xác nhận còn đi làm tới mốc tính phí' });
      toast(`${list.length} người → Đủ ngày tính phí`);
      load(); reload();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const closeGuarantee = async (list: RecruitApplicationFull[]) => {
    setBusy(true);
    try {
      await moveApplications(list.map(a => a.id), 'done');
      toast(`${list.length} người → Hết bảo hành`);
      load();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };

  type Group = { key: string; title: string; icon: React.ReactNode; empty: string; list: RecruitApplication[]; count?: number;
    detail: (a: RecruitApplication) => string; action?: React.ReactNode; rowAction?: (a: RecruitApplication) => React.ReactNode };
  const groups: Group[] = data ? [
    { key: 'interviews', title: 'Hẹn phỏng vấn (hôm nay & quá hẹn)', icon: <CalendarClock size={15} className="text-[#3634A3]" />, empty: 'Không có lịch phỏng vấn', list: data.interviews, detail: a => `PV ${fmtDateTime(a.interview_at)}` },
    { key: 'starting', title: 'Nhận việc hôm nay / ngày mai', icon: <Rocket size={15} className="text-[#1E7B34]" />, empty: 'Không có ai sắp nhận việc', list: data.starting, detail: a => `Nhận việc ${fmtDate(a.planned_start)}` },
    ...(extra ? [
      { key: 'fee_due', title: 'Tới mốc tính phí — gọi xác nhận còn đi làm', icon: <BadgeCheck size={15} className="text-[#1E7B34]" />, empty: 'Chưa ai tới mốc tính phí', list: extra.fee_due,
        detail: (a: RecruitApplication) => `đi làm ${fmtDate(a.start_date)} · tới mốc ${fmtDate((a as RecruitApplicationFull).due)}`,
        action: canEdit && extra.fee_due.length > 0 ? <button type="button" disabled={busy} onClick={() => confirmFees(extra.fee_due)} className={MINI_BTN}>Xác nhận cả {extra.fee_due.length}</button> : undefined },
      { key: 'need_replacement', title: 'Nghỉ trong bảo hành — cần người thay', icon: <LifeBuoy size={15} className="text-[#D70015]" />, empty: 'Không ai nghỉ trong bảo hành', list: extra.need_replacement,
        detail: (a: RecruitApplication) => `nghỉ ${fmtDate(a.left_date)} · bảo hành tới ${fmtDate((a as RecruitApplicationFull).guarantee_end)}`,
        rowAction: canEdit ? (a: RecruitApplication) => (
          // span thay vì button: dòng danh sách đã là 1 nút bấm (không lồng nút trong nút)
          <span role="button" tabIndex={0} className={`${MINI_BTN} inline-flex items-center`}
            onClick={e => { e.stopPropagation(); setReplacing(a as RecruitApplicationFull); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setReplacing(a as RecruitApplicationFull); } }}>Tìm người thay</span>
        ) : undefined },
      { key: 'guarantee_over', title: 'Hết thời gian bảo hành', icon: <ShieldCheck size={15} className="text-[#0066CC]" />, empty: 'Chưa ai hết bảo hành', list: extra.guarantee_over,
        detail: (a: RecruitApplication) => `đủ phí ${fmtDate(a.fee_date)}`,
        action: canEdit && extra.guarantee_over.length > 0 ? <button type="button" disabled={busy} onClick={() => closeGuarantee(extra.guarantee_over)} className={MINI_BTN}>Chuyển cả {extra.guarantee_over.length}</button> : undefined },
    ] : []),
    { key: 'stale_new', title: 'Hồ sơ mới quá 2 ngày chưa gọi', icon: <Phone size={15} className="text-[#B25000]" />, empty: 'Đã gọi hết hồ sơ mới', list: data.stale_new, count: data.stale_new_count, detail: a => `Nộp ${fmtDate(a.created_at)}` },
    { key: 'diploma_due', title: 'Tới hạn nộp bằng (KTV chờ bằng)', icon: <GraduationCap size={15} className="text-[#8944AB]" />, empty: 'Không có ai tới hạn nộp bằng', list: data.diploma_due, detail: a => `Hạn ${fmtDate(a.candidate?.diploma_due)}` },
  ] : [];

  return (
    <Panel title="Việc cần làm hôm nay" icon={<UserPlus size={16} className="text-[#0066CC]" />}
      meta={extra && extra.batches.length > 0 ? `Đợt nhận việc: ${extra.batches.map(b => `${fmtDate(b.batch_date)}${b.start_time ? ` ${b.start_time}` : ''} · ${nameOf(sites, b.site_id)} (${b.assigned} người)`).join(' · ')}` : undefined}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!data && !error && <div className="py-6 flex justify-center"><Spinner /></div>}
      {data && (
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4 pb-3">
          {groups.map(g => {
            const total = g.count ?? g.list.length;
            return (
              <div key={g.key} className="min-w-0">
                <h3 className="text-[13px] font-semibold text-[#1D1D1F] flex items-center gap-1.5 mb-1">{g.icon}<span className="min-w-0 truncate">{g.title}</span>
                  {total > 0 && <span className="font-normal text-[#86868B]">{total}</span>}
                  {g.action && <span className="ml-auto">{g.action}</span>}
                </h3>
                {g.list.length === 0 ? <p className="text-[12.5px] text-[#AEAEB2] py-1">{g.empty}</p> : (
                  <div>
                    {g.list.slice(0, 8).map((a, i) => (
                      <Row key={a.id} first={i === 0} inset={0} onClick={() => setOpenCandidate(a.candidate_id)}>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] text-[#1D1D1F] truncate">{a.candidate?.full_name} <span className="text-[#86868B]">· {formatPhone(a.candidate?.phone ?? '')}</span></div>
                          <div className="text-[12px] text-[#86868B] truncate">{[g.detail(a), nameOf(sites, a.site_id)].filter(Boolean).join(' · ')}</div>
                        </div>
                        {g.rowAction?.(a)}
                      </Row>
                    ))}
                    {total > 8 && <p className="text-[12px] text-[#86868B] pt-1">… và {total - 8} hồ sơ khác (xem ở tab Ứng tuyển)</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {openCandidate && <CandidateSheet candidateId={openCandidate} onClose={() => setOpenCandidate(null)} onChanged={load} />}
      {replacing && (
        <QuickAddSheet replaces={{ id: replacing.id, name: replacing.candidate.full_name }} defaultSiteId={replacing.site_id ?? undefined}
          defaultPositionId={replacing.position_id ?? undefined} onClose={() => setReplacing(null)} onDone={() => { load(); reload(); }} />
      )}
    </Panel>
  );
}

const MINI_BTN = 'h-7 px-2.5 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[12px] font-semibold hover:bg-[#0071E3]/[0.16] disabled:opacity-40 whitespace-nowrap';
