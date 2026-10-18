/* eslint-disable react-refresh/only-export-components */
// Thiết lập chart.js dùng chung cho module + sparkline SVG nhẹ cho thẻ KPI.
// Bảng màu phân loại theo thứ tự cố định (đã kiểm bằng dataviz validator — an toàn cho người mù màu ở các cặp liền kề).
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart as ChartJS, DoughnutController, Legend, LinearScale,
  LineController, LineElement, PointElement, Tooltip, type ChartOptions,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, LineElement, LineController, PointElement, ArcElement, DoughnutController, Tooltip, Legend);

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const C = {
  profit: '#2a78d6',
  loss: '#e34948',
  revenue: '#1baf7a',
  cost: '#eb6834',
  neutral: '#c3c2b7',
  grid: '#F1F0EA',
  ink: '#52514e',
  muted: '#888',
};

export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const trTick = (v: number | string) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })} tr`;
export const trVal = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} tr`;

export function baseOptions<T extends 'bar' | 'line' | 'doughnut'>(extra: ChartOptions<T> = {} as ChartOptions<T>): ChartOptions<T> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    ...extra,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 }, color: C.ink } },
      ...(extra?.plugins ?? {}),
    },
  } as ChartOptions<T>;
}

/** Đường xu hướng nhỏ trong thẻ KPI (không trục, có điểm cuối). */
export function Sparkline({ values, color = C.profit, height = 28, zeroLine }: { values: number[]; color?: string; height?: number; zeroLine?: boolean }) {
  if (values.length < 2) return <div style={{ height }} />;
  const w = 120;
  const min = Math.min(...values, zeroLine ? 0 : Infinity);
  const max = Math.max(...values, zeroLine ? 0 : -Infinity);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const zeroY = height - 3 - ((0 - min) / span) * (height - 6);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      {zeroLine && min < 0 && max > 0 && <line x1="0" x2={w} y1={zeroY} y2={zeroY} stroke="#E8E7E2" strokeDasharray="3 3" />}
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  );
}

export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return <div className="h-full min-h-[180px] flex items-center justify-center text-center text-[12px] text-gray-400 px-4">{children}</div>;
}
