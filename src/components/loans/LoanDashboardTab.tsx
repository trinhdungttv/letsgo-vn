// Tab Dashboard — 5 KPI + bang "Can xu ly ngay" + 7 bieu do
import { useMemo } from 'react';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, BarElement,
  LineElement, PointElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { AlertTriangle } from 'lucide-react';
import { fmtVND, fmtRate } from '../../lib/loanCalculations';
import { RENEWAL_STATUS_LABELS, BORROWER_TYPE_LABELS } from '../../lib/types';
import type { Loan, LoanMonthlyConfirmation, LoanPaymentHistory, LoanRenewal } from '../../lib/types';
import { estimateMonthInterest, daysTo, monthKeyOf, CHART_COLORS, RENEWAL_STATUS_CLS } from './loanShared';

ChartJS.register(CategoryScale, LinearScale, LogarithmicScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler);

interface Props {
  loans: Loan[];
  confirmations: LoanMonthlyConfirmation[];
  payments: LoanPaymentHistory[];
  renewals: LoanRenewal[];
}

export function LoanDashboardTab({ loans, confirmations, payments, renewals }: Props) {
  const active = useMemo(() => loans.filter(l => l.status === 'active'), [loans]);
  const now = new Date();
  const curMonth = monthKeyOf(now);
  const totalPrincipal = active.reduce((s, l) => s + l.principal, 0);
  const totalInterest = active.reduce((s, l) => s + estimateMonthInterest(l, now.getFullYear(), now.getMonth() + 1), 0);
  const wacc = totalPrincipal > 0 ? active.reduce((s, l) => s + l.interest_rate * l.principal, 0) / totalPrincipal : 0;
  const paidCount = confirmations.filter(c => c.month === curMonth && c.status === 'paid').length;
  const cicCount = confirmations.filter(c => c.month === curMonth && c.cic_risk).length;

  // ── Can xu ly ngay ──
  const urgent = useMemo(() => {
    const items: { label: string; loan: string; deadline: string; amount: string; chip: string; chipCls: string; sort: number }[] = [];
    const today = now.getDate();
    for (const l of active) {
      // Dao han <= 21 ngay
      if (l.maturity_date) {
        const d = daysTo(l.maturity_date);
        if (d >= 0 && d <= 21) {
          const rn = renewals.find(r => r.loan_id === l.id && r.status !== 'completed' && r.status !== 'rejected');
          const st = rn?.status ?? 'pending';
          items.push({
            label: '🔄 ' + (st === 'pending' ? 'Liên hệ NH chuẩn bị đáo hạn' : 'Theo dõi hồ sơ đáo hạn'),
            loan: `${l.label} — ${l.bank_name}`,
            deadline: `Đáo hạn ${new Date(l.maturity_date).toLocaleDateString('vi-VN')} · còn ${d} ngày`,
            amount: fmtVND(l.principal), chip: RENEWAL_STATUS_LABELS[st], chipCls: RENEWAL_STATUS_CLS[st], sort: d,
          });
        }
      }
      // Ngay dong lai trong 7 ngay toi, chua xac nhan
      if (l.payment_day) {
        const dd = l.payment_day - today;
        if (dd >= 0 && dd <= 7) {
          const conf = confirmations.find(c => c.loan_id === l.id && c.month === curMonth);
          if (!conf || conf.status === 'pending') {
            items.push({
              label: '✏️ Hỏi NH lãi chính xác (B1)',
              loan: `${l.label} — ${l.bank_name}`,
              deadline: `Đóng lãi ngày ${l.payment_day} · còn ${dd} ngày`,
              amount: '~' + fmtVND(estimateMonthInterest(l, now.getFullYear(), now.getMonth() + 1)),
              chip: 'Chưa xác nhận', chipCls: 'bg-amber-50 text-amber-700 border-amber-200', sort: dd,
            });
          }
        }
      }
    }
    // Tre han / CIC
    confirmations.filter(c => c.month === curMonth && (c.status === 'overdue' || c.cic_risk)).forEach(c => {
      const l = loans.find(x => x.id === c.loan_id);
      if (l) items.push({
        label: '🚨 Nộp trễ — rủi ro CIC', loan: `${l.label} — ${l.bank_name}`,
        deadline: `Hạn ngày ${l.payment_day ?? '?'} đã qua`, amount: fmtVND(c.amount_to_pay ?? 0),
        chip: 'Xử lý ngay', chipCls: 'bg-red-50 text-red-700 border-red-200', sort: -99,
      });
    });
    return items.sort((a, b) => a.sort - b.sort).slice(0, 8);
  }, [active, renewals, confirmations, loans, curMonth, now]);

  // ── Du lieu bieu do ──
  const bySource = useMemo(() => {
    const m: Record<string, number> = {};
    active.forEach(l => { const k = BORROWER_TYPE_LABELS[l.borrower_type]; m[k] = (m[k] || 0) + l.principal; });
    return m;
  }, [active]);

  const byBorrower = useMemo(() => {
    const m: Record<string, number> = {};
    active.forEach(l => { m[l.borrower_name] = (m[l.borrower_name] || 0) + l.principal; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [active]);

  // Lai 6 thang: thuc nop (payment_history) vs uoc tinh (confirmations)
  const sixMonths = useMemo(() => {
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(monthKeyOf(d));
    }
    const paid = keys.map(k => payments.filter(p => p.paid_date?.startsWith(k)).reduce((s, p) => s + p.interest_paid, 0));
    const est = keys.map(k => confirmations.filter(c => c.month === k).reduce((s, c) => s + (c.estimated_interest ?? 0), 0));
    return { labels: keys.map(k => 'T' + parseInt(k.split('-')[1])), paid, est };
  }, [payments, confirmations, now]);

  // Thang dao han theo thang
  const maturityLadder = useMemo(() => {
    const m: Record<string, number> = {};
    active.forEach(l => {
      if (!l.maturity_date) return;
      const k = l.maturity_date.slice(0, 7);
      const far = new Date(l.maturity_date).getFullYear() > now.getFullYear() + 1;
      const key = far ? 'Sau đó' : 'T' + parseInt(k.split('-')[1]) + '/' + k.slice(2, 4);
      m[key] = (m[key] || 0) + l.principal;
    });
    return Object.entries(m);
  }, [active, now]);

  const floatBal = active.filter(l => l.rate_type === 'floating').reduce((s, l) => s + l.principal, 0);

  const chartOpts = { maintainAspectRatio: false as const, plugins: { legend: { display: false } } };
  const money = (v: number) => fmtVND(v);

  return (
    <div className="space-y-4">
      {/* KPI — tong no, tong lai ro rang */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Tổng dư nợ', value: fmtVND(totalPrincipal), sub: `${active.length} khoản đang theo dõi`, color: 'border-t-red-500' },
          { label: 'Tổng lãi tháng này', value: fmtVND(totalInterest), sub: 'ngày thực/365', color: 'border-t-amber-500' },
          { label: 'Đã đóng', value: `${paidCount}/${active.length}`, sub: `Tháng ${curMonth.split('-')[1]}`, color: 'border-t-teal-500' },
          { label: 'Chi phí vốn BQ', value: fmtRate(wacc), sub: 'WACC toàn danh mục', color: 'border-t-blue-500' },
          { label: 'CIC Risk', value: String(cicCount), sub: cicCount > 0 ? 'Khoản có rủi ro' : 'An toàn', color: cicCount > 0 ? 'border-t-red-500' : 'border-t-green-500' },
        ].map((k, i) => (
          <div key={i} className={`bg-white rounded-xl border border-gray-100 p-3 border-t-[3px] ${k.color}`}>
            <div className="text-[9.5px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{k.label}</div>
            <div className="text-[19px] font-semibold leading-tight">{k.value}</div>
            <div className="text-[10px] text-gray-400 mt-1">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Can xu ly ngay */}
      <div className="bg-white rounded-xl border-[1.5px] border-red-200 p-4">
        <div className="text-[12px] font-semibold text-red-600 mb-3 flex items-center gap-1.5">
          <AlertTriangle size={13} /> Cần xử lý ngay
        </div>
        {urgent.length === 0 ? (
          <div className="text-[11px] text-gray-400 py-3 text-center">Không có việc gấp — mọi khoản trong tầm kiểm soát ✓</div>
        ) : (
          <table className="w-full text-[11.5px]">
            <thead><tr className="text-gray-400 text-left text-[10px] uppercase">
              <th className="py-1.5 pr-2 font-medium">Việc</th><th className="py-1.5 pr-2 font-medium">Khoản vay</th>
              <th className="py-1.5 pr-2 font-medium">Hạn chót</th><th className="py-1.5 pr-2 font-medium text-right">Số tiền</th><th className="py-1.5 font-medium">Trạng thái</th>
            </tr></thead>
            <tbody>
              {urgent.map((u, i) => (
                <tr key={i} className="border-t border-gray-50">
                  <td className="py-2 pr-2 font-medium">{u.label}</td>
                  <td className="py-2 pr-2 text-gray-600">{u.loan}</td>
                  <td className={`py-2 pr-2 font-semibold ${u.sort <= 14 ? 'text-red-600' : 'text-amber-600'}`}>{u.deadline}</td>
                  <td className="py-2 pr-2 text-right font-semibold">{u.amount}</td>
                  <td className="py-2"><span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${u.chipCls}`}>{u.chip}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 7 bieu do */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Dư nợ theo nguồn vay</div>
          <div className="h-[190px]">
            <Doughnut data={{ labels: Object.keys(bySource), datasets: [{ data: Object.values(bySource), backgroundColor: [CHART_COLORS[1], CHART_COLORS[3], CHART_COLORS[4]], borderWidth: 2 }] }}
              options={{ maintainAspectRatio: false, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => ` ${c.label}: ${money(c.raw as number)}` } } } }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">
            Dư nợ theo người đứng tên
            {byBorrower[0] && totalPrincipal > 0 && byBorrower[0][1] / totalPrincipal > 0.5 && (
              <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                {byBorrower[0][0]} {Math.round(byBorrower[0][1] / totalPrincipal * 100)}% ⚠
              </span>
            )}
          </div>
          <div className="h-[190px]">
            <Bar data={{ labels: byBorrower.map(e => e[0]), datasets: [{ data: byBorrower.map(e => e[1]), backgroundColor: CHART_COLORS, borderRadius: 5 }] }}
              options={{ ...chartOpts, indexAxis: 'y', plugins: { ...chartOpts.plugins, tooltip: { callbacks: { label: c => ' ' + money(c.raw as number) } } }, scales: { x: { ticks: { callback: v => money(v as number) } } } }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Lãi 6 tháng — thực nộp vs ước tính</div>
          <div className="h-[190px]">
            <Bar data={{ labels: sixMonths.labels, datasets: [
              { label: 'Thực nộp', data: sixMonths.paid, backgroundColor: CHART_COLORS[2], borderRadius: 4 },
              { label: 'Ước tính', data: sixMonths.est, backgroundColor: '#cbd5e1', borderRadius: 4 },
            ] }}
              options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => money(v as number) } } } }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Thang đáo hạn — dư nợ đến hạn theo tháng</div>
          <div className="h-[190px]">
            <Bar data={{ labels: maturityLadder.map(e => e[0]), datasets: [{ data: maturityLadder.map(e => e[1]), backgroundColor: maturityLadder.map((_, i) => i === 0 ? CHART_COLORS[0] : i === 1 ? CHART_COLORS[4] : CHART_COLORS[2]), borderRadius: 5 }] }}
              options={{ ...chartOpts, plugins: { ...chartOpts.plugins, tooltip: { callbacks: { label: c => ' Đến hạn: ' + money(c.raw as number) } } }, scales: { y: { ticks: { callback: v => money(v as number) } } } }} />
          </div>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Thả nổi vs cố định</div>
          <div className="h-[150px]">
            <Doughnut data={{ labels: ['Thả nổi', 'Cố định'], datasets: [{ data: [floatBal, totalPrincipal - floatBal], backgroundColor: [CHART_COLORS[4], CHART_COLORS[2]], borderWidth: 2 }] }}
              options={{ maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom' } } }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Lãi ước tính theo khoản (tháng này)</div>
          <div className="h-[150px]">
            <Bar data={{ labels: active.slice().sort((a, b) => b.principal - a.principal).slice(0, 6).map(l => l.label),
              datasets: [{ data: active.slice().sort((a, b) => b.principal - a.principal).slice(0, 6).map(l => estimateMonthInterest(l, now.getFullYear(), now.getMonth() + 1)), backgroundColor: CHART_COLORS[4], borderRadius: 4 }] }}
              options={{ ...chartOpts, scales: { y: { ticks: { callback: v => money(v as number) } } } }} />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Đóng lãi tháng {parseInt(curMonth.split('-')[1])}</div>
          <div className="h-[150px]">
            <Doughnut data={{ labels: ['Đã nộp', 'Đã xác nhận', 'Chưa xác nhận'], datasets: [{
              data: [
                paidCount,
                confirmations.filter(c => c.month === curMonth && c.status === 'confirmed').length,
                Math.max(0, active.length - confirmations.filter(c => c.month === curMonth && c.status !== 'pending').length),
              ], backgroundColor: [CHART_COLORS[5], CHART_COLORS[1], '#e5e7eb'], borderWidth: 2 }] }}
              options={{ maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom' } } }} />
          </div>
        </div>
      </div>
      {sixMonths.paid.every(v => v === 0) && (
        <div className="text-[11px] text-gray-400 text-center">Biểu đồ lãi 6 tháng sẽ có số liệu sau khi bạn ghi nhận các lần nộp lãi ở tab «Nhập lãi».</div>
      )}
    </div>
  );
}
