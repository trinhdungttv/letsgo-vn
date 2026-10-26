// Phần "Món quà" của form Ghi tương tác / Ghi nhận nhanh khi chọn hình thức "Quà tặng":
// Mình tặng / Họ tặng · món quà · giá trị (VND, tuỳ chọn) · gắn sự kiện. Lưu xong món quà nằm trong
// Sự kiện & Quà tặng → Lịch sử quà (ngày tặng = ngày tương tác, ghi chú = nội dung nhật ký).
import { formatCurrencyFull } from '../../../lib/format';
import { formatDateVN } from '../../../lib/cskh/dates';
import { parseGiftAmount, type LogGiftDraft } from '../../../lib/cskh/logGift';
import type { CskhGift, CskhOccasion } from '../../../lib/cskh/types';
import { GIFT_DIRECTION_LABEL } from '../../../lib/cskh/types';
import { inputCls } from '../ui';
import { ChoiceChip } from './Sheet';

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';

export function LogGiftFields({ draft, onChange, past = [], occasions = [], notice }: {
  draft: LogGiftDraft;
  onChange: (next: LogGiftDraft) => void;
  /** Quà đã ghi cho người này — hiện để tránh tặng trùng. */
  past?: readonly CskhGift[];
  /** Sự kiện của người này (chỉ ngày đặc biệt đã lưu) để gắn vào món quà. */
  occasions?: readonly CskhOccasion[];
  /** Dòng nhắc (VD: chưa gắn công ty, dòng cũ chưa có món quà). */
  notice?: { tone: 'warn' | 'info'; text: string } | null;
}) {
  const amount = parseGiftAmount(draft.value);
  const set = (patch: Partial<LogGiftDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="rounded-[14px] bg-[#FF9500]/[0.08] px-3.5 py-3 space-y-3" role="group" aria-label="Món quà">
      <p className="text-[12px] font-medium text-[#B25000]">
        Món quà — tự ghi vào Sự kiện &amp; Quà tặng → Lịch sử quà (ngày tặng = ngày tương tác)
      </p>
      {notice && (
        <p className={`text-[12px] leading-snug ${notice.tone === 'warn' ? 'text-[#D70015]' : 'text-[#6E6E73]'}`}>{notice.text}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {(['given', 'received'] as const).map(d => (
          <ChoiceChip key={d} active={draft.direction === d} onClick={() => set({ direction: d })}>
            {d === 'given' ? 'Mình tặng' : 'Họ tặng mình'}
          </ChoiceChip>
        ))}
      </div>
      <div>
        <label className={labelCls} htmlFor="log-gift-item">Món quà</label>
        <input id="log-gift-item" value={draft.item} onChange={e => set({ item: e.target.value })} className={inputCls}
          placeholder="VD: Giỏ trái cây, hộp bánh trung thu, rượu vang" maxLength={200} />
      </div>
      <div className={occasions.length > 0 ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
        <div>
          <label className={labelCls} htmlFor="log-gift-value">Giá trị (VND, tuỳ chọn)</label>
          <input id="log-gift-value" value={draft.value} onChange={e => set({ value: e.target.value })} inputMode="numeric" className={inputCls} placeholder="500000" />
          {amount !== null && <p className="text-[11.5px] text-[#86868B] mt-0.5">{formatCurrencyFull(amount)}</p>}
        </div>
        {occasions.length > 0 && (
          <div>
            <label className={labelCls} htmlFor="log-gift-occasion">Gắn với sự kiện (tuỳ chọn)</label>
            <select id="log-gift-occasion" value={draft.occasionId} onChange={e => set({ occasionId: e.target.value })} className={inputCls}>
              <option value="">— Không gắn —</option>
              {occasions.map(o => <option key={o.id} value={o.id}>{o.title}{o.relatedPerson ? ` · ${o.relatedPerson}` : ''}</option>)}
            </select>
          </div>
        )}
      </div>
      {past.length > 0 && (
        <p className="text-[11.5px] text-[#6E6E73] leading-snug">
          <b className="text-[#3A3A3C]">Đã ghi trước đây:</b>{' '}
          {past.slice(0, 5).map(g => `${g.item} (${GIFT_DIRECTION_LABEL[g.direction].toLowerCase()} ${formatDateVN(g.givenAt)})`).join(' · ')}
        </p>
      )}
    </div>
  );
}
