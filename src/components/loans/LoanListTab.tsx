// Tab Danh sach — bang day du thong so + dong mo rong: chi tiet, lich su lai suat,
// lich su dong tien, an han goc (dai han), giai ngan theo hoa don (khoan cong ty)
import { useState, useMemo, Fragment } from 'react';
import { Edit2, Check, Trash2, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { fmtVND, fmtRate } from '../../lib/loanCalculations';
import { BORROWER_TYPE_LABELS, LOAN_STATUS_LABELS, DISBURSEMENT_STATUS_LABELS } from '../../lib/types';
import type { Loan, LoanStatus, LoanRateHistory, LoanPaymentHistory, LoanDisbursement, LoanDisbursementStatus } from '../../lib/types';
import { estimateMonthInterest, inGracePeriod, graceEndDate, daysTo, fmtFull, DISB_STATUS_CLS } from './loanShared';

interface Props {
  loans: Loan[];
  rateHistory: LoanRateHistory[];
  payments: LoanPaymentHistory[];
  disbursements: LoanDisbursement[];
  onEdit: (l: Loan) => void;
  onDelete: (l: Loan) => void;
  onSettle: (l: Loan) => void;
  onChanged: () => Promise<void>;
  toast: (msg: string) => void;
}

export function LoanListTab({ loans, rateHistory, payments, disbursements, onEdit, onDelete, onSettle, onChanged, toast }: Props) {
  const { token } = useAuth();
  const [filter, setFilter] = useState<'all' | LoanStatus>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const now = new Date();

  const filtered = useMemo(
    () => (filter === 'all' ? loans : loans.filter(l => l.status === filter)),
    [loans, filter]
  );
  const activeList = filtered.filter(l => l.status === 'active');
  const totalPrincipal = activeList.reduce((s, l) => s + l.principal, 0);
  const totalInterest = activeList.reduce((s, l) => s + estimateMonthInterest(l, now.getFullYear(), now.getMonth() + 1), 0);
  const totalPaidInterest = payments.reduce((s, p) => s + p.interest_paid, 0);

  const filters: { key: 'all' | LoanStatus; label: string }[] = [
    { key: 'all', label: 'Tất cả' }, { key: 'active', label: 'Đang vay' },
    { key: 'closed', label: 'Đã tất toán' }, { key: 'restructured', label: 'Tái cơ cấu' },
  ];

  return (
    <div className="space-y-3">
      {/* Tong hop dau bang: tong no + tong lai */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Tổng dư nợ đang vay', value: fmtVND(totalPrincipal), sub: `${activeList.length} khoản`, color: 'text-red-600' },
          { label: 'Tổng lãi tháng này (ước)', value: fmtVND(totalInterest), sub: 'ngày thực/365', color: 'text-amber-600' },
          { label: 'Tổng lãi đã trả (lũy kế)', value: fmtVND(totalPaidInterest), sub: 'từ lịch sử đóng tiền', color: 'text-blue-600' },
        ].map((k, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-3">
            <div className="text-[9.5px] text-gray-400 font-semibold uppercase">{k.label}</div>
            <div className={`text-[17px] font-bold ${k.color}`}>{k.value}</div>
            <div className="text-[10px] text-gray-400">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5">
        {filters.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1 text-[11px] rounded-full border transition ${filter === f.key ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-[13px] text-gray-400">Chưa có khoản vay nào</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-3 py-2 font-medium">Khoản vay</th>
                  <th className="px-3 py-2 font-medium">Người đứng tên</th>
                  <th className="px-3 py-2 font-medium text-right">Dư nợ</th>
                  <th className="px-3 py-2 font-medium text-right">Lãi suất</th>
                  <th className="px-3 py-2 font-medium text-right">Lãi/tháng</th>
                  <th className="px-3 py-2 font-medium">Ngày chi lãi</th>
                  <th className="px-3 py-2 font-medium">Ngày đáo</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium w-24"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => {
                  const interest = estimateMonthInterest(l, now.getFullYear(), now.getMonth() + 1);
                  const d = l.maturity_date ? daysTo(l.maturity_date) : null;
                  const isOpen = expanded === l.id;
                  const statusColor = l.status === 'active' ? 'bg-green-50 text-green-700' : l.status === 'closed' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700';
                  return (
                    <Fragment key={l.id}>
                      <tr className="border-t border-gray-50 hover:bg-gray-50/50 transition cursor-pointer" onClick={() => setExpanded(isOpen ? null : l.id)}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{l.label}</div>
                          <div className="text-[10px] text-gray-400">{l.bank_name}{l.requires_invoice ? ' · 🧾 theo hoá đơn' : ''}{l.grace_months > 0 ? ` · ân hạn ${l.grace_months}th` : ''}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{l.borrower_name}<span className="ml-1 text-[10px] text-gray-400">({BORROWER_TYPE_LABELS[l.borrower_type]})</span></td>
                        <td className="px-3 py-2 text-right font-semibold">{fmtVND(l.principal)}</td>
                        <td className="px-3 py-2 text-right">{fmtRate(l.interest_rate)}<span className="ml-0.5 text-[9px] text-gray-400">{l.rate_type === 'floating' ? 'TN' : 'CĐ'}</span></td>
                        <td className="px-3 py-2 text-right text-amber-600 font-medium">{l.status === 'active' ? fmtVND(interest) : '—'}</td>
                        <td className="px-3 py-2">{l.payment_day ? `Ngày ${l.payment_day}` : '—'}</td>
                        <td className="px-3 py-2">
                          <span className={d !== null && d <= 14 && l.status === 'active' ? 'text-red-600 font-bold' : d !== null && d <= 30 && l.status === 'active' ? 'text-amber-600 font-semibold' : ''}>
                            {l.maturity_date ? new Date(l.maturity_date).toLocaleDateString('vi-VN') : '—'}
                            {d !== null && d >= 0 && d <= 30 && l.status === 'active' && ` (${d} ng)`}
                          </span>
                        </td>
                        <td className="px-3 py-2"><span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusColor}`}>{LOAN_STATUS_LABELS[l.status]}</span></td>
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1 items-center">
                            <button onClick={() => onEdit(l)} className="p-1 text-gray-400 hover:text-blue-600" title="Sửa"><Edit2 size={12} /></button>
                            {l.status === 'active' && <button onClick={() => onSettle(l)} className="p-1 text-gray-400 hover:text-teal-600" title="Tất toán"><Check size={12} /></button>}
                            <button onClick={() => onDelete(l)} className="p-1 text-gray-400 hover:text-red-600" title="Xoá"><Trash2 size={12} /></button>
                            <button onClick={() => setExpanded(isOpen ? null : l.id)} className="p-1 text-gray-300">{isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={9} className="bg-gray-50/60 px-4 py-3">
                            <LoanDetail loan={l} rateHistory={rateHistory.filter(r => r.loan_id === l.id)}
                              payments={payments.filter(p => p.loan_id === l.id)}
                              disbursements={disbursements.filter(dd => dd.loan_id === l.id)}
                              token={token} onChanged={onChanged} toast={toast} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Chi tiet 1 khoan (dong mo rong) ──
function LoanDetail({ loan, rateHistory, payments, disbursements, token, onChanged, toast }: {
  loan: Loan; rateHistory: LoanRateHistory[]; payments: LoanPaymentHistory[]; disbursements: LoanDisbursement[];
  token: string | null; onChanged: () => Promise<void>; toast: (m: string) => void;
}) {
  const paidInterest = payments.reduce((s, p) => s + p.interest_paid, 0);
  const paidPrincipal = payments.reduce((s, p) => s + p.principal_paid, 0);
  const grace = graceEndDate(loan);
  const [showDisbForm, setShowDisbForm] = useState(false);
  const [disbForm, setDisbForm] = useState({ invoice_no: '', supplier_name: '', amount: '' });

  async function addDisbursement() {
    if (!token) { toast('Phiên đăng nhập hết hạn'); return; }
    if (!disbForm.amount) { toast('Nhập số tiền cần giải ngân'); return; }
    const { error } = await supabase.rpc('admin_upsert_disbursement', {
      p_token: token, p_id: null,
      p_data: { loan_id: loan.id, invoice_no: disbForm.invoice_no || null, supplier_name: disbForm.supplier_name || null,
        amount: Number(disbForm.amount) || 0, status: disbForm.invoice_no ? 'submitted' : 'pending',
        request_date: disbForm.invoice_no ? new Date().toISOString().split('T')[0] : null },
    });
    if (error) { toast('Lỗi: ' + error.message); return; }
    toast('Đã thêm yêu cầu giải ngân');
    setShowDisbForm(false); setDisbForm({ invoice_no: '', supplier_name: '', amount: '' });
    await onChanged();
  }

  async function advanceDisbursement(dd: LoanDisbursement) {
    if (!token) return;
    const next: LoanDisbursementStatus = dd.status === 'pending' ? 'submitted' : 'disbursed';
    const patch: Record<string, unknown> = { status: next };
    if (next === 'submitted') patch.request_date = new Date().toISOString().split('T')[0];
    if (next === 'disbursed') patch.disbursed_date = new Date().toISOString().split('T')[0];
    const { error } = await supabase.rpc('admin_upsert_disbursement', { p_token: token, p_id: dd.id, p_data: patch });
    if (error) { toast('Lỗi: ' + error.message); return; }
    await onChanged();
  }

  async function removeDisbursement(dd: LoanDisbursement) {
    if (!token || !confirm('Xoá dòng giải ngân này?')) return;
    await supabase.rpc('admin_delete_disbursement', { p_token: token, p_id: dd.id });
    await onChanged();
  }

  return (
    <div className="grid md:grid-cols-3 gap-4 text-[11px]">
      {/* Thong so */}
      <div>
        <div className="font-bold text-gray-600 mb-1.5 text-[11px] uppercase tracking-wide">Thông số</div>
        <table className="w-full">
          <tbody>
            <tr><td className="py-0.5 text-gray-400">Dư nợ gốc</td><td className="py-0.5 text-right font-semibold">{fmtFull(loan.principal)}</td></tr>
            <tr><td className="py-0.5 text-gray-400">Lãi suất</td><td className="py-0.5 text-right">{fmtRate(loan.interest_rate)} ({loan.rate_type === 'floating' ? `thả nổi${loan.base_rate != null ? ` = ${loan.base_rate}% + biên ${loan.margin ?? 0}%` : ''}` : 'cố định'})</td></tr>
            <tr><td className="py-0.5 text-gray-400">Hình thức trả</td><td className="py-0.5 text-right">{loan.repayment_type === 'interest_only' ? 'Lãi hàng kỳ' : loan.repayment_type === 'reducing' ? 'Dư nợ giảm dần' : 'Niên kim cố định'}</td></tr>
            <tr><td className="py-0.5 text-gray-400">Kỳ hạn</td><td className="py-0.5 text-right">{loan.term_months ? `${loan.term_months} tháng` : '—'}</td></tr>
            <tr><td className="py-0.5 text-gray-400">Giải ngân</td><td className="py-0.5 text-right">{loan.disbursement_date ? new Date(loan.disbursement_date).toLocaleDateString('vi-VN') : '—'}</td></tr>
            <tr><td className="py-0.5 text-gray-400">Ngày đáo hạn</td><td className="py-0.5 text-right font-semibold">{loan.maturity_date ? new Date(loan.maturity_date).toLocaleDateString('vi-VN') : '— xoay vòng'}</td></tr>
            <tr><td className="py-0.5 text-gray-400">Ngày chi lãi</td><td className="py-0.5 text-right font-semibold">{loan.payment_day ? `Ngày ${loan.payment_day} hằng tháng` : '—'}</td></tr>
            <tr><td className="py-0.5 text-gray-400">Tài sản đảm bảo</td><td className="py-0.5 text-right">{loan.collateral || '—'}</td></tr>
            {loan.proxy_account && <tr><td className="py-0.5 text-gray-400">TK nộp tiền</td><td className="py-0.5 text-right">{loan.proxy_account}</td></tr>}
          </tbody>
        </table>
        {loan.grace_months > 0 && (
          <div className={`mt-2 rounded-lg px-2.5 py-2 text-[10.5px] ${inGracePeriod(loan) ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
            {inGracePeriod(loan)
              ? <>🏦 <b>Đang trong ân hạn gốc</b> — chỉ trả lãi đến {grace?.toLocaleDateString('vi-VN')}, sau đó trả cả gốc + lãi.</>
              : <>🏦 Hết ân hạn gốc từ {grace?.toLocaleDateString('vi-VN')} — <b>đang kỳ trả cả gốc + lãi</b>.</>}
          </div>
        )}
        {loan.notes && <div className="mt-2 text-gray-500 italic">📝 {loan.notes}</div>}
      </div>

      {/* Lich su lai suat + dong tien */}
      <div>
        <div className="font-bold text-gray-600 mb-1.5 text-[11px] uppercase tracking-wide">Lãi suất & đã trả</div>
        <div className="flex gap-3 mb-2">
          <div className="flex-1 bg-white rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="text-[9px] text-gray-400 uppercase">Lãi đã trả</div>
            <div className="font-bold text-amber-600">{fmtVND(paidInterest)}</div>
          </div>
          <div className="flex-1 bg-white rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="text-[9px] text-gray-400 uppercase">Gốc đã trả</div>
            <div className="font-bold text-teal-600">{fmtVND(paidPrincipal)}</div>
          </div>
        </div>
        {rateHistory.length > 0 && (
          <>
            <div className="text-[10px] text-gray-400 mb-1">Lịch sử lãi suất (không đè số cũ):</div>
            <div className="max-h-24 overflow-y-auto">
              {rateHistory.map(r => (
                <div key={r.id} className="flex justify-between py-0.5 border-t border-gray-100 first:border-0">
                  <span className="text-gray-500">{new Date(r.effective_date).toLocaleDateString('vi-VN')}</span>
                  <span className="font-semibold">{fmtRate(r.interest_rate)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {payments.length > 0 && (
          <>
            <div className="text-[10px] text-gray-400 mt-2 mb-1">Lần nộp gần nhất:</div>
            {payments.slice(0, 4).map(p => (
              <div key={p.id} className="flex justify-between py-0.5 border-t border-gray-100 first:border-0">
                <span className="text-gray-500">{new Date(p.paid_date).toLocaleDateString('vi-VN')}</span>
                <span className="font-semibold">{fmtVND(p.amount)}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Giai ngan theo hoa don (khoan cong ty) */}
      <div>
        <div className="font-bold text-gray-600 mb-1.5 text-[11px] uppercase tracking-wide flex items-center justify-between">
          <span>🧾 Giải ngân theo hoá đơn</span>
          {loan.requires_invoice && (
            <button onClick={() => setShowDisbForm(v => !v)} className="text-[10px] px-2 py-0.5 rounded-md border border-blue-200 text-blue-600 hover:bg-blue-50 font-semibold flex items-center gap-0.5">
              <Plus size={10} /> Thêm
            </button>
          )}
        </div>
        {!loan.requires_invoice ? (
          <div className="text-gray-400 text-[10.5px]">Khoản này không giải ngân theo hoá đơn.<br />Bật «Giải ngân theo hoá đơn» khi Sửa khoản vay (dành cho khoản công ty).</div>
        ) : (
          <>
            {showDisbForm && (
              <div className="bg-white rounded-lg border border-blue-200 p-2 mb-2 space-y-1.5">
                <input placeholder="Số hoá đơn (bỏ trống nếu chưa có)" value={disbForm.invoice_no} onChange={e => setDisbForm(p => ({ ...p, invoice_no: e.target.value }))}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-[11px] focus:outline-none" />
                <input placeholder="Nhà cung cấp nhận tiền" value={disbForm.supplier_name} onChange={e => setDisbForm(p => ({ ...p, supplier_name: e.target.value }))}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-[11px] focus:outline-none" />
                <input type="number" placeholder="Số tiền (VND)" value={disbForm.amount} onChange={e => setDisbForm(p => ({ ...p, amount: e.target.value }))}
                  className="w-full px-2 py-1 border border-gray-200 rounded text-[11px] focus:outline-none" />
                <button onClick={addDisbursement} className="w-full py-1 bg-blue-600 text-white rounded text-[11px] font-semibold hover:bg-blue-700">Lưu</button>
              </div>
            )}
            {disbursements.length === 0 ? (
              <div className="text-gray-400 text-[10.5px]">Chưa có yêu cầu giải ngân. Flow: cung cấp hoá đơn → NH giải ngân cho NCC.</div>
            ) : disbursements.map(dd => (
              <div key={dd.id} className="bg-white rounded-lg border border-gray-100 px-2.5 py-1.5 mb-1.5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">{fmtVND(dd.amount)}</span>
                  <span className={`px-1.5 py-0.5 rounded-full border text-[9.5px] font-semibold ${DISB_STATUS_CLS[dd.status]}`}>{DISBURSEMENT_STATUS_LABELS[dd.status]}</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {dd.invoice_no ? `HĐ ${dd.invoice_no}` : 'Chưa có hoá đơn'}{dd.supplier_name ? ` → ${dd.supplier_name}` : ''}
                </div>
                <div className="flex gap-1 mt-1">
                  {dd.status !== 'disbursed' && (
                    <button onClick={() => advanceDisbursement(dd)} className="text-[9.5px] px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 font-semibold hover:bg-blue-50">
                      → {dd.status === 'pending' ? 'Đã gửi hoá đơn cho NH' : 'NH đã giải ngân cho NCC'}
                    </button>
                  )}
                  <button onClick={() => removeDisbursement(dd)} className="text-[9.5px] px-1 text-gray-300 hover:text-red-500"><Trash2 size={10} /></button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
