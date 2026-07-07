// Tab Dao han & Tai vay — flow thuc te: nop tien vao TK de dao -> NH giai ngan lai (co the sang nguoi dung ten khac)
import { useState, useMemo } from 'react';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { fmtVND } from '../../lib/loanCalculations';
import { RENEWAL_STATUS_LABELS } from '../../lib/types';
import type { Loan, LoanRenewal, LoanRenewalStatus } from '../../lib/types';
import { daysTo } from './loanShared';

interface Props {
  loans: Loan[];
  renewals: LoanRenewal[];
  onChanged: () => Promise<void>;
  toast: (msg: string) => void;
}

const COLS: { key: LoanRenewalStatus; label: string; hint: string }[] = [
  { key: 'pending', label: 'Chưa xử lý', hint: 'Gọi CV tín dụng' },
  { key: 'contacted', label: 'Đã liên hệ NH', hint: 'Chuẩn bị hồ sơ' },
  { key: 'deposited', label: 'Đã nộp tiền đáo', hint: 'Tiền đã vào TK chờ đáo' },
  { key: 'redisbursed', label: 'NH đã giải ngân lại', hint: 'Xác nhận rồi bấm Hoàn tất' },
];

export function LoanRenewalTab({ loans, renewals, onChanged, toast }: Props) {
  const { token, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState<LoanRenewal | null>(null);

  const activeLoans = useMemo(() => loans.filter(l => l.status === 'active'), [loans]);
  const openRenewals = useMemo(() => renewals.filter(r => r.status !== 'completed' && r.status !== 'rejected'), [renewals]);

  // Khoan sap dao han (<=30 ngay) chua co ho so dao
  const suggestions = useMemo(() =>
    activeLoans
      .filter(l => l.maturity_date && daysTo(l.maturity_date) <= 30 && daysTo(l.maturity_date) >= -5)
      .filter(l => !openRenewals.some(r => r.loan_id === l.id))
      .sort((a, b) => daysTo(a.maturity_date!) - daysTo(b.maturity_date!)),
  [activeLoans, openRenewals]);

  // Kich ban xau: khoan gap nhat trong pipeline chua den buoc deposited
  const worstCase = useMemo(() => {
    const risky = openRenewals
      .map(r => ({ r, loan: loans.find(l => l.id === r.loan_id) }))
      .filter(x => x.loan?.maturity_date && (x.r.status === 'pending' || x.r.status === 'contacted'))
      .sort((a, b) => daysTo(a.loan!.maturity_date!) - daysTo(b.loan!.maturity_date!));
    const sug = suggestions[0];
    const first = risky[0]?.loan ?? sug;
    return first && daysTo(first.maturity_date!) <= 21 ? first : null;
  }, [openRenewals, loans, suggestions]);

  async function createRenewal(loan: Loan) {
    if (!token) { toast('Phiên đăng nhập hết hạn'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('admin_upsert_renewal', {
      p_token: token, p_id: null,
      p_data: { loan_id: loan.id, status: 'pending', checklist: [
        { label: 'Gọi CV tín dụng', done: false },
        { label: 'Chuẩn bị hồ sơ tái vay', done: false },
        { label: 'Xác nhận lãi suất kỳ mới', done: false },
      ] },
    });
    setBusy(false);
    if (error) { toast('Lỗi: ' + error.message); return; }
    await logActivity({ user, action: 'insert', table: 'loan_renewals', recordId: loan.id, description: `Mở hồ sơ đáo hạn "${loan.label}"` });
    toast('Đã mở hồ sơ đáo hạn');
    await onChanged();
  }

  async function moveStatus(r: LoanRenewal, next: LoanRenewalStatus) {
    if (!token) { toast('Phiên đăng nhập hết hạn'); return; }
    const today = new Date().toISOString().split('T')[0];
    const patch: Record<string, unknown> = { status: next };
    if (next === 'contacted') patch.contacted_date = today;
    if (next === 'deposited') patch.deposit_date = today;
    if (next === 'redisbursed') {
      patch.redisbursed_date = today;
      const who = prompt('NH giải ngân lại sang người đứng tên nào? (bỏ trống = giữ nguyên người cũ)');
      if (who && who.trim()) patch.new_borrower_name = who.trim();
    }
    setBusy(true);
    const { error } = await supabase.rpc('admin_upsert_renewal', { p_token: token, p_id: r.id, p_data: patch });
    setBusy(false);
    if (error) { toast('Lỗi: ' + error.message); return; }
    const loan = loans.find(l => l.id === r.loan_id);
    await logActivity({ user, action: 'update', table: 'loan_renewals', recordId: r.id, description: `Đáo hạn "${loan?.label}": ${RENEWAL_STATUS_LABELS[next]}` });
    await onChanged();
  }

  async function toggleCheck(r: LoanRenewal, idx: number) {
    if (!token) return;
    const cl = r.checklist.map((c, i) => i === idx ? { ...c, done: !c.done } : c);
    await supabase.rpc('admin_upsert_renewal', { p_token: token, p_id: r.id, p_data: { checklist: cl } });
    await onChanged();
  }

  async function deleteRenewal(r: LoanRenewal) {
    if (!token) return;
    const loan = loans.find(l => l.id === r.loan_id);
    if (!confirm(`Xoá hồ sơ đáo hạn của "${loan?.label}"?`)) return;
    await supabase.rpc('admin_delete_renewal', { p_token: token, p_id: r.id });
    toast('Đã xoá hồ sơ');
    await onChanged();
  }

  async function completeRenewal(r: LoanRenewal, form: { rate: string; term: string; maturity: string; principal: string }) {
    if (!token) { toast('Phiên đăng nhập hết hạn'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('admin_complete_renewal', {
      p_token: token, p_renewal_id: r.id,
      p_new_loan: {
        interest_rate: form.rate ? Number(form.rate) : null,
        term_months: form.term ? Number(form.term) : null,
        maturity_date: form.maturity || null,
        principal: form.principal ? Number(form.principal) : null,
      },
    });
    setBusy(false);
    if (error) { toast('Lỗi: ' + error.message); return; }
    const loan = loans.find(l => l.id === r.loan_id);
    await logActivity({ user, action: 'update', table: 'loan_renewals', recordId: r.id, description: `Hoàn tất tái vay "${loan?.label}" — khoản cũ tất toán, tạo khoản mới` });
    toast('✅ Tái vay xong — khoản cũ đã tất toán, khoản mới đã tạo');
    setCompleting(null);
    await onChanged();
  }

  return (
    <div className="space-y-3">
      {/* Canh bao kich ban xau */}
      {worstCase && (
        <div className="flex gap-3 items-start bg-red-50 border-[1.5px] border-red-200 rounded-xl px-4 py-3">
          <span className="text-[17px]">🚨</span>
          <div className="text-[11.5px] text-red-900 leading-relaxed">
            <b className="text-red-600">Kịch bản xấu — {worstCase.label} ({fmtVND(worstCase.principal)}, đáo {new Date(worstCase.maturity_date!).toLocaleDateString('vi-VN')}):</b>{' '}
            nếu NH không giải ngân lại kịp, phải có <b>{fmtVND(worstCase.principal)} tiền mặt</b> nộp vào TK ngày đáo.
            Trễ → nhảy nhóm CIC của <b>{worstCase.borrower_name}</b>, ảnh hưởng toàn bộ khoản đứng tên này. Xử lý hồ sơ ngay hôm nay.
          </div>
        </div>
      )}

      {/* Goi y mo ho so */}
      {suggestions.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <div className="text-[12px] font-semibold text-amber-700 mb-2">⏰ Sắp đáo hạn ≤30 ngày — chưa mở hồ sơ</div>
          <div className="flex flex-col gap-1.5">
            {suggestions.map(l => (
              <div key={l.id} className="flex items-center gap-2 text-[11.5px]">
                <span className={`w-2 h-2 rounded-full ${daysTo(l.maturity_date!) <= 14 ? 'bg-red-500' : 'bg-amber-400'}`} />
                <span className="font-medium flex-1">{l.label} — {l.bank_name} ({l.borrower_name}) · {fmtVND(l.principal)}</span>
                <span className={`font-bold ${daysTo(l.maturity_date!) <= 14 ? 'text-red-600' : 'text-amber-600'}`}>còn {daysTo(l.maturity_date!)} ngày</span>
                <button onClick={() => createRenewal(l)} disabled={busy}
                  className="flex items-center gap-1 text-[10.5px] px-2.5 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 font-semibold disabled:opacity-40">
                  <Plus size={11} /> Mở hồ sơ đáo
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kanban 4 cot */}
      <div className="grid md:grid-cols-4 gap-2.5">
        {COLS.map((col, ci) => {
          const items = openRenewals.filter(r => r.status === col.key);
          return (
            <div key={col.key} className="bg-gray-100 rounded-xl p-2.5">
              <div className="flex justify-between items-center px-1 pb-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">{col.label}</span>
                <span className="text-[10px] font-bold text-gray-400">{items.length}</span>
              </div>
              {items.length === 0 && <div className="text-[10px] text-gray-400 text-center py-3">{col.hint}</div>}
              {items.map(r => {
                const loan = loans.find(l => l.id === r.loan_id);
                if (!loan) return null;
                const d = loan.maturity_date ? daysTo(loan.maturity_date) : null;
                return (
                  <div key={r.id} className={`bg-white rounded-lg border p-2.5 mb-2 ${d !== null && d <= 14 && col.key === 'pending' ? 'border-red-300' : 'border-gray-200'}`}>
                    <div className="text-[11.5px] font-bold">{loan.label} — {loan.bank_name}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {fmtVND(loan.principal)} · {loan.borrower_name}
                      {loan.maturity_date && <> · đáo {new Date(loan.maturity_date).toLocaleDateString('vi-VN')}{d !== null && d >= 0 && <b className={d <= 14 ? ' text-red-600' : ' text-amber-600'}> ({d} ng)</b>}</>}
                    </div>
                    {r.new_borrower_name && (
                      <div className="text-[10px] text-violet-700 font-semibold mt-1">→ Giải ngân sang: {r.new_borrower_name}</div>
                    )}
                    {r.checklist.length > 0 && col.key !== 'redisbursed' && (
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        {r.checklist.map((c, i) => (
                          <button key={i} onClick={() => toggleCheck(r, i)} className={`text-left text-[10px] ${c.done ? 'text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}>
                            {c.done ? '☑' : '☐'} {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {ci < 3 && (
                        <button onClick={() => moveStatus(r, COLS[ci + 1].key)} disabled={busy}
                          className="text-[10px] px-2 py-1 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40">
                          → {COLS[ci + 1].label}
                        </button>
                      )}
                      {col.key === 'redisbursed' && (
                        <button onClick={() => setCompleting(r)} disabled={busy}
                          className="text-[10px] px-2 py-1 rounded-md bg-teal-600 text-white font-semibold hover:bg-teal-700 disabled:opacity-40 flex items-center gap-1">
                          <RefreshCw size={10} /> Hoàn tất tái vay
                        </button>
                      )}
                      <button onClick={() => deleteRenewal(r)} className="text-[10px] px-1.5 py-1 rounded-md text-gray-300 hover:text-red-500" title="Xoá hồ sơ">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Lich su hoan tat */}
      {renewals.filter(r => r.status === 'completed').length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-2">✅ Đã tái vay xong</div>
          {renewals.filter(r => r.status === 'completed').slice(0, 10).map(r => {
            const loan = loans.find(l => l.id === r.loan_id);
            return (
              <div key={r.id} className="flex items-center gap-2 text-[11px] py-1.5 border-t border-gray-50 first:border-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="font-medium flex-1">{loan?.label} — {loan?.bank_name}</span>
                {r.new_borrower_name && <span className="text-violet-600">→ {r.new_borrower_name}</span>}
                <span className="text-gray-400">{r.renewal_date ? new Date(r.renewal_date).toLocaleDateString('vi-VN') : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[10.5px] text-gray-400">
        Flow đáo hạn: nộp tiền vào TK để đáo → NH giải ngân lại (có thể sang người đứng tên khác) → «Hoàn tất tái vay» tạo khoản mới kế thừa + tự tất toán khoản cũ, giữ nguyên chuỗi lịch sử.
      </div>

      {/* Modal hoan tat */}
      {completing && (() => {
        const loan = loans.find(l => l.id === completing.loan_id);
        return <CompleteModal renewal={completing} loan={loan} busy={busy} onClose={() => setCompleting(null)} onSubmit={f => completeRenewal(completing, f)} />;
      })()}
    </div>
  );
}

function CompleteModal({ renewal, loan, busy, onClose, onSubmit }: {
  renewal: LoanRenewal; loan?: Loan; busy: boolean;
  onClose: () => void; onSubmit: (f: { rate: string; term: string; maturity: string; principal: string }) => void;
}) {
  const defMaturity = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + (loan?.term_months ?? 3));
    return d.toISOString().split('T')[0];
  })();
  const [f, setF] = useState({
    rate: String(loan?.interest_rate ?? ''), term: String(loan?.term_months ?? 3),
    maturity: defMaturity, principal: String(loan?.principal ?? ''),
  });
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-100 text-[13px] font-semibold">
          Hoàn tất tái vay — {loan?.label}
          {renewal.new_borrower_name && <div className="text-[10.5px] text-violet-600 font-normal mt-0.5">Khoản mới đứng tên: {renewal.new_borrower_name}</div>}
        </div>
        <div className="px-5 py-4 space-y-3">
          {[
            { k: 'principal' as const, label: 'Dư nợ kỳ mới (VND)', type: 'number' },
            { k: 'rate' as const, label: 'Lãi suất kỳ mới (%/năm)', type: 'number' },
            { k: 'term' as const, label: 'Kỳ hạn (tháng)', type: 'number' },
            { k: 'maturity' as const, label: 'Ngày đáo hạn mới', type: 'date' },
          ].map(fl => (
            <div key={fl.k}>
              <label className="block text-[11px] text-gray-500 mb-1">{fl.label}</label>
              <input type={fl.type} value={f[fl.k]} onChange={e => setF(p => ({ ...p, [fl.k]: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[12px] focus:outline-none focus:border-blue-300" />
            </div>
          ))}
          <div className="text-[10.5px] text-gray-400">Khoản cũ sẽ tự chuyển «Đã tất toán», khoản mới tạo với thông tin trên và link lịch sử.</div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-1.5 text-[12px] text-gray-500">Huỷ</button>
          <button onClick={() => onSubmit(f)} disabled={busy} className="px-4 py-1.5 bg-teal-600 text-white text-[12px] font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {busy ? 'Đang xử lý...' : 'Hoàn tất tái vay'}
          </button>
        </div>
      </div>
    </div>
  );
}
