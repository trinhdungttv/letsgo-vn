import { useState } from 'react';
import { ArrowRightLeft, Plus, Trash2 } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { sortTenants } from '../../data/selectors';
import { addMonths, monthLabel, monthToDate } from '../../lib/calc/months';
import { fmtVND } from '../../lib/calc/money';
import type { MonthKey } from '../../lib/calc/types';
import type { BdsMeterReading } from '../../lib/types';
import { DecimalInput, MoneyInput } from '../MoneyInput';
import { Badge, Banner, Card, MonthSelect, cls } from '../ui';

const kwhOf = (r: BdsMeterReading) => Math.max(0, (Number(r.curr_reading) || 0) - (Number(r.prev_reading) || 0));
const amountOf = (r: BdsMeterReading) => Math.round(kwhOf(r) * (Number(r.unit_price) || 0));

export default function Meters() {
  const { rows, calc, months, currentMonth, settings, insert, patch, remove, setFee, toast } = useOffice();
  const [sel, setSel] = useState<MonthKey>(() => (months.includes(currentMonth) ? currentMonth : months[0]));
  const month = months.includes(sel) ? sel : months[0];
  const md = monthToDate(month);
  const prevMd = monthToDate(addMonths(month, -1));
  const tenants = sortTenants(rows.bds_tenants);
  const roomOf = new Map(rows.bds_rooms.map(r => [r.id, r]));
  const readings = rows.bds_meter_readings.filter(r => r.month === md);
  const readingOf = new Map(readings.map(r => [r.tenant_id, r]));
  const missing = tenants.filter(t => t.active && !readingOf.has(t.id));
  const [busy, setBusy] = useState(false);

  const createSheet = async () => {
    setBusy(true);
    for (const t of missing) {
      const last = rows.bds_meter_readings.find(r => r.tenant_id === t.id && r.month === prevMd);
      await insert('bds_meter_readings', {
        tenant_id: t.id, month: md, prev_reading: last ? Number(last.curr_reading) : 0,
        curr_reading: last ? Number(last.curr_reading) : 0, unit_price: settings.electricity_unit_price ?? 3500,
      });
    }
    setBusy(false);
  };

  const apply = (r: BdsMeterReading) => {
    setFee(r.tenant_id, month, { electricity_amount: amountOf(r) });
    patch('bds_meter_readings', r.id, { applied_at: new Date().toISOString() }, true);
  };
  const applyAll = () => {
    const list = readings.filter(r => kwhOf(r) > 0);
    if (!list.length) return;
    if (!confirm(`Ghi tiền điện của ${list.length} khách vào phí điện ${monthLabel(month)} (thay số đang có)?`)) return;
    list.forEach(apply);
    toast(`Đã áp dụng tiền điện ${monthLabel(month)} cho ${list.length} khách`);
  };

  const rowsShown = tenants.filter(t => readingOf.has(t.id));
  const total = readings.reduce((a, r) => a + amountOf(r), 0);

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-gray-500">Tháng</span>
        <MonthSelect months={months} value={month} onChange={setSel} />
        <span className="text-[11.5px] text-gray-400">Đơn giá mặc định {fmtVND(settings.electricity_unit_price ?? 0)}/kWh (đổi ở Cài đặt)</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {missing.length > 0 && <button className={`${cls.btn} ${cls.secondary}`} disabled={busy} onClick={createSheet}><Plus size={13} /> Tạo dòng cho {missing.length} khách</button>}
          <button className={`${cls.btn} ${cls.primary}`} disabled={!readings.some(r => kwhOf(r) > 0)} onClick={applyAll}><ArrowRightLeft size={13} /> Áp dụng tất cả vào phí điện</button>
        </div>
      </div>

      <Banner>
        ⚡ Nhập chỉ số công tơ phụ → hệ thống tính tiền điện. Bấm <b>Áp dụng</b> để ghi số tiền vào "Phụ phí điện" của khách trong tháng (đây là cầu nối duy nhất sang Lời/Lỗ). Chỉ số cũ tự lấy từ chỉ số mới tháng trước.
      </Banner>

      <Card pad={false} title={`Chỉ số điện ${monthLabel(month)}`} actions={<div className="text-[12px] text-gray-500">Tổng tiền điện: <b>{fmtVND(total)}</b></div>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Khách / Phòng</th>
                <th className={`${cls.th} text-right`}>Chỉ số cũ</th>
                <th className={`${cls.th} text-right`}>Chỉ số mới</th>
                <th className={`${cls.th} text-right`}>kWh</th>
                <th className={`${cls.th} text-right`}>Đơn giá</th>
                <th className={`${cls.th} text-right`}>Thành tiền</th>
                <th className={`${cls.th} text-right`}>Phí điện đang ghi</th>
                <th className={cls.th} />
              </tr>
            </thead>
            <tbody>
              {rowsShown.map(t => {
                const r = readingOf.get(t.id)!;
                const amt = amountOf(r);
                const current = calc.fees[month]?.[t.id]?.electricity || 0;
                const synced = current === amt && amt > 0;
                const backwards = Number(r.curr_reading) < Number(r.prev_reading);
                const room = t.room_id ? roomOf.get(t.room_id) : undefined;
                return (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className={cls.td}><div className="font-medium">{t.name}</div><div className="text-[10.5px] text-gray-400">{room?.code || '—'}</div></td>
                    <td className={`${cls.td} w-[110px]`}><DecimalInput value={r.prev_reading} onChange={v => patch('bds_meter_readings', r.id, { prev_reading: v ?? 0 })} /></td>
                    <td className={`${cls.td} w-[110px]`}>
                      <DecimalInput value={r.curr_reading} onChange={v => patch('bds_meter_readings', r.id, { curr_reading: v ?? 0 })} className={backwards ? '!border-red-400 !bg-red-50' : ''} />
                      {backwards && <div className="text-[10px] text-red-600 mt-0.5">nhỏ hơn chỉ số cũ (thay công tơ?)</div>}
                    </td>
                    <td className={`${cls.td} ${cls.num}`}>{kwhOf(r).toLocaleString('en-US')}</td>
                    <td className={`${cls.td} w-[110px]`}><MoneyInput value={r.unit_price} onChange={v => patch('bds_meter_readings', r.id, { unit_price: v })} /></td>
                    <td className={`${cls.td} ${cls.num} font-semibold`}>{fmtVND(amt)}</td>
                    <td className={`${cls.td} ${cls.num}`}>
                      {fmtVND(current)}
                      <div>{synced ? <Badge tone="green">✓ Đã áp dụng</Badge> : amt > 0 ? <Badge tone="amber">Chưa áp dụng</Badge> : null}</div>
                    </td>
                    <td className={`${cls.td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <button className={`${cls.btn} ${cls.secondary} !py-1 !px-2`} disabled={!amt || synced} onClick={() => apply(r)}>Áp dụng</button>
                        <button className="p-1 text-gray-300 hover:text-red-500" title="Xoá dòng chỉ số" onClick={() => { if (confirm(`Xoá chỉ số điện ${monthLabel(month)} của ${t.name}? (Phí điện đã áp dụng vẫn giữ nguyên)`)) remove('bds_meter_readings', r.id); }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rowsShown.length && (
                <tr><td colSpan={8} className="text-center text-gray-400 py-6">
                  Chưa có chỉ số tháng này.{missing.length > 0 && <> Bấm <b>"Tạo dòng cho {missing.length} khách"</b> ở trên.</>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
