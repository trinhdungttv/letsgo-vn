// Tab Rui ro & CIC — diem ky luat, tap trung theo nguoi dung ten, phoi nhiem lai tha noi
import { useMemo } from 'react';
import { Shield } from 'lucide-react';
import { fmtVND } from '../../lib/loanCalculations';
import type { Loan, LoanMonthlyConfirmation } from '../../lib/types';

interface Props {
  loans: Loan[];
  confirmations: LoanMonthlyConfirmation[];
}

export function LoanRiskTab({ loans, confirmations }: Props) {
  const active = useMemo(() => loans.filter(l => l.status === 'active'), [loans]);
  const total = active.reduce((s, l) => s + l.principal, 0);

  // Diem ky luat: 12 thang gan nhat — tru diem theo lan tre / CIC
  const discipline = useMemo(() => {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 12);
    const recent = confirmations.filter(c => c.month >= `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`);
    const overdue = recent.filter(c => c.status === 'overdue').length;
    const cic = recent.filter(c => c.cic_risk).length;
    const score = Math.max(0, 100 - overdue * 4 - cic * 15);
    return { score, overdue, cic, totalTracked: recent.length };
  }, [confirmations]);

  // Tap trung theo nguoi dung ten
  const byBorrower = useMemo(() => {
    const m: Record<string, { bal: number; count: number }> = {};
    active.forEach(l => {
      m[l.borrower_name] = m[l.borrower_name] || { bal: 0, count: 0 };
      m[l.borrower_name].bal += l.principal;
      m[l.borrower_name].count += 1;
    });
    return Object.entries(m).sort((a, b) => b[1].bal - a[1].bal);
  }, [active]);

  // Phoi nhiem tha noi
  const floatBal = active.filter(l => l.rate_type === 'floating').reduce((s, l) => s + l.principal, 0);
  const floatPct = total > 0 ? floatBal / total * 100 : 0;

  // CIC theo nguoi: co khoan nao cua nguoi do dinh cic_risk / overdue khong
  const cicByBorrower = useMemo(() => byBorrower.map(([name, info]) => {
    const loanIds = active.filter(l => l.borrower_name === name).map(l => l.id);
    const risky = confirmations.filter(c => loanIds.includes(c.loan_id) && (c.cic_risk || c.status === 'overdue'));
    return { name, ...info, riskyCount: risky.length, lastEvent: risky[0] ?? null };
  }), [byBorrower, active, confirmations]);

  const ringDeg = discipline.score / 100 * 360;
  const scoreColor = discipline.score >= 90 ? '#059669' : discipline.score >= 70 ? '#d97706' : '#dc2626';

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-3 gap-3">
        {/* Diem ky luat */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <div className="text-[12px] font-semibold text-gray-700 mb-3 flex items-center justify-center gap-1.5">
            <Shield size={13} className="text-teal-600" /> Điểm kỷ luật thanh toán
          </div>
          <div className="w-[110px] h-[110px] rounded-full mx-auto flex items-center justify-center"
            style={{ background: `conic-gradient(${scoreColor} 0 ${ringDeg}deg, #e5e7eb ${ringDeg}deg 360deg)` }}>
            <div className="w-[84px] h-[84px] rounded-full bg-white flex flex-col items-center justify-center">
              <span className="text-[24px] font-extrabold" style={{ color: scoreColor }}>{discipline.score}</span>
              <span className="text-[9px] text-gray-400">/100</span>
            </div>
          </div>
          <div className="text-[10.5px] text-gray-400 mt-3 leading-relaxed">
            12 tháng gần nhất: {discipline.overdue} lần trễ hạn · {discipline.cic} lần chạm ngưỡng CIC.<br />
            {discipline.score >= 90 ? 'Kỷ luật tốt — tài sản quý nhất để tái vay thuận lợi.' : 'Cần siết lại kỷ luật nộp đúng hạn.'}
          </div>
        </div>

        {/* Tap trung rui ro */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-3">Tập trung rủi ro theo người đứng tên</div>
          <div className="space-y-2.5">
            {byBorrower.map(([name, info]) => {
              const pct = total > 0 ? info.bal / total * 100 : 0;
              const col = pct > 50 ? '#dc2626' : pct > 25 ? '#d97706' : '#0d9488';
              return (
                <div key={name}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="font-semibold">{name}</span>
                    <span>{fmtVND(info.bal)} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
                  </div>
                </div>
              );
            })}
          </div>
          {byBorrower[0] && total > 0 && byBorrower[0][1].bal / total > 0.5 && (
            <div className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mt-3 leading-relaxed">
              ⚠ <b>{Math.round(byBorrower[0][1].bal / total * 100)}% dư nợ dồn vào CIC của {byBorrower[0][0]}</b> — một lần trễ sẽ ảnh hưởng
              việc tái vay của toàn bộ {fmtVND(byBorrower[0][1].bal)}. Khoản mới nên cân nhắc người đứng tên khác.
            </div>
          )}
        </div>

        {/* Phoi nhiem tha noi */}
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">Phơi nhiễm lãi suất thả nổi</div>
          <div className="text-[26px] font-extrabold text-amber-600">{floatPct.toFixed(0)}%</div>
          <div className="text-[10.5px] text-gray-400">{fmtVND(floatBal)} / {fmtVND(total)} đang chịu lãi thả nổi</div>
          <table className="w-full text-[11px] mt-3">
            <tbody>
              {[0.5, 1, 2].map(delta => (
                <tr key={delta} className="border-t border-gray-50">
                  <td className="py-1.5 text-gray-500">Nếu lãi +{delta}%</td>
                  <td className="py-1.5 text-right font-bold text-red-600">+{fmtVND(floatBal * delta / 100 / 12)}/tháng</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-gray-400 mt-2">Đổi lãi suất trong form Sửa = hệ thống tự ghi thêm dòng lịch sử lãi, không đè số cũ.</div>
        </div>
      </div>

      {/* Nhom no CIC theo nguoi */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="text-[12px] font-semibold text-gray-700 mb-3">Nhóm nợ CIC theo người đứng tên</div>
        <table className="w-full text-[11.5px]">
          <thead><tr className="text-gray-400 text-left text-[10px] uppercase">
            <th className="py-1.5 pr-2 font-medium">Người đứng tên</th><th className="py-1.5 pr-2 font-medium text-right">Dư nợ</th>
            <th className="py-1.5 pr-2 font-medium text-right">Số khoản</th><th className="py-1.5 pr-2 font-medium">Đánh giá</th><th className="py-1.5 font-medium">Sự kiện</th>
          </tr></thead>
          <tbody>
            {cicByBorrower.map(b => (
              <tr key={b.name} className="border-t border-gray-50">
                <td className="py-2 pr-2 font-semibold">{b.name}</td>
                <td className="py-2 pr-2 text-right">{fmtVND(b.bal)}</td>
                <td className="py-2 pr-2 text-right">{b.count}</td>
                <td className="py-2 pr-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${b.riskyCount === 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                    {b.riskyCount === 0 ? 'Nhóm 1 — Đủ chuẩn' : `⚠ ${b.riskyCount} sự kiện rủi ro`}
                  </span>
                </td>
                <td className="py-2 text-[10.5px] text-gray-400">{b.riskyCount === 0 ? 'Không có nợ quá hạn' : `Gần nhất: kỳ ${b.lastEvent?.month}`}</td>
              </tr>
            ))}
            {cicByBorrower.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-gray-400 text-[11px]">Chưa có khoản vay</td></tr>}
          </tbody>
        </table>
        <div className="text-[10px] text-gray-400 mt-2">Nhóm nợ chính thức tra trên CIC — bảng này là cảnh báo nội bộ dựa trên lịch sử nộp trong hệ thống (trễ &gt;10 ngày = chạm ngưỡng).</div>
      </div>
    </div>
  );
}
