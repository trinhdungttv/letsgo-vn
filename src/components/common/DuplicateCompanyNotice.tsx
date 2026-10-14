// Khối cảnh báo "công ty này có thể đã có trong hệ thống" — đặt ngay dưới ô nhập tên công ty. Xem useCompanyDuplicates.
import { AlertTriangle, Info } from 'lucide-react';
import { MATCH_LABEL, SOURCE_LABEL, type CompanyHit } from '../../lib/companyMatch';
import type { CompanyDuplicates } from '../../hooks/useCompanyDuplicates';

const TONE = {
  same: { box: 'bg-red-50 border-red-200 text-red-800', pill: 'bg-red-100 text-red-700', icon: 'text-red-600' },
  likely: { box: 'bg-amber-50 border-amber-200 text-amber-900', pill: 'bg-amber-100 text-amber-800', icon: 'text-amber-600' },
  maybe: { box: 'bg-blue-50 border-blue-200 text-blue-900', pill: 'bg-blue-100 text-blue-700', icon: 'text-blue-600' },
} as const;

function HitRow({ h, onUseName }: { h: CompanyHit; onUseName?: (name: string) => void }) {
  const t = TONE[h.level];
  return (
    <li className="flex items-start gap-2 py-1.5 border-t first:border-t-0 border-black/5">
      <span className={`shrink-0 mt-0.5 px-1.5 py-px rounded text-[10px] font-semibold whitespace-nowrap ${t.pill}`}>{MATCH_LABEL[h.level]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold leading-snug break-words">{h.entry.name}</div>
        <div className="text-[11px] opacity-80 leading-snug">
          {h.entry.refs.map(r => `${SOURCE_LABEL[r.source]}${r.note ? ` · ${r.note}` : ''}`).filter((v, i, a) => a.indexOf(v) === i).join('  |  ')}
          {' — '}{h.reason}
        </div>
      </div>
      {onUseName && <button type="button" onClick={() => onUseName(h.entry.name)} className="shrink-0 text-[11px] font-semibold text-blue-700 hover:underline whitespace-nowrap">Dùng tên này</button>}
    </li>
  );
}

export default function DuplicateCompanyNotice({ dup, onUseName, className = '' }: {
  dup: CompanyDuplicates;
  /** Có = hiện nút "Dùng tên này" để điền lại đúng tên đã có */
  onUseName?: (name: string) => void;
  className?: string;
}) {
  if (!dup.level) return null;
  const t = TONE[dup.level];
  const strong = dup.level === 'same' || dup.level === 'likely';
  const Icon = strong ? AlertTriangle : Info;
  return (
    <div className={`mt-1.5 rounded-lg border px-3 py-2 ${t.box} ${className}`} role="alert">
      <div className="flex items-start gap-1.5">
        <Icon size={14} className={`shrink-0 mt-0.5 ${t.icon}`} />
        <div className="text-[12px] font-semibold leading-snug">
          {dup.level === 'same' ? 'Công ty này đã có trong hệ thống' : dup.level === 'likely' ? 'Có vẻ công ty này đã có (tên rất giống)' : 'Có công ty tên gần giống — kiểm tra trước khi thêm'}
        </div>
      </div>
      <ul className="mt-1 pl-5">{dup.hits.map(h => <HitRow key={h.entry.refs[0].id} h={h} onUseName={onUseName} />)}</ul>
      {strong && (
        <label className="mt-1.5 pl-5 flex items-center gap-2 text-[12px] font-medium cursor-pointer select-none">
          <input type="checkbox" checked={dup.ack} onChange={e => dup.setAck(e.target.checked)} className="w-3.5 h-3.5 accent-red-600" />
          Đây là công ty khác — vẫn thêm mới
        </label>
      )}
    </div>
  );
}
