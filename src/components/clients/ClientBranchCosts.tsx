import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { monthLabel } from '../../lib/format';
import { fetchCostRules, planRuleApply, applyRuleChanges, COST_KIND_LABEL, DEFAULT_TET_RATE, type CostKind, type CostRule } from '../../lib/branchCostRules';
import type { Client } from '../../lib/types';

const fmt = (n: number) => Number(n).toLocaleString('vi-VN');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** Đơn giá quỹ tết / hoa hồng KH của khách hàng theo MỐC THỜI GIAN (đ/công, trừ vào phần Chi nhánh
 * của dự án khoán). Lưu mốc xong, các tháng P&L từ mốc đó trở đi được cập nhật đơn giá tương ứng. */
export default function ClientBranchCosts({ client, toast }: { client: Client; toast: (m: string) => void }) {
  const { user } = useAuth();
  const [rules, setRules] = useState<CostRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<Record<CostKind, { month: string; rate: string }>>({
    tet: { month: thisMonth(), rate: String(DEFAULT_TET_RATE) },
    commission: { month: thisMonth(), rate: '' },
  });
  const [busy, setBusy] = useState(false);
  // Quỹ tết chỉ áp dụng cho dịch vụ Cho thuê lại lao động.
  const KINDS: CostKind[] = client.service_type === 'recruitment' || client.service_type === 'hoh' ? ['commission'] : ['tet', 'commission'];

  const reload = async () => { setRules(await fetchCostRules(client.id)); setLoaded(true); };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client.id]);

  const save = async (kind: CostKind) => {
    const f = form[kind];
    const rate = parseInt(f.rate.replace(/\D/g, ''));
    if (!f.month || Number.isNaN(rate)) { toast('Chọn tháng bắt đầu và nhập đơn giá (đ/công)'); return; }
    setBusy(true);
    try {
      const next: CostRule[] = [...rules.filter(r => !(r.kind === kind && r.effective_from === f.month)), { id: 'new', client_id: client.id, kind, rate, effective_from: f.month, created_at: '' }];
      const changes = await planRuleApply(client.id, kind, f.month, next);
      const overwrites = changes.filter(c => c.from !== null);
      const msg = `Đặt ${COST_KIND_LABEL[kind].toLowerCase()} = ${fmt(rate)}đ/công từ ${monthLabel(f.month)}.\n\nSẽ cập nhật đơn giá cho ${changes.length} tháng P&L đã có từ mốc này${overwrites.length ? ` (trong đó ${overwrites.length} tháng đang có đơn giá khác sẽ bị GHI ĐÈ: ${overwrites.slice(0, 4).map(c => `${monthLabel(c.month)} ${fmt(c.from ?? 0)}đ`).join(', ')}${overwrites.length > 4 ? '…' : ''})` : ''}.\n\nTiếp tục?`;
      if (!confirm(msg)) { setBusy(false); return; }
      const { error } = await supabase.from('client_branch_cost_rules').upsert({ client_id: client.id, kind, rate, effective_from: f.month }, { onConflict: 'client_id,kind,effective_from' });
      if (error) {
        toast(/does not exist|schema cache/i.test(error.message) ? 'Chưa chạy migration 150 — chạy xong rồi thử lại' : 'Lỗi: ' + error.message);
        setBusy(false); return;
      }
      const failed = await applyRuleChanges(kind, changes);
      await logActivity({ user, action: 'update', table: 'client_branch_cost_rules', recordId: client.id, description: `Đặt ${COST_KIND_LABEL[kind]} ${fmt(rate)}đ/công từ ${monthLabel(f.month)} cho "${client.name}" (áp ${changes.length - failed} tháng P&L)` });
      await reload();
      toast(failed ? `Đã lưu mốc, ${failed} tháng P&L không cập nhật được` : `Đã lưu — cập nhật ${changes.length} tháng P&L`);
    } finally { setBusy(false); }
  };

  const remove = async (r: CostRule) => {
    if (!confirm(`Xoá mốc "${COST_KIND_LABEL[r.kind]} ${fmt(r.rate)}đ/công từ ${monthLabel(r.effective_from)}"?\n\nĐơn giá đã ghi ở các tháng P&L KHÔNG bị đổi; chỉ các tháng tạo mới về sau không còn theo mốc này.`)) return;
    const { error } = await supabase.from('client_branch_cost_rules').delete().eq('id', r.id);
    if (error) { toast('Lỗi: ' + error.message); return; }
    await reload();
  };

  return (
    <div className="space-y-4">
      <div className="text-[11.5px] text-[#888]">
        Chi phí riêng của chi nhánh ở dự án khoán, tính bằng <b>số công × đơn giá</b> và trừ vào phần lợi nhuận của Chi nhánh (dự án "nhận lương" không áp dụng).
        Đơn giá áp dụng từ tháng bắt đầu trở đi cho tới khi có mốc mới.
      </div>
      {!loaded ? <div className="text-[12px] text-[#999]">Đang tải…</div> : KINDS.map(kind => {
        const list = rules.filter(r => r.kind === kind);
        return (
          <div key={kind} className="border border-[#E8E7E2] rounded-lg p-3">
            <div className="text-[12.5px] font-semibold text-[#111] mb-2">{COST_KIND_LABEL[kind]} <span className="font-normal text-[11px] text-[#999]">{kind === 'tet' ? '(mặc định 500đ/công khi tạo P&L mới nếu chưa đặt mốc)' : '(mỗi dự án một mức)'}</span></div>
            {list.length === 0 ? (
              <div className="text-[11.5px] text-[#aaa] italic mb-2">Chưa đặt mốc nào{kind === 'commission' ? ' — chưa tính hoa hồng' : ''}</div>
            ) : (
              <div className="space-y-1 mb-2">
                {list.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-2 text-[12px] bg-[#FAFAF8] rounded px-2 py-1">
                    <span className="font-medium text-[#111] w-[90px]">Từ {monthLabel(r.effective_from).replace('Tháng ', 'T')}</span>
                    <span className="text-emerald-700 font-semibold">{fmt(r.rate)} đ/công</span>
                    {i === 0 && <span className="text-[10px] px-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">hiện tại</span>}
                    <button onClick={() => remove(r)} className="ml-auto text-gray-300 hover:text-red-500" title="Xoá mốc"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-[#888]">Từ tháng</span>
              <input type="month" value={form[kind].month} onChange={e => setForm(f => ({ ...f, [kind]: { ...f[kind], month: e.target.value } }))}
                className="text-[12px] px-2 py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              <input inputMode="numeric" value={form[kind].rate} placeholder="Đơn giá"
                onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, '')); setForm(f => ({ ...f, [kind]: { ...f[kind], rate: Number.isNaN(n) ? '' : fmt(n) } })); }}
                className="w-28 text-[12px] text-right px-2 py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              <span className="text-[11px] text-[#888]">đ/công</span>
              <button disabled={busy} onClick={() => save(kind)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-50">
                <Plus size={11} /> Đặt mốc
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
