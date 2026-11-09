// Khối giao diện nhỏ của tab Nguồn LĐ — kiểu Apple như CSKH (viên màu, ô icon iOS, số lớn).
import type { ReactNode } from 'react';
import { Building, Bus, GraduationCap, Landmark, School, Star, Users } from 'lucide-react';
import { ICON_TILE, TINT } from '../../../components/workspace/wsTheme';
import { fmtDuration, fmtKm, ENGINE_NOTE } from '../../../lib/laborSources/routing';
import type { MatchReason, ReasonTone } from '../../../lib/laborSources/match';
import { KIND_LABEL, KIND_SHORT, STATUS_LABEL, type RouteRow, type SourceKind, type SourceStatus } from '../../../lib/laborSources/types';

export const KIND_TINT: Readonly<Record<SourceKind, keyof typeof ICON_TILE>> = {
  dai_hoc: 'indigo', cao_dang: 'blue', trung_cap: 'teal', trung_tam: 'green', dia_phuong: 'orange', khac: 'gray',
};
/** Màu ghim trên bản đồ (khớp ô icon). */
export const KIND_COLOR: Readonly<Record<SourceKind, string>> = {
  dai_hoc: '#5856D6', cao_dang: '#0071E3', trung_cap: '#1FA2BA', trung_tam: '#28B04A', dia_phuong: '#FF9500', khac: '#8E8E93',
};

export function KindIcon({ kind, size = 36 }: { kind: SourceKind; size?: number }) {
  const Icon = kind === 'dai_hoc' ? GraduationCap : kind === 'cao_dang' || kind === 'trung_cap' ? School
    : kind === 'trung_tam' ? Building : kind === 'dia_phuong' ? Landmark : Users;
  return (
    <span className={`shrink-0 inline-flex items-center justify-center rounded-[10px] text-white ${ICON_TILE[KIND_TINT[kind]]}`}
      style={{ width: size, height: size }} title={KIND_LABEL[kind]}>
      <Icon size={Math.round(size * 0.5)} strokeWidth={2.1} />
    </span>
  );
}

export function SourceAvatar({ kind, logo, size = 44 }: { kind: SourceKind; logo: string | null; size?: number }) {
  if (logo) {
    return <img src={logo} alt="" className="shrink-0 rounded-[12px] object-contain bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.1)]" style={{ width: size, height: size }} />;
  }
  return <KindIcon kind={kind} size={size} />;
}

const STATUS_TINT: Readonly<Record<SourceStatus, keyof typeof TINT>> = {
  new: 'gray', contacting: 'orange', partner: 'green', paused: 'red',
};

export function Pill({ tint = 'gray', children, title }: { tint?: keyof typeof TINT; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-medium whitespace-nowrap ${TINT[tint]}`}>{children}</span>;
}

export const StatusPill = ({ status }: { status: SourceStatus }) => <Pill tint={STATUS_TINT[status]}>{STATUS_LABEL[status]}</Pill>;
export const KindPill = ({ kind }: { kind: SourceKind }) => <Pill tint={KIND_TINT[kind] === 'gray' ? 'gray' : KIND_TINT[kind] as keyof typeof TINT}>{KIND_SHORT[kind]}</Pill>;

export function Stars({ value, onChange, size = 15 }: { value: number | null; onChange?: (v: number | null) => void; size?: number }) {
  return (
    <span className="inline-flex items-center" aria-label={value ? `${value} sao` : 'Chưa xếp sao'}>
      {[1, 2, 3].map(n => {
        const on = (value ?? 0) >= n;
        const star = <Star size={size} className={on ? 'text-[#FF9500]' : 'text-[#D1D1D6]'} fill={on ? 'currentColor' : 'none'} strokeWidth={2} />;
        return onChange
          ? <button key={n} type="button" onClick={() => onChange(value === n ? null : n)} className="p-1 -m-0.5 rounded-full hover:bg-black/[0.04]" aria-label={`${n} sao`}>{star}</button>
          : <span key={n}>{star}</span>;
      })}
    </span>
  );
}

/** Viên "xe khách ~X phút · Y km" — số liệu từ bộ nhớ đường xe. */
export function BusChip({ route, estimate, compact = false }: { route?: RouteRow | null; estimate?: { min: number; km: number } | null; compact?: boolean }) {
  if (route) {
    if (route.distance_km == null) return <Pill tint="red">Không có đường xe</Pill>;
    return (
      <span title={`${ENGINE_NOTE[route.engine]} · ${fmtKm(route.distance_km)}`}
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold whitespace-nowrap tabular-nums ${busTint(route.duration_min)}`}>
        <Bus size={12} strokeWidth={2.3} /> {fmtDuration(route.duration_min)}{!compact && <span className="font-normal opacity-80">· {fmtKm(route.distance_km)}</span>}
      </span>
    );
  }
  if (estimate) {
    return (
      <span title="Ước từ đường thẳng — mở hồ sơ để tính đường xe thật"
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-medium whitespace-nowrap tabular-nums bg-black/[0.04] text-[#86868B]">
        <Bus size={12} /> ≈ {fmtDuration(estimate.min)}
      </span>
    );
  }
  return <span className="text-[12px] text-[#AEAEB2]">—</span>;
}

export function busTint(min: number | null | undefined): string {
  if (min == null) return TINT.gray;
  if (min <= 45) return TINT.green;
  if (min <= 90) return TINT.blue;
  if (min <= 180) return TINT.orange;
  return TINT.red;
}

const TONE_TINT: Readonly<Record<ReasonTone, string>> = {
  good: TINT.green, warn: TINT.orange, bad: TINT.red, muted: TINT.gray,
};
export function ReasonChips({ reasons }: { reasons: readonly MatchReason[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map(r => <span key={r.key} className={`px-2 py-0.5 rounded-full text-[11.5px] leading-[18px] ${TONE_TINT[r.tone]}`}>{r.text}</span>)}
    </div>
  );
}

/** Vòng điểm phù hợp (0–100). */
export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 70 ? '#34C759' : score >= 45 ? '#FF9500' : '#FF3B30';
  return (
    <span className="relative shrink-0 inline-flex items-center justify-center" style={{ width: size, height: size }} title={`Mức phù hợp ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`} />
      </svg>
      <span className="absolute text-[13px] font-bold tabular-nums text-[#1D1D1F]">{score}</span>
    </span>
  );
}

/** Ô số lớn kiểu Apple (dùng trong thẻ Tổng quan). */
export function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'orange' | 'blue' }) {
  const color = tone === 'green' ? 'text-[#248A3D]' : tone === 'orange' ? 'text-[#B25000]' : tone === 'blue' ? 'text-[#0066CC]' : 'text-[#1D1D1F]';
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[12px] font-medium text-[#86868B] truncate">{label}</p>
      <p className={`text-[26px] md:text-[28px] font-bold tracking-[-0.02em] leading-tight tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[12px] text-[#86868B] truncate">{sub}</p>}
    </div>
  );
}

/** Thanh tỷ lệ đạt. */
export function RateBar({ sent, passed }: { sent: number; passed: number }) {
  const rate = sent > 0 ? Math.min(1, passed / sent) : 0;
  const color = rate >= 0.6 ? 'bg-[#34C759]' : rate >= 0.3 ? 'bg-[#FF9500]' : 'bg-[#FF3B30]';
  return (
    <span className="inline-flex items-center gap-2 min-w-[120px]">
      <span className="flex-1 h-[6px] rounded-full bg-black/[0.06] overflow-hidden"><span className={`block h-full rounded-full ${color}`} style={{ width: `${rate * 100}%` }} /></span>
      <span className="text-[12px] tabular-nums text-[#6E6E73] whitespace-nowrap">{passed}/{sent}</span>
    </span>
  );
}

export const fmtDateVN = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
export const fmtDayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
