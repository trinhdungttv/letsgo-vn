// Tab Dong tien — nhu cau tien mat 30 ngay toi + diem cang thanh khoan
import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { fmtVND } from '../../lib/loanCalculations';
import type { Loan, LoanRenewal } from '../../lib/types';
import { estimateMonthInterest, daysTo, CHART_COLORS } from './loanShared';

interface Props {
  loans: Loan[];
  renewals: LoanRenewal[];
}

interface CashDay { date: Date; label: string; interest: number; principalRisk: number; items: string[] }

export function LoanCashflowTab({ loans, renewals }: Props) {
  const active = useMemo(() => loans.filter(l => l.status === 'active'), [loans]);

  const days = useMemo((): CashDay[] => {
    const out: CashDay[] = [];
    for (let i = 1; i <= 30; i++) {
      const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0);
      const day: CashDay = { date: d, label: `${d.getDate()}/${d.getMonth() + 1}`, interest: 0, principalRisk: 0, items: [] };
      for (const l of active) {
        if (l.payment_day === d.getDate()) {
          const amt = estimateMonthInterest(l, d.getFullYear(), d.getMonth() + 1);
          day.interest += amt;
          day.items.push(`Lãi ${l.label}: ~${fmtVND(amt)}`);
        }
        if (l.maturity_date) {
          const md = new Date(l.maturity_date); md.setHours(0, 0, 0, 0);
          if (md.getTime() === d.getTime()) {
            // Goc den han — neu ho so dao chua toi buoc "da nop tien dao" thi coi la rui ro tien mat
            const rn = renewals.find(r => r.loan_id === l.id && r.status !== 'completed' && r.status !== 'rejected');
            const safe = rn && (rn.status === 'deposited' || rn.status === 'redisbursed');
            if (!safe) {
              day.principalRisk += l.principal;
              day.items.push(`🔴 GỐC ${l.label}: ${fmtVND(l.principal)} (nếu chưa đáo xong)`);
            } else {
              day.items.push(`Gốc ${l.label}: đã nộp tiền đáo ✓`);
            }
          }
        }
      }
      out.push(day);
    }
    return out;
  }, [active, renewals]);

  const stressPoints = useMemo(() =>
    days.filter(d => d.interest + d.principalRisk > 0)
      .map(d => ({ ...d, total: d.interest + d.principalRisk }))
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
  [days]);

  const weeks = useMemo(() => {
    const w: { label: string; total: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const chunk = days.slice(i * 7, i * 7 + 7);
      if (chunk.length === 0) continue;
      const total = chunk.reduce((s, d) => s + d.interest + d.principalRisk, 0);
      w.push({ label: `${chunk[0].label} – ${chunk[chunk.length - 1].label}`, total });
    }
    return w;
  }, [days]);

  const maxWeek = Math.max(...weeks.map(w => w.total), 1);
  const hasData = active.length > 0;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="text-[12px] font-semibold text-gray-700 mb-2">💧 Nhu cầu tiền mặt 30 ngày tới</div>
        {!hasData ? (
          <div className="text-[12px] text-gray-400 py-8 text-center">Chưa có khoản vay để dự báo dòng tiền</div>
        ) : (
          <div className="h-[220px]">
            <Bar
              data={{
                labels: days.map(d => d.label),
                datasets: [
                  { label: 'Lãi phải nộp', data: days.map(d => d.interest), backgroundColor: CHART_COLORS[4], borderRadius: 3, stack: 's' },
                  { label: 'Gốc đến hạn (chưa đáo xong)', data: days.map(d => d.principalRisk), backgroundColor: CHART_COLORS[0], borderRadius: 3, stack: 's' },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtVND(c.raw as number)}` } } },
                scales: { x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { stacked: true, ticks: { callback: v => fmtVND(v as number) } } },
              }}
            />
          </div>
        )}
        <div className="text-[10.5px] text-gray-400 mt-2">
          Cột đỏ = gốc đến hạn mà hồ sơ đáo <b>chưa tới bước «Đã nộp tiền đáo»</b> — xử lý ở tab Đáo hạn &amp; Tái vay để cột đỏ biến mất.
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Điểm căng thanh khoản</div>
          {stressPoints.length === 0 ? (
            <div className="text-[11px] text-gray-400 py-4 text-center">30 ngày tới không có khoản phải chi</div>
          ) : (
            <table className="w-full text-[11.5px]">
              <thead><tr className="text-gray-400 text-left text-[10px] uppercase">
                <th className="py-1.5 pr-2 font-medium">Ngày</th><th className="py-1.5 pr-2 font-medium">Khoản phải chi</th>
                <th className="py-1.5 pr-2 font-medium text-right">Số tiền</th><th className="py-1.5 font-medium">Mức độ</th>
              </tr></thead>
              <tbody>
                {stressPoints.map((d, i) => {
                  const level = d.principalRisk > 0 ? { l: 'Nguy hiểm', c: 'bg-red-50 text-red-700 border-red-200' }
                    : d.total > 100_000_000 ? { l: 'Trung bình', c: 'bg-amber-50 text-amber-700 border-amber-200' }
                    : { l: 'Nhẹ', c: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
                  return (
                    <tr key={i} className="border-t border-gray-50 align-top">
                      <td className="py-2 pr-2 font-bold whitespace-nowrap">{d.label}</td>
                      <td className="py-2 pr-2 text-gray-600">{d.items.map((it, j) => <div key={j}>{it}</div>)}</td>
                      <td className={`py-2 pr-2 text-right font-bold ${d.principalRisk > 0 ? 'text-red-600' : ''}`}>{fmtVND(d.total)}</td>
                      <td className="py-2"><span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${level.c}`}>{level.l}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-3">Tổng nhu cầu theo tuần</div>
          <div className="space-y-2.5">
            {weeks.map((w, i) => (
              <div key={i}>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="font-semibold">{w.label}</span>
                  <span>{fmtVND(w.total)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(w.total / maxWeek * 100, 100)}%`, background: w.total === maxWeek && w.total > 0 ? '#dc2626' : '#0d9488' }} />
                </div>
              </div>
            ))}
          </div>
          <div className="text-[10.5px] text-gray-400 mt-3">
            Sắp đáo hạn trong 14 ngày: {active.filter(l => l.maturity_date && daysTo(l.maturity_date) >= 0 && daysTo(l.maturity_date) <= 14).length} khoản.
            Lãi ước tính dựa trên dư nợ hiện tại, ngày thực/365.
          </div>
        </div>
      </div>
    </div>
  );
}
