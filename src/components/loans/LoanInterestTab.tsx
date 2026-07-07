// Tab Nhap lai — vong lap van hanh thang: B1 hoi NH -> B2 chot so nop -> B4 nop dung ngay -> B5 cap nhat so
import { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { fmtVND } from '../../lib/loanCalculations';
import { CONFIRMATION_STATUS_LABELS } from '../../lib/types';
import type { Loan, LoanMonthlyConfirmation } from '../../lib/types';
import { estimateMonthInterest, monthKeyOf, CONF_STATUS_CLS } from './loanShared';

interface Props {
  loans: Loan[];
  confirmations: LoanMonthlyConfirmation[];
  onChanged: () => Promise<void>;
  toast: (msg: string) => void;
}

const STEPS = [
  { t: 'B1 · TRƯỚC HẠN ~1 TUẦN', d: 'Gọi NH hỏi lãi chính xác' },
  { t: 'B2 · CHỐT SỐ NỘP', d: 'Lãi NH + đệm 1–2 triệu' },
  { t: 'B3 · CHUẨN BỊ TIỀN', d: 'Xem tab Dòng tiền' },
  { t: 'B4 · NỘP ĐÚNG NGÀY/TK', d: 'Trễ >10 ngày → dính CIC' },
  { t: 'B5 · CẬP NHẬT SỔ', d: 'Không đụng sổ kế toán chính' },
];

export function LoanInterestTab({ loans, confirmations, onChanged, toast }: Props) {
  const { token, user } = useAuth();
  const today = new Date();
  const [month, setMonth] = useState(monthKeyOf(today));
  const [inputs, setInputs] = useState<Record<string, { confirmed?: string; buffer?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const active = useMemo(() => loans.filter(l => l.status === 'active'), [loans]);
  const [yy, mm] = month.split('-').map(Number);

  const rows = useMemo(() => active.map(l => {
    const conf = confirmations.find(c => c.loan_id === l.id && c.month === month);
    const est = conf?.estimated_interest ?? estimateMonthInterest(l, yy, mm);
    const inp = inputs[l.id] ?? {};
    const confirmed = inp.confirmed !== undefined ? Number(inp.confirmed) || 0 : (conf?.confirmed_interest ?? null);
    const buffer = inp.buffer !== undefined ? Number(inp.buffer) || 0 : (conf?.buffer_amount ?? 2_000_000);
    const toPay = confirmed != null && confirmed > 0 ? confirmed + buffer : null;
    // Tre han: qua ngay dong lai cua thang dang xem ma chua nop
    const dueDate = l.payment_day ? new Date(yy, mm - 1, l.payment_day) : null;
    const isOverdue = !!dueDate && today > dueDate && conf?.status !== 'paid';
    const lateDays = isOverdue && dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / 86400000) : 0;
    return { loan: l, conf, est, confirmed, buffer, toPay, isOverdue, lateDays };
  }).sort((a, b) => (a.loan.payment_day ?? 32) - (b.loan.payment_day ?? 32)), [active, confirmations, month, inputs, yy, mm, today]);

  const confirmedCount = rows.filter(r => r.conf && r.conf.status !== 'pending').length;
  const paidCount = rows.filter(r => r.conf?.status === 'paid').length;

  const setInput = (id: string, field: 'confirmed' | 'buffer', v: string) =>
    setInputs(prev => ({ ...prev, [id]: { ...prev[id], [field]: v } }));

  async function saveConfirm(r: typeof rows[0]) {
    if (!token) { toast('Phiên đăng nhập hết hạn'); return; }
    if (r.confirmed == null || r.confirmed <= 0) { toast('Nhập số lãi NH xác nhận trước'); return; }
    setBusy(r.loan.id);
    const { error } = await supabase.rpc('admin_upsert_confirmation', {
      p_token: token, p_loan_id: r.loan.id, p_month: month,
      p_data: { estimated_interest: r.est, confirmed_interest: r.confirmed, buffer_amount: r.buffer, amount_to_pay: r.confirmed + r.buffer, status: 'confirmed' },
    });
    setBusy(null);
    if (error) { toast('Lỗi: ' + error.message); return; }
    await logActivity({ user, action: 'update', table: 'monthly_confirmations', recordId: r.loan.id, description: `Xác nhận lãi ${month} "${r.loan.label}": ${fmtVND(r.confirmed)}` });
    toast(`Đã xác nhận lãi ${r.loan.label}`);
    await onChanged();
  }

  async function markPaid(r: typeof rows[0]) {
    if (!token) { toast('Phiên đăng nhập hết hạn'); return; }
    const amount = r.toPay ?? r.conf?.amount_to_pay ?? r.est;
    if (!confirm(`Ghi nhận đã nộp ${fmtVND(amount)} cho "${r.loan.label}" (kỳ ${month})?`)) return;
    setBusy(r.loan.id);
    const cicRisk = r.lateDays > 10;
    const { error } = await supabase.rpc('admin_record_payment', {
      p_token: token, p_loan_id: r.loan.id,
      p_data: { paid_date: new Date().toISOString().split('T')[0], amount, interest_paid: r.confirmed ?? r.est, fee_paid: 0, month, note: `Nộp lãi kỳ ${month}` },
    });
    if (!error && cicRisk) {
      await supabase.rpc('admin_upsert_confirmation', { p_token: token, p_loan_id: r.loan.id, p_month: month, p_data: { cic_risk: true } });
    }
    setBusy(null);
    if (error) { toast('Lỗi: ' + error.message); return; }
    await logActivity({ user, action: 'insert', table: 'payment_history', recordId: r.loan.id, description: `Nộp lãi ${month} "${r.loan.label}": ${fmtVND(amount)}${cicRisk ? ' (TRỄ >10 ngày — CIC risk)' : ''}` });
    toast(cicRisk ? '⚠ Đã ghi nộp — TRỄ >10 ngày, gắn cờ CIC' : 'Đã ghi nhận nộp lãi ✓');
    await onChanged();
  }

  return (
    <div className="space-y-3">
      {/* 5 buoc quy trinh */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {STEPS.map((s, i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-100 px-3 py-2">
            <div className="text-[9.5px] font-extrabold text-teal-600">{s.t}</div>
            <div className="text-[10.5px] text-gray-500 mt-0.5">{s.d}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="text-[13px] font-semibold flex items-center gap-2">
            ✏️ Nhập lãi tháng
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="text-[12px] px-2 py-1 border border-gray-200 rounded-lg focus:outline-none" />
          </div>
          <div className="flex gap-1.5">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold">Đã xác nhận {confirmedCount}/{rows.length}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">Đã nộp {paidCount}/{rows.length}</span>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-[12px] text-gray-400 py-8 text-center">Chưa có khoản vay nào — thêm ở nút «Thêm khoản vay»</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead><tr className="text-gray-400 text-left text-[10px] uppercase">
                <th className="py-1.5 pr-2 font-medium">Khoản vay</th><th className="py-1.5 pr-2 font-medium">Hạn nộp</th>
                <th className="py-1.5 pr-2 font-medium text-right">Lãi ước tính</th><th className="py-1.5 pr-2 font-medium text-right">Lãi NH xác nhận</th>
                <th className="py-1.5 pr-2 font-medium text-right">Đệm</th><th className="py-1.5 pr-2 font-medium text-right">Phải nộp</th>
                <th className="py-1.5 pr-2 font-medium">Trạng thái</th><th className="py-1.5 font-medium"></th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const status = r.conf?.status === 'paid' ? 'paid' : r.isOverdue ? 'overdue' : (r.conf?.status ?? 'pending');
                  return (
                    <tr key={r.loan.id} className="border-t border-gray-50">
                      <td className="py-2 pr-2">
                        <span className="font-medium">{r.loan.label}</span>
                        <span className="text-gray-400 ml-1 text-[10px]">{r.loan.bank_name} · {r.loan.borrower_name}</span>
                      </td>
                      <td className={`py-2 pr-2 ${r.isOverdue ? 'text-red-600 font-bold' : ''}`}>
                        {r.loan.payment_day ? `Ngày ${r.loan.payment_day}` : '—'}
                        {r.isOverdue && <span className="ml-1 text-[10px]">(trễ {r.lateDays} ng{r.lateDays > 10 ? ' ⚠CIC' : ''})</span>}
                      </td>
                      <td className="py-2 pr-2 text-right text-gray-500">{fmtVND(r.est)}</td>
                      <td className="py-2 pr-2 text-right">
                        {status === 'paid' ? <span className="font-semibold">{fmtVND(r.conf?.confirmed_interest ?? 0)}</span> : (
                          <input type="number" value={inputs[r.loan.id]?.confirmed ?? (r.conf?.confirmed_interest ?? '')}
                            onChange={e => setInput(r.loan.id, 'confirmed', e.target.value)}
                            placeholder="chờ NH..." className="w-28 px-2 py-1 border border-gray-200 rounded-lg text-right text-[11.5px] focus:outline-none focus:border-blue-300" />
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {status === 'paid' ? fmtVND(r.conf?.buffer_amount ?? 0) : (
                          <input type="number" value={inputs[r.loan.id]?.buffer ?? (r.conf?.buffer_amount ?? 2000000)}
                            onChange={e => setInput(r.loan.id, 'buffer', e.target.value)}
                            className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-right text-[11.5px] focus:outline-none focus:border-blue-300" />
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right font-bold">
                        {status === 'paid' ? fmtVND(r.conf?.paid_amount ?? 0) : r.toPay ? fmtVND(r.toPay) : '—'}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${CONF_STATUS_CLS[status]}`}>
                          {CONFIRMATION_STATUS_LABELS[status]}{r.conf?.cic_risk ? ' ⚠CIC' : ''}
                        </span>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {status !== 'paid' && (
                          <>
                            <button onClick={() => saveConfirm(r)} disabled={busy === r.loan.id}
                              className="text-[10.5px] px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 font-semibold mr-1 disabled:opacity-40">Xác nhận</button>
                            <button onClick={() => markPaid(r)} disabled={busy === r.loan.id}
                              className="text-[10.5px] px-2 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 font-semibold disabled:opacity-40">Đã nộp ✓</button>
                          </>
                        )}
                        {status === 'paid' && <span className="text-[10px] text-gray-400">{r.conf?.paid_date ? new Date(r.conf.paid_date).toLocaleDateString('vi-VN') : ''}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="text-[10.5px] text-gray-400 mt-3">
          «Xác nhận» lưu số lãi NH báo (B1–B2). «Đã nộp ✓» ghi vào lịch sử đóng tiền (B4–B5) — nộp trễ quá 10 ngày hệ thống tự gắn cờ ⚠CIC.
        </div>
      </div>
    </div>
  );
}
