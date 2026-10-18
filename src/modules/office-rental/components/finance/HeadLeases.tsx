import { Car, Plus, Trash2, X } from 'lucide-react';
import { useOffice, patchKey } from '../../data/OfficeDataProvider';
import { LANDLORD_NAME, nextSortOrder, sortLeases } from '../../data/selectors';
import { addMonths, monthLabel, monthToDate, toMonthKey } from '../../lib/calc/months';
import { fmtMoney } from '../../lib/calc/money';
import { priceAt } from '../../lib/calc/pl';
import { gross, net, vatAmount, vatRateFor } from '../../lib/calc/vat';
import type { Landlord } from '../../lib/calc/types';
import type { BdsHeadLease } from '../../lib/types';
import { DecimalInput, MoneyInput } from '../MoneyInput';
import { Badge, Banner, Card, CurrencyBadge, CurrencySelect, Field, MonthInput, TextInput, VatBadge, VatCategorySelect, VatSelect, cls } from '../ui';

function LeaseCard({ lease }: { lease: BdsHeadLease }) {
  const { rows, calc, currentMonth, patch, remove, insert, saveState, saveErrors, retry, months } = useOffice();
  const incs = rows.bds_head_lease_increases
    .filter(i => i.head_lease_id === lease.id)
    .sort((a, b) => a.effective_month.localeCompare(b.effective_month));
  const calcLease = calc.headLeases.find(h => h.id === lease.id);
  const rate = vatRateFor(calc.settings, lease.vat_category);
  const raw = calcLease ? priceAt(calcLease, currentMonth) : 0;
  const key = patchKey('bds_head_leases', lease.id);
  const tenants = rows.bds_tenants.filter(t => t.head_lease_id === lease.id);

  const del = async () => {
    const extra = tenants.length ? `\n${tenants.length} khách đang gán vào khoản này sẽ chuyển về "Chưa gán mặt bằng".` : '';
    if (!confirm(`Xoá khoản thuê "${lease.name}" cùng các mốc tăng giá?${extra}\nChi phí của khoản này sẽ biến mất khỏi mọi tháng trong Lời/Lỗ.`)) return;
    await remove('bds_head_leases', lease.id);
  };

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-[#FCFCFB]">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[#111] flex flex-wrap items-center gap-1.5">
            {lease.is_parking && <Car size={14} className="text-gray-400" />}{lease.name}
            <CurrencyBadge currency={lease.currency} />
            <VatBadge mode={lease.vat_mode} rate={rate} />
            {lease.is_parking && <Badge tone="teal">Bãi xe</Badge>}
            {saveState[key] === 'error' && <button onClick={() => retry(key)} className="text-[11px] text-red-600 underline" title={saveErrors[key]}>Lỗi lưu — thử lại</button>}
          </div>
          <div className="text-[12px] text-gray-600 mt-1">
            Giá {monthLabel(currentMonth)}: <b>{fmtMoney(gross(raw, lease.vat_mode, rate), lease.currency)}</b>
            {lease.vat_mode !== 'none' && (
              <span className="text-gray-400"> (trước VAT: {fmtMoney(net(raw, lease.vat_mode, rate), lease.currency)} · VAT: {fmtMoney(vatAmount(raw, lease.vat_mode, rate), lease.currency)})</span>
            )}
          </div>
        </div>
        <button className={`${cls.btn} ${cls.danger} !px-2 !py-1`} onClick={del}><Trash2 size={12} /> Xoá</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Field label="Tên khoản">
          <TextInput className="w-full" value={lease.name} onChange={v => patch('bds_head_leases', lease.id, { name: v })} />
        </Field>
        <Field label={`Giá gốc / tháng (${lease.currency === 'USD' ? 'USD' : 'VNĐ, số đầy đủ'})`}>
          <div className="flex gap-1.5">
            <MoneyInput currency={lease.currency} value={lease.base_price} onChange={v => patch('bds_head_leases', lease.id, { base_price: v })} />
            <CurrencySelect value={lease.currency} onChange={v => patch('bds_head_leases', lease.id, { currency: v })} />
          </div>
        </Field>
        <Field label="Áp dụng từ tháng">
          <MonthInput className="w-full" value={toMonthKey(lease.base_month)} onChange={m => m && patch('bds_head_leases', lease.id, { base_month: monthToDate(m) })} />
        </Field>
        <Field label="Trả mặt bằng từ (tuỳ chọn)" hint="Từ tháng này chi phí = 0">
          <MonthInput allowEmpty className="w-full" value={lease.end_month ? toMonthKey(lease.end_month) : null} onChange={m => patch('bds_head_leases', lease.id, { end_month: m ? monthToDate(m) : null })} />
        </Field>
        <Field label="VAT">
          <VatSelect className="w-full" value={lease.vat_mode} onChange={v => patch('bds_head_leases', lease.id, { vat_mode: v })} />
        </Field>
        <Field label="Loại thuế suất">
          <VatCategorySelect className="w-full" value={lease.vat_category} onChange={v => patch('bds_head_leases', lease.id, { vat_category: v })} />
        </Field>
        <Field label="Bãi giữ xe?" hint="Bãi xe tính lời/lỗ riêng với phí xe của mọi khách">
          <label className="flex items-center gap-2 text-[12px] text-gray-700 py-1">
            <input type="checkbox" checked={lease.is_parking} onChange={e => patch('bds_head_leases', lease.id, { is_parking: e.target.checked, ...(e.target.checked ? { vat_category: 'util' as const } : {}) }, true)} />
            Đây là bãi giữ xe
          </label>
        </Field>
        <Field label="Ghi chú">
          <TextInput className="w-full" value={lease.note || ''} onChange={v => patch('bds_head_leases', lease.id, { note: v || null })} />
        </Field>
      </div>

      <div className="mt-3">
        <div className={cls.label}>Mốc tăng giá (cộng dồn)</div>
        <div className="space-y-1.5">
          {incs.map(inc => (
            <div key={inc.id} className="flex flex-wrap items-center gap-1.5 text-[12px] text-gray-600">
              <span>Từ</span>
              <MonthInput value={toMonthKey(inc.effective_month)} onChange={m => m && patch('bds_head_lease_increases', inc.id, { effective_month: monthToDate(m) })} />
              <span>tăng</span>
              <span className="w-[80px]"><DecimalInput allowNegative value={inc.percent} onChange={v => patch('bds_head_lease_increases', inc.id, { percent: v ?? 0 })} /></span>
              <span>%</span>
              <span className="text-gray-400">→ {fmtMoney(gross(calcLease ? priceAt(calcLease, toMonthKey(inc.effective_month)) : 0, lease.vat_mode, rate), lease.currency)}</span>
              <button className="p-1 text-gray-300 hover:text-red-500" title="Xoá mốc" onClick={() => remove('bds_head_lease_increases', inc.id)}><X size={13} /></button>
            </div>
          ))}
          {!incs.length && <div className="text-[11.5px] text-gray-400">Chưa có mốc tăng giá.</div>}
        </div>
        <button
          className={`${cls.btn} ${cls.secondary} !py-1 mt-2`}
          onClick={() => {
            const last = incs[incs.length - 1];
            const base = last ? toMonthKey(last.effective_month) : (months.includes(currentMonth) ? currentMonth : toMonthKey(lease.base_month));
            insert('bds_head_lease_increases', { head_lease_id: lease.id, effective_month: monthToDate(addMonths(base, 12)), percent: 5 });
          }}
        >
          <Plus size={12} /> Thêm mốc tăng
        </button>
      </div>
    </div>
  );
}

export default function HeadLeases() {
  const { rows, insert } = useOffice();
  const leases = sortLeases(rows.bds_head_leases);

  const add = (landlord: Landlord) => insert('bds_head_leases', {
    landlord, name: `Khoản thuê mới ${leases.filter(l => l.landlord === landlord).length + 1}`,
    base_month: '2026-01-01', sort_order: nextSortOrder(leases.filter(l => l.landlord === landlord)),
  });

  return (
    <div className="space-y-3 md:space-y-4">
      <Banner>
        💡 <b>Mốc tăng giá cộng dồn</b>: "từ T1/2027 tăng 5%" → giá từ tháng đó × 1.05; nhiều mốc thì nhân liên tiếp.
        <b> VAT</b>: chọn "Giá đã gồm VAT" nếu số nhập là số cuối cùng phải trả; "Giá chưa gồm VAT" nếu là giá gốc và muốn hệ thống tự cộng thuế.
      </Banner>
      {(['mbt', 'ts4'] as Landlord[]).map(g => {
        const list = leases.filter(l => l.landlord === g);
        return (
          <Card
            key={g}
            title={<>{LANDLORD_NAME[g]} <Badge tone={g === 'mbt' ? 'purple' : 'teal'}>{list.length} khoản</Badge></>}
            desc={g === 'mbt' ? 'Mặt bằng 1.05 (Trệt) + 2.01 (Tầng 1) — 2 hoá đơn trả chung' : 'Mặt tiền phía trước + Bãi giữ xe (hầm)'}
            actions={<button className={`${cls.btn} ${cls.secondary}`} onClick={() => add(g)}><Plus size={13} /> Thêm khoản thuê</button>}
          >
            <div className="space-y-3">
              {list.map(l => <LeaseCard key={l.id} lease={l} />)}
              {!list.length && <div className="text-[12px] text-gray-400">Chưa có khoản thuê nào.</div>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
