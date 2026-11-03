// Băng dẫn đường trên cùng màn khảo sát (kiểu Google Maps): mũi tên rẽ to, còn bao xa, rẽ vào đường nào, chỗ rẽ sau đó.
import type { ReactNode } from 'react';
import { ArrowUp, ArrowUpLeft, ArrowUpRight, Bell, CornerUpLeft, CornerUpRight, Flag, Loader2, RefreshCw, Route, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import type { Maneuver, ManeuverKind, NavRoute } from '../../../lib/kcnSurvey/navigate';
import { fmtDistance } from '../../../lib/kcnSurvey/track';
import type { NavMode, NavStatus } from './useSurveyNavigation';
import { NAV_SOUND_LABEL, nextNavSound, type NavSound } from './surveyData';

const ICON: Record<ManeuverKind, (size: number) => ReactNode> = {
  left: s => <CornerUpLeft size={s} strokeWidth={2.6} />,
  right: s => <CornerUpRight size={s} strokeWidth={2.6} />,
  'slight-left': s => <ArrowUpLeft size={s} strokeWidth={2.6} />,
  'slight-right': s => <ArrowUpRight size={s} strokeWidth={2.6} />,
  uturn: s => <Undo2 size={s} strokeWidth={2.6} />,
  'run-start': s => <Route size={s} strokeWidth={2.4} />,
  arrive: s => <Flag size={s} strokeWidth={2.4} />,
};

/** Khoảng cách trên băng: làm tròn 10 m cho dễ đọc khi đang chạy. */
const navDist = (m: number) => (m < 1000 ? `${Math.max(0, Math.round(m / 10) * 10)} m` : fmtDistance(m));

interface Props {
  mode: NavMode;
  status: NavStatus;
  route: NavRoute | null;
  next: Maneuver | null;
  after: Maneuver | null;
  distToNext: number | null;
  remaining: number | null;
  toApproach: number | null;
  sound: NavSound;
  /** Bấm nút loa: Tắt → Bíp → Giọng đọc → Tắt */
  onSound: (next: NavSound) => void;
  onReplan: () => void;
  onStop: () => void;
  /** Giao diện gọn (màn ngang): băng thấp hơn, chữ nhỏ hơn để chừa chỗ cho bản đồ */
  compact?: boolean;
}

export default function SurveyNavBanner({ mode, status, route, next, after, distToNext, remaining, toApproach, sound, onSound, onReplan, onStop, compact }: Props) {
  if (mode.kind === 'off') return null;
  const target = route?.target;
  const onRun = target?.kind === 'run' && toApproach != null && toApproach <= 0;
  // Chỗ "tới nơi" là mốc kế tiếp → đang đi trong đoạn / đoạn cuối: hiện quãng còn lại thay cho câu "Hết đoạn…"
  const arriving = !!route && next?.kind === 'arrive';
  const headline = !route
    ? status === 'waiting-gps' ? 'Đang chờ tín hiệu GPS…'
      : status === 'no-target' ? 'Đã đi hết đường trong KCN'
      : mode.kind === 'auto' ? 'Chưa tìm được đoạn chưa đi để dẫn tới' : 'Không tìm được đường tới công ty'
    : arriving
      ? target?.kind === 'run' ? `Đi hết đoạn chưa đi${target.name ? ` trên ${target.name}` : ''}`
        : target?.kind === 'tour' ? 'Đi tiếp tới hết lộ trình' : `Đến ${target?.kind === 'point' ? target.name : ''}`
      : next?.text ?? 'Đi thẳng';
  const bigDist = !route ? null : arriving ? remaining : next ? distToNext : null;
  const sub = !route
    ? status === 'no-road' ? 'Đứng gần đường hơn, hoặc tải lại mạng đường trong Cài đặt' : status === 'waiting-gps' ? '' : 'Bấm ✕ để tắt dẫn đường'
    : target?.kind === 'run'
      ? onRun
        ? `Đang đi đoạn chưa đi · còn ${navDist(remaining ?? 0)}`
        : `Tới đoạn chưa đi ${navDist(toApproach ?? 0)}${target.name ? ` · ${target.name}` : ''} · đoạn dài ${navDist(target.len)}${target.factory ? ' · có nhà máy' : ''}`
      : target?.kind === 'tour' ? `Lộ trình 1 lượt · còn ${navDist(remaining ?? 0)} · qua ${navDist(target.len)} đường chưa đi`
      : target?.kind === 'point' ? `Tới ${target.name} · còn ${navDist(remaining ?? 0)}` : '';
  const iconSize = compact ? 24 : 30;

  return (
    <div className="pointer-events-auto rounded-2xl overflow-hidden shadow-xl">
      <div className={`bg-[#137333] text-white flex items-center ${compact ? 'px-2.5 py-1.5 gap-2.5' : 'px-3 py-2.5 gap-3'}`}>
        <div className={`${compact ? 'w-10 h-10 rounded-lg' : 'w-12 h-12 rounded-xl'} bg-white/15 flex items-center justify-center shrink-0`}>
          {!route
            ? status === 'waiting-gps' ? <Loader2 size={iconSize - 4} className="animate-spin" /> : <Route size={iconSize - 4} />
            : next && !arriving ? ICON[next.kind](iconSize) : arriving && target?.kind !== 'point' ? <ArrowUp size={iconSize} strokeWidth={2.6} /> : next ? ICON[next.kind](iconSize) : <ArrowUp size={iconSize} strokeWidth={2.6} />}
        </div>
        <div className="flex-1 min-w-0">
          {bigDist != null && <div className={`${compact ? 'text-[18px]' : 'text-[22px]'} font-bold leading-none tabular-nums`}>{navDist(bigDist)}</div>}
          <div className={`${bigDist != null ? (compact ? 'text-[13px] mt-0.5 line-clamp-1' : 'text-[14.5px] mt-1 line-clamp-2') : (compact ? 'text-[14px] line-clamp-1' : 'text-[16px] line-clamp-2')} font-semibold leading-snug`}>{headline}</div>
        </div>
        <button onClick={onStop} className={`${compact ? 'w-8 h-8' : 'w-9 h-9'} rounded-full bg-white/15 flex items-center justify-center shrink-0`} aria-label="Tắt dẫn đường"><X size={compact ? 16 : 18} /></button>
      </div>
      <div className={`bg-[#0D5A28] text-white/90 flex items-center gap-2 ${compact ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[12px]'}`}>
        <div className="flex-1 min-w-0 truncate">
          {after && after.kind !== 'arrive' && route
            ? <>Sau đó: <b>{after.text}</b>{sub ? ` · ${sub}` : ''}</>
            : sub}
        </div>
        <button onClick={onReplan} className={`${compact ? 'w-7 h-7' : 'w-8 h-8'} rounded-full flex items-center justify-center hover:bg-white/10 shrink-0`} aria-label="Tìm đường khác" title="Tìm đường khác"><RefreshCw size={15} /></button>
        <button onClick={() => onSound(nextNavSound(sound))}
          className={`${compact ? 'h-7' : 'h-8'} pl-2 pr-2.5 rounded-full flex items-center gap-1 hover:bg-white/10 bg-white/10 shrink-0 text-[11.5px] font-medium`}
          aria-label={`Âm thanh: ${NAV_SOUND_LABEL[sound]} — bấm để đổi`} title={`Âm thanh: ${NAV_SOUND_LABEL[sound]} — bấm để đổi`}>
          {sound === 'voice' ? <Volume2 size={15} /> : sound === 'beep' ? <Bell size={15} /> : <VolumeX size={15} />}
          {sound === 'voice' ? 'Giọng' : sound === 'beep' ? 'Bíp' : 'Tắt'}
        </button>
      </div>
    </div>
  );
}
