// Các khối nội dung của báo cáo lao động (bản in A4). Mỗi khối là 1 đơn vị KHÔNG bị cắt ngang khi dàn trang;
// bảng dài được chia sẵn thành nhiều khối (lặp lại dòng tiêu đề).
import type { ReactNode } from 'react';
import { type LaborReport, type LrGroupRow, fmtN, fmtPct, fmtShare, fmtSigned } from '../../lib/laborReport/model';
import {
  C, TrendLine, DeltaBars, MonthBars, BridgeChart, bridgeAxisMin, PairHBars, HBars, StackedColumns, MultiLine, ShareDonut, CoverageBars, Spark,
} from './ReportCharts';

export const CONTENT_W = 714;

export interface ReportBlock { id: string; node: ReactNode; breakBefore?: boolean; keepWithNext?: boolean }

export interface ReportSections {
  weekly: boolean; monthly: boolean; branches: boolean; areas: boolean; clients: boolean; quality: boolean; appendix: boolean;
}
export const SECTION_LABELS: { key: keyof ReportSections; label: string }[] = [
  { key: 'weekly', label: 'Xu hướng theo tuần' },
  { key: 'monthly', label: 'Xu hướng theo tháng + cầu biến động' },
  { key: 'branches', label: 'So sánh chi nhánh' },
  { key: 'areas', label: 'So sánh khu vực & KCN' },
  { key: 'clients', label: 'Biến động khách hàng & cam kết' },
  { key: 'quality', label: 'Chất lượng số liệu & phương pháp' },
  { key: 'appendix', label: 'Phụ lục: chi tiết từng khách hàng' },
];
export const ALL_SECTIONS: ReportSections = { weekly: true, monthly: true, branches: true, areas: true, clients: true, quality: true, appendix: true };

// ─── Mảnh dùng chung ─────────────────────────────────────────────────────────

const TH = 'text-left font-semibold text-[#52514e] bg-[#f6f5f2] px-2 py-[5px] border-b border-[#e1e0d9] whitespace-nowrap';
const TD = 'px-2 py-[3.5px] border-b border-[#efeee9] text-[#0b0b0b] whitespace-nowrap';
const R = ' text-right';

function Bold({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i} className="font-semibold text-[#0b0b0b]">{p}</b> : p))}</>;
}

function Delta({ d, p, size = 'sm' }: { d: number | null | undefined; p?: number | null; size?: 'sm' | 'xs' }) {
  if (d == null) return <span className="text-[#898781]">—</span>;
  if (d === 0) return <span className="text-[#898781]">0</span>;
  const up = d > 0;
  return (
    <span style={{ color: up ? C.up : C.down }} className={`font-medium ${size === 'xs' ? 'text-[9.5px]' : ''}`}>
      {up ? '▲' : '▼'} {fmtSigned(d)}{p != null ? <span className="font-normal"> ({fmtPct(p)})</span> : null}
    </span>
  );
}

function SectionTitle({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-end justify-between border-b-2 pb-1.5" style={{ borderColor: C.navy }}>
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-bold" style={{ color: C.blue }}>{String(n).padStart(2, '0')}</span>
        <span className="text-[16px] font-bold text-[#0b0b0b]">{title}</span>
      </div>
      {sub && <span className="text-[10.5px] text-[#898781]">{sub}</span>}
    </div>
  );
}

function Card({ title, note, legend, children }: { title: string; note?: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-[#e8e7e2] px-3 pt-2.5 pb-2 bg-white">
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-[11.5px] font-semibold text-[#0b0b0b]">{title}</span>
        {legend}
      </div>
      {children}
      {note && <div className="text-[9.5px] text-[#898781] mt-1">{note}</div>}
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string; hollow?: boolean }[] }) {
  return (
    <div className="flex flex-wrap justify-end gap-x-3 gap-y-0.5 text-[9.5px] text-[#52514e]">
      {items.map(it => (
        <span key={it.name} className="inline-flex items-center gap-1">
          <span style={{ width: 9, height: 9, borderRadius: 2, background: it.hollow ? '#fff' : it.color, border: it.hollow ? `1.5px solid ${it.color}` : undefined, display: 'inline-block' }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out.length ? out : [[]];
}

/** Nhóm lớn nhất giữ màu riêng (≤ 6), còn lại gộp "Khác" — màu đi theo nhóm, không theo thứ hạng tháng. */
function topSeries(rows: LrGroupRow[], pick: (g: LrGroupRow) => number[], n = 6) {
  const named = rows.filter(g => g.key !== '__none');
  const top = named.slice(0, n);
  const rest = [...named.slice(n), ...rows.filter(g => g.key === '__none')];
  const series = top.map((g, i) => ({ name: g.name, color: C.cat[i], data: pick(g) }));
  if (rest.length) {
    const len = pick(rows[0]).length;
    series.push({ name: rest.length === 1 ? rest[0].name : `Khác (${rest.length})`, color: C.other, data: Array.from({ length: len }, (_, i) => rest.reduce((s, g) => s + (pick(g)[i] ?? 0), 0)) });
  }
  return series;
}

/** Ô nhiệt: màu theo % thay đổi so với kỳ trước (xanh tăng / đỏ giảm / xám đi ngang). */
function heat(cur: number, prev: number | null): { bg: string; fg: string } {
  if (prev == null || prev === 0) return { bg: cur > 0 && prev === 0 ? '#86b6ef' : '#f6f5f2', fg: C.ink };
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return { bg: '#f0efec', fg: C.ink };
  if (p > 0) return p >= 8 ? { bg: '#3987e5', fg: '#fff' } : p >= 3 ? { bg: '#86b6ef', fg: C.ink } : { bg: '#cde2fb', fg: C.ink };
  return p <= -8 ? { bg: '#e34948', fg: '#fff' } : p <= -3 ? { bg: '#f3a3a2', fg: C.ink } : { bg: '#fbd9d8', fg: C.ink };
}

// ─── Bảng nhóm (chi nhánh / khu vực / KCN) ──────────────────────────────────

function GroupTable({ rows, label, r, startIndex = 0, total = true, cont = false }: { rows: LrGroupRow[]; label: string; r: LaborReport; startIndex?: number; total?: boolean; cont?: boolean }) {
  const maxShare = Math.max(...rows.map(g => g.share), 0.0001);
  const all = r.kpis.total ?? 0;
  const sum = (f: (g: LrGroupRow) => number) => rows.reduce((s, g) => s + f(g), 0);
  return (
    <table className="w-full border-collapse text-[10.5px] tabular-nums">
      <thead>
        <tr>
          <th className={TH + R} style={{ width: 22 }}>#</th>
          <th className={TH}>{label}{cont ? ' (tiếp)' : ''}</th>
          <th className={TH + R}>Tuần {r.anchor.label}</th>
          <th className={TH} style={{ width: 92 }}>Tỷ trọng</th>
          <th className={TH + R}>± tuần</th>
          <th className={TH + R}>{r.months[r.months.length - 2]?.short ?? '—'}</th>
          <th className={TH + R}>{r.months[r.months.length - 1]?.short}</th>
          <th className={TH + R}>± tháng</th>
          <th className={TH + R}>KH</th>
          <th className={TH}>{r.weeks.length} tuần</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g, i) => (
          <tr key={g.key}>
            <td className={TD + R + ' text-[#898781]'}>{startIndex + i + 1}</td>
            <td className={TD + ' max-w-[170px] truncate font-medium'}>{g.name}</td>
            <td className={TD + R + ' font-semibold'}>{fmtN(g.cur)}</td>
            <td className={TD}>
              <div className="flex items-center gap-1.5">
                <div style={{ width: 46, height: 6, background: '#efeee9', borderRadius: 3 }}>
                  <div style={{ width: `${(g.share / maxShare) * 100}%`, height: 6, background: C.blue, borderRadius: 3 }} />
                </div>
                <span className="text-[#52514e]">{fmtShare(g.share)}</span>
              </div>
            </td>
            <td className={TD + R}><Delta d={g.dWeek} /></td>
            <td className={TD + R + ' text-[#52514e]'}>{fmtN(g.prevMonth)}</td>
            <td className={TD + R}>{fmtN(g.curMonth)}</td>
            <td className={TD + R}><Delta d={g.dMonth} p={g.dMonthPct} /></td>
            <td className={TD + R + ' text-[#52514e]'}>{g.clients}</td>
            <td className={TD}><Spark values={g.weekly} /></td>
          </tr>
        ))}
        {total && (
          <tr className="font-semibold">
            <td className={TD} />
            <td className={TD}>Tổng</td>
            <td className={TD + R}>{fmtN(all)}</td>
            <td className={TD + ' text-[#52514e]'}>100%</td>
            <td className={TD + R}><Delta d={r.kpis.dWeek} /></td>
            <td className={TD + R}>{fmtN(sum(g => g.prevMonth))}</td>
            <td className={TD + R}>{fmtN(sum(g => g.curMonth))}</td>
            <td className={TD + R}><Delta d={sum(g => g.dMonth)} /></td>
            <td className={TD + R}>{sum(g => g.clients)}</td>
            <td className={TD} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function MatrixTable({ rows, label, heads, pick, note }: { rows: LrGroupRow[]; label: string; heads: string[]; pick: (g: LrGroupRow) => number[]; note?: string }) {
  const nameW = 150;
  return (
    <div>
      <table className="w-full border-collapse text-[10px] tabular-nums" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th className={TH} style={{ width: nameW }}>{label}</th>
            {heads.map(h => <th key={h} className={TH + R + ' px-1'}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(g => {
            const vals = pick(g);
            return (
              <tr key={g.key}>
                <td className={TD + ' truncate font-medium'}>{g.name}</td>
                {vals.map((v, i) => {
                  const h = heat(v, i > 0 ? vals[i - 1] : null);
                  return <td key={i} className="px-1 py-[3.5px] text-right border-b border-white" style={{ background: i > 0 ? h.bg : '#f6f5f2', color: i > 0 ? h.fg : C.ink }}>{fmtN(v)}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {note && (
        <div className="flex items-center gap-2 mt-1 text-[9.5px] text-[#898781]">
          <span>{note}</span>
          {[['#3987e5', '≥ +8%'], ['#86b6ef', '+3–8%'], ['#cde2fb', '+0,5–3%'], ['#f0efec', '≈ 0'], ['#fbd9d8', '−0,5–3%'], ['#f3a3a2', '−3–8%'], ['#e34948', '≤ −8%']].map(([c, t]) => (
            <span key={t} className="inline-flex items-center gap-1"><span style={{ width: 10, height: 8, background: c, display: 'inline-block', borderRadius: 2 }} />{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Lắp các khối ────────────────────────────────────────────────────────────

export function buildReportBlocks(r: LaborReport, s: ReportSections): ReportBlock[] {
  const k = r.kpis;
  const blocks: ReportBlock[] = [];
  const add = (b: ReportBlock) => blocks.push(b);
  const year = r.anchor.key.slice(0, 4);
  const prevM = r.months[r.months.length - 2];
  const curM = r.months[r.months.length - 1];
  const half = (CONTENT_W - 14) / 2;
  const hollowNote = 'Điểm rỗng / cột nhạt: dưới 50% khách hàng có số thật trong kỳ — tổng có dùng số gần nhất của KH chưa nhập.';
  let n = 1;

  // ── Trang bìa + tóm tắt ──
  add({
    id: 'cover',
    node: (
      <div className="rounded-[12px] px-5 py-4 flex items-center justify-between text-white" style={{ background: C.navy }}>
        <div className="min-w-0">
          <div className="text-[9.5px] tracking-[0.14em] uppercase opacity-70">Let's Go VN · Báo cáo nội bộ</div>
          <div className="text-[22px] font-bold leading-tight mt-1">Báo cáo tổng quan lao động</div>
          <div className="text-[11.5px] opacity-85 mt-1.5">{r.scopeLabel} · Tuần chốt {r.anchor.label} ({r.anchor.range}/{year}) · {r.anchorMonthLabel}</div>
        </div>
        <div className="text-right shrink-0 pl-4">
          <div className="text-[10px] opacity-75">Tổng lao động tuần chốt</div>
          <div className="text-[36px] font-bold leading-none mt-1">{fmtN(k.total)}</div>
          <div className="text-[10.5px] mt-1.5 opacity-90">
            {k.dWeek == null ? 'Chưa có tuần trước để so sánh' : k.dWeek === 0 ? 'Không đổi so với tuần trước' : `${k.dWeek > 0 ? '▲' : '▼'} ${fmtSigned(k.dWeek)} (${fmtPct(k.dWeekPct)}) so với tuần trước`}
          </div>
        </div>
      </div>
    ),
  });

  const tiles: { label: string; value: string; sub: ReactNode }[] = [
    { label: `Số chốt ${r.anchorMonthLabel.toLowerCase()}`, value: fmtN(k.curMonth), sub: r.prevMonthLabel ? <><Delta d={k.dMonth} p={k.dMonthPct} size="xs" /> so với {prevM?.short}</> : '—' },
    { label: 'So với 4 tuần trước', value: fmtSigned(k.d4Week), sub: <>{fmtPct(k.d4WeekPct)} · từ {fmtN(k.fourWeeksAgo)}</> },
    { label: `So với đầu kỳ (${r.months[0]?.short ?? '—'})`, value: fmtSigned(k.dFirstMonth), sub: <>{fmtPct(k.dFirstMonthPct)} · từ {fmtN(k.firstMonth)}</> },
    { label: 'Khách hàng có lao động', value: String(k.activeClients), sub: <>Bình quân {fmtN(k.avgPerClient)} LĐ/KH</> },
    { label: 'Chi nhánh / khu vực', value: `${k.branchCount} / ${k.areaCount}`, sub: 'đang có lao động' },
    { label: `Cao nhất ${r.weeks.length} tuần`, value: fmtN(k.peak?.value), sub: k.peak?.label ?? '—' },
    { label: 'Đạt cam kết tối thiểu', value: k.commitTotal ? `${k.commitMet}/${k.commitTotal}` : '—', sub: k.commitTotal ? (k.commitGap ? `Thiếu ${fmtN(k.commitGap)} LĐ` : 'Tất cả đều đạt') : 'Chưa khai báo mức cam kết' },
    { label: 'Độ phủ số liệu tuần chốt', value: `${k.actualClients}/${k.contributingClients}`, sub: <span style={{ color: k.coverage < 0.5 ? C.down : undefined }}>{fmtShare(k.coverage)} KH đã nhập số thật</span> },
  ];
  add({
    id: 'kpis',
    node: (
      <div className="grid grid-cols-4 gap-2">
        {tiles.map(t => (
          <div key={t.label} className="rounded-[10px] border border-[#e8e7e2] px-3 py-2.5 bg-white">
            <div className="text-[10px] text-[#898781] truncate">{t.label}</div>
            <div className="text-[19px] font-semibold text-[#0b0b0b] leading-tight mt-0.5">{t.value}</div>
            <div className="text-[9.5px] text-[#52514e] mt-0.5 truncate">{t.sub}</div>
          </div>
        ))}
      </div>
    ),
  });

  add({
    id: 'insights',
    node: (
      <div className="rounded-[10px] px-4 py-3" style={{ background: '#f4f8fd', border: '1px solid #dbe8f8' }}>
        <div className="text-[12px] font-semibold text-[#0b0b0b] mb-1.5">Nhận định chính</div>
        <ul className="space-y-1">
          {r.insights.map((t, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-[1.45] text-[#33322f]">
              <span style={{ color: C.blue }} className="font-bold">•</span><span><Bold text={t} /></span>
            </li>
          ))}
        </ul>
      </div>
    ),
  });

  add({
    id: 'overview-charts',
    node: (
      <div>
        <div className="grid grid-cols-2 gap-[14px]">
          <Card title={`Tổng lao động ${r.weeks.length} tuần`}><TrendLine periods={r.weeks} width={half - 26} height={180} /></Card>
          <Card title={`Số chốt theo tháng (${r.months.length} tháng)`}><MonthBars periods={r.months} width={half - 26} height={180} /></Card>
        </div>
        <div className="text-[9.5px] text-[#898781] mt-1">{hollowNote}</div>
      </div>
    ),
  });

  if (r.branches.length) {
    // Báo cáo 1 chi nhánh → ô bên trái chia theo KCN (1 thanh duy nhất thì vô nghĩa).
    const byKcn = r.branches.filter(b => b.cur > 0 && b.key !== '__none').length <= 1;
    const live = (byKcn ? r.kcns : r.branches).filter(b => b.cur > 0);
    const top = live.slice(0, 7);
    const donut = topSeries(r.areas, g => [g.cur], 5).map(x => ({ name: x.name, color: x.color, value: x.data[0] })).filter(x => x.value > 0);
    add({
      id: 'overview-split',
      node: (
        <div className="grid grid-cols-2 gap-[14px]">
          <Card title={`Theo ${byKcn ? 'KCN' : 'chi nhánh'} · tuần ${r.anchor.label}`} note={live.length > top.length ? `${top.length}/${live.length} ${byKcn ? 'KCN' : 'chi nhánh'} lớn nhất` : undefined}>
            <HBars rows={top.map(b => ({ name: b.name, value: b.cur }))} width={half - 26} rowH={20} />
          </Card>
          <Card title={`Theo khu vực · tuần ${r.anchor.label}`}>
            <div className="flex items-center gap-3">
              <ShareDonut size={132} rows={donut} centerValue={fmtN(k.total)} centerLabel="lao động" />
              <div className="flex-1 min-w-0 space-y-1">
                {donut.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5 text-[10.5px]">
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: d.color, display: 'inline-block', flexShrink: 0 }} />
                    <span className="truncate flex-1 text-[#33322f]">{d.name}</span>
                    <span className="font-semibold tabular-nums">{fmtN(d.value)}</span>
                    <span className="text-[#898781] tabular-nums w-[38px] text-right">{k.total ? fmtShare(d.value / k.total) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      ),
    });
  }

  // ── Theo tuần ──
  if (s.weekly) {
    n++;
    add({ id: 'w-title', breakBefore: true, keepWithNext: true, node: <SectionTitle n={n} title="Xu hướng theo tuần" sub={`${r.weeks.length} tuần · ${r.weeks[0].range} → ${r.anchor.range}/${year}`} /> });
    add({
      id: 'w-line', keepWithNext: true,
      node: <Card title="Tổng lao động mỗi tuần" note={hollowNote} legend={<Legend items={[{ name: 'Đủ số thật', color: C.blue }, { name: 'Có ước tính', color: C.blue, hollow: true }]} />}>
        <TrendLine periods={r.weeks} width={CONTENT_W - 26} height={230} labelAll={r.weeks.length <= 13} />
      </Card>,
    });
    add({
      id: 'w-delta',
      node: <Card title="Tăng / giảm so với tuần trước" legend={<Legend items={[{ name: 'Tăng', color: C.blue }, { name: 'Giảm', color: C.red }]} />}>
        <DeltaBars periods={r.weeks} width={CONTENT_W - 26} height={150} />
      </Card>,
    });
    const rows = r.weeks.map((w, i) => ({ w, prev: i > 0 ? r.weeks[i - 1].total : null }));
    chunk(rows, 20).forEach((part, ci) => add({
      id: `w-table-${ci}`,
      node: (
        <table className="w-full border-collapse text-[10.5px] tabular-nums">
          <thead><tr>
            <th className={TH}>Tuần{ci ? ' (tiếp)' : ''}</th><th className={TH}>Ngày làm việc</th><th className={TH + R}>Tổng LĐ</th>
            <th className={TH + R}>Tăng / giảm</th><th className={TH + R}>KH có số thật</th><th className={TH + R}>Độ phủ</th>
          </tr></thead>
          <tbody>
            {part.map(({ w, prev }) => {
              const d = w.total != null && prev != null ? w.total - prev : null;
              return (
                <tr key={w.key}>
                  <td className={TD + ' font-medium'}>{w.label}</td>
                  <td className={TD + ' text-[#52514e]'}>{w.range}</td>
                  <td className={TD + R + ' font-semibold'}>{fmtN(w.total)}</td>
                  <td className={TD + R}><Delta d={d} p={d != null && prev ? (d / prev) * 100 : null} /></td>
                  <td className={TD + R + ' text-[#52514e]'}>{w.actualClients}/{w.contributingClients}</td>
                  <td className={TD + R} style={{ color: w.coverage < 0.5 ? C.down : C.ink2 }}>{fmtShare(w.coverage)}{w.coverage < 0.5 ? ' ⚠' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ),
    }));
  }

  // ── Theo tháng ──
  if (s.monthly) {
    n++;
    add({ id: 'm-title', breakBefore: true, keepWithNext: true, node: <SectionTitle n={n} title="Xu hướng theo tháng" sub={`${r.months[0].range} → ${r.anchorMonthLabel}`} /> });
    add({
      id: 'm-bars',
      node: <Card title="Số lao động chốt tháng" note="Số chốt tháng = số của tuần muộn nhất có nhập trong tháng. Cột nhạt: dưới 50% KH có số thật trong tháng.">
        <MonthBars periods={r.months} width={CONTENT_W - 26} height={220} />
      </Card>,
    });
    add({
      id: 'm-table',
      node: (
        <table className="w-full border-collapse text-[10.5px] tabular-nums">
          <thead><tr>
            <th className={TH}>Tháng</th><th className={TH + R}>Tổng LĐ (chốt)</th><th className={TH + R}>Tăng / giảm</th>
            <th className={TH + R}>So với đầu kỳ</th><th className={TH + R}>KH có số thật</th><th className={TH + R}>Độ phủ</th>
          </tr></thead>
          <tbody>
            {r.months.map((m, i) => {
              const prev = i > 0 ? r.months[i - 1].total : null;
              const d = m.total != null && prev != null ? m.total - prev : null;
              const first = r.months[0].total;
              const df = m.total != null && first != null && i > 0 ? m.total - first : null;
              return (
                <tr key={m.key}>
                  <td className={TD + ' font-medium'}>{m.range}</td>
                  <td className={TD + R + ' font-semibold'}>{fmtN(m.total)}</td>
                  <td className={TD + R}><Delta d={d} p={d != null && prev ? (d / prev) * 100 : null} /></td>
                  <td className={TD + R}><Delta d={df} p={df != null && first ? (df / first) * 100 : null} /></td>
                  <td className={TD + R + ' text-[#52514e]'}>{m.actualClients}/{m.contributingClients}</td>
                  <td className={TD + R} style={{ color: m.coverage < 0.5 ? C.down : C.ink2 }}>{fmtShare(m.coverage)}{m.coverage < 0.5 ? ' ⚠' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ),
    });
    if (r.monthBridge && prevM && curM) {
      const b = r.monthBridge;
      const steps: { label: string; value: number; kind: 'total' | 'up' | 'down' }[] = [
        { label: prevM.short + ' (đầu kỳ)', value: b.start, kind: 'total' },
        { label: 'KH mới / chuyển đến', value: b.newClients, kind: 'up' },
        { label: 'KH hiện hữu tăng', value: b.increase, kind: 'up' },
        { label: 'KH hiện hữu giảm', value: b.decrease, kind: 'down' },
        { label: 'KH về 0 / ngưng', value: b.lost, kind: 'down' },
        { label: curM.short + ' (cuối kỳ)', value: b.end, kind: 'total' },
      ];
      add({
        id: 'm-bridge',
        node: (
          <Card title={`Cầu biến động lao động: ${prevM.range} → ${curM.range}`}
            legend={<Legend items={[{ name: 'Tổng đầu/cuối kỳ', color: C.neutral }, { name: 'Tăng', color: C.blue }, { name: 'Giảm', color: C.red }]} />}
            note={`Trục đứng bắt đầu từ ${fmtN(bridgeAxisMin(steps))} để thấy rõ phần tăng/giảm. KH mới/chuyển đến = tháng trước 0 hoặc chưa có số. KH về 0/ngưng = tháng trước có số, tháng này 0 hoặc đã ngưng hợp tác.`}>
            <BridgeChart width={CONTENT_W - 26} height={200} steps={steps} />
            {(b.newList.length > 0 || b.lostList.length > 0) && (
              <div className="grid grid-cols-2 gap-3 mt-1.5 text-[10px] text-[#33322f]">
                <div><span className="font-semibold" style={{ color: C.up }}>KH mới / chuyển đến ({b.newList.length}): </span>{b.newList.length ? b.newList.slice(0, 12).map(x => `${x.name} (${fmtN(x.value)})`).join(', ') + (b.newList.length > 12 ? '…' : '') : '—'}</div>
                <div><span className="font-semibold" style={{ color: C.down }}>KH về 0 / ngưng ({b.lostList.length}): </span>{b.lostList.length ? b.lostList.slice(0, 12).map(x => `${x.name} (${fmtN(x.value)})`).join(', ') + (b.lostList.length > 12 ? '…' : '') : '—'}</div>
              </div>
            )}
          </Card>
        ),
      });
    }
  }

  // ── Chi nhánh ──
  if (s.branches && r.branches.length) {
    n++;
    const brs = r.branches;
    add({ id: 'b-title', breakBefore: true, keepWithNext: true, node: <SectionTitle n={n} title="So sánh chi nhánh" sub={`${k.branchCount} chi nhánh có lao động · tuần ${r.anchor.label}`} /> });
    const pairRows = brs.filter(b => b.prevMonth > 0 || b.curMonth > 0);
    add({
      id: 'b-pair',
      node: <Card title={`Số chốt tháng theo chi nhánh: ${prevM?.short ?? ''} so với ${curM.short}`} legend={<Legend items={[{ name: prevM?.range ?? 'Tháng trước', color: C.prev }, { name: curM.range, color: C.blue }]} />}>
        <PairHBars rows={pairRows.map(b => ({ name: b.name, prev: b.prevMonth, cur: b.curMonth }))} width={CONTENT_W - 26} prevLabel={prevM?.range ?? ''} curLabel={curM.range} />
      </Card>,
    });
    chunk(brs, 22).forEach((part, ci, all) => add({
      id: `b-table-${ci}`,
      node: <GroupTable rows={part} label="Chi nhánh" r={r} startIndex={ci * 22} total={ci === all.length - 1} cont={ci > 0} />,
    }));
    const series = topSeries(brs, g => g.monthly);
    add({
      id: 'b-stack',
      node: <Card title="Cơ cấu lao động theo chi nhánh qua các tháng" legend={<Legend items={series.map(x => ({ name: x.name, color: x.color }))} />}>
        <StackedColumns labels={r.months.map(m => m.short)} series={series} width={CONTENT_W - 26} height={230} />
      </Card>,
    });
    const last8 = r.weeks.slice(-8);
    add({
      id: 'b-heat-weeks',
      node: <Card title="Chi nhánh × 8 tuần gần nhất (màu theo % thay đổi so với tuần trước)">
        <MatrixTable rows={brs} label="Chi nhánh" heads={last8.map(w => w.short)} pick={g => g.weekly.slice(-8)} note="Màu:" />
      </Card>,
    });
    add({
      id: 'b-heat-months',
      node: <Card title="Chi nhánh × tháng (số chốt tháng, màu theo % thay đổi so với tháng trước)">
        <MatrixTable rows={brs} label="Chi nhánh" heads={r.months.map(m => m.short)} pick={g => g.monthly} />
      </Card>,
    });
  }

  // ── Khu vực & KCN ──
  if (s.areas && r.areas.length) {
    n++;
    const areas = r.areas;
    add({ id: 'a-title', breakBefore: true, keepWithNext: true, node: <SectionTitle n={n} title="So sánh khu vực & KCN" sub="Khu vực = tỉnh/thành của KCN chính (chưa có thì theo chi nhánh)" /> });
    const donutRows = topSeries(areas, g => [g.cur], 5).map(x => ({ name: x.name, color: x.color, value: x.data[0] }));
    add({
      id: 'a-donut',
      node: (
        <Card title={`Tỷ trọng lao động theo khu vực · tuần ${r.anchor.label}`}>
          <div className="flex items-center gap-5">
            <ShareDonut size={200} rows={donutRows} centerValue={fmtN(k.total)} centerLabel="lao động" />
            <table className="flex-1 border-collapse text-[10.5px] tabular-nums">
              <thead><tr><th className={TH}>Khu vực</th><th className={TH + R}>Lao động</th><th className={TH + R}>Tỷ trọng</th><th className={TH + R}>± tháng</th><th className={TH + R}>KH</th></tr></thead>
              <tbody>
                {areas.map(a => {
                  const color = donutRows.find(d => d.name === a.name)?.color ?? C.other;
                  return (
                    <tr key={a.key}>
                      <td className={TD + ' font-medium'}><span className="inline-flex items-center gap-1.5"><span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block' }} />{a.name}</span></td>
                      <td className={TD + R + ' font-semibold'}>{fmtN(a.cur)}</td>
                      <td className={TD + R + ' text-[#52514e]'}>{fmtShare(a.share)}</td>
                      <td className={TD + R}><Delta d={a.dMonth} p={a.dMonthPct} /></td>
                      <td className={TD + R + ' text-[#52514e]'}>{a.clients}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ),
    });
    const aSeries = topSeries(areas, g => g.monthly, 5);
    add({
      id: 'a-lines',
      node: <Card title="Lao động theo khu vực qua các tháng (số chốt tháng)" legend={<Legend items={aSeries.map(x => ({ name: x.name, color: x.color }))} />}>
        <MultiLine labels={r.months.map(m => m.short)} series={aSeries} width={CONTENT_W - 26} height={210} />
      </Card>,
    });
    add({ id: 'a-table', node: <GroupTable rows={areas} label="Khu vực" r={r} /> });
    add({
      id: 'a-heat',
      node: <Card title="Khu vực × tháng (màu theo % thay đổi so với tháng trước)">
        <MatrixTable rows={areas} label="Khu vực" heads={r.months.map(m => m.short)} pick={g => g.monthly} />
      </Card>,
    });
    const kcns = r.kcns.filter(x => x.cur > 0 || x.curMonth > 0 || x.prevMonth > 0);
    if (kcns.length) {
      add({
        id: 'k-bars', keepWithNext: true,
        node: <Card title={`Top ${Math.min(12, kcns.length)} KCN theo lao động · tuần ${r.anchor.label}`} note={`KCN của khách hàng = KCN đầu tiên trong hồ sơ (KCN chính). ${kcns.length} KCN có lao động.`}>
          <HBars rows={kcns.slice(0, 12).map(x => ({ name: x.name, value: x.cur }))} width={CONTENT_W - 26} rowH={22} />
        </Card>,
      });
      chunk(kcns, 24).forEach((part, ci, all) => add({
        id: `k-table-${ci}`,
        node: <GroupTable rows={part} label="KCN" r={r} startIndex={ci * 24} total={ci === all.length - 1} cont={ci > 0} />,
      }));
    }
  }

  // ── Khách hàng ──
  if (s.clients) {
    n++;
    add({ id: 'c-title', breakBefore: true, keepWithNext: true, node: <SectionTitle n={n} title="Biến động khách hàng" sub={`${prevM?.range ?? ''} → ${curM.range}`} /> });
    const withD = r.clients.filter(c => c.dMonth != null && c.dMonth !== 0);
    const ups = [...withD].sort((a, b) => b.dMonth! - a.dMonth!).filter(c => c.dMonth! > 0).slice(0, 10);
    const downs = [...withD].sort((a, b) => a.dMonth! - b.dMonth!).filter(c => c.dMonth! < 0).slice(0, 10);
    const movers = [...ups.slice(0, 8), ...downs.slice(0, 8).reverse()];
    if (movers.length) {
      add({
        id: 'c-movers',
        node: <Card title="Khách hàng tăng / giảm nhiều nhất trong tháng" legend={<Legend items={[{ name: 'Tăng', color: C.blue }, { name: 'Giảm', color: C.red }]} />}>
          <HBars diverging rows={movers.map(c => ({ name: c.name, value: c.dMonth! }))} width={CONTENT_W - 26} rowH={21} />
        </Card>,
      });
    } else {
      add({ id: 'c-none', node: <div className="text-[11px] text-[#52514e] py-2">Không có khách hàng nào thay đổi số lao động giữa {prevM?.range?.toLowerCase()} và {curM.range.toLowerCase()}.</div> });
    }
    const moverTable = (id: string, title: string, list: typeof ups) => {
      if (!list.length) return;
      add({
      id,
      node: (
        <div>
          <div className="text-[11.5px] font-semibold text-[#0b0b0b] mb-1">{title}</div>
          <table className="w-full border-collapse text-[10.5px] tabular-nums">
            <thead><tr>
              <th className={TH}>Khách hàng</th><th className={TH}>Chi nhánh</th><th className={TH}>KCN</th>
              <th className={TH + R}>{prevM?.short}</th><th className={TH + R}>{curM.short}</th><th className={TH + R}>Tăng / giảm</th>
            </tr></thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id}>
                  <td className={TD + ' max-w-[170px] truncate font-medium'}>{c.name}</td>
                  <td className={TD + ' max-w-[150px] truncate text-[#52514e]'}>{c.branch}</td>
                  <td className={TD + ' max-w-[130px] truncate text-[#52514e]'}>{c.kcn}</td>
                  <td className={TD + R + ' text-[#52514e]'}>{fmtN(c.prevMonth)}</td>
                  <td className={TD + R}>{fmtN(c.curMonth)}</td>
                  <td className={TD + R}><Delta d={c.dMonth} p={c.prevMonth ? (c.dMonth! / c.prevMonth) * 100 : null} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
      });
    };
    moverTable('c-up', `Top ${ups.length} khách hàng tăng`, ups);
    moverTable('c-down', `Top ${downs.length} khách hàng giảm`, downs);
    if (r.commitShortfall.length) {
      chunk(r.commitShortfall, 30).forEach((part, ci) => add({
        id: `c-commit-${ci}`,
        node: (
          <div>
            <div className="text-[11.5px] font-semibold text-[#0b0b0b] mb-1">Khách hàng dưới mức cam kết tối thiểu{ci ? ' (tiếp)' : ` (${r.commitShortfall.length} KH · thiếu ${fmtN(k.commitGap)} LĐ)`}</div>
            <table className="w-full border-collapse text-[10.5px] tabular-nums">
              <thead><tr><th className={TH}>Khách hàng</th><th className={TH}>Chi nhánh</th><th className={TH + R}>Hiện có</th><th className={TH + R}>Cam kết</th><th className={TH + R}>Thiếu</th><th className={TH}>Mức đạt</th></tr></thead>
              <tbody>
                {part.map(c => (
                  <tr key={c.name + c.branch}>
                    <td className={TD + ' max-w-[190px] truncate font-medium'}>{c.name}</td>
                    <td className={TD + ' max-w-[160px] truncate text-[#52514e]'}>{c.branch}</td>
                    <td className={TD + R}>{fmtN(c.cur)}</td>
                    <td className={TD + R + ' text-[#52514e]'}>{fmtN(c.min)}</td>
                    <td className={TD + R + ' font-semibold'} style={{ color: C.down }}>{fmtN(c.gap)}</td>
                    <td className={TD}>
                      <div style={{ width: 80, height: 6, background: '#efeee9', borderRadius: 3 }}>
                        <div style={{ width: `${Math.min(100, (c.cur / c.min) * 100)}%`, height: 6, background: C.blue, borderRadius: 3 }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      }));
    }
  }

  // ── Chất lượng số liệu & phương pháp ──
  if (s.quality) {
    n++;
    add({ id: 'q-title', breakBefore: true, keepWithNext: true, node: <SectionTitle n={n} title="Chất lượng số liệu & phương pháp" sub="Đọc trước khi kết luận xu hướng" /> });
    add({
      id: 'q-coverage',
      node: <Card title="Tỷ lệ khách hàng có số thật theo tuần" note="Tuần dưới 50%: phần lớn tổng là số gần nhất của KH chưa nhập — xu hướng của tuần đó chỉ mang tính ước tính.">
        <CoverageBars periods={r.weeks} width={CONTENT_W - 26} height={150} />
      </Card>,
    });
    if (r.stale.length) {
      chunk(r.stale, 30).forEach((part, ci) => add({
        id: `q-stale-${ci}`,
        node: (
          <div>
            <div className="text-[11.5px] font-semibold text-[#0b0b0b] mb-1">Khách hàng chưa cập nhật số từ 2 tuần trở lên{ci ? ' (tiếp)' : ` (${r.stale.length})`}</div>
            <table className="w-full border-collapse text-[10.5px] tabular-nums">
              <thead><tr><th className={TH}>Khách hàng</th><th className={TH}>Chi nhánh</th><th className={TH}>Nhập gần nhất</th><th className={TH + R}>Số tuần chưa cập nhật</th><th className={TH + R}>Số đang dùng</th></tr></thead>
              <tbody>
                {part.map(x => (
                  <tr key={x.name + x.branch}>
                    <td className={TD + ' max-w-[190px] truncate font-medium'}>{x.name}</td>
                    <td className={TD + ' max-w-[160px] truncate text-[#52514e]'}>{x.branch}</td>
                    <td className={TD + ' text-[#52514e]'}>{x.lastLabel}</td>
                    <td className={TD + R + ' font-semibold'} style={{ color: x.weeks >= 4 ? C.down : C.ink }}>{x.weeks}</td>
                    <td className={TD + R}>{fmtN(x.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      }));
    }
    add({
      id: 'q-notes',
      node: (
        <div className="rounded-[10px] border border-[#e8e7e2] px-4 py-3 bg-[#fbfbfa]">
          <div className="text-[11.5px] font-semibold text-[#0b0b0b] mb-1">Phương pháp tính</div>
          <ul className="space-y-1">
            {r.notes.map((t, i) => <li key={i} className="flex gap-2 text-[10px] leading-[1.45] text-[#52514e]"><span>•</span><span>{t}</span></li>)}
          </ul>
        </div>
      ),
    });
  }

  // ── Phụ lục: từng khách hàng, nhóm theo chi nhánh ──
  if (s.appendix && r.clients.length) {
    n++;
    const shown = r.months.slice(-6);
    const offset = r.months.length - shown.length;
    add({ id: 'x-title', breakBefore: true, keepWithNext: true, node: <SectionTitle n={n} title="Phụ lục — chi tiết khách hàng" sub={`Nhóm theo chi nhánh · ${shown.length} tháng gần nhất · * = số gần nhất (chưa nhập tuần chốt)`} /> });
    type Row = { kind: 'group'; name: string; total: number; count: number } | { kind: 'client'; c: LaborReport['clients'][number] };
    // Chỉ liệt kê KH có số trong các tháng hiển thị (KH đã về 0 từ lâu xem ở bản Markdown đầy đủ).
    const listed = r.clients.filter(c => (c.cur ?? 0) > 0 || c.monthly.slice(offset).some(v => (v ?? 0) > 0));
    const rows: Row[] = [];
    let curBranch = '';
    for (const c of listed) {
      if (c.branch !== curBranch) {
        curBranch = c.branch;
        const members = listed.filter(x => x.branch === c.branch);
        rows.push({ kind: 'group', name: c.branch, total: members.reduce((s2, x) => s2 + (x.cur ?? 0), 0), count: members.length });
      }
      rows.push({ kind: 'client', c });
    }
    // Chia trang: dòng tiêu đề chi nhánh không được đứng cuối 1 phần (sẽ tách khỏi KH của nó).
    const parts: Row[][] = [];
    for (let i = 0; i < rows.length;) {
      let end = Math.min(rows.length, i + 36);
      if (end < rows.length && rows[end - 1].kind === 'group') end--;
      parts.push(rows.slice(i, end));
      i = end;
    }
    parts.forEach((part, ci) => add({
      id: `x-table-${ci}`,
      node: (
        <table className="w-full border-collapse text-[10px] tabular-nums" style={{ tableLayout: 'fixed' }}>
          <thead><tr>
            <th className={TH} style={{ width: 180 }}>Khách hàng{ci ? ' (tiếp)' : ''}</th>
            <th className={TH} style={{ width: 120 }}>KCN</th>
            {shown.map(m => <th key={m.key} className={TH + R + ' px-1'}>{m.short}</th>)}
            <th className={TH + R + ' px-1'} style={{ width: 62 }}>{r.anchor.short}</th>
            <th className={TH + R + ' px-1'} style={{ width: 62 }}>± tháng</th>
          </tr></thead>
          <tbody>
            {part.map((row, i) => row.kind === 'group' ? (
              <tr key={`g${i}`}>
                <td colSpan={4 + shown.length} className="px-2 pt-2 pb-1 text-[10.5px] font-semibold border-b border-[#e1e0d9]" style={{ color: C.navy }}>
                  {row.name} <span className="font-normal text-[#898781]">· {row.count} KH · {fmtN(row.total)} LĐ tuần chốt</span>
                </td>
              </tr>
            ) : (
              <tr key={row.c.id}>
                <td className={TD + ' truncate font-medium pl-4'}>{row.c.name}</td>
                <td className={TD + ' truncate text-[#52514e]'}>{row.c.kcn}</td>
                {row.c.monthly.slice(offset).map((v, j) => <td key={j} className={TD + R + ' px-1 text-[#52514e]'}>{fmtN(v)}</td>)}
                <td className={TD + R + ' px-1 font-semibold'}>{fmtN(row.c.cur)}{row.c.curEstimated ? '*' : ''}</td>
                <td className={TD + R + ' px-1'}><Delta d={row.c.dMonth} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    }));
  }

  return blocks;
}
