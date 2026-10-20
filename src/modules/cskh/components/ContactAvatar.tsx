// Avatar người liên hệ: chỉ dùng ẢNH THẬT; chưa có ảnh thì vòng tròn chữ cái
// (theo TÊN GỌI, như danh bạ LetsGo) tô nhạt theo màu hạng chăm sóc.
import { personInitial } from '../../../lib/vnName';
import type { CskhTier } from '../../../lib/cskh/types';
import { TIER_COLOR } from '../ui';

export function ContactAvatar({ name, url, tier, size = 36 }: { name: string; url?: string; tier: CskhTier; size?: number }) {
  if (url) {
    return (
      <img src={url} alt={name} width={size} height={size} loading="lazy"
        className="rounded-full object-cover bg-gray-100 shrink-0" style={{ width: size, height: size }} />
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
