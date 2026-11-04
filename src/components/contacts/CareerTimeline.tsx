// "Quá trình công tác" của 1 người liên hệ — dựng từ lịch sử gắn / gỡ / chuyển công ty
// (lib/contactCareer.buildCareer). Dùng ở form đầy đủ và hồ sơ CSKH.
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Contact } from '../../lib/types';
import { linksOf } from '../../lib/contactOps';
import { buildCareer, periodLabel, type CareerHistoryRow } from '../../lib/contactCareer';

export default function CareerTimeline({ contact, history, onOpenClient }: {
  contact: Contact;
  history: readonly CareerHistoryRow[];
  /** Bấm tên công ty → mở hồ sơ công ty (nếu có). */
  onOpenClient?: (clientId: string) => void;
}) {
  const periods = useMemo(() => buildCareer({
    role: contact.role, startDate: contact.start_date, history,
    links: linksOf(contact).map(l => ({ clientId: l.client_id, clientName: l.clients?.name || '', createdAt: l.created_at })),
  }), [contact, history]);
  if (periods.length === 0) return null;
  return (
    <ol className="relative space-y-2.5 pl-4">
      <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-gray-200" aria-hidden />
      {periods.map((p, i) => (
        <li key={`${p.clientId ?? p.clientName}:${p.from ?? ''}:${i}`} className="relative">
          <span className={`absolute -left-4 top-1 w-[11px] h-[11px] rounded-full border-2 border-white ${p.current ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
          <div className="text-[13px] leading-snug">
            {p.clientId && onOpenClient ? (
              <button type="button" onClick={() => onOpenClient(p.clientId as string)} className="font-semibold text-gray-900 hover:text-blue-700">{p.clientName}</button>
            ) : <span className="font-semibold text-gray-900">{p.clientName}</span>}
            {p.role && <span className="text-gray-600"> · {p.role}</span>}
            {p.current && <span className="ml-1.5 text-[10.5px] font-medium text-emerald-700 bg-emerald-100 rounded-full px-1.5 py-px">Hiện tại</span>}
          </div>
          <div className="text-[11.5px] text-gray-500 flex items-center gap-1 flex-wrap">
            {periodLabel(p)}
            {p.movedToName && <><ArrowRight className="w-3 h-3" /> chuyển sang <b className="font-medium text-gray-700">{p.movedToName}</b></>}
          </div>
        </li>
      ))}
    </ol>
  );
}
