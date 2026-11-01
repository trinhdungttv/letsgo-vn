// Biểu đồ cho báo cáo lao động (bản in A4). Kích thước cố định (px) để dàn trang chính xác;
// tắt hiệu ứng, vẽ nét cao (devicePixelRatio 2) để ảnh chụp PDF không bị mờ.
// Quy ước màu: 1 trục duy nhất, tăng = xanh dương / giảm = đỏ (cặp phân kỳ), nhãn số dùng màu chữ, không dùng màu dữ liệu.
import { createContext, useContext } from 'react';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Filler,
  type Plugin, type ChartOptions, type ChartType,
} from 'chart.js';
import type { LrPeriod } from '../../lib/laborReport/model';
import { fmtN, fmtSigned } from '../../lib/laborReport/model';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Filler);

export const C = {
  ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', paper: '#ffffff',
  blue: '#2a78d6', blueLight: '#9ec5f4', blueWash: 'rgba(42,120,214,0.10)', red: '#e34948', redLight: '#f3b1b0',
  prev: '#c9c7c0', neutral: '#9a9893', other: '#b4b2ab',
  up: '#006300', down: '#d03b3b', navy: '#0c2340',
  // Bảng màu phân loại — dùng theo ĐÚNG thứ tự, không xoay vòng (quá 6 nhóm → gộp "Khác").
  cat: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
};
export const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const DPR = 2;

/** Đang ở bước ĐO dàn trang → vẽ khung rỗng cùng kích thước thay cho biểu đồ (đỡ tốn công). */
export const MeasureContext = createContext(false);

function Box({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const measuring = useContext(MeasureContext);
  return <div style={{ width, height }}>{measuring ? null : children}</div>;
}

// ─── Trục & nhãn ─────────────────────────────────────────────────────────────

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
/** Khung trục đứng "tròn số": bước chia đẹp, gần `ticks` vạch. zero=true thì luôn bắt đầu từ 0 (cột). */
export function niceScale(vals: number[], { zero = false, ticks = 5 } = {}): { min: number; max: number; step: number } {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return { min: 0, max: 10, step: 2 };
  let lo = Math.min(...v), hi = Math.max(...v);
  if (zero) lo = Math.min(0, lo);
  if (hi === lo) hi = lo + Math.max(10, Math.abs(lo) * 0.1);
  const pad = zero ? 0 : (hi - lo) * 0.18;
  const step = NICE.find(s => s >= (hi - lo + pad * 2) / ticks) ?? 20000;
  const min = zero ? Math.floor(lo / step) * step : Math.max(0, Math.floor((lo - pad) / step) * step);
  return { min, max: Math.ceil((hi + (zero ? (hi - lo) * 0.12 : pad)) / step) * step, step };
}

// Số lao động thường < 10.000 → ghi đủ (1.850) cho rõ; chỉ rút gọn K khi lớn hơn.
const compact = (v: number) => (Math.abs(v) >= 10000 ? `${(v / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}K` : v.toLocaleString('vi-VN'));

interface LabelSpec {
  dataset: number;
  indices?: number[];                 // bỏ trống = mọi điểm
  format: (v: number, i: number) => string;
  bold?: boolean;
  size?: number;
}
/** Nhãn số trực tiếp: đầu cột / đầu thanh ngang / trên điểm của đường. */
const labelsPlugin = <T extends ChartType>(): Plugin<T> => ({
  id: 'lrLabels',
  afterDatasetsDraw(chart, _args, options) {
    const specs = (options as { specs?: LabelSpec[] }).specs ?? [];
    const { ctx } = chart;
    const horizontal = chart.options?.indexAxis === 'y';
    ctx.save();
    for (const spec of specs) {
      const meta = chart.getDatasetMeta(spec.dataset);
      const data = chart.data.datasets[spec.dataset]?.data ?? [];
      meta.data.forEach((el, i) => {
        if (spec.indices && !spec.indices.includes(i)) return;
        const raw = data[i] as number | [number, number] | null | undefined;
        if (raw == null) return;
        const v = Array.isArray(raw) ? raw[1] - raw[0] : raw;
        const text = spec.format(v, i);
        if (!text) return;
        const p = el as unknown as { x: number; y: number; base?: number };
        ctx.font = `${spec.bold ? 600 : 500} ${spec.size ?? 10}px ${FONT}`;
        ctx.fillStyle = spec.bold ? C.ink : C.ink2;
        if (meta.type === 'line') {
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(text, p.x, p.y - 7);
        } else if (horizontal) {
          const base = p.base ?? p.x;
          const right = Math.max(p.x, base), left = Math.min(p.x, base);
          ctx.textBaseline = 'middle';
          if (v >= 0) { ctx.textAlign = 'left'; ctx.fillText(text, right + 4, p.y); }
          else { ctx.textAlign = 'right'; ctx.fillText(text, left - 4, p.y); }
        } else {
          const base = p.base ?? p.y;
          const top = Math.min(p.y, base), bottom = Math.max(p.y, base);
          ctx.textAlign = 'center';
          if (v >= 0 || Array.isArray(raw)) { ctx.textBaseline = 'bottom'; ctx.fillText(text, p.x, top - 3); }
          else { ctx.textBaseline = 'top'; ctx.fillText(text, p.x, bottom + 3); }
        }
      });
    }
    ctx.restore();
  },
});

/** Đường tham chiếu ngang (vd mức 50% độ phủ). */
const refLinePlugin = <T extends ChartType>(): Plugin<T> => ({
  id: 'lrRefLine',
  afterDatasetsDraw(chart, _args, options) {
    const o = options as { value?: number; label?: string };
    if (o.value == null) return;
    const y = chart.scales.y.getPixelForValue(o.value);
    const { left, right } = chart.chartArea;
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = C.ink2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    if (o.label) {
      ctx.font = `500 9.5px ${FONT}`; ctx.fillStyle = C.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(o.label, right, y - 2);
    }
    ctx.restore();
  },
});

const tickFont = { size: 10, family: FONT };

/** Trục nhãn quá chật (vd 13 tuần trong khung nửa trang) → tự bỏ bớt nhãn, không để chữ chồng nhau. */
const crowded = (count: number, width: number, per = 46) => count * per > width;

function axes(o: { min?: number; max?: number; step?: number; horizontal?: boolean; stacked?: boolean; pct?: boolean; hideValueAxis?: boolean; skipTo?: number }) {
  const valueAxis = {
    min: o.min, max: o.max, stacked: o.stacked,
    display: !o.hideValueAxis,
    grid: { color: C.grid, lineWidth: 1, drawTicks: false },
    border: { display: false },
    ticks: { color: C.muted, font: tickFont, padding: 6, stepSize: o.step, callback: (v: string | number) => (o.pct ? `${v}%` : compact(Number(v))) },
  };
  const catAxis = {
    stacked: o.stacked,
    grid: { display: false },
    border: { color: C.axis },
    ticks: { color: o.horizontal ? C.ink2 : C.muted, font: { ...tickFont, size: o.horizontal ? 10.5 : 10 }, autoSkip: !!o.skipTo, maxTicksLimit: o.skipTo, maxRotation: 0, padding: 4 },
  };
  return o.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis };
}

function baseOptions(extra: { padding?: { top?: number; right?: number; left?: number; bottom?: number }; labels?: LabelSpec[]; refLine?: { value: number; label: string } }) {
  return {
    responsive: false, maintainAspectRatio: false, animation: false as const, devicePixelRatio: DPR,
    layout: { padding: { top: 18, right: 16, left: 0, bottom: 0, ...extra.padding } },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true, backgroundColor: '#1f1f1e', titleFont: { family: FONT, size: 11 }, bodyFont: { family: FONT, size: 11 }, padding: 8, cornerRadius: 6, displayColors: false },
      lrLabels: { specs: extra.labels ?? [] },
      lrRefLine: extra.refLine ?? {},
    },
  };
}

const BAR = { borderRadius: 4, borderSkipped: 'start' as const, maxBarThickness: 24 };

// ─── 1. Xu hướng tổng theo tuần (đường) ─────────────────────────────────────

export function TrendLine({ periods, width, height, labelAll = false }: { periods: LrPeriod[]; width: number; height: number; labelAll?: boolean }) {
  const vals = periods.map(p => p.total);
  const nums = vals.filter((v): v is number => v != null);
  const sc = niceScale(nums);
  const idx = (pred: (v: number) => boolean) => vals.findIndex(v => v != null && pred(v));
  const max = nums.length ? Math.max(...nums) : 0, min = nums.length ? Math.min(...nums) : 0;
  const marks = labelAll ? undefined : [...new Set([vals.length - 1, idx(v => v === max), idx(v => v === min)].filter(i => i >= 0))];
  const options = {
    ...baseOptions({ labels: [{ dataset: 0, indices: marks, format: (v: number) => fmtN(v), bold: true }], padding: { right: 18, top: 22 } }),
    scales: axes({ min: sc.min, max: sc.max, step: sc.step, skipTo: crowded(periods.length, width) ? Math.floor(width / 50) : undefined }),
  } as ChartOptions<'line'>;
  return (
    <Box width={width} height={height}>
      <Line width={width} height={height} options={options} plugins={[labelsPlugin<'line'>()]}
        data={{
          labels: periods.map(p => p.short),
          datasets: [{
            data: vals, borderColor: C.blue, borderWidth: 2, backgroundColor: C.blueWash, fill: 'start', tension: 0.25,
            pointRadius: 4, pointHoverRadius: 5, pointBorderWidth: 2,
            // Điểm có < 50% KH nhập số thật → vẽ rỗng (ước tính).
            pointBackgroundColor: periods.map(p => (p.coverage < 0.5 ? C.paper : C.blue)),
            pointBorderColor: C.blue, spanGaps: false,
          }],
        }} />
    </Box>
  );
}

// ─── 2. Tăng / giảm từng kỳ (cột phân kỳ) ───────────────────────────────────

export function DeltaBars({ periods, width, height }: { periods: LrPeriod[]; width: number; height: number }) {
  const deltas = periods.map((p, i) => (i > 0 && p.total != null && periods[i - 1].total != null ? p.total - periods[i - 1].total! : null));
  const sc = niceScale(deltas.filter((v): v is number => v != null).concat(0), { zero: true, ticks: 4 });
  const tight = crowded(periods.length, width);
  const nums = deltas.map(d => d ?? 0);
  const keys = tight ? [nums.indexOf(Math.max(...nums)), nums.indexOf(Math.min(...nums)), nums.length - 1] : undefined;
  const options = {
    ...baseOptions({ labels: [{ dataset: 0, indices: keys, format: (v: number) => (v ? fmtSigned(v) : '') }], padding: { top: 16, bottom: 4 } }),
    scales: axes({ min: sc.min < 0 ? sc.min - sc.step : sc.min, max: sc.max, step: sc.step, skipTo: tight ? Math.floor(width / 50) : undefined }),
  } as ChartOptions<'bar'>;
  return (
    <Box width={width} height={height}>
      <Bar width={width} height={height} options={options} plugins={[labelsPlugin<'bar'>()]}
        data={{
          labels: periods.map(p => p.short),
          datasets: [{ data: deltas, backgroundColor: deltas.map(d => ((d ?? 0) >= 0 ? C.blue : C.red)), ...BAR }],
        }} />
    </Box>
  );
}

// ─── 3. Số chốt tháng (cột) ─────────────────────────────────────────────────

export function MonthBars({ periods, width, height }: { periods: LrPeriod[]; width: number; height: number }) {
  const vals = periods.map(p => p.total ?? 0);
  const sc = niceScale(vals, { zero: true });
  // Khung hẹp: chỉ ghi số ở tháng cuối + cao nhất + thấp nhất (ghi hết sẽ dính chữ).
  const keys = crowded(periods.length, width, 52)
    ? [...new Set([vals.length - 1, vals.indexOf(Math.max(...vals)), vals.indexOf(Math.min(...vals))])]
    : undefined;
  const options = {
    ...baseOptions({ labels: [{ dataset: 0, indices: keys, format: (v: number) => fmtN(v), bold: true }] }),
    scales: axes({ min: 0, max: sc.max, step: sc.step }),
  } as ChartOptions<'bar'>;
  return (
    <Box width={width} height={height}>
      <Bar width={width} height={height} options={options} plugins={[labelsPlugin<'bar'>()]}
        data={{
          labels: periods.map(p => p.short),
          datasets: [{
            data: vals, ...BAR,
            // Cột nhạt = tháng có < 50% KH nhập số thật (có dùng số gần nhất).
            backgroundColor: periods.map(p => (p.coverage < 0.5 ? C.blueLight : C.blue)),
          }],
        }} />
    </Box>
  );
}

// ─── 4. Cầu biến động (thác nước) ───────────────────────────────────────────

/** Mức chân trục của biểu đồ cầu biến động (để ghi chú "trục bắt đầu từ …"). */
export function bridgeAxisMin(steps: { value: number; kind: 'total' | 'up' | 'down' }[]): number {
  let run = 0;
  const moving: number[] = [];
  for (const s of steps) {
    if (s.kind === 'total') { run = s.value; moving.push(run); continue; }
    moving.push(run);
    run = s.kind === 'up' ? run + s.value : run - s.value;
    moving.push(run);
  }
  return niceScale(moving, { ticks: 4 }).min;
}

export function BridgeChart({ steps, width, height }: { steps: { label: string; value: number; kind: 'total' | 'up' | 'down' }[]; width: number; height: number }) {
  let run = 0;
  const bars: [number, number][] = steps.map(s => {
    if (s.kind === 'total') { run = s.value; return [0, s.value]; }
    const from = run;
    run = s.kind === 'up' ? run + s.value : run - s.value;
    return [Math.min(from, run), Math.max(from, run)];
  });
  // Trục đứng KHÔNG bắt đầu từ 0: biến động thường chỉ vài % của tổng, từ 0 thì các khoản tăng/giảm gần như vô hình.
  // Cột tổng đầu/cuối kỳ bị cắt ở chân trục — khối ghi chú dưới biểu đồ nói rõ điều này.
  const moving = bars.flatMap((b, i) => (steps[i].kind === 'total' ? [b[1]] : b));
  const sc = niceScale(moving, { ticks: 4 });
  const options = {
    ...baseOptions({
      labels: [{ dataset: 0, bold: true, format: (_v: number, i: number) => (steps[i].kind === 'total' ? fmtN(steps[i].value) : steps[i].value ? fmtSigned(steps[i].kind === 'up' ? steps[i].value : -steps[i].value) : '0') }],
    }),
    scales: axes({ min: sc.min, max: sc.max, step: sc.step }),
  } as ChartOptions<'bar'>;
  return (
    <Box width={width} height={height}>
      <Bar width={width} height={height} options={options} plugins={[labelsPlugin<'bar'>()]}
        data={{
          labels: steps.map(s => s.label),
          datasets: [{ data: bars, ...BAR, borderSkipped: false, maxBarThickness: 46, backgroundColor: steps.map(s => (s.kind === 'total' ? C.neutral : s.kind === 'up' ? C.blue : C.red)) }],
        }} />
    </Box>
  );
}

// ─── 5. So sánh 2 kỳ theo nhóm (thanh ngang ghép) ───────────────────────────

export function PairHBars({ rows, width, prevLabel, curLabel }: { rows: { name: string; prev: number; cur: number }[]; width: number; prevLabel: string; curLabel: string }) {
  const height = 30 + rows.length * 30;
  const sc = niceScale(rows.flatMap(r => [r.prev, r.cur]), { zero: true });
  const options = {
    ...baseOptions({ labels: [{ dataset: 1, format: (v: number) => fmtN(v), bold: true }], padding: { right: 40, top: 4 } }),
    indexAxis: 'y',
    scales: axes({ min: 0, max: sc.max, step: sc.step, horizontal: true }),
  } as ChartOptions<'bar'>;
  return (
    <Box width={width} height={height}>
      <Bar width={width} height={height} options={options} plugins={[labelsPlugin<'bar'>()]}
        data={{
          labels: rows.map(r => r.name),
          datasets: [
            { label: prevLabel, data: rows.map(r => r.prev), backgroundColor: C.prev, ...BAR, maxBarThickness: 11, categoryPercentage: 0.78, barPercentage: 0.92 },
            { label: curLabel, data: rows.map(r => r.cur), backgroundColor: C.blue, ...BAR, maxBarThickness: 11, categoryPercentage: 0.78, barPercentage: 0.92 },
          ],
        }} />
    </Box>
  );
}

// ─── 6. Thanh ngang 1 chuỗi / phân kỳ ───────────────────────────────────────

export function HBars({ rows, width, diverging = false, rowH = 24 }: { rows: { name: string; value: number }[]; width: number; diverging?: boolean; rowH?: number }) {
  const height = 26 + rows.length * rowH;
  const sc = niceScale(rows.map(r => r.value).concat(0), { zero: true });
  const options = {
    ...baseOptions({ labels: [{ dataset: 0, format: (v: number) => (diverging ? fmtSigned(v) : fmtN(v)), bold: true }], padding: { right: 40, left: diverging ? 36 : 0, top: 4 } }),
    indexAxis: 'y',
    // Chỗ cho nhãn số ở 2 đầu nằm trong lề (padding), trục giữ đúng mốc tròn.
    scales: axes({ min: sc.min, max: sc.max, step: sc.step, horizontal: true }),
  } as ChartOptions<'bar'>;
  return (
    <Box width={width} height={height}>
      <Bar width={width} height={height} options={options} plugins={[labelsPlugin<'bar'>()]}
        data={{
          labels: rows.map(r => r.name),
          datasets: [{ data: rows.map(r => r.value), ...BAR, maxBarThickness: 14, backgroundColor: rows.map(r => (diverging && r.value < 0 ? C.red : C.blue)) }],
        }} />
    </Box>
  );
}

// ─── 7. Cơ cấu theo tháng (cột chồng) ───────────────────────────────────────

export function StackedColumns({ labels, series, width, height }: { labels: string[]; series: { name: string; color: string; data: number[] }[]; width: number; height: number }) {
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.data[i] ?? 0), 0));
  const sc = niceScale(totals, { zero: true });
  const options = {
    ...baseOptions({ labels: [{ dataset: series.length, format: (_v: number, i: number) => fmtN(totals[i]), bold: true }] }),
    scales: axes({ min: 0, max: sc.max, step: sc.step, stacked: true }),
  } as ChartOptions<'bar'>;
  return (
    <Box width={width} height={height}>
      <Bar width={width} height={height} options={options} plugins={[labelsPlugin<'bar'>()]}
        data={{
          labels,
          datasets: [
            // Khe 2px màu nền giữa các lớp chồng.
            ...series.map(s => ({ label: s.name, data: s.data, backgroundColor: s.color, borderColor: C.paper, borderWidth: { top: 2, bottom: 0, left: 0, right: 0 }, borderSkipped: false as const, maxBarThickness: 30, stack: 'a' })),
            // Chuỗi ẩn chỉ để đặt nhãn tổng trên đỉnh cột.
            { label: 'Tổng', data: totals.map(() => 0), backgroundColor: 'rgba(0,0,0,0)', stack: 'a', maxBarThickness: 30 },
          ],
        }} />
    </Box>
  );
}

// ─── 8. Nhiều đường (khu vực theo thời gian) ────────────────────────────────

export function MultiLine({ labels, series, width, height }: { labels: string[]; series: { name: string; color: string; data: number[] }[]; width: number; height: number }) {
  const sc = niceScale(series.flatMap(s => s.data), { zero: true });
  const last = labels.length - 1;
  // Nhãn cuối đường: chỉ ghi khi không đè nhãn khác (cách ≥ 14px) và khác 0 — còn lại xem chú thích + bảng.
  const pxPerUnit = (height - 40) / Math.max(1, sc.max - sc.min);
  const ends = series.map((s, i) => ({ i, v: s.data[last] ?? 0 })).sort((a, b) => b.v - a.v);
  const keep = new Set<number>();
  let prevY = -Infinity;
  for (const e of ends) {
    const y = (sc.max - e.v) * pxPerUnit;
    if (e.v > 0 && y - prevY >= 14) { keep.add(e.i); prevY = y; }
  }
  const options = {
    ...baseOptions({ labels: series.map((_, i) => ({ dataset: i, indices: keep.has(i) ? [last] : [], format: (v: number) => fmtN(v), bold: true })), padding: { right: 30 } }),
    scales: axes({ min: 0, max: sc.max, step: sc.step }),
  } as ChartOptions<'line'>;
  return (
    <Box width={width} height={height}>
      <Line width={width} height={height} options={options} plugins={[labelsPlugin<'line'>()]}
        data={{
          labels,
          datasets: series.map(s => ({
            label: s.name, data: s.data, borderColor: s.color, backgroundColor: s.color, borderWidth: 2, tension: 0.25,
            pointRadius: 3, pointBorderColor: C.paper, pointBorderWidth: 1.5,
          })),
        }} />
    </Box>
  );
}

// ─── 9. Vòng tỷ trọng ───────────────────────────────────────────────────────

export function ShareDonut({ rows, size, centerLabel, centerValue }: { rows: { name: string; color: string; value: number }[]; size: number; centerLabel: string; centerValue: string }) {
  const options = {
    responsive: false, animation: false as const, devicePixelRatio: DPR, cutout: '64%',
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
  } as ChartOptions<'doughnut'>;
  return (
    <Box width={size} height={size}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <Doughnut width={size} height={size} options={options}
          data={{ labels: rows.map(r => r.name), datasets: [{ data: rows.map(r => r.value), backgroundColor: rows.map(r => r.color), borderColor: C.paper, borderWidth: 2 }] }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, lineHeight: 1.1 }}>{centerValue}</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{centerLabel}</div>
        </div>
      </div>
    </Box>
  );
}

// ─── 10. Độ phủ số liệu (cột %) ─────────────────────────────────────────────

export function CoverageBars({ periods, width, height }: { periods: LrPeriod[]; width: number; height: number }) {
  const vals = periods.map(p => Math.round(p.coverage * 100));
  const options = {
    ...baseOptions({ labels: [{ dataset: 0, format: (v: number) => `${v}%` }], refLine: { value: 50, label: 'Mức 50%' } }),
    scales: axes({ min: 0, max: 100, step: 25, pct: true }),
  } as ChartOptions<'bar'>;
  return (
    <Box width={width} height={height}>
      <Bar width={width} height={height} options={options} plugins={[labelsPlugin<'bar'>(), refLinePlugin<'bar'>()]}
        data={{ labels: periods.map(p => p.short), datasets: [{ data: vals, ...BAR, backgroundColor: periods.map(p => (p.coverage < 0.5 ? C.blueLight : C.blue)) }] }} />
    </Box>
  );
}

// ─── Đường mini trong bảng (SVG) ────────────────────────────────────────────

export function Spark({ values, width = 76, height = 16 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => (hi === lo ? height / 2 : 2 + (1 - (v - lo) / (hi - lo)) * (height - 4));
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const end = values[values.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={C.blue} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(end)} r={2.2} fill={C.blue} />
    </svg>
  );
}
