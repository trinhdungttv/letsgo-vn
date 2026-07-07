// Tab Lich — lich thang: ngay dong lai (vang), dao han goc (do); bam ngay xem chi tiet
import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmtVND } from '../../lib/loanCalculations';
import type { Loan, LoanMonthlyConfirmation } from '../../lib/types';
import { estimateMonthInterest, monthKeyOf, CONF_STATUS_CLS } from './loanShared';
import { CONFIRMATION_STATUS_LABELS } from '../../lib/types';

interface Props {
  loans: Loan[];
  confirmations: LoanMonthlyConfirmation[];
}

interface DayEvent { kind: 'pay' | 'mat'; loan: Loan; text: string; amount: number }

export function LoanCalendarTab({ loans, confirmations }: Props) {
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() }); // m: 0-11
  const [selDay, setSelDay] = useState<number>(today.getDate());
  const active = useMemo(() => loans.filter(l => l.status === 'active'), [loans]);
  const monthKey = monthKeyOf(new Date(ym.y, ym.m, 1));

  const events = useMemo(() => {
    const m: Record<number, DayEvent[]> = {};
    const push = (d: number, e: DayEvent) => { (m[d] = m[d] || []).push(e); };
    for (const l of active) {
      if (l.payment_day) {
        push(l.payment_day, { kind: 'pay', loan: l, text: `${l.label} · lãi`, amount: estimateMonthInterest(l, ym.y, ym.m + 1) });
      }
      if (l.maturity_date) {
        const md = new Date(l.maturity_date);
        if (md.getFullYear() === ym.y && md.getMonth() === ym.m) {
          push(md.getDate(), { kind: 'mat', loan: l, text: `ĐÁO ${l.label}`, amount: l.principal });
        }
      }
    }
    return m;
  }, [active, ym]);

  const firstDow = new Date(ym.y, ym.m, 1).getDay(); // 0=CN
  const nDays = new Date(ym.y, ym.m + 1, 0).getDate();
  const isCurMonth = ym.y === today.getFullYear() && ym.m === today.getMonth();
  const selEvents = events[selDay] ?? [];

  const nav = (d: number) => {
    const nd = new Date(ym.y, ym.m + d, 1);
    setYm({ y: nd.getFullYear(), m: nd.getMonth() });
    setSelDay(1);
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] font-semibold">📅 Tháng {ym.m + 1}/{ym.y}</div>
          <div className="flex gap-1">
            <button onClick={() => nav(-1)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft size={13} /></button>
            <button onClick={() => { setYm({ y: today.getFullYear(), m: today.getMonth() }); setSelDay(today.getDate()); }} className="px-2.5 py-1 text-[11px] rounded-lg border border-gray-200 hover:bg-gray-50">Hôm nay</button>
            <button onClick={() => nav(1)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight size={13} /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map(d => (
            <div key={d} className="text-center text-[10px] font-bold text-gray-400 py-1">{d}</div>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => <div key={'e' + i} />)}
          {Array.from({ length: nDays }, (_, i) => i + 1).map(d => {
            const evs = events[d] ?? [];
            const isToday = isCurMonth && d === today.getDate();
            const isSel = d === selDay;
            return (
              <button key={d} onClick={() => setSelDay(d)}
                className={`min-h-[58px] text-left rounded-lg border p-1 transition ${isSel ? 'border-blue-500 border-[1.5px]' : isToday ? 'border-teal-500 border-[1.5px] bg-teal-50/40' : 'border-gray-100 hover:border-blue-200'}`}>
                <div className={`text-[11px] font-bold ${isToday ? 'text-teal-600' : 'text-gray-700'}`}>{d}</div>
                {evs.slice(0, 2).map((e, i) => (
                  <div key={i} className={`text-[8.5px] font-bold px-1 py-px rounded mt-0.5 truncate ${e.kind === 'mat' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{e.text}</div>
                ))}
                {evs.length > 2 && <div className="text-[8.5px] text-gray-400 px-1">+{evs.length - 2}</div>}
              </button>
            );
          })}
        </div>
        <div className="text-[10.5px] text-gray-400 mt-2">🟡 đóng lãi · 🔴 đáo hạn gốc · viền xanh = hôm nay</div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="text-[12px] font-semibold text-gray-700 mb-2">📌 Ngày {selDay}/{ym.m + 1}/{ym.y}</div>
        {selEvents.length === 0 ? (
          <div className="text-[11px] text-gray-400 py-2">Không có việc khoản vay trong ngày này.</div>
        ) : (
          <table className="w-full text-[11.5px]">
            <tbody>
              {selEvents.map((e, i) => {
                const conf = confirmations.find(c => c.loan_id === e.loan.id && c.month === monthKey);
                return (
                  <tr key={i} className="border-t border-gray-50 first:border-0">
                    <td className="py-2 pr-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${e.kind === 'mat' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                        {e.kind === 'mat' ? '🔴 Đáo hạn gốc' : '🟡 Đóng lãi'}
                      </span>
                    </td>
                    <td className="py-2 pr-2 font-medium">{e.loan.label} — {e.loan.bank_name} <span className="text-gray-400">({e.loan.borrower_name})</span></td>
                    <td className="py-2 pr-2 text-right font-semibold">{e.kind === 'mat' ? fmtVND(e.amount) : '~' + fmtVND(e.amount)}</td>
                    <td className="py-2 text-right">
                      {e.kind === 'pay' && (
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${CONF_STATUS_CLS[conf?.status ?? 'pending']}`}>
                          {CONFIRMATION_STATUS_LABELS[conf?.status ?? 'pending']}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
