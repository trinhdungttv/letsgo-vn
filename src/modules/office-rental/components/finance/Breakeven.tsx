import { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { LANDLORD_SHORT, sortLeases } from '../../data/selectors';
import { computeBreakeven } from '../../lib/calc/breakeven';
import { leaseCostVND } from '../../lib/calc/pl';
import { monthLabel, monthToDate, toMonthKey } from '../../lib/calc/months';
import { fmtMoney, fmtUSD, fmtVND } from '../../lib/calc/money';
import type { BdsScenario } from '../../lib/types';
import { DecimalInput, MoneyInput } from '../MoneyInput';
import { Banner, Card, CurrencySelect, Empty, Field, Kpi, MonthInput, TextInput, VatSelect, cls, pnlTone, signed } from '../ui';

const LS_KEY = 'bds_breakeven_selected';

export default function Breakeven() {
  const { rows, calc, currentMonth, insert, patch, remove, toast } = useOffice();
  const scenarios = useMemo(
    () => [...rows.bds_breakeven_scenarios].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.name.localeCompare(b.name, 'vi')),
    [rows.bds_breakeven_scenarios],
  );
  const [selId, setSelId] = useState<string | null>(() => { try { return localStorage.getItem(LS_KEY); } catch { return null; } });
  const sc = scenarios.find(s => s.id === selId) || scenarios[0] || null;
  useEffect(() => { try { if (sc) localStorage.setItem(LS_KEY, sc.id); } catch { /* ignore */ } }, [sc]);

  const leases = sortLeases(rows.bds_head_leases);
  const rooms = useMemo(
    () => rows.bds_breakeven_rooms.filter(r => r.scenario_id === sc?.id).sort((a, b) => a.sort_order - b.sort_order),
    [rows.bds_breakeven_rooms, sc?.id],
  );

  const create = async () => {
    const s = await insert('bds_breakeven_scenarios', { name: `Kịch bản ${scenarios.length + 1}`, reference_month: monthToDate(currentMonth) });
    if (s) { setSelId(s.id); toast('Đã tạo kịch bản mới'); }
  };
  const duplicate = async () => {
    if (!sc) return;
    const s = await insert('bds_breakeven_scenarios', {
      name: `${sc.name} (bản sao)`, head_lease_id: sc.head_lease_id, reference_month: sc.reference_month,
      target_cost: sc.target_cost, extra_cost: sc.extra_cost, parent_area_m2: sc.parent_area_m2, note: sc.note,
    });
    if (!s) return;
    for (const r of rooms) {
      await insert('bds_breakeven_rooms', {
        scenario_id: s.id, name: r.name, area_m2: r.area_m2, currency: r.currency, price: r.price, vat_mode: r.vat_mode, sort_order: r.sort_order,
      });
    }
    setSelId(s.id);
    toast('Đã nhân bản kịch bản');
  };
  const del = async () => {
    if (!sc || !confirm(`Xoá kịch bản "${sc.name}" và ${rooms.length} phòng trong đó? (Không ảnh hưởng số liệu Lời/Lỗ thật)`)) return;
    if (await remove('bds_breakeven_scenarios', sc.id)) { setSelId(null); toast('Đã xoá kịch bản'); }
  };

  const leaseCostAt = (s: BdsScenario) => {
    const l = calc.headLeases.find(h => h.id === s.head_lease_id);
    return l && s.reference_month ? leaseCostVND(l, toMonthKey(s.reference_month), calc.settings) : null;
  };
  const updateSource = (p: Partial<BdsScenario>) => {
    if (!sc) return;
    const next = { ...sc, ...p };
    const cost = leaseCostAt(next);
    patch('bds_breakeven_scenarios', sc.id, { ...p, ...(cost !== null ? { target_cost: Math.round(cost) } : {}) });
  };

  const result = useMemo(() => computeBreakeven({
    targetCost: sc?.target_cost || 0,
    extraCost: sc?.extra_cost || 0,
    parentArea: sc?.parent_area_m2,
    rooms: rooms.map(r => ({ name: r.name, area: r.area_m2 || 0, currency: r.currency, price: r.price || 0, vatMode: r.vat_mode })),
    settings: calc.settings,
  }), [sc, rooms, calc.settings]);

  if (!sc) {
    return (
      <Card>
        <Empty>
          Chưa có kịch bản hòa vốn nào.
          <div className="mt-3"><button className={`${cls.btn} ${cls.primary}`} onClick={create}><Plus size={13} /> Tạo kịch bản</button></div>
        </Empty>
      </Card>
    );
  }

  const sourceCost = leaseCostAt(sc);
  const rate = calc.settings.exchangeRate || 1;

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${cls.inputSm} min-w-[200px]`} value={sc.id} onChange={e => setSelId(e.target.value)}>
          {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className={`${cls.btn} ${cls.secondary}`} onClick={create}><Plus size={13} /> Kịch bản mới</button>
        <button className={`${cls.btn} ${cls.secondary}`} onClick={duplicate}><Copy size={13} /> Nhân bản</button>
        <button className={`${cls.btn} ${cls.danger}`} onClick={del}><Trash2 size={13} /> Xoá</button>
      </div>

      <Banner tone="purple">🧮 Công cụ thử số khi chia nhỏ mặt bằng — gõ thử giá từng phòng để thấy dư/thiếu và <b>giá sàn tối thiểu</b> để deal. Không ảnh hưởng số liệu Lời/Lỗ thật.</Banner>

      <Card title="Thiết lập kịch bản">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label="Tên kịch bản">
            <TextInput className="w-full" value={sc.name} onChange={v => patch('bds_breakeven_scenarios', sc.id, { name: v })} />
          </Field>
          <Field label="Mặt bằng gốc">
            <select className={`${cls.inputSm} w-full`} value={sc.head_lease_id || ''} onChange={e => updateSource({ head_lease_id: e.target.value || null })}>
              <option value="">— Tự nhập chi phí —</option>
              {leases.map(l => <option key={l.id} value={l.id}>{LANDLORD_SHORT[l.landlord]} · {l.name}</option>)}
            </select>
          </Field>
          <Field label="Tháng tham khảo giá thuê">
            <MonthInput className="w-full" value={sc.reference_month ? toMonthKey(sc.reference_month) : null} onChange={m => updateSource({ reference_month: m ? monthToDate(m) : null })} />
          </Field>
          <Field
            label="Chi phí mục tiêu / tháng (VNĐ)"
            hint={sourceCost !== null && (
              Math.round(sourceCost) === Math.round(sc.target_cost)
                ? <>= giá thuê {monthLabel(toMonthKey(sc.reference_month!))} (đã gồm VAT)</>
                : <>Giá thuê {monthLabel(toMonthKey(sc.reference_month!))}: {fmtVND(sourceCost)} · <button className="text-blue-600 hover:underline" onClick={() => patch('bds_breakeven_scenarios', sc.id, { target_cost: Math.round(sourceCost) })}>dùng số này</button></>
            )}
          >
            <MoneyInput value={sc.target_cost} onChange={v => patch('bds_breakeven_scenarios', sc.id, { target_cost: v })} />
          </Field>
          <Field label="Chi phí chung phân bổ thêm (VNĐ)" hint="vd phần điện nước chung, bảo vệ… muốn các phòng gánh thêm">
            <MoneyInput value={sc.extra_cost} onChange={v => patch('bds_breakeven_scenarios', sc.id, { extra_cost: v })} />
          </Field>
          <Field label="Diện tích mặt bằng gốc (m²)" hint="Tuỳ chọn — để cảnh báo khi tổng m² các phòng lệch">
            <DecimalInput value={sc.parent_area_m2} onChange={v => patch('bds_breakeven_scenarios', sc.id, { parent_area_m2: v })} placeholder="vd 778" />
          </Field>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        <Kpi label="Cần thu tối thiểu / tháng" value={fmtVND(result.target)} sub={`≈ ${fmtUSD(Math.round(result.target / rate))}`} />
        <Kpi label="Tổng diện tích các phòng" value={`${result.totalArea.toLocaleString('en-US', { maximumFractionDigits: 2 })} m²`} sub={result.totalArea > 0 ? `Sàn bình quân ${fmtVND(result.target / result.totalArea)}/m²` : 'Nhập m² từng phòng'} />
        <Kpi label="Doanh thu gộp theo giá đề xuất" value={fmtVND(result.totalRevenue)} sub={`≈ ${fmtUSD(Math.round(result.totalRevenue / rate))}`} />
        <Kpi label={result.diff >= 0 ? 'Dư (lời)' : 'Thiếu (lỗ)'} tone={pnlTone(result.diff)} value={signed(fmtVND(result.diff), result.diff)} sub={result.target > 0 ? `${((result.totalRevenue / result.target) * 100).toFixed(1)}% mục tiêu` : undefined} />
      </div>

      {result.areaMismatch && (
        <Banner tone="amber">⚠ Tổng m² các phòng ({result.areaMismatch.rooms.toLocaleString('en-US')} m²) khác diện tích mặt bằng gốc ({result.areaMismatch.parent.toLocaleString('en-US')} m²) — lệch {(result.areaMismatch.parent - result.areaMismatch.rooms).toLocaleString('en-US', { maximumFractionDigits: 2 })} m² (hành lang, khu chung…?). Giá sàn vẫn chia theo tổng m² các phòng.</Banner>
      )}

      <Card
        pad={false}
        title="Danh sách phòng"
        desc={`Giá sàn = cần thu × m² phòng ÷ tổng m². VAT theo thuế thuê ${calc.settings.vatRateRent}%.`}
        actions={<button className={`${cls.btn} ${cls.primary}`} onClick={() => insert('bds_breakeven_rooms', { scenario_id: sc.id, name: `Phòng ${rooms.length + 1}`, sort_order: rooms.length + 1 })}><Plus size={13} /> Thêm phòng</button>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Phòng</th>
                <th className={`${cls.th} text-right`}>m²</th>
                <th className={`${cls.th} text-left`}>Tiền tệ</th>
                <th className={`${cls.th} text-right`}>Giá đề xuất / tháng</th>
                <th className={`${cls.th} text-left`}>VAT</th>
                <th className={`${cls.th} text-right`}>Giá / m²</th>
                <th className={`${cls.th} text-right`}>Doanh thu gộp (VNĐ)</th>
                <th className={`${cls.th} text-right`}>Giá sàn</th>
                <th className={`${cls.th} text-right`}>Dư / thiếu</th>
                <th className={cls.th} />
              </tr>
            </thead>
            <tbody>
              {rooms.map((room, i) => {
                const x = result.rooms[i];
                return (
                  <tr key={room.id} className="border-t border-gray-100 align-top">
                    <td className={`${cls.td} min-w-[120px]`}><TextInput className="w-full" value={room.name} onChange={v => patch('bds_breakeven_rooms', room.id, { name: v })} /></td>
                    <td className={`${cls.td} w-[90px]`}><DecimalInput value={room.area_m2} onChange={v => patch('bds_breakeven_rooms', room.id, { area_m2: v ?? 0 })} /></td>
                    <td className={cls.td}><CurrencySelect value={room.currency} onChange={v => patch('bds_breakeven_rooms', room.id, { currency: v })} /></td>
                    <td className={`${cls.td} min-w-[130px]`}><MoneyInput currency={room.currency} value={room.price} onChange={v => patch('bds_breakeven_rooms', room.id, { price: v })} /></td>
                    <td className={cls.td}><VatSelect value={room.vat_mode} onChange={v => patch('bds_breakeven_rooms', room.id, { vat_mode: v })} /></td>
                    <td className={`${cls.td} ${cls.num} text-gray-500`}>{x.pricePerM2 !== null ? fmtMoney(x.pricePerM2, room.currency) : '—'}</td>
                    <td className={`${cls.td} ${cls.num}`}>{fmtVND(x.revenueVND)}</td>
                    <td className={`${cls.td} ${cls.num} font-semibold`}>
                      {x.floorVND !== null ? (
                        <>
                          <div>{fmtVND(x.floorVND)}</div>
                          {(room.currency === 'USD' || room.vat_mode === 'excl') && x.floorQuote !== null && (
                            <div className="text-[10.5px] font-normal text-gray-400">≈ {fmtMoney(x.floorQuote, room.currency)}{room.vat_mode === 'excl' ? ' chưa VAT' : ''}</div>
                          )}
                          {x.floorPerM2VND !== null && <div className="text-[10.5px] font-normal text-gray-400">{fmtVND(x.floorPerM2VND)}/m²</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td className={`${cls.td} ${cls.num} ${x.diffVND === null ? '' : x.diffVND >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{x.diffVND !== null ? signed(fmtVND(x.diffVND), x.diffVND) : '—'}</td>
                    <td className={cls.td}>
                      <button className="p-1 text-gray-300 hover:text-red-500" title="Xoá phòng" onClick={() => remove('bds_breakeven_rooms', room.id)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
              {!rooms.length && <tr><td colSpan={10} className="text-center text-gray-400 py-6">Chưa có phòng — bấm "Thêm phòng".</td></tr>}
            </tbody>
            {rooms.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className={cls.td}>Tổng</td>
                  <td className={`${cls.td} ${cls.num}`}>{result.totalArea.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                  <td className={cls.td} colSpan={4} />
                  <td className={`${cls.td} ${cls.num}`}>{fmtVND(result.totalRevenue)}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtVND(result.target)}</td>
                  <td className={`${cls.td} ${cls.num} ${result.diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{signed(fmtVND(result.diff), result.diff)}</td>
                  <td className={cls.td} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
