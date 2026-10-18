import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cellKey, useOffice } from '../../data/OfficeDataProvider';
import { nextSortOrder, sortCategories } from '../../data/selectors';
import { monthLabel } from '../../lib/calc/months';
import { fmtVND } from '../../lib/calc/money';
import { opexAt } from '../../lib/calc/pl';
import { vatRateFor } from '../../lib/calc/vat';
import { MoneyInput } from '../MoneyInput';
import CopyPrevMonth from '../CopyPrevMonth';
import { Card, TextInput, Toggle, VatBadge, VatCategorySelect, VatSelect, cls } from '../ui';

export default function Opex() {
  const { rows, calc, months, currentMonth, insert, patch, remove, setOpex, saveState, saveErrors, retry } = useOffice();
  const cats = sortCategories(rows.bds_opex_categories);
  const [showInactive, setShowInactive] = useState(false);
  const gridCats = cats.filter(c => showInactive || c.active);
  const [name, setName] = useState('');

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if (await insert('bds_opex_categories', { name: n, sort_order: nextSortOrder(cats) })) setName('');
  };
  const del = async (id: string, nm: string) => {
    const n = rows.bds_opex_monthly.filter(r => r.category_id === id).length;
    if (!confirm(`Xoá hạng mục "${nm}" và ${n} tháng số liệu của nó?\nNếu chỉ không dùng nữa, hãy tắt "Đang dùng" để giữ lịch sử.`)) return;
    await remove('bds_opex_categories', id);
  };

  return (
    <div className="space-y-3 md:space-y-4">
      <Card pad={false} title="Hạng mục chi phí & cấu hình VAT" desc="Phí quản lý, bảo trì, sửa chữa, lương NV, đối ngoại… Chi phí vận hành là chi phí chung, không phân bổ theo mặt bằng.">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Hạng mục</th>
                <th className={`${cls.th} text-left`}>VAT</th>
                <th className={`${cls.th} text-left`}>Loại thuế suất</th>
                <th className={`${cls.th} text-center`}>Đang dùng</th>
                <th className={cls.th} />
              </tr>
            </thead>
            <tbody>
              {cats.map(c => (
                <tr key={c.id} className={`border-t border-gray-100 ${c.active ? '' : 'opacity-60'}`}>
                  <td className={`${cls.td} min-w-[180px]`}><TextInput className="w-full" value={c.name} onChange={v => patch('bds_opex_categories', c.id, { name: v })} /></td>
                  <td className={cls.td}><VatSelect value={c.vat_mode} onChange={v => patch('bds_opex_categories', c.id, { vat_mode: v })} /></td>
                  <td className={cls.td}><VatCategorySelect value={c.vat_category} onChange={v => patch('bds_opex_categories', c.id, { vat_category: v })} /></td>
                  <td className={`${cls.td} text-center`}><Toggle checked={c.active} onChange={v => patch('bds_opex_categories', c.id, { active: v }, true)} /></td>
                  <td className={cls.td}><button className="p-1 text-gray-300 hover:text-red-500" title="Xoá hạng mục" onClick={() => del(c.id, c.name)}><Trash2 size={13} /></button></td>
                </tr>
              ))}
              {!cats.length && <tr><td colSpan={5} className="text-center text-gray-400 py-5">Chưa có hạng mục.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 p-3 border-t border-gray-100 items-center">
          <input className={`${cls.inputSm} flex-1 min-w-[160px] max-w-[280px]`} placeholder="Tên hạng mục mới" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <button className={`${cls.btn} ${cls.primary}`} onClick={add} disabled={!name.trim()}><Plus size={13} /> Thêm hạng mục</button>
          {cats.some(c => !c.active) && <span className="ml-auto"><Toggle checked={showInactive} onChange={setShowInactive} label="Hiện hạng mục đã tắt trong bảng" /></span>}
        </div>
      </Card>

      <Card
        pad={false} title="Bảng nhập chi phí vận hành theo tháng"
        desc="Gõ số đầy đủ VNĐ. Tự lưu sau khi ngừng gõ. Cột tổng đã gồm VAT (theo cấu hình từng hạng mục)."
        actions={
          <CopyPrevMonth
            months={months} defaultMonth={months.includes(currentMonth) ? currentMonth : months[months.length - 1]} what="chi phí cố định"
            onCopy={(target, source) => {
              let n = 0;
              for (const c of gridCats) {
                const v = calc.opex[source]?.[c.id] || 0;
                if (v > 0 && !(calc.opex[target]?.[c.id] > 0)) { setOpex(c.id, target, v); n++; }
              }
              return n;
            }}
          />
        }
      >
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className={`${cls.th} text-left sticky left-0 bg-gray-50 z-10`}>Tháng</th>
                {gridCats.map(c => (
                  <th key={c.id} className={`${cls.th} text-right normal-case min-w-[120px]`}>
                    <div className="text-[11px] text-gray-700 font-semibold">{c.name}</div>
                    <div className="flex justify-end mt-0.5"><VatBadge mode={c.vat_mode} rate={vatRateFor(calc.settings, c.vat_category)} /></div>
                  </th>
                ))}
                <th className={`${cls.th} text-right`}>Tổng (VNĐ)</th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => {
                const now = m === currentMonth;
                return (
                  <tr key={m} className={`border-t border-gray-100 ${now ? 'bg-amber-50/60' : ''}`}>
                    <td className={`${cls.td} font-semibold sticky left-0 ${now ? 'bg-amber-50' : 'bg-white'}`}>{monthLabel(m)}</td>
                    {gridCats.map(c => {
                      const k = cellKey('bds_opex_monthly', c.id, m);
                      return (
                        <td key={c.id} className="px-1.5 py-1">
                          <MoneyInput value={calc.opex[m]?.[c.id] || 0} onChange={v => setOpex(c.id, m, v)} status={saveState[k]} error={saveErrors[k]} onRetry={() => retry(k)} ariaLabel={`${c.name} ${monthLabel(m)}`} />
                        </td>
                      );
                    })}
                    <td className={`${cls.td} ${cls.num} font-semibold`}>{fmtVND(opexAt(calc, m))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
