// Avatar người liên hệ: chỉ dùng ẢNH THẬT; chưa có ảnh thì vòng tròn chữ cái
// (theo TÊN GỌI, như danh bạ LetsGo) tô nhạt theo màu hạng chăm sóc.
import { personInitial } from '../../../lib/vnName';
import type { CskhTier } from '../../../lib/cskh/types';
import { TIER_COLOR } from '../ui';

export function ContactAvatar({ name, url, tier, size = 36 }: { name: string; url?: string; tier: CskhTier; size?: number }) {
  if (url) {
    return (
      <img src={url} alt={name} width={size} height={size} loading="lazy"
        className="rounded-full object-cover bg-black/[0.05] shrink-0" style={{ width: size, height: size }} />
    );
  }
  const color = TIER_COLOR[tier];
  return (
    <span
      aria-hidden
      className="rounded-full font-semibold inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `${color}26`, color }}
    >
      {personInitial(name)}
    </span>
  );
}

export interface StackPerson { key: string; name: string; url?: string; tier: CskhTier }

/** Tối đa 3 avatar hiện rõ; nhóm đông hơn thì thêm vòng "+N". */
const STACK_MAX = 3;

/** Bề rộng nhóm avatar chồng nhau (px) — để dòng cha canh lề / đường kẻ cho khớp. */
export function avatarStackWidth(count: number, size = 28): number {
  const slots = Math.min(count, STACK_MAX) + (count > STACK_MAX ? 1 : 0);
  return slots <= 0 ? 0 : size + (slots - 1) * Math.round(size * 0.62);
}

/**
 * Nhóm avatar chồng nhau (đợt "Ghi cho nhóm"): nhìn là biết đợt này có những ai.
 * Viền trắng tách từng vòng; người sau đè lên người trước nhẹ để đọc được cả 3 mặt.
 */
export function AvatarStack({ people, size = 28 }: { people: readonly StackPerson[]; size?: number }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, STACK_MAX);
  const more = people.length - shown.length;
  const step = Math.round(size * 0.62);
  const label = people.map(p => p.name).filter(Boolean).join(', ');
  return (
    <span className="relative shrink-0 inline-block" style={{ width: avatarStackWidth(people.length, size), height: size }}
      role="img" aria-label={label} title={label}>
      {shown.map((p, k) => (
        <span key={p.key} className="absolute top-0 rounded-full ring-2 ring-white bg-white" style={{ left: k * step, zIndex: STACK_MAX - k }}>
          <ContactAvatar name={p.name} url={p.url} tier={p.tier} size={size} />
        </span>
      ))}
      {more > 0 && (
        <span className="absolute top-0 rounded-full ring-2 ring-white bg-[#F2F2F7] text-[#6E6E73] font-semibold inline-flex items-center justify-center tabular-nums"
          style={{ left: shown.length * step, width: size, height: size, fontSize: Math.round(size * 0.38) }}>
          +{more}
        </span>
      )}
    </span>
  );
}
