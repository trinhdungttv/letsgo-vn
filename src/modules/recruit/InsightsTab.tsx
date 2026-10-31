// Tab Phân tích: dự báo kịp chỉ tiêu, phễu theo nhóm vị trí, hiệu quả & chi phí từng kênh, bản đồ nguồn lao động,
// báo cáo tuần (Excel) gửi đầu mối khách.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, Download, Map as MapIcon, Megaphone, Plus, Trash2, TrendingUp } from 'lucide-react';
import { TINT } from '../../components/workspace/wsTheme';
import { deleteCost, errText, isUnsupported, listCosts, loadFunnel, loadGeo, loadWeekly, saveCost } from '../../lib/recruit/api';
import type { ChannelCost, GeoRow } from '../../lib/recruit/api';
import { downloadXlsx } from '../../lib/recruit/exportXlsx';
import { costPerHire, forecast, requiredWeeklyPace, sumFunnel, weeklyIntake, yieldRate } from '../../lib/recruit/funnel';
import type { FunnelReport, ForecastStatus } from '../../lib/recruit/funnel';
import { buildPlanMatrix, monthLabel, monthRange } from '../../lib/recruit/plan';
import { STAGE_META } from '../../lib/recruit/stages';
import { SOURCE_CHANNELS } from '../../lib/recruit/types';
import type { PositionGroup } from '../../lib/recruit/types';
import { nameOf, useRecruit } from './context';
import SourceMap from './SourceMap';
import {
  CAPTION, ErrorBanner, Field, MoneyInput, PILL_GRAY, PILL_PRIMARY, PageTitle, Panel, PillSelect, Quiet, SHEET_FOOTER, Segmented, Sheet,
  Spinner, currentMonth, fmtDate, fmtNum, inputCls, sectionCls, todayIso,
} from './ui';

const STATUS: Record<ForecastStatus, { label: string; tint: keyof typeof TINT }> = {
  done: { label: 'Đủ', tint: 'green' },
  ok: { label: 'Kịp', tint: 'green' },
  tight: { label: 'Sát', tint: 'orange' },
  behind: { label: 'Thiếu nguồn', tint: 'red' },
  late: { label: 'Quá hạn gom', tint: 'red' },
  past: { label: 'Đã qua · thiếu', tint: 'gray' },
};
const pctOf = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

export default function InsightsTab() {
  const { project, sites, positions, boot } = useRecruit();
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [geo, setGeo] = useState<GeoRow[] | null>(null);
  const [costs, setCosts] = useState<ChannelCost[]>([]);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [group, setGroup] = useState<'all' | PositionGroup>('all');
  const [siteId, setSiteId] = useState('');
  const [weekly, setWeekly] = useState(false);
  const projectId = project?.id;

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [f, g, c] = await Promise.all([loadFunnel(projectId), loadGeo(projectId), listCosts(projectId)]);
      setFunnel(f); setGeo(g); setCosts(c); setError(''); setMissing(false);
    } catch (e) {
      if (isUnsupported(e)) setMissing(true); else setError(errText(e));
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => monthRange(project?.period_from, project?.period_to), [project]);
  const matrix = useMemo(() => project ? buildPlanMatrix({
    months, sites, positions,
    targets: boot.targets.filter(t => t.project_id === project.id),
    hires: boot.hires.filter(h => h.project_id === project.id),
    scheduled: boot.scheduled.filter(s => s.project_id === project.id),
  }) : null, [project, months, sites, positions, boot]);

  if (!project || !matrix) return <Quiet>Chọn hoặc tạo dự án tuyển dụng trước.</Quiet>;
  if (missing) return <Quiet>Phần Phân tích cần chạy migration 182 (20261101120000_182_recruit_insights.sql) trên Supabase.</Quiet>;

  const rows = funnel?.rows ?? [];
  const filtered = sumFunnel(rows, r => (group === 'all' || r.group_code === group) && (!siteId || r.site_id === siteId));
  const all = sumFunnel(rows);
  const y = yieldRate(all, 'B');
  const intake = funnel ? weeklyIntake(funnel.weeks) : 0;
  const fc = funnel ? forecast({ matrix, rate: y.rate, intakePerWeek: intake, medianDays: funnel.median_days_to_start, today: todayIso() }) : [];
  const pace = requiredWeeklyPace(fc);

  return (
    <div className="space-y-4 md:space-y-5">
      <PageTitle eyebrow="Phân tích" title="Dự báo & nguồn tuyển"
        subtitle="Đủ chỉ tiêu không, kênh nào hiệu quả, vùng nào nhiều lao động đi làm bền."
        actions={<button type="button" onClick={() => setWeekly(true)} className={PILL_PRIMARY}><Download size={14} /> Báo cáo tuần</button>} />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!funnel && !error && <div className="py-10 flex justify-center"><Spinner /></div>}

      {funnel && (
        <Panel title="Dự báo kịp chỉ tiêu" icon={<TrendingUp size={16} className="text-[#0066CC]" />} flush
          meta={`1 người đi làm / ${y.rate > 0 ? (1 / y.rate).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '—'} hồ sơ ${y.measured ? `(đo từ ${fmtNum(y.decided)} hồ sơ đã nộp ≥ 14 ngày)` : `(giả định — mới có ${fmtNum(y.decided)}/30 hồ sơ nộp ≥ 14 ngày)`} · đang nhận ${fmtNum(Math.round(intake))} hồ sơ/tuần · nộp → đi làm ${funnel.median_days_to_start != null ? `${Math.round(funnel.median_days_to_start)} ngày` : '~7 ngày (giả định)'}`}>
          {pace > 0 && (
            <p className={`mx-4 md:mx-5 mb-2 rounded-[10px] px-3 py-2 text-[13px] ${pace > intake * 1.5 ? 'bg-[#FF3B30]/10 text-[#D70015]' : pace > intake ? 'bg-[#FF9500]/[0.14] text-[#8A4B00]' : 'bg-[#34C759]/[0.14] text-[#1E7B34]'}`}>
              Cần nhận khoảng <b>{fmtNum(pace)} hồ sơ / tuần</b> từ nay để kịp mọi tháng — hiện đang nhận {fmtNum(Math.round(intake))}.
            </p>
          )}
          <div className="overflow-x-auto px-4 md:px-5 pb-4">
            <table className="w-full min-w-[640px] text-[13px] tabular-nums [&_th]:whitespace-nowrap">
              <thead><tr className="text-[11.5px] text-[#86868B] text-right">
                <th className="text-left font-semibold py-1.5">Tháng</th><th className="font-semibold">Chỉ tiêu</th><th className="font-semibold">Đã đi làm</th>
                <th className="font-semibold">Đã hẹn</th><th className="font-semibold">Còn thiếu</th><th className="font-semibold">Hồ sơ cần</th>
                <th className="font-semibold">Hạn gom</th><th className="font-semibold">Cần / tuần</th><th className="font-semibold">Tình trạng</th>
              </tr></thead>
              <tbody>
                {fc.map(r => (
                  <tr key={r.month} className="text-right border-t border-[#E5E5EA]">
                    <td className="text-left py-2 font-medium text-[#1D1D1F]">{monthLabel(r.month)}</td>
                    <td>{fmtNum(r.target)}</td><td>{fmtNum(r.started)}</td><td>{fmtNum(r.scheduled)}</td>
                    <td className="font-semibold">{fmtNum(r.gap)}</td><td>{r.gap ? fmtNum(r.leadsNeeded) : '—'}</td>
                    <td>{r.gap && r.status !== 'past' ? fmtDate(r.deadline) : '—'}</td>
                    <td className="font-semibold">{r.gap && r.status !== 'past' && r.status !== 'late' ? fmtNum(r.perWeek) : '—'}</td>
                    <td><span className={`inline-block px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${TINT[STATUS[r.status].tint]}`}>{STATUS[r.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={`${CAPTION} mt-2`}>Hạn gom = cuối tháng trừ số ngày từ lúc nộp tới lúc đi làm. "Sát" = cần nhiều hơn mức đang nhận nhưng chưa quá 1,5 lần.</p>
          </div>
        </Panel>
      )}

      {funnel && (
        <Panel title="Phễu tuyển dụng" icon={<BarChart3 size={16} className="text-[#8944AB]" />}
          action={sites.length > 1 ? (
            <PillSelect label="Nhà máy" value={siteId} active={!!siteId} onChange={setSiteId}>
              <option value="">Mọi nhà máy</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </PillSelect>
          ) : undefined}>
          <div className="pb-4 space-y-3">
            <Segmented label="Nhóm" value={group} onChange={setGroup} fit
              options={[{ key: 'all', label: 'Tất cả' }, { key: 'A', label: 'A · KTV' }, { key: 'B', label: 'B · LĐPT' }, { key: 'C', label: 'C · Khảo sát' }]} />
            {filtered.total === 0 ? <Quiet>Chưa có hồ sơ.</Quiet> : (
              <div className="space-y-1.5">
                {([['total', 'Hồ sơ'], ['contacted', STAGE_META.contacted.label], ['interview', 'Phỏng vấn / sàng lọc'], ['passed', STAGE_META.passed.label],
                  ['started', STAGE_META.started.label], ['fee_ok', STAGE_META.fee_ok.label]] as const).map(([k, label]) => (
                  <div key={k} className="flex items-center gap-3 text-[13px]">
                    <span className="w-[130px] shrink-0 text-[#6E6E73]">{label}</span>
                    <div className="flex-1 h-6 rounded-[6px] bg-black/[0.04] overflow-hidden">
                      <div className="h-full bg-[#0071E3]/70 rounded-[6px]" style={{ width: `${Math.max(1, (filtered[k] / filtered.total) * 100)}%` }} />
                    </div>
                    <span className="w-[110px] text-right tabular-nums text-[#1D1D1F]">{fmtNum(filtered[k])} <span className="text-[#86868B]">{pctOf(filtered[k], filtered.total)}</span></span>
                  </div>
                ))}
                <p className={`${CAPTION} pt-1`}>
                  Bị loại / bỏ / không đến: {fmtNum(filtered.lost)} · Đã nghỉ: {fmtNum(filtered.left_count)} · Nghỉ trong 30 ngày đầu: {fmtNum(filtered.early_left)} ({pctOf(filtered.early_left, filtered.started)} số người đi làm)
                </p>
              </div>
            )}
          </div>
        </Panel>
      )}

      {funnel && <ChannelPanel rows={rows} costs={costs} onChanged={load} />}

      {geo && (
        <Panel title="Bản đồ nguồn lao động" icon={<MapIcon size={16} className="text-[#1E7B34]" />}
          meta="Theo xã/phường ứng viên đang ở. Vòng to = nhiều hồ sơ · xanh đậm = tỷ lệ đi làm cao · đỏ = hay nghỉ sớm. Ứng viên chưa chọn xã từ danh mục sẽ không lên bản đồ.">
          <div className="pb-4 space-y-3">
            <SourceMap rows={geo} sites={sites} />
            <div className="grid md:grid-cols-2 gap-x-6">
              {geo.slice(0, 10).map(g => (
                <div key={`${g.province}|${g.commune}`} className="flex items-center gap-2 py-1.5 border-b border-[#E5E5EA] text-[13px]">
                  <span className="flex-1 min-w-0 truncate text-[#1D1D1F]">{g.commune || 'Chưa rõ xã'}<span className="text-[#86868B]">{g.province ? ` · ${g.province}` : ''}</span></span>
                  <span className="tabular-nums text-[#6E6E73]">{fmtNum(g.total)} hồ sơ · {fmtNum(g.started)} đi làm</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}
      {weekly && <WeeklyReportSheet onClose={() => setWeekly(false)} />}
    </div>
  );
}

// ── Hiệu quả & chi phí theo kênh ───────────────────────────────────────────
function ChannelPanel({ rows, costs, onChanged }: { rows: FunnelReport['rows']; costs: ChannelCost[]; onChanged: () => void }) {
  const { project, toast, canEdit } = useRecruit();
  const [month, setMonth] = useState(currentMonth());
  const [channel, setChannel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const channels = useMemo(() => {
    const m = new Map<string, { total: number; started: number; early: number }>();
    for (const r of rows) {
      const k = r.source_channel || 'Không rõ';
      const cur = m.get(k) ?? { total: 0, started: 0, early: 0 };
      m.set(k, { total: cur.total + r.total, started: cur.started + r.started, early: cur.early + r.early_left });
    }
    for (const c of costs) if (!m.has(c.channel)) m.set(c.channel, { total: 0, started: 0, early: 0 });
    return [...m.entries()].map(([name, v]) => ({ name, ...v, cost: costs.filter(c => c.channel === name).reduce((s, c) => s + c.amount, 0) }))
      .sort((a, b) => b.started - a.started || b.total - a.total);
  }, [rows, costs]);
  if (!project) return null;

  const add = async () => {
    if (!channel.trim() || amount == null) { toast('Chọn kênh và nhập số tiền'); return; }
    setBusy(true);
    try {
      await saveCost({ project_id: project.id, month, channel: channel.trim(), amount });
      setAmount(null);
      onChanged();
      toast('Đã lưu chi phí');
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const remove = async (c: ChannelCost) => {
    if (!confirm(`Xoá chi phí ${c.channel} ${monthLabel(c.month)} (${fmtNum(c.amount)}đ)?`)) return;
    try { await deleteCost(c.id); onChanged(); } catch (e) { toast(errText(e)); }
  };

  return (
    <Panel title="Kênh tuyển: hiệu quả & chi phí" icon={<Megaphone size={16} className="text-[#B25000]" />}
      meta="Chi phí cộng mọi tháng đã nhập. Chi phí / người = tổng chi phí kênh ÷ số người đi làm từ kênh đó.">
      <div className="pb-4 space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px] tabular-nums [&_th]:whitespace-nowrap">
            <thead><tr className="text-[11.5px] text-[#86868B] text-right">
              <th className="text-left font-semibold py-1.5">Kênh</th><th className="font-semibold">Hồ sơ</th><th className="font-semibold">Đi làm</th>
              <th className="font-semibold">Tỷ lệ</th><th className="font-semibold">Nghỉ sớm</th><th className="font-semibold">Chi phí</th><th className="font-semibold">Chi phí / người</th>
            </tr></thead>
            <tbody>
              {channels.map(c => (
                <tr key={c.name} className="text-right border-t border-[#E5E5EA]">
                  <td className="text-left py-2 text-[#1D1D1F]">{c.name}</td>
                  <td>{fmtNum(c.total)}</td><td>{fmtNum(c.started)}</td><td>{pctOf(c.started, c.total)}</td>
                  <td>{c.early ? fmtNum(c.early) : '—'}</td><td>{c.cost ? fmtNum(c.cost) : '—'}</td>
                  <td className="font-semibold">{c.cost ? (costPerHire(c.cost, c.started) != null ? fmtNum(costPerHire(c.cost, c.started)) : 'chưa có ai') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="grid grid-cols-2 md:grid-cols-[150px_1fr_160px_auto] gap-2 items-end rounded-[12px] bg-[#F5F5F7] p-3">
            <Field label="Tháng"><input type="month" value={month} onChange={e => setMonth(e.target.value)} className={inputCls} /></Field>
            <Field label="Kênh">
              <input value={channel} onChange={e => setChannel(e.target.value)} list="recruit-cost-channels" placeholder="VD: Facebook" className={inputCls} />
              <datalist id="recruit-cost-channels">{SOURCE_CHANNELS.map(s => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Chi phí (đ)"><MoneyInput value={amount} onChange={setAmount} /></Field>
            <button type="button" onClick={add} disabled={busy} className={`${PILL_PRIMARY} col-span-2 md:col-span-1`}><Plus size={14} /> Lưu</button>
          </div>
        )}
        {costs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {costs.map(c => (
              <span key={c.id} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-black/[0.05] text-[12px] text-[#1D1D1F]">
                {monthLabel(c.month)} · {c.channel} · {fmtNum(c.amount)}đ
                {canEdit && <button type="button" onClick={() => remove(c)} aria-label="Xoá" className="w-5 h-5 rounded-full flex items-center justify-center text-[#86868B] hover:bg-black/[0.08]"><Trash2 size={11} /></button>}
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── Báo cáo tuần gửi khách ─────────────────────────────────────────────────
function WeeklyReportSheet({ onClose }: { onClose: () => void }) {
  const { project, sites, positions, boot, clients, toast } = useRecruit();
  const today = todayIso();
  const weekAgo = new Date(Date.now() - 6 * 86400000);
  const [from, setFrom] = useState(`${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  if (!project) return null;

  const run = async () => {
    setBusy(true);
    try {
      const w = await loadWeekly(project.id, from, to);
      const months = monthRange(project.period_from, project.period_to);
      const m = buildPlanMatrix({
        months, sites, positions,
        targets: boot.targets.filter(t => t.project_id === project.id),
        hires: boot.hires.filter(h => h.project_id === project.id),
        scheduled: boot.scheduled.filter(s => s.project_id === project.id),
      });
      const pos = (id: string | null) => positions.find(p => p.id === id)?.title ?? '';
      const cell = (c: { target: number; started: number }) => (c.target || c.started ? `${c.started}/${c.target}` : '');
      const pipeline = boot.pipeline.filter(p => p.project_id === project.id);
      const stages = ['new', 'contacted', 'interview', 'passed', 'ready'] as const;
      const title = [`BÁO CÁO TUYỂN DỤNG — ${project.name}`, `Khách hàng: ${nameOf(clients, project.client_id) || '—'}${project.contact_name ? ` · Đầu mối: ${project.contact_name}` : ''}`, `Từ ${fmtDate(from)} đến ${fmtDate(to)}`];
      await downloadXlsx(`Bao cao tuyen dung ${project.name} ${from} ${to}`, [
        {
          name: 'Tổng hợp', title: [...title, 'Mỗi ô: đã nhận việc / chỉ tiêu'],
          headers: ['Nhà máy', ...months.map(monthLabel), 'Tổng'],
          rows: m.rows.map(r => [r.siteName, ...months.map(x => cell(r.cells[x])), cell(r.total)]),
          total: ['Tổng', ...months.map(x => cell(m.totals[x])), cell(m.grand)],
        },
        {
          name: 'Nhận việc', title,
          headers: ['STT', 'Họ tên', 'Năm sinh', 'Giới tính', 'Vị trí', 'Nhà máy', 'Ngày đi làm', 'Mã NV'],
          rows: w.started.map((r, i) => [i + 1, r.candidate.full_name, r.candidate.birth_year, r.candidate.gender === 'male' ? 'Nam' : r.candidate.gender === 'female' ? 'Nữ' : '',
            pos(r.position_id), nameOf(sites, r.site_id), fmtDate(r.start_date), r.employee_code]),
          widths: [6, 26, 10, 10, 26, 12, 12, 12],
        },
        {
          name: 'Nghỉ việc', title,
          headers: ['STT', 'Họ tên', 'Vị trí', 'Nhà máy', 'Ngày đi làm', 'Ngày nghỉ', 'Lý do'],
          rows: w.left.map((r, i) => [i + 1, r.candidate.full_name, pos(r.position_id), nameOf(sites, r.site_id), fmtDate(r.start_date), fmtDate(r.left_date), r.close_reason]),
          widths: [6, 26, 26, 12, 12, 12, 30],
        },
        {
          name: 'Đang xử lý', title: [...title, 'Số hồ sơ chưa đi làm theo bước (thời điểm xuất)'],
          headers: ['Nhà máy', ...stages.map(s => STAGE_META[s].label), 'Tổng'],
          rows: sites.map(s => {
            const n = stages.map(st => pipeline.filter(p => p.site_id === s.id && p.stage === st).reduce((a, p) => a + p.n, 0));
            return [s.name, ...n, n.reduce((a, b) => a + b, 0)];
          }),
        },
      ]);
      toast(`Đã xuất báo cáo: ${w.started.length} nhận việc, ${w.left.length} nghỉ việc`);
      onClose();
    } catch (e) { toast(errText(e)); setBusy(false); }
  };

  return createPortal(
    <Sheet label="Báo cáo tuần" onClose={onClose}>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Báo cáo tuần gửi khách</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">Excel 4 trang: Kế hoạch vs thực tế · Nhận việc · Nghỉ việc · Đang xử lý. Không kèm SĐT / CCCD.</p>
      <section className={`${sectionCls} mt-4`}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Từ ngày"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} /></Field>
          <Field label="Đến ngày"><input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} /></Field>
        </div>
      </section>
      <div className={`${SHEET_FOOTER} mt-4 flex justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <button type="button" onClick={onClose} className={PILL_GRAY}>Huỷ</button>
        <button type="button" onClick={run} disabled={busy || !from || !to || to < from} className={PILL_PRIMARY}><Download size={14} /> {busy ? 'Đang xuất…' : 'Xuất Excel'}</button>
      </div>
    </Sheet>,
    document.body,
  );
}

