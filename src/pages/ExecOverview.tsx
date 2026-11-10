// Trang "Tổng quan" — bức tranh tổng thể cho Ban Điều Hành (migration 218): chỉ số gộp, không danh sách chi tiết
// từng khách hàng / liên hệ / ghi chú. Chỉ đọc; số liệu lấy từ dữ liệu App đã nạp + vài câu đếm nhẹ.
import { useEffect, useMemo, useState } from 'react';
import { Building2, Users, Network, FileClock, HeartHandshake, CheckCircle2, AlarmClock, MapPinned, Eye } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { CRM_STAGES, ROLE_LABELS } from '../lib/constants';
import { activitySummary } from '../lib/dataGuard';
import { useBranchLookup } from '../hooks/useBranchLookup';
import { CARD, ICON_TILE } from '../components/workspace/wsTheme';
import type { Client, CRMPipelineEntry } from '../lib/types';

interface Props {
  clients: Client[];
  pipeline: CRMPipelineEntry[];
}

const MONTHS = 6;
const fmt = (n: number) => n.toLocaleString('vi-VN');

/** yyyy-mm-dd theo giờ máy. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** 6 tháng gần nhất (cũ → mới). */
function lastMonths(): { key: string; label: string; start: Date }[] {
  const now = new Date();
  return Array.from({ length: MONTHS }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1);
    return { key: monthKey(start), label: `T${start.getMonth() + 1}`, start };
  });
}

/** Đọc 1 cột ngày của bảng từ mốc `since` (phân trang 1000 dòng) → đếm theo tháng. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder của supabase-js không có kiểu gọn để truyền qua lại
type Query = any;
async function countByMonth(table: string, col: string, since: string, extra?: (q: Query) => Query): Promise<Record<string, number> | null> {
  const out: Record<string, number> = {};
  for (let from = 0; from < 20000; from += 1000) {
    let q = supabase.from(table).select(col).gte(col, since).range(from, from + 999);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return null;
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const r of rows) {
      const v = r[col];
      if (!v) continue;
      const k = v.slice(0, 7);
      out[k] = (out[k] ?? 0) + 1;
    }
    if (rows.length < 1000) break;
  }
  return out;
}

interface Trends {
  cskh: Record<string, number> | null;
  tasksDone: Record<string, number> | null;
  visits: Record<string, number> | null;
  overdue: number | null;
}

export default function ExecOverview({ clients, pipeline }: Props) {
  const { token } = useAuth();
  const { labelOf } = useBranchLookup();
  const months = useMemo(lastMonths, []);
  const thisKey = months[MONTHS - 1].key;
  const prevKey = months[MONTHS - 2].key;
  const [trends, setTrends] = useState<Trends | null>(null);
  const [team, setTeam] = useState<{ id: string; name: string; role: string; ins: number; upd: number; del: number; days: number }[] | null>(null);

  useEffect(() => {
    let alive = true;
    const since = ymd(months[0].start);
    const today = ymd(new Date());
    Promise.all([
      countByMonth('cskh_logs', 'log_date', since),
      countByMonth('work_tasks', 'completed_at', since, q => q.eq('status', 'done').is('deleted_at', null)),
      countByMonth('kcn_visits', 'visit_date', since, q => q.eq('status', 'done')),
      supabase.from('work_tasks').select('id', { count: 'exact', head: true })
        .neq('status', 'done').is('deleted_at', null).lt('due_date', today)
        .then(({ count, error }) => (error ? null : count ?? 0)),
    ]).then(([cskh, tasksDone, visits, overdue]) => {
      if (alive) setTrends({ cskh, tasksDone, visits, overdue });
    });
    return () => { alive = false; };
  }, [months]);

  useEffect(() => {
    if (!token) { setTeam([]); return; }
    let alive = true;
    activitySummary(token, months[MONTHS - 1].start, new Date(Date.now() + 60_000))
      .then(rows => {
        const m = new Map<string, { id: string; name: string; role: string; ins: number; upd: number; del: number; days: Set<string> }>();
        for (const r of rows) {
          const a = m.get(r.actor_id) ?? { id: r.actor_id, name: r.actor_name || '—', role: r.actor_role || '', ins: 0, upd: 0, del: 0, days: new Set<string>() };
          if (r.action === 'INSERT') a.ins += r.n; else if (r.action === 'UPDATE') a.upd += r.n; else a.del += r.n;
          a.days.add(r.day);
          m.set(r.actor_id, a);
        }
        const list = [...m.values()].map(a => ({ ...a, days: a.days.size })).sort((x, y) => (y.ins + y.upd + y.del) - (x.ins + x.upd + x.del));
        if (alive) setTeam(list);
      })
      .catch(() => { if (alive) setTeam([]); });
    return () => { alive = false; };
  }, [token, months]);

  // ── Chỉ số từ dữ liệu đã nạp ──
  const k = useMemo(() => {
    const now = new Date();
    const in60 = ymd(new Date(now.getTime() + 60 * 86_400_000));
    const today = ymd(now);
    const newClients = clients.filter(c => (c.won_date || c.created_at || '').slice(0, 7) === thisKey).length;
    const workers = clients.reduce((s, c) => s + (c.current_workers ?? 0), 0);
    const committed = clients.reduce((s, c) => s + (c.min_workers ?? 0), 0);
    const expiring = clients.filter(c => c.contract_end && c.contract_end >= today && c.contract_end <= in60).length;
    const activeStages = new Set(CRM_STAGES.filter(s => s.id !== 'hop-tac').map(s => s.id));
    const pursuing = pipeline.filter(p => activeStages.has(p.stage)).length;
    const newPipeline = pipeline.filter(p => (p.created_at || '').slice(0, 7) === thisKey).length;
    const pipeByMonth: Record<string, number> = {};
    for (const p of pipeline) { const mk = (p.created_at || '').slice(0, 7); if (mk) pipeByMonth[mk] = (pipeByMonth[mk] ?? 0) + 1; }
    return { newClients, workers, committed, expiring, pursuing, newPipeline, pipeByMonth };
  }, [clients, pipeline, thisKey]);

  const funnel = useMemo(() => {
    const rows = CRM_STAGES.map(s => ({ id: s.id, label: s.label, n: pipeline.filter(p => p.stage === s.id).length }));
    const lost = pipeline.filter(p => p.stage === 'khong-nhu-cau').length;
    const stopped = pipeline.filter(p => p.stage === 'ngung').length;
    return { rows, lost, stopped, max: Math.max(1, ...rows.map(r => r.n)) };
  }, [pipeline]);

  const branches = useMemo(() => {
    const m = new Map<string, { name: string; clients: number; workers: number }>();
    for (const c of clients) {
      const name = labelOf(c) || 'Chưa gán chi nhánh';
      const b = m.get(name) ?? { name, clients: 0, workers: 0 };
      b.clients += 1; b.workers += c.current_workers ?? 0;
      m.set(name, b);
    }
    const list = [...m.values()].sort((x, y) => y.workers - x.workers || y.clients - x.clients);
    return { list, max: Math.max(1, ...list.map(b => b.workers)) };
  }, [clients, labelOf]);

  const delta = (series: Record<string, number> | null | undefined) => {
    if (!series) return null;
    const cur = series[thisKey] ?? 0, prev = series[prevKey] ?? 0;
    return { cur, prev };
  };
  const cskh = delta(trends?.cskh);
  const done = delta(trends?.tasksDone);
  const visits = delta(trends?.visits);

  return (
    <>
      <PageHeader title="Tổng quan điều hành" subtitle={`Bức tranh chung toàn bộ hoạt động · tháng ${new Date().getMonth() + 1}/${new Date().getFullYear()}`} />
      <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4">
        <div className="flex items-center gap-2 text-[12px] text-[#6E6E73]">
          <Eye size={13} /> Số liệu tổng hợp, tự cập nhật — chế độ chỉ xem.
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi icon={<Building2 size={16} />} tile="teal" label="Khách hàng đang hợp tác" value={fmt(clients.length)} sub={k.newClients ? `+${k.newClients} mới tháng này` : 'Chưa có KH mới tháng này'} />
          <Kpi icon={<Users size={16} />} tile="blue" label="Lao động đang cung ứng" value={fmt(k.workers)} sub={k.committed ? `Cam kết tối thiểu ${fmt(k.committed)}` : undefined} />
          <Kpi icon={<Network size={16} />} tile="purple" label="Công ty đang theo đuổi" value={fmt(k.pursuing)} sub={`+${k.newPipeline} vào pipeline tháng này`} />
          <Kpi icon={<FileClock size={16} />} tile="orange" label="HĐ hết hạn trong 60 ngày" value={fmt(k.expiring)} sub="Cần tái ký / gia hạn" />
          <Kpi icon={<HeartHandshake size={16} />} tile="pink" label="Lượt chăm sóc KH tháng này" value={cskh ? fmt(cskh.cur) : '…'} sub={cskh ? compare(cskh.cur, cskh.prev) : undefined} />
          <Kpi icon={<CheckCircle2 size={16} />} tile="green" label="Việc hoàn thành tháng này" value={done ? fmt(done.cur) : '…'} sub={done ? compare(done.cur, done.prev) : undefined} />
          <Kpi icon={<AlarmClock size={16} />} tile="red" label="Việc đang quá hạn" value={trends ? (trends.overdue == null ? '—' : fmt(trends.overdue)) : '…'} sub="Toàn bộ công việc chưa xong" />
          <Kpi icon={<MapPinned size={16} />} tile="indigo" label="Lượt ghé KCN tháng này" value={visits ? fmt(visits.cur) : '…'} sub={visits ? compare(visits.cur, visits.prev) : undefined} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <section className={`${CARD} p-4`}>
            <h3 className="text-[14px] font-semibold text-[#1D1D1F]">Phễu kinh doanh</h3>
            <div className="text-[11.5px] text-[#86868B] mb-3">Số công ty ở từng giai đoạn BD Pipeline</div>
            <div className="space-y-2">
              {funnel.rows.map(r => (
                <BarRow key={r.id} label={r.label} value={r.n} max={funnel.max} text={fmt(r.n)} />
              ))}
            </div>
            <div className="text-[11.5px] text-[#86868B] mt-3">Không hợp tác: {fmt(funnel.lost)} · Ngưng hợp đồng: {fmt(funnel.stopped)}</div>
          </section>

          <section className={`${CARD} p-4`}>
            <h3 className="text-[14px] font-semibold text-[#1D1D1F]">Lao động theo chi nhánh</h3>
            <div className="text-[11.5px] text-[#86868B] mb-3">Số lao động đang cung ứng · số khách hàng</div>
            {branches.list.length === 0 ? <div className="text-[12px] text-[#AEAEB2] py-4">Chưa có dữ liệu</div> : (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {branches.list.map(b => (
                  <BarRow key={b.name} label={b.name} value={b.workers} max={branches.max} text={`${fmt(b.workers)} LĐ · ${b.clients} KH`} />
                ))}
              </div>
            )}
          </section>
        </div>

        <section className={`${CARD} p-4`}>
          <h3 className="text-[14px] font-semibold text-[#1D1D1F]">Nhịp hoạt động 6 tháng</h3>
          <div className="text-[11.5px] text-[#86868B] mb-3">Mỗi cột là 1 tháng · cột đậm là tháng hiện tại</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MiniTrend title="Chăm sóc khách hàng" months={months} series={trends?.cskh} />
            <MiniTrend title="Việc hoàn thành" months={months} series={trends?.tasksDone} />
            <MiniTrend title="Ghé khu công nghiệp" months={months} series={trends?.visits} />
            <MiniTrend title="Công ty mới vào pipeline" months={months} series={k.pipeByMonth} />
          </div>
        </section>

        <section className={`${CARD} p-4`}>
          <h3 className="text-[14px] font-semibold text-[#1D1D1F]">Nhịp nhập liệu của đội ngũ (tháng này)</h3>
          <div className="text-[11.5px] text-[#86868B] mb-3 flex items-center gap-3 flex-wrap">
            <span>Số dòng dữ liệu mỗi người thêm / sửa / xoá</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#34C759]" />Thêm</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#0071E3]" />Sửa</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#FF3B30]" />Xoá</span>
          </div>
          {team === null ? <div className="text-[12px] text-[#AEAEB2] py-3">Đang tải…</div> : team.length === 0 ? (
            <div className="text-[12px] text-[#AEAEB2] py-3">Chưa có dữ liệu ghi tên người nhập (tính năng bắt đầu ghi từ khi cập nhật hệ thống).</div>
          ) : (
            <div className="space-y-2.5">
              {(() => {
                const max = Math.max(1, ...team.map(t => t.ins + t.upd + t.del));
                return team.map(t => {
                  const total = t.ins + t.upd + t.del;
                  return (
                    <div key={t.id} className="grid grid-cols-[140px_1fr_auto] sm:grid-cols-[200px_1fr_auto] items-center gap-3 text-[12.5px]"
                      title={`${t.name}: ${t.ins} thêm · ${t.upd} sửa · ${t.del} xoá · ${t.days} ngày có nhập liệu`}>
                      <div className="min-w-0">
                        <div className="font-medium text-[#1D1D1F] truncate">{t.name}</div>
                        <div className="text-[11px] text-[#86868B] truncate">{ROLE_LABELS[t.role] || t.role} · {t.days} ngày</div>
                      </div>
                      <div className="h-2.5 rounded-full bg-black/[0.04] overflow-hidden flex gap-[2px]" style={{ width: `${Math.max(4, (total / max) * 100)}%` }}>
                        {t.ins > 0 && <div className="bg-[#34C759]" style={{ flex: t.ins }} />}
                        {t.upd > 0 && <div className="bg-[#0071E3]" style={{ flex: t.upd }} />}
                        {t.del > 0 && <div className="bg-[#FF3B30]" style={{ flex: t.del }} />}
                      </div>
                      <div className="tabular-nums text-[#1D1D1F] font-medium w-14 text-right">{fmt(total)}</div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function compare(cur: number, prev: number): string {
  if (!prev) return cur ? 'Tháng trước: 0' : 'Chưa có số liệu';
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% so với tháng trước (${fmt(prev)})`;
}

function Kpi({ icon, tile, label, value, sub }: { icon: React.ReactNode; tile: keyof typeof ICON_TILE | 'pink'; label: string; value: string; sub?: string }) {
  const tileCls = tile === 'pink' ? 'bg-gradient-to-b from-[#FF6B8A] to-[#FF2D55]' : ICON_TILE[tile];
  return (
    <div className={`${CARD} p-3.5`}>
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-[8px] flex items-center justify-center text-white shrink-0 ${tileCls}`}>{icon}</span>
        <span className="text-[12px] text-[#6E6E73] leading-tight">{label}</span>
      </div>
      <div className="text-[26px] font-semibold text-[#1D1D1F] tabular-nums mt-2 leading-none">{value}</div>
      {sub && <div className="text-[11.5px] text-[#86868B] mt-1.5">{sub}</div>}
    </div>
  );
}

function BarRow({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr_auto] sm:grid-cols-[150px_1fr_auto] items-center gap-3 text-[12.5px]" title={`${label}: ${text}`}>
      <span className="text-[#1D1D1F] truncate">{label}</span>
      <div className="h-2.5 rounded-full bg-black/[0.04]">
        <div className="h-full rounded-full bg-[#0071E3]" style={{ width: `${value ? Math.max(2, (value / max) * 100) : 0}%` }} />
      </div>
      <span className="tabular-nums text-[#6E6E73] text-right whitespace-nowrap">{text}</span>
    </div>
  );
}

function MiniTrend({ title, months, series }: { title: string; months: { key: string; label: string }[]; series: Record<string, number> | null | undefined }) {
  const vals = months.map(m => series?.[m.key] ?? 0);
  const max = Math.max(1, ...vals);
  const cur = vals[vals.length - 1];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-[#6E6E73] truncate">{title}</span>
        <span className="text-[15px] font-semibold text-[#1D1D1F] tabular-nums">{series === undefined ? '…' : series === null ? '—' : fmt(cur)}</span>
      </div>
      <div className="flex items-end gap-[3px] h-16 mt-2 border-b border-black/[0.06]">
        {months.map((m, i) => (
          <div key={m.key} className="flex-1 h-full flex items-end group" title={`${m.label}: ${fmt(vals[i])}`}>
            <div className={`w-full rounded-t-[4px] group-hover:opacity-80 ${i === months.length - 1 ? 'bg-[#0071E3]' : 'bg-[#0071E3]/35'}`}
              style={{ height: `${vals[i] ? Math.max(4, (vals[i] / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] mt-1">
        {months.map(m => <span key={m.key} className="flex-1 text-center text-[10px] text-[#86868B]">{m.label}</span>)}
      </div>
    </div>
  );
}
