// Sao ưu tiên của công ty (lib/clientStars): huy hiệu chỉ xem + ô chọn 3 sao bấm được.
// Dùng ở Khách hàng (bảng, thẻ, hồ sơ) và CSKH (Danh bạ, Hôm nay cần liên hệ).
import { useState } from 'react';
import {
  CLIENT_STAR_COLOR, CLIENT_STAR_HINT, CLIENT_STAR_LABEL, starGlyphs, type ClientStar,
} from '../../lib/clientStars';

/** "★★★" tô màu theo mức — không hiện gì khi chưa xếp sao (trừ khi showEmpty). */
export function ClientStarBadge({ star, showEmpty = false, withLabel = false, className = '' }: {
  star: ClientStar | null;
  showEmpty?: boolean;
  withLabel?: boolean;
  className?: string;
}) {
  if (star === null) {
    return showEmpty
      ? <span className={`text-[11px] text-[#C7C7CC] whitespace-nowrap ${className}`} title="Chưa xếp sao">☆ chưa xếp</span>
      : null;
  }
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap leading-none ${className}`}
      title={`${starGlyphs(star)} ${CLIENT_STAR_HINT[star]}`}
      aria-label={`${star} sao — ${CLIENT_STAR_LABEL[star]}`}
    >
      <span className="text-[12px] tracking-[-1px]" style={{ color: CLIENT_STAR_COLOR[star] }}>{starGlyphs(star)}</span>
      {withLabel && <span className="text-[11px] font-medium text-[#6E6E73]">{CLIENT_STAR_LABEL[star]}</span>}
    </span>
  );
}

/**
 * 3 ngôi sao bấm được: bấm sao thứ n = xếp n sao; bấm lại đúng mức đang có = bỏ sao.
 * Tự chặn nổi bọt click (nằm trong dòng bảng bấm để mở hồ sơ). readOnly → chỉ hiện.
 */
export function ClientStarPicker({ value, onChange, readOnly = false, busy = false, size = 15, withLabel = false, className = '' }: {
  value: ClientStar | null;
  onChange: (next: ClientStar | null) => void;
  readOnly?: boolean;
  busy?: boolean;
  size?: number;
  withLabel?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState<ClientStar | null>(null);
  const shown = hover ?? value;
  const color = shown ? CLIENT_STAR_COLOR[shown] : '#D1D5DB';
  const label = hover
    ? CLIENT_STAR_LABEL[hover]
    : value ? CLIENT_STAR_LABEL[value] : 'Chưa xếp sao';

  if (readOnly) {
    return <ClientStarBadge star={value} showEmpty={withLabel} withLabel={withLabel} className={className} />;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${busy ? 'opacity-50 pointer-events-none' : ''} ${className}`}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onMouseLeave={() => setHover(null)}
      role="radiogroup"
      aria-label="Xếp sao ưu tiên công ty"
    >
      <span className="inline-flex items-center">
        {[1, 2, 3].map(n => {
          const s = n as ClientStar;
          const on = shown !== null && s <= shown;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={value === s}
              aria-label={`${s} sao — ${CLIENT_STAR_LABEL[s]}`}
              title={value === s ? `Bấm để bỏ sao (${CLIENT_STAR_LABEL[s]})` : `${starGlyphs(s)} ${CLIENT_STAR_HINT[s]}`}
              onMouseEnter={() => setHover(s)}
              onFocus={() => setHover(s)}
              onBlur={() => setHover(null)}
              onClick={e => { e.stopPropagation(); setHover(null); onChange(value === s ? null : s); }}
              className="p-[1px] leading-none transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded"
              style={{ fontSize: size, color: on ? color : '#D1D5DB' }}
            >
              {on ? '★' : '☆'}
            </button>
          );
        })}
      </span>
      {withLabel && (
        <span className="text-[11.5px] font-medium whitespace-nowrap" style={{ color: shown ? '#555' : '#9CA3AF' }}>{label}</span>
      )}
    </span>
  );
}
