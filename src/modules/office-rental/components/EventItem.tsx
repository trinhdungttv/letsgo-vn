/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import {
  AlertCircle, AlarmClock, CalendarPlus, Check, DoorOpen, ExternalLink, FileText, LogOut,
  MonitorSmartphone, PenLine, Receipt, RotateCcw, TrendingUp, Unlink, Wallet, Wrench, Zap,
} from 'lucide-react';
import { useOffice } from '../data/OfficeDataProvider';
import { KIND_LABEL, type EventKind, type OfficeEvent, type Severity } from '../lib/events';
import { fmtTr } from '../lib/calc/money';
import { todayStr } from '../lib/ops';

const ICON: Record<EventKind, ReactNode> = {
  contract_end: <FileText size={15} />, contract_start: <CalendarPlus size={15} />, lease_increase: <TrendingUp size={15} />,
  lease_end: <LogOut size={15} />, invoice_overdue: <AlertCircle size={15} />, invoice_due: <Receipt size={15} />,
  missing_invoice: <Receipt size={15} />, missing_revenue: <PenLine size={15} />, missing_opex: <PenLine size={15} />,
  meter_due: <Zap size={15} />, forecast_expense: <Wallet size={15} />, room_vacant: <DoorOpen size={15} />,
  unassigned_tenant: <Unlink size={15} />, ticket: <Wrench size={15} />, asset: <MonitorSmartphone size={15} />,
};

export const SEV_STYLE: Record<Severity, { bar: string; icon: string; chip: string; label: string }> = {
  critical: { bar: 'bg-red-500', icon: 'bg-red-50 text-red-600', chip: 'bg-red-50 text-red-700', label: 'Khẩn' },
  warning: { bar: 'bg-amber-400', icon: 'bg-amber-50 text-amber-700', chip: 'bg-amber-50 text-amber-800', label: 'Chú ý' },
  info: { bar: 'bg-blue-400', icon: 'bg-blue-50 text-blue-600', chip: 'bg-blue-50 text-blue-700', label: 'Sắp tới' },
};

export function whenLabel(e: OfficeEvent): string | null {
  if (e.daysLeft === null) return null;
  if (e.kind === 'ticket') return `mở ${-e.daysLeft} ngày`;
  if (e.daysLeft === 0) return 'hôm nay';
  if (e.daysLeft > 0) return e.daysLeft >= 45 ? `còn ~${Math.round(e.daysLeft / 30)} tháng` : `còn ${e.daysLeft} ngày`;
  return `quá ${-e.daysLeft} ngày`;
}

/** Ý nghĩa số tiền theo loại sự kiện. */
export function amountLabel(e: OfficeEvent): string {
  const v = fmtTr(Math.abs(e.amount || 0));
  switch (e.kind) {
    case 'invoice_overdue': return `${v} tr chưa thu`;
    case 'forecast_expense': return `${v} tr`;
    case 'lease_increase': return `${(e.amount || 0) >= 0 ? '+' : '−'}${v} tr/tháng chi phí`;
    case 'room_vacant': return `−${v} tr/tháng thất thu`;
    case 'contract_end': return `${v} tr/tháng doanh thu`;
    default: return `${v} tr`;
  }
}

function plusDays(today: string, n: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export default function EventItem({ e, hidden, compact, onOpen }: { e: OfficeEvent; hidden?: boolean; compact?: boolean; onOpen?: () => void }) {
  const { setNotification, rows } = useOffice();
  const st = SEV_STYLE[e.severity];
  const when = whenLabel(e);
  const today = todayStr();
  const state = rows.bds_notification_states.find(s => s.event_key === e.key);
  const go = () => { onOpen?.(); window.location.hash = e.href.replace(/^#/, ''); };
  const snoozeDays = e.daysLeft !== null && e.daysLeft > 14 ? Math.min(30, e.daysLeft - 7) : 7;
  return (
    <div className="relative flex gap-2.5 rounded-lg border border-gray-100 bg-white pl-3 pr-2.5 py-2 overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${st.bar}`} />
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${st.icon}`}>{ICON[e.kind]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{KIND_LABEL[e.kind]}</span>
          {when && <span className={`text-[10.5px] font-semibold px-1.5 rounded ${st.chip}`}>{when}</span>}
          {e.amount !== undefined && e.amount !== 0 && (
            <span className={`text-[10.5px] font-semibold ${e.amount > 0 ? 'text-red-600' : 'text-amber-700'}`}>{amountLabel(e)}</span>
          )}
        </div>
        <button onClick={go} className="text-left text-[12.5px] font-medium text-[#111] hover:text-blue-700 leading-snug">{e.title}</button>
        {e.detail && !compact && <div className="text-[11.5px] text-gray-500 leading-snug mt-0.5">{e.detail}</div>}
        {hidden && state && (
          <div className="text-[10.5px] text-gray-400 mt-0.5">
            {state.status === 'dismissed' ? 'Đã đánh dấu xử lý' : `Nhắc lại từ ${state.snooze_until?.split('-').reverse().join('/')}`}
          </div>
        )}
        <div className="flex flex-wrap gap-1 mt-1.5">
          <button onClick={go} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"><ExternalLink size={11} /> Mở</button>
          {hidden ? (
            <button onClick={() => setNotification(e.key, null)} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"><RotateCcw size={11} /> Hiện lại</button>
          ) : (
            <>
              <button
                onClick={() => setNotification(e.key, 'snoozed', plusDays(today, snoozeDays))}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                title="Tạm ẩn, tự hiện lại sau"
              >
                <AlarmClock size={11} /> Nhắc lại sau {snoozeDays} ngày
              </button>
              <button onClick={() => setNotification(e.key, 'dismissed')} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-emerald-200 text-emerald-700 hover:bg-emerald-50"><Check size={11} /> Đã xử lý</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
