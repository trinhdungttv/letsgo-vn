import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { calcExpectedDue, formatDateVN } from '../../lib/paymentDate';
import type { Client } from '../../lib/types';

interface FinRow {
  id: string;
  month: string;
  revenue: number;
  paid_status: boolean;
  paid_date: string | null;
}

interface Props {
  client: Client;
  embedded?: boolean;
}

export default function PaymentHistory({ client, embedded }: Props) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<FinRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('finance_records')
        .select('id, month, revenue, paid_status, paid_date')
        .eq('client_id', client.id)
        .order('month', { ascending: false })
        .limit(24);
      setRows(data ?? []);
      setLoading(false);
    })();
  }, [client.id]);

  const analyzed = useMemo(() => {
    return rows.map(r => {
      const [y, m] = r.month.split('-').map(Number);
      const invDay = client.invoice_day ? (client.invoice_day === -1 ? new Date(y, m, 0).getDate() : client.invoice_day) : null;
      const invDate = invDay ? new Date(y, m - 1, invDay) : null;
      const due = invDate ? calcExpectedDue(client, invDate) : null;
      const dueDate = due?.date ?? null;

      let diffDays: number | null = null;
      if (dueDate && r.paid_date) {
        const paid = new Date(r.paid_date);
        paid.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        diffDays = Math.round((paid.getTime() - dueDate.getTime()) / 86400000);
      }

      return { ...r, dueDate, diffDays };
    });
  }, [rows, client]);

  const stats = useMemo(() => {
    const paid = analyzed.filter(a => a.paid_status && a.diffDays != null);
    if (!paid.length) return null;
    const diffs = paid.map(p => p.diffDays as number);
    const avg = Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length);
    const onTime = diffs.filter(d => d <= 0).length;
    const late = diffs.filter(d => d > 0).length;
    const maxLate = Math.max(...diffs, 0);
    return { avg, onTime, late, total: paid.length, maxLate };
  }, [analyzed]);

  const fmtMonth = (m: string) => {
    const [y, mo] = m.split('-');
    return `T${Number(mo)}/${y}`;
  };

  const fmtDay = (d: string | null) => {
    if (!d) return '—';
    const p = d.split('T')[0].split('-');
    return `${p[2]}/${p[1]}`;
  };

  return (
    <div className={embedded ? '' : 'bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden'}>
      {!embedded && (
        <button onClick={() => setOpen(!open)} className="flex items-center justify-between w-full px-4 py-2.5 border-b border-[#E8E7E2] hover:bg-[#FAFAF8] transition">
          <span className="text-[12.5px] font-semibold text-[#111] flex items-center gap-2">Lich su thanh toan</span>
          {open ? <ChevronUp size={13} className="text-[#aaa]" /> : <ChevronDown size={13} className="text-[#aaa]" />}
        </button>
      )}
      {(embedded || open) && (
        <div className={embedded ? 'px-4 py-3' : 'p-4'}>
          {embedded && <div className="text-[12px] font-semibold text-[#111] mb-3">Lich su thanh toan</div>}
          {loading ? (
            <div className="text-[12px] text-[#999] text-center py-4">Dang tai...</div>
          ) : rows.length === 0 ? (
            <div className="text-[12px] text-[#999] text-center py-4">Chua co du lieu tai chinh</div>
          ) : (
            <>
              {stats && (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                    <div className={`text-[16px] font-bold ${stats.avg <= 0 ? 'text-emerald-600' : stats.avg <= 5 ? 'text-amber-600' : 'text-red-600'}`}>
                      {stats.avg > 0 ? `+${stats.avg}` : stats.avg} ngay
                    </div>
                    <div className="text-[10px] text-[#888] mt-0.5">TB chenh lech</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                    <div className="text-[16px] font-bold text-emerald-600">{stats.onTime}/{stats.total}</div>
                    <div className="text-[10px] text-[#888] mt-0.5">Dung han</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                    <div className="text-[16px] font-bold text-red-600">{stats.late}/{stats.total}</div>
                    <div className="text-[10px] text-[#888] mt-0.5">Tre han</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                    <div className="text-[16px] font-bold text-red-500">{stats.maxLate > 0 ? `+${stats.maxLate}` : 0}</div>
                    <div className="text-[10px] text-[#888] mt-0.5">Tre nhieu nhat</div>
                  </div>
                </div>
              )}

              {analyzed.length > 1 && (
                <div className="mb-4 flex items-end gap-px" style={{ height: 48 }}>
                  {[...analyzed].reverse().map((a, i) => {
                    const d = a.diffDays;
                    if (d == null) return <div key={i} className="flex-1 bg-gray-100 rounded-t" style={{ height: 4 }} title={fmtMonth(a.month) + ': chua TT'} />;
                    const maxAbs = Math.max(...analyzed.filter(x => x.diffDays != null).map(x => Math.abs(x.diffDays as number)), 1);
                    const h = Math.max(4, Math.round((Math.abs(d) / maxAbs) * 40));
                    const color = d <= 0 ? 'bg-emerald-400' : d <= 5 ? 'bg-amber-400' : 'bg-red-400';
                    return <div key={i} className={`flex-1 ${color} rounded-t`} style={{ height: h }} title={`${fmtMonth(a.month)}: ${d > 0 ? `+${d}` : d} ngay`} />;
                  })}
                </div>
              )}

              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-[10px] text-[#999] border-b border-gray-100">
                    <th className="text-left py-1.5 font-medium">Thang</th>
                    <th className="text-right py-1.5 font-medium">Doanh thu</th>
                    <th className="text-center py-1.5 font-medium">Du kien TT</th>
                    <th className="text-center py-1.5 font-medium">Thuc te TT</th>
                    <th className="text-center py-1.5 font-medium">Chenh lech</th>
                    <th className="text-center py-1.5 font-medium">Trang thai</th>
                  </tr>
                </thead>
                <tbody>
                  {analyzed.map(a => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-1.5 font-medium text-[#333]">{fmtMonth(a.month)}</td>
                      <td className="py-1.5 text-right text-[#555]">{a.revenue ? (a.revenue / 1000000).toFixed(1) + ' tr' : '—'}</td>
                      <td className="py-1.5 text-center text-[#777]">{a.dueDate ? formatDateVN(a.dueDate) : '—'}</td>
                      <td className="py-1.5 text-center text-[#555]">{fmtDay(a.paid_date)}</td>
                      <td className="py-1.5 text-center">
                        {a.diffDays != null ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            a.diffDays <= 0 ? 'bg-emerald-50 text-emerald-700' : a.diffDays <= 5 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                          }`}>
                            {a.diffDays > 0 ? `+${a.diffDays}` : a.diffDays} ngay
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-1.5 text-center">
                        {a.paid_status ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">Da TT</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">Chua TT</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
