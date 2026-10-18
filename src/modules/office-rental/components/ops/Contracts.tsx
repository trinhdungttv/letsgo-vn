import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { LANDLORD_SHORT, sortLeases, sortTenants } from '../../data/selectors';
import { fmtMoney, fmtVND } from '../../lib/calc/money';
import { leaseCostVND, priceAt } from '../../lib/calc/pl';
import { monthLabel } from '../../lib/calc/months';
import { contractState, daysBetween, effectiveRoomStatus, fmtDate, todayStr } from '../../lib/ops';
import type { BdsTenant } from '../../lib/types';
import { MoneyInput } from '../MoneyInput';
import { Badge, Card, CurrencySelect, Field, Modal, TextInput, Toggle, cls } from '../ui';
import { ContractBadge } from './shared';

type Form = Pick<BdsTenant, 'id' | 'name' | 'active' | 'head_lease_id'> & {
  room_id: string | null; contract_code: string; contract_start: string; contract_end: string;
  deposit_amount: number | null; deposit_currency: 'VND' | 'USD'; contact_name: string; contact_phone: string;
};

export default function Contracts() {
  const { rows, calc, currentMonth, settings, patch } = useOffice();
  const today = todayStr();
  const tenants = sortTenants(rows.bds_tenants);
  const roomOf = new Map(rows.bds_rooms.map(r => [r.id, r]));
  const leases = sortLeases(rows.bds_head_leases);
  const rate = calc.settings.exchangeRate || 1;
  const vacant = rows.bds_rooms.filter(r => effectiveRoomStatus(r, rows.bds_tenants) !== 'occupied');
  const [form, setForm] = useState<Form | null>(null);

  const latestRent = (t: BdsTenant) => {
    const cur = calc.rent[currentMonth]?.[t.id];
    if (cur) return { amount: cur, month: currentMonth };
    const m = Object.keys(calc.rent).filter(k => calc.rent[k][t.id]).sort().pop();
    return m ? { amount: calc.rent[m][t.id], month: m } : null;
  };

  const open = (t: BdsTenant) => setForm({
    id: t.id, name: t.name, active: t.active, head_lease_id: t.head_lease_id, room_id: t.room_id ?? null,
    contract_code: t.contract_code || '', contract_start: t.contract_start || '', contract_end: t.contract_end || '',
    deposit_amount: t.deposit_amount ?? null, deposit_currency: t.deposit_currency || 'VND',
    contact_name: t.contact_name || '', contact_phone: t.contact_phone || '',
  });

  const save = () => {
    if (!form) return;
    if (form.contract_start && form.contract_end && form.contract_end < form.contract_start) {
      alert('Ngày kết thúc phải sau ngày bắt đầu');
      return;
    }
    const room = form.room_id ? roomOf.get(form.room_id) : undefined;
    patch('bds_tenants', form.id, {
      active: form.active, room_id: form.room_id,
      head_lease_id: form.head_lease_id || room?.head_lease_id || null,
      contract_code: form.contract_code.trim() || null, contract_start: form.contract_start || null, contract_end: form.contract_end || null,
      deposit_amount: form.deposit_amount || null, deposit_currency: form.deposit_currency,
      contact_name: form.contact_name.trim() || null, contact_phone: form.contact_phone.trim() || null,
    }, true);
    setForm(null);
  };

  return (
    <div className="space-y-3 md:space-y-4">
      <Card pad={false} title="📤 Hợp đồng đầu ra — khách thuê lại" desc={`Cảnh báo đỏ khi còn ≤ 30 ngày, vàng khi ≤ ${settings.alert_days ?? 60} ngày (đổi ở Cài đặt).`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Mã HĐ</th>
                <th className={`${cls.th} text-left`}>Phòng</th>
                <th className={`${cls.th} text-left`}>Khách thuê</th>
                <th className={`${cls.th} text-right`}>Diện tích</th>
                <th className={`${cls.th} text-right`}>Giá thuê</th>
                <th className={`${cls.th} text-right`}>Tiền cọc</th>
                <th className={`${cls.th} text-left`}>Thời hạn</th>
                <th className={`${cls.th} text-left`}>Trạng thái</th>
                <th className={cls.th} />
              </tr>
            </thead>
            <tbody>
              {tenants.map(t => {
                const room = t.room_id ? roomOf.get(t.room_id) : undefined;
                const area = room?.area_m2 ?? t.area_m2;
                const rent = latestRent(t);
                const months = t.contract_start && t.contract_end ? Math.round(daysBetween(t.contract_start, t.contract_end) / 30.4) : null;
                return (
                  <tr key={t.id} className={`border-t border-gray-100 ${t.active ? '' : 'opacity-60'}`}>
                    <td className={`${cls.td} font-medium`}>{t.contract_code || <span className="text-gray-300">—</span>}</td>
                    <td className={cls.td}>{room ? <b>{room.code}</b> : <span className="text-gray-300">—</span>}</td>
                    <td className={cls.td}>
                      <div>{t.name}</div>
                      {(t.contact_name || t.contact_phone) && <div className="text-[10.5px] text-gray-400">{[t.contact_name, t.contact_phone].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td className={`${cls.td} ${cls.num}`}>{area ? `${Number(area).toLocaleString('en-US')} m²` : '—'}</td>
                    <td className={`${cls.td} ${cls.num}`}>
                      {rent ? <>{fmtMoney(rent.amount, t.currency)}{area ? <div className="text-[10.5px] text-gray-400">{fmtMoney(rent.amount / Number(area), t.currency)}/m²{rent.month !== currentMonth ? ` · ${monthLabel(rent.month)}` : ''}</div> : null}</> : '—'}
                    </td>
                    <td className={`${cls.td} ${cls.num}`}>{t.deposit_amount ? fmtMoney(t.deposit_amount, t.deposit_currency || 'VND') : '—'}</td>
                    <td className={cls.td}>
                      {t.contract_start || t.contract_end ? <>{fmtDate(t.contract_start)} → {fmtDate(t.contract_end)}{months ? <div className="text-[10.5px] text-gray-400">{months} tháng</div> : null}</> : '—'}
                    </td>
                    <td className={cls.td}><ContractBadge c={contractState(t, today, settings.alert_days ?? 60)} /></td>
                    <td className={cls.td}><button className={`${cls.btn} ${cls.secondary} !py-1 !px-2`} onClick={() => open(t)}><Pencil size={12} /> Sửa</button></td>
                  </tr>
                );
              })}
              {vacant.map(r => (
                <tr key={r.id} className="border-t border-gray-100 bg-amber-50/40 text-gray-500">
                  <td className={cls.td}>—</td>
                  <td className={cls.td}><b>{r.code}</b></td>
                  <td className={cls.td}>{r.status === 'reserved' ? 'Đang giữ chỗ' : 'Chưa có khách'}</td>
                  <td className={`${cls.td} ${cls.num}`}>{r.area_m2 ? `${Number(r.area_m2).toLocaleString('en-US')} m²` : '—'}</td>
                  <td className={`${cls.td} ${cls.num}`}>{r.list_price ? `~${fmtMoney(r.list_price, r.list_currency)} (chào)` : '—'}</td>
                  <td className={cls.td} colSpan={2}>—</td>
                  <td className={cls.td}><Badge tone={r.status === 'reserved' ? 'blue' : 'amber'}>{r.status === 'reserved' ? 'Giữ chỗ' : 'Trống'}</Badge></td>
                  <td className={cls.td} />
                </tr>
              ))}
              {!tenants.length && !vacant.length && <tr><td colSpan={9} className="text-center text-gray-400 py-6">Chưa có khách thuê. Thêm khách ở Lời/Lỗ → Doanh thu khách hàng.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card pad={false} title="📥 Hợp đồng đầu vào — thuê từ chủ đầu tư" desc={<>Giá tháng {monthLabel(currentMonth)} đã gồm mốc tăng + VAT. Sửa ở <a className="text-blue-600 hover:underline" href="#/office-pl/chi-phi-thue">Lời/Lỗ → Chi phí thuê</a>.</>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Bên cho thuê</th>
                <th className={`${cls.th} text-left`}>Khoản thuê</th>
                <th className={`${cls.th} text-left`}>Áp dụng từ</th>
                <th className={`${cls.th} text-right`}>Giá gốc</th>
                <th className={`${cls.th} text-right`}>Giá tháng này</th>
                <th className={`${cls.th} text-left`}>Mốc tăng sắp tới</th>
              </tr>
            </thead>
            <tbody>
              {leases.map(l => {
                const cl = calc.headLeases.find(h => h.id === l.id)!;
                const next = cl.increases.filter(i => i.month > currentMonth).sort((a, b) => a.month.localeCompare(b.month))[0];
                return (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className={cls.td}><Badge tone={l.landlord === 'mbt' ? 'purple' : 'teal'}>{LANDLORD_SHORT[l.landlord]}</Badge></td>
                    <td className={cls.td}>{l.name}</td>
                    <td className={cls.td}>{monthLabel(cl.baseMonth)}{cl.endMonth ? ` → trả ${monthLabel(cl.endMonth)}` : ''}</td>
                    <td className={`${cls.td} ${cls.num}`}>{fmtMoney(l.base_price, l.currency)}</td>
                    <td className={`${cls.td} ${cls.num} font-semibold`}>{fmtVND(leaseCostVND(cl, currentMonth, calc.settings))}</td>
                    <td className={cls.td}>{next ? <>{monthLabel(next.month)}: +{next.percent}% → {fmtMoney(priceAt(cl, next.month), l.currency)}</> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!form} onClose={() => setForm(null)} title={`Hợp đồng — ${form?.name || ''}`}
        footer={<><button className={`${cls.btn} ${cls.secondary}`} onClick={() => setForm(null)}>Huỷ</button><button className={`${cls.btn} ${cls.primary}`} onClick={save}>Lưu</button></>}
      >
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Mã hợp đồng"><TextInput className="w-full" value={form.contract_code} onChange={v => setForm({ ...form, contract_code: v })} placeholder="HD-2026-01" /></Field>
            <Field label="Phòng">
              <select className={`${cls.inputSm} w-full`} value={form.room_id || ''} onChange={e => setForm({ ...form, room_id: e.target.value || null })}>
                <option value="">— Chưa gán phòng —</option>
                {rows.bds_rooms.map(r => <option key={r.id} value={r.id}>{r.code}{r.name ? ` — ${r.name}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Mặt bằng gốc (để tính lời/lỗ theo mặt bằng)" className="sm:col-span-2">
              <select className={`${cls.inputSm} w-full`} value={form.head_lease_id || ''} onChange={e => setForm({ ...form, head_lease_id: e.target.value || null })}>
                <option value="">{form.room_id && roomOf.get(form.room_id)?.head_lease_id ? '— Lấy theo phòng —' : '⚠ Chưa gán'}</option>
                {leases.map(l => <option key={l.id} value={l.id}>{LANDLORD_SHORT[l.landlord]} · {l.name}</option>)}
              </select>
            </Field>
            <Field label="Ngày bắt đầu"><input type="date" className={`${cls.inputSm} w-full`} value={form.contract_start} onChange={e => setForm({ ...form, contract_start: e.target.value })} /></Field>
            <Field label="Ngày kết thúc"><input type="date" className={`${cls.inputSm} w-full`} value={form.contract_end} onChange={e => setForm({ ...form, contract_end: e.target.value })} /></Field>
            <Field label="Tiền đặt cọc">
              <div className="flex gap-1.5">
                <MoneyInput currency={form.deposit_currency} value={form.deposit_amount} onChange={v => setForm({ ...form, deposit_amount: v })} />
                <CurrencySelect value={form.deposit_currency} onChange={v => setForm({ ...form, deposit_currency: v })} />
              </div>
              {form.deposit_currency === 'USD' && !!form.deposit_amount && <div className="text-[10.5px] text-gray-400 mt-0.5">≈ {fmtVND(form.deposit_amount * rate)}</div>}
            </Field>
            <Field label="Đang thuê"><div className="py-1"><Toggle checked={form.active} onChange={v => setForm({ ...form, active: v })} label={form.active ? 'Đang thuê' : 'Đã ngừng (giữ lịch sử)'} /></div></Field>
            <Field label="Người liên hệ"><TextInput className="w-full" value={form.contact_name} onChange={v => setForm({ ...form, contact_name: v })} /></Field>
            <Field label="Điện thoại"><TextInput className="w-full" value={form.contact_phone} onChange={v => setForm({ ...form, contact_phone: v })} inputMode="tel" /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
