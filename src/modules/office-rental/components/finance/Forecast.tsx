import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { monthToDate, toMonthKey } from '../../lib/calc/months';
import { fmtVND } from '../../lib/calc/money';
import type { MonthKey } from '../../lib/calc/types';
import { MoneyInput } from '../MoneyInput';
import { Badge, Banner, Card, Field, MonthInput, TextInput, Toggle, cls } from '../ui';

export default function Forecast() {
  const { rows, currentMonth, settings, insert, patch, remove } = useOffice();
  const list = [...rows.bds_forecast_expenses].sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name, 'vi'));
  const [name, setName] = useState('');
  const [month, setMonth] = useState<MonthKey>(currentMonth);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const total = list.reduce((a, f) => a + (Number(f.amount) || 0), 0);
  const upcoming = list.filter(f => toMonthKey(f.month) >= currentMonth).reduce((a, f) => a + (Number(f.amount) || 0), 0);

  const add = async () => {
    if (!name.trim()) return;
    const f = await insert('bds_forecast_expenses', { name: name.trim(), month: monthToDate(month), amount, note: note.trim() || null });
    if (f) { setName(''); setAmount(0); setNote(''); }
  };

  return (
    <div className="space-y-3 md:space-y-4">
      <Banner tone="purple">
        🔮 Danh sách <b>dự kiến</b>, chưa phải chi phí thực tế. Khi khoản nào xảy ra thật, nhập nó vào tab "Chi phí vận hành" rồi xoá khỏi đây để tránh trùng.
      </Banner>
      <div className="bg-white rounded-xl border border-[#E8E7E2] p-3 flex flex-wrap items-center gap-3">
        <Toggle
          checked={settings.include_forecast_in_cost}
          onChange={v => patch('bds_settings', '1', { include_forecast_in_cost: v }, true)}
          label="Cộng khoản dự kiến vào Tổng chi phí (Lời/Lỗ)"
        />
        <span className="text-[11.5px] text-gray-400">{settings.include_forecast_in_cost ? 'Đang cộng thẳng vào chi phí đúng tháng dự kiến.' : 'Đang tắt: chỉ hiện tham khảo ở cột riêng, không ảnh hưởng lợi nhuận.'}</span>
      </div>

      <Card title="Thêm khoản dự kiến">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.2fr_2fr_auto] gap-2.5 items-end">
          <Field label="Tên khoản"><TextInput className="w-full" value={name} onChange={setName} placeholder="VD: Sơn lại mặt tiền" /></Field>
          <Field label="Tháng dự kiến"><MonthInput className="w-full" value={month} onChange={m => m && setMonth(m)} /></Field>
          <Field label="Số tiền (VNĐ)"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Ghi chú"><TextInput className="w-full" value={note} onChange={setNote} placeholder="VD: chưa báo giá chính thức" /></Field>
          <button className={`${cls.btn} ${cls.primary}`} onClick={add} disabled={!name.trim()}><Plus size={13} /> Thêm</button>
        </div>
      </Card>

      <Card
        pad={false}
        title="Khoản đang theo dõi"
        actions={<div className="text-[12px] text-gray-500">{list.length} khoản · Tổng <b>{fmtVND(total)}</b> · Sắp tới <b className="text-violet-600">{fmtVND(upcoming)}</b></div>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Tháng</th>
                <th className={`${cls.th} text-left`}>Tên khoản</th>
                <th className={`${cls.th} text-right`}>Số tiền</th>
                <th className={`${cls.th} text-left`}>Ghi chú</th>
                <th className={cls.th} />
              </tr>
            </thead>
            <tbody>
              {list.map(f => {
                const past = toMonthKey(f.month) < currentMonth;
                return (
                  <tr key={f.id} className={`border-t border-gray-100 ${past ? 'opacity-70' : ''}`}>
                    <td className={cls.td}>
                      <div className="flex items-center gap-1.5">
                        <MonthInput value={toMonthKey(f.month)} onChange={m => m && patch('bds_forecast_expenses', f.id, { month: monthToDate(m) })} />
                        {past && <Badge tone="amber">Đã qua</Badge>}
                      </div>
                    </td>
                    <td className={`${cls.td} min-w-[180px]`}><TextInput className="w-full" value={f.name} onChange={v => patch('bds_forecast_expenses', f.id, { name: v })} /></td>
                    <td className={`${cls.td} w-[150px]`}><MoneyInput value={f.amount} onChange={v => patch('bds_forecast_expenses', f.id, { amount: v })} /></td>
                    <td className={`${cls.td} min-w-[180px]`}><TextInput className="w-full" value={f.note || ''} onChange={v => patch('bds_forecast_expenses', f.id, { note: v || null })} /></td>
                    <td className={cls.td}>
                      <button className="p-1 text-gray-300 hover:text-red-500" title="Xoá khoản" onClick={() => { if (confirm(`Xoá khoản dự kiến "${f.name}"?`)) remove('bds_forecast_expenses', f.id); }}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={5} className="text-center text-gray-400 py-6">Chưa có khoản dự kiến nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
