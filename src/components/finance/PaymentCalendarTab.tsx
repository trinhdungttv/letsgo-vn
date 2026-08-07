import { useMemo, useState } from 'react';
import { calcExpectedDue, getDueStatusConfig, formatDateVN } from '../../lib/paymentDate';
import type { Client } from '../../lib/types';
import { isSuspended, formatSuspensionDate, suspensionMonth } from '../../utils/suspension';

interface Props {
  clients: Client[];
  onUpdateClient: (c: Client) => void;
  toast: (msg: string) => void;
}

type FilterMode = 'all' | 'overdue' | 'soon' | 'ok' | 'no_invoice' | 'paid';

function GroupBadge({ group }: { group: number }) {
  const labels: Record<number, { text: string; cls: string }> = {
    1: { text: 'Sau N ngày', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    2: { text: 'Ngày cố định', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
    3: { text: 'Chu kỳ', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  };
  const cfg = labels[group] ?? labels[1];
  return <span className={`text-[10.5px] px-1.5 py-0.5 rounded border font-medium ${cfg.cls}`}>{cfg.text}</span>;
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-[#E8E7E2] rounded-xl p-3.5">
      <div className="text-[11.5px] text-[#888] mb-1">{label}</div>
      <div className={`text-[20px] font-semibold ${color ?? 'text-[#111]'}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#aaa] mt-0.5">{sub}</div>}
    </div>
  );
}

export default function PaymentCalendarTab({ clients }: Props) {
  const [filter, setFilter] = useState<FilterMode>('all');

  const enriched = useMemo(() => {
    const curMonth = new Date().toISOString().slice(0, 7);
    return clients
      .filter(c => !c.archived_at)
      // Khách đã ngưng: giữ tới hết tháng ngưng (còn kỳ thu tiền cuối), sau đó
      // chỉ giữ nếu vẫn CHƯA thu được tiền — tránh để nợ cũ rơi khỏi tầm mắt.
      .filter(c => {
        const sm = suspensionMonth(c);
        return sm == null || curMonth <= sm || !c.paid_this_month;
      })
      .map(c => {
        const paid = c.paid_this_month || false;
        const invDate = c.invoice_date ? new Date(c.invoice_date) : null;
        const rawResult = invDate ? calcExpectedDue(c, invDate) : null;
        const result = paid && rawResult
          ? { ...rawResult, status: 'paid' as const, label: rawResult.label }
          : rawResult;
        return { client: c, result, paid };
      })
      .sort((a, b) => {
        if (a.paid !== b.paid) return a.paid ? 1 : -1;
        if (!a.result && !b.result) return 0;
        if (!a.result) return 1;
        if (!b.result) return -1;
        const da = a.result.date ?? a.result.dateFrom;
        const db = b.result.date ?? b.result.dateFrom;
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.getTime() - db.getTime();
      });
  }, [clients]);

  const kpi = useMemo(() => {
    let overdue = 0, urgent = 0, soon = 0, ok = 0, noInvoice = 0, paid = 0;
    enriched.forEach(({ result, paid: isPaid }) => {
      if (isPaid) { paid++; return; }
      if (!result) { noInvoice++; return; }
      if (result.status === 'overdue') overdue++;
      else if (result.status === 'urgent') urgent++;
      else if (result.status === 'soon') soon++;
      else ok++;
    });
    return { overdue, urgent, soon, ok, noInvoice, paid };
  }, [enriched]);

  const filtered = useMemo(() => {
    if (filter === 'all') return enriched;
    if (filter === 'paid') return enriched.filter(e => e.paid);
    if (filter === 'no_invoice') return enriched.filter(e => !e.paid && !e.result);
    if (filter === 'overdue') return enriched.filter(e => !e.paid && e.result?.status === 'overdue');
    if (filter === 'soon') return enriched.filter(e => !e.paid && (e.result?.status === 'urgent' || e.result?.status === 'soon'));
    if (filter === 'ok') return enriched.filter(e => !e.paid && (e.result?.status === 'ok' || e.result?.status === 'manual'));
    return enriched;
  }, [enriched, filter]);

  const filterButtons: { key: FilterMode; label: string; count: number; cls: string }[] = [
    { key: 'all', label: 'Tất cả', count: enriched.length, cls: 'text-[#111] bg-white border-[#E8E7E2]' },
    { key: 'overdue', label: '🔴 Quá hạn', count: kpi.overdue, cls: 'text-red-700 bg-red-50 border-red-200' },
    { key: 'soon', label: '🟡 Sắp hạn', count: kpi.urgent + kpi.soon, cls: 'text-amber-700 bg-amber-50 border-amber-200' },
    { key: 'ok', label: '🟢 Còn xa', count: kpi.ok, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    { key: 'paid', label: 'Da thu', count: kpi.paid, cls: 'text-blue-700 bg-blue-50 border-blue-200' },
    { key: 'no_invoice', label: 'Chua nhap HD', count: kpi.noInvoice, cls: 'text-gray-600 bg-gray-50 border-gray-200' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2.5">
        <KpiCard label="Qua han" value={kpi.overdue} sub="can doc thuc ngay" color="text-red-600" />
        <KpiCard label="Sap den han" value={kpi.urgent + kpi.soon} sub="can theo doi" color="text-amber-600" />
        <KpiCard label="Binh thuong" value={kpi.ok} sub="con xa" color="text-emerald-600" />
        <KpiCard label="Da thu tien" value={kpi.paid} sub="da thanh toan" color="text-blue-600" />
        <KpiCard label="Chua nhap HD" value={kpi.noInvoice} sub="can cap nhat" color="text-[#888]" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {filterButtons.map(btn => (
          <button key={btn.key} onClick={() => setFilter(btn.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition ${filter === btn.key ? btn.cls : 'text-[#888] bg-white border-[#E8E7E2] hover:border-[#ccc]'}`}>
            {btn.label} <span className="text-[10.5px] font-semibold opacity-80">({btn.count})</span>
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-[#aaa]">{filtered.length} khách hàng</span>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] text-center py-12 text-[#aaa] text-[13px]">Không có dữ liệu</div>
      ) : (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] bg-[#F9F9F7]">
            <div className="grid grid-cols-12 text-[11px] text-[#888] font-medium">
              <div className="col-span-4">Khách hàng</div>
              <div className="col-span-2">Điều khoản</div>
              <div className="col-span-2">Xuất HĐ</div>
              <div className="col-span-2">Dự kiến thu</div>
              <div className="col-span-2 text-right">Trạng thái</div>
            </div>
          </div>
          <div className="divide-y divide-[#F0EEE9]">
            {filtered.map(({ client: c, result, paid }) => {
              const statusCfg = paid
                ? { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Da thu tien', dot: 'bg-blue-400' }
                : (result && result.status !== 'paid') ? getDueStatusConfig(result.status, result.daysRemaining) : null;
              return (
                <div key={c.id} className={`px-4 py-3 grid grid-cols-12 items-center gap-2 hover:bg-[#FAFAF8] transition border-l-2 ${paid ? 'border-l-blue-400 opacity-60' : result?.status==='overdue' ? 'border-l-red-400' : result?.status==='urgent' ? 'border-l-amber-400' : 'border-l-transparent'}`}>
                  <div className="col-span-4 min-w-0">
                    <div className="text-[13px] font-semibold text-[#111] truncate">{c.name}</div>
                    <div className="text-[11px] text-[#888]">
                      {c.region}
                      {isSuspended(c) && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap">
                          Ngưng {formatSuspensionDate(c)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <GroupBadge group={c.payment_group ?? 1} />
                  </div>
                  <div className="col-span-2 text-[12px] text-[#555]">
                    {c.invoice_date ? formatDateVN(new Date(c.invoice_date)) : <span className="text-[#ccc]">—</span>}
                  </div>
                  <div className="col-span-2 text-[13px] font-semibold text-[#111]">
                    {result ? result.label : <span className="text-[#ccc] font-normal text-[12px]">Chưa nhập HĐ</span>}
                  </div>
                  <div className="col-span-2 text-right">
                    {statusCfg ? (
                      <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border font-medium ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                        {statusCfg.label}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#ccc]">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
