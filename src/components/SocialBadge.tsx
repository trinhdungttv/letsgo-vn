import { ExternalLink, Facebook, Linkedin } from 'lucide-react';
import type { SocialKind } from '../lib/socialLinks';

// Logo mạng xã hội theo màu thương hiệu (Facebook xanh #1877F2, LinkedIn xanh #0A66C2).
export const SOCIAL_META: Record<SocialKind, { label: string; color: string; Icon: typeof Facebook }> = {
  facebook: { label: 'Facebook', color: '#1877F2', Icon: Facebook },
  linkedin: { label: 'LinkedIn', color: '#0A66C2', Icon: Linkedin },
  other: { label: 'Liên kết', color: '#6E6E73', Icon: ExternalLink },
};

export default function SocialBadge({ kind, size = 28, iconSize }: { kind: SocialKind; size?: number; iconSize?: number }) {
  const { color, Icon } = SOCIAL_META[kind];
  return (
    <span aria-hidden className="inline-flex items-center justify-center rounded-full shrink-0 text-white"
      style={{ width: size, height: size, background: color }}>
      <Icon size={iconSize ?? Math.round(size * 0.55)} fill="currentColor" strokeWidth={kind === 'facebook' ? 0 : 1.8} />
    </span>
  );
}
