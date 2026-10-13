// Số báo giá · ngày ban hành · hiệu lực — dùng chung cho màn phương án (thẻ "Thông tin báo giá") và hộp "Xem & xuất PDF".
// Mặc định: ban hành hôm nay, hiệu lực 1 tháng; đổi ngày ban hành thì ngày hết hạn tự tính lại (khi đang chọn theo số tháng).
import { useRef } from 'react';
import { addMonthsIso, dateShort, daysLeft, defaultDoc, isoDate, normalizeDoc, type DocDefaults, type QuoteDoc } from '../../../lib/costPlan/quoteDoc';
import type { PlanData } from '../../../lib/costPlan/types';
import { Select, card, field, labelCls } from './ui';

const VALID_OPTS = [1, 2, 3, 6];

export function ValidityBadge({ validUntil }: { validUntil: string }) {
  const n = daysLeft(validUntil);
  if (n == null) return null;
  const cls = n < 0 ? 'bg-[#fff1f0] text-[#b3140a]' : n <= 7 ? 'bg-[#fff8e6] text-[#8a5a00]' : 'bg-[#e8f8ed] text-[#1d8a3b]';
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{n < 0 ? 'Đã hết hiệu lực' : n === 0 ? 'Hết hạn hôm nay' : `Còn ${n} ngày`}</span>;
}

export function QuoteMetaFields({ doc, onDoc, readOnly }: { doc: QuoteDoc; onDoc: (p: Partial<QuoteDoc>) => void; readOnly?: boolean }) {
  const setDate = (date: string) => onDoc({ date, ...(doc.validMonths && date ? { validUntil: addMonthsIso(date, doc.validMonths) } : {}) });
  const setValidity = (v: string) => (v === 'custom'
    ? onDoc({ validMonths: null })
    : onDoc({ validMonths: Number(v), validUntil: addMonthsIso(doc.date, Number(v)) }));
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block"><span className={labelCls}>Số báo giá</span>
        <input disabled={readOnly} value={doc.number} onChange={e => onDoc({ number: e.target.value })} className={`${field} w-full`} /></label>
      <label className="block"><span className={labelCls}>Ngày ban hành</span>
        <input type="date" disabled={readOnly} value={doc.date} onChange={e => setDate(e.target.value)} className={`${field} w-full`} /></label>
      <label className="block"><span className={labelCls}>Hiệu lực</span>
        <Select value={doc.validMonths ? String(doc.validMonths) : 'custom'} disabled={readOnly} onChange={setValidity}>
          {VALID_OPTS.map(m => <option key={m} value={m}>{m} tháng</option>)}
          <option value="custom">Chọn ngày cụ thể</option>
        </Select></label>
      <label className="block"><span className={labelCls}>Hiệu lực đến</span>
        <input type="date" disabled={readOnly || !!doc.validMonths} value={doc.validUntil} onChange={e => onDoc({ validUntil: e.target.value, validMonths: null })}
          title={doc.validMonths ? 'Tự tính theo số tháng — chọn “Chọn ngày cụ thể” để sửa tay' : undefined} className={`${field} w-full`} /></label>
    </div>
  );
}

/** Thẻ "Thông tin báo giá" trên màn phương án: số, ngày ban hành, hiệu lực — lưu cùng phương án. */
export default function QuoteMetaCard({ data, onChange, readOnly, defaults, companyName }: {
  data: PlanData; onChange: (d: PlanData) => void; readOnly?: boolean; defaults?: DocDefaults; companyName?: string | null;
}) {
  // Chưa có thì hiện số mặc định (giữ cố định trong lúc mở, không đổi số báo giá mỗi lần vẽ lại)
  const base = useRef<QuoteDoc>(defaultDoc(new Date(), { name: companyName ?? '', ...defaults }));
  const doc = (data.doc && normalizeDoc(data.doc)) || base.current;
  const onDoc = (p: Partial<QuoteDoc>) => { if (!readOnly) onChange({ ...data, doc: { ...doc, ...p } }); };
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[14px] font-semibold text-[#1d1d1f]">Thông tin báo giá</div>
          <div className="text-[12px] text-[#86868b]">
            Ban hành {dateShort(doc.date) || '—'}{doc.validUntil ? ` · hiệu lực đến ${dateShort(doc.validUntil)}` : ''}
            {!data.doc && ' · số mặc định, lưu phương án để giữ'}
          </div>
        </div>
        <ValidityBadge validUntil={doc.validUntil} />
      </div>
      <QuoteMetaFields doc={doc} onDoc={onDoc} readOnly={readOnly} />
      {doc.date && doc.date > isoDate(new Date()) && <div className="mt-2 text-[11.5px] text-[#86868b]">Ngày ban hành ở tương lai.</div>}
    </div>
  );
}
