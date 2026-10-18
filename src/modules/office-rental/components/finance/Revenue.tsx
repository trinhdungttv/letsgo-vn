import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Plus, Trash2, Upload } from 'lucide-react';
import { cellKey, useOffice, patchKey } from '../../data/OfficeDataProvider';
import { LANDLORD_SHORT, nextSortOrder, sortLeases, sortTenants } from '../../data/selectors';
import { buildFeeCsvTemplate, parseFeeCsv, type FeeCsvResult } from '../../lib/calc/csv';
import { monthLabel } from '../../lib/calc/months';
import { fmtVND } from '../../lib/calc/money';
import { tenantMonth } from '../../lib/calc/pl';
import type { Currency, MonthKey } from '../../lib/calc/types';
import { downloadText } from '../../lib/download';
import { CountInput, DecimalInput, MoneyInput } from '../MoneyInput';
import { Banner, Card, CurrencyBadge, CurrencySelect, MonthSelect, Modal, TextInput, Toggle, VatBadge, VatSelect, cls } from '../ui';

function TenantConfig() {
  const { rows, insert, patch, remove, saveState, saveErrors, retry } = useOffice();
  const tenants = sortTenants(rows.bds_tenants);
  const leases = sortLeases(rows.bds_head_leases);
  const [name, setName] = useState('');
  const [cur, setCur] = useState<Currency>('VND');

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const t = await insert('bds_tenants', { name: n, currency: cur, sort_order: nextSortOrder(tenants) });
    if (t) setName('');
  };
  const del = async (id: string, nm: string) => {
    const nRent = rows.bds_tenant_rent.filter(r => r.tenant_id === id).length;
    const nFee = rows.bds_tenant_fees.filter(r => r.tenant_id === id).length;
    if (!confirm(`Xoá khách "${nm}"?\nSẽ xoá luôn ${nRent} tháng tiền thuê + ${nFee} tháng phụ phí (cùng hoá đơn, chỉ số điện) của khách này.\nNếu khách chỉ ngừng thuê, hãy tắt "Đang thuê" thay vì xoá để giữ lịch sử.`)) return;
    await remove('bds_tenants', id);
  };

  return (
    <Card pad={false} title="Khách hàng & cấu hình" desc="Tiền tệ, mặt bằng đang thuê và cách tính VAT riêng từng khách. Khách đã ngừng: tắt 'Đang thuê' để giữ lịch sử doanh thu.">
      {/* Điện thoại: mỗi khách một thẻ */}
      <div className="md:hidden divide-y divide-gray-100 border-t border-gray-100">
        {tenants.map(t => (
          <div key={t.id} className={`p-3 space-y-2 ${t.active ? '' : 'opacity-60'}`}>
            <div className="flex gap-2 items-center">
              <TextInput className="flex-1" value={t.name} onChange={v => patch('bds_tenants', t.id, { name: v })} />
              <button className="p-1 text-gray-300 hover:text-red-500" title="Xoá khách" onClick={() => del(t.id, t.name)}><Trash2 size={14} /></button>
            </div>
            <select
              className={`${cls.inputSm} w-full ${!t.head_lease_id ? 'border-amber-300 bg-amber-50' : ''}`}
              value={t.head_lease_id || ''}
              onChange={e => patch('bds_tenants', t.id, { head_lease_id: e.target.value || null }, true)}
            >
              <option value="">⚠ Chưa gán mặt bằng</option>
              {leases.map(l => <option key={l.id} value={l.id}>{LANDLORD_SHORT[l.landlord]} · {l.name}</option>)}
            </select>
            <div className="flex gap-2 items-center">
              <CurrencySelect value={t.currency} onChange={v => patch('bds_tenants', t.id, { currency: v })} />
              <VatSelect className="flex-1 min-w-0" value={t.vat_mode} onChange={v => patch('bds_tenants', t.id, { vat_mode: v })} />
            </div>
            <div className="flex gap-2 items-center text-[12px] text-gray-500">
              <span className="w-[90px]"><DecimalInput value={t.area_m2} placeholder="m²" onChange={v => patch('bds_tenants', t.id, { area_m2: v })} /></span>m²
              <span className="ml-auto"><Toggle checked={t.active} onChange={v => patch('bds_tenants', t.id, { active: v }, true)} label="Đang thuê" /></span>
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50/70">
            <tr>
              <th className={`${cls.th} text-left`}>Khách hàng</th>
              <th className={`${cls.th} text-left`}>Tiền tệ</th>
              <th className={`${cls.th} text-left`}>Mặt bằng đang thuê</th>
              <th className={`${cls.th} text-left`}>VAT</th>
              <th className={`${cls.th} text-right`}>m²</th>
              <th className={`${cls.th} text-center`}>Đang thuê</th>
              <th className={cls.th} />
            </tr>
          </thead>
          <tbody>
            {tenants.map(t => {
              const k = patchKey('bds_tenants', t.id);
              return (
                <tr key={t.id} className={`border-t border-gray-100 ${t.active ? '' : 'opacity-60'}`}>
                  <td className={`${cls.td} min-w-[160px]`}>
                    <TextInput className={`w-full ${saveState[k] === 'error' ? 'border-red-400 bg-red-50' : ''}`} value={t.name} onChange={v => patch('bds_tenants', t.id, { name: v })} title={saveErrors[k]} />
                    {saveState[k] === 'error' && <button className="text-[10.5px] text-red-600 underline" onClick={() => retry(k)}>{saveErrors[k]} — thử lại</button>}
                  </td>
                  <td className={cls.td}><CurrencySelect value={t.currency} onChange={v => patch('bds_tenants', t.id, { currency: v })} /></td>
                  <td className={cls.td}>
                    <select
                      className={`${cls.inputSm} ${!t.head_lease_id ? 'border-amber-300 bg-amber-50' : ''}`}
                      value={t.head_lease_id || ''}
                      onChange={e => patch('bds_tenants', t.id, { head_lease_id: e.target.value || null }, true)}
                    >
                      <option value="">⚠ Chưa gán</option>
                      {leases.map(l => <option key={l.id} value={l.id}>{LANDLORD_SHORT[l.landlord]} · {l.name}</option>)}
                    </select>
                  </td>
                  <td className={cls.td}><VatSelect value={t.vat_mode} onChange={v => patch('bds_tenants', t.id, { vat_mode: v })} /></td>
                  <td className={`${cls.td} w-[80px]`}><DecimalInput value={t.area_m2} onChange={v => patch('bds_tenants', t.id, { area_m2: v })} /></td>
                  <td className={`${cls.td} text-center`}><Toggle checked={t.active} onChange={v => patch('bds_tenants', t.id, { active: v }, true)} /></td>
                  <td className={cls.td}><button className="p-1 text-gray-300 hover:text-red-500" title="Xoá khách" onClick={() => del(t.id, t.name)}><Trash2 size={13} /></button></td>
                </tr>
              );
            })}
            {!tenants.length && <tr><td colSpan={7} className="text-center text-gray-400 py-5">Chưa có khách hàng.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 p-3 border-t border-gray-100">
        <input className={`${cls.inputSm} flex-1 min-w-[160px] max-w-[260px]`} placeholder="Tên khách hàng mới" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <CurrencySelect value={cur} onChange={setCur} />
        <button className={`${cls.btn} ${cls.primary}`} onClick={add} disabled={!name.trim()}><Plus size={13} /> Thêm khách</button>
      </div>
    </Card>
  );
}

function RentGrid({ showInactive }: { showInactive: boolean }) {
  const { rows, calc, months, currentMonth, setRent, saveState, saveErrors, retry } = useOffice();
  const tenants = sortTenants(rows.bds_tenants).filter(t => showInactive || t.active);
  const calcTenant = new Map(calc.tenants.map(t => [t.id, t]));
  return (
    <Card pad={false} title="Bảng nhập tiền thuê theo tháng" desc="Gõ số đầy đủ, tự thêm dấu phẩy (5997000 → 5,997,000). Ô trống = chưa thu / chưa nhập. Tự lưu sau khi ngừng gõ.">
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className={`${cls.th} text-left sticky left-0 bg-gray-50 z-10`}>Tháng</th>
              {tenants.map(t => (
                <th key={t.id} className={`${cls.th} text-right normal-case min-w-[130px]`}>
                  <div className="text-[11px] text-gray-700 font-semibold">{t.name}</div>
                  <div className="flex justify-end gap-1 mt-0.5"><CurrencyBadge currency={t.currency} /><VatBadge mode={t.vat_mode} rate={calc.settings.vatRateRent} /></div>
                </th>
              ))}
              <th className={`${cls.th} text-right`}>Tổng tiền thuê (VNĐ)</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => {
              let total = 0;
              for (const t of calc.tenants) total += tenantMonth(calc, m, t).rent;
              const now = m === currentMonth;
              return (
                <tr key={m} className={`border-t border-gray-100 ${now ? 'bg-amber-50/60' : ''}`}>
                  <td className={`${cls.td} font-semibold sticky left-0 ${now ? 'bg-amber-50' : 'bg-white'}`}>{monthLabel(m)}</td>
                  {tenants.map(t => {
                    const k = cellKey('bds_tenant_rent', t.id, m);
                    const ct = calcTenant.get(t.id)!;
                    return (
                      <td key={t.id} className="px-1.5 py-1">
                        <MoneyInput
                          currency={t.currency} value={calc.rent[m]?.[t.id] || 0} ariaLabel={`${t.name} ${monthLabel(m)}`}
                          onChange={v => setRent(t.id, m, v)} status={saveState[k]} error={saveErrors[k]} onRetry={() => retry(k)}
                        />
                        {t.currency === 'USD' && (calc.rent[m]?.[t.id] || 0) > 0 && (
                          <div className="text-[10px] text-gray-400 text-right mt-0.5">≈ {fmtVND(tenantMonth(calc, m, ct).rent)}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className={`${cls.td} ${cls.num} font-semibold`}>{fmtVND(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FeePanel({ showInactive }: { showInactive: boolean }) {
  const { rows, calc, months, currentMonth, settings, patch, setFee, bulkFees, saveState, saveErrors, retry, toast } = useOffice();
  const open = settings.show_fee_panel;
  const tenants = sortTenants(rows.bds_tenants).filter(t => showInactive || t.active);
  const [tplMonth, setTplMonth] = useState<MonthKey>(() => (months.includes(currentMonth) ? currentMonth : months[0]));
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<{ name: string; result: FeeCsvResult } | null>(null);
  const [importing, setImporting] = useState(false);

  const downloadTemplate = () => {
    const list = sortTenants(rows.bds_tenants).filter(t => t.active);
    downloadText(`mau_phi_dien_xe_${tplMonth}.csv`, buildFeeCsvTemplate(tplMonth, list, calc.fees[tplMonth]), 'text/csv;charset=utf-8');
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    setCsv({ name: f.name, result: parseFeeCsv(text, rows.bds_tenants) });
    if (fileRef.current) fileRef.current.value = '';
  };
  const doImport = async () => {
    if (!csv) return;
    setImporting(true);
    const ok = await bulkFees(csv.result.rows.map(r => ({ tenantId: r.tenantId, month: r.month, fee: r.fee })));
    setImporting(false);
    if (ok) {
      toast(`Đã nhập ${csv.result.rows.length} dòng phụ phí${csv.result.errors.length ? ` · ${csv.result.errors.length} dòng lỗi bị bỏ qua` : ''}`);
      setCsv(c => (c && c.result.errors.length ? { ...c, result: { ...c.result, rows: [] } } : null));
    }
  };

  return (
    <Card pad={false}>
      <button
        className="w-full flex flex-wrap items-center justify-between gap-2 px-3 md:px-4 py-3 text-left"
        onClick={() => patch('bds_settings', '1', { show_fee_panel: !open }, true)}
      >
        <span className="text-[13px] font-semibold text-[#111] flex items-center gap-1.5">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} 🔌🅿️ Phụ phí Điện &amp; Bãi xe theo khách hàng
        </span>
        <span className="text-[11.5px] text-gray-400">{open ? 'Bấm để ẩn' : 'Bấm để hiện'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <div className="p-3 md:p-4 space-y-3">
            <div className="text-[11.5px] text-gray-500">Mỗi khách trả thêm tiền điện + phí gửi xe hằng tháng, cộng vào doanh thu (VAT theo thuế điện/xe {calc.settings.vatRateUtil}%). Điện nhập số tiền, xe nhập số lượng — hệ thống tự nhân đơn giá.</div>
            <div className="flex flex-wrap gap-3 items-end">
              <label className="text-[12px] text-gray-600">🏍️ Đơn giá xe máy (đ/xe/tháng)
                <div className="w-[150px] mt-1"><MoneyInput value={settings.parking_price_moto} onChange={v => patch('bds_settings', '1', { parking_price_moto: v })} /></div>
              </label>
              <label className="text-[12px] text-gray-600">🚗 Đơn giá ô tô (đ/xe/tháng)
                <div className="w-[150px] mt-1"><MoneyInput value={settings.parking_price_car} onChange={v => patch('bds_settings', '1', { parking_price_car: v })} /></div>
              </label>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <MonthSelect months={months} value={tplMonth} onChange={setTplMonth} />
                <button className={`${cls.btn} ${cls.secondary}`} onClick={downloadTemplate}><Download size={13} /> Tải mẫu CSV</button>
                <button className={`${cls.btn} ${cls.primary}`} onClick={() => fileRef.current?.click()}><Upload size={13} /> Nhập CSV</button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="w-full text-[12px]">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className={`${cls.th} text-left sticky left-0 bg-gray-50 z-10`} rowSpan={2}>Tháng</th>
                  {tenants.map(t => <th key={t.id} colSpan={3} className={`${cls.th} text-center normal-case text-gray-700 border-l border-gray-200`}>{t.name}</th>)}
                  <th className={`${cls.th} text-right`} rowSpan={2}>Tổng phụ phí (VNĐ)</th>
                </tr>
                <tr>
                  {tenants.map(t => (
                    <FeeHead key={t.id} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map(m => {
                  let total = 0;
                  for (const t of calc.tenants) total += tenantMonth(calc, m, t).fees;
                  const now = m === currentMonth;
                  return (
                    <tr key={m} className={`border-t border-gray-100 ${now ? 'bg-amber-50/60' : ''}`}>
                      <td className={`${cls.td} font-semibold sticky left-0 ${now ? 'bg-amber-50' : 'bg-white'}`}>{monthLabel(m)}</td>
                      {tenants.map(t => {
                        const f = calc.fees[m]?.[t.id];
                        const k = cellKey('bds_tenant_fees', t.id, m);
                        const st = saveState[k];
                        return [
                          <td key={`${t.id}e`} className="px-1 py-1 border-l border-gray-100 min-w-[110px]">
                            <MoneyInput value={f?.electricity || 0} onChange={v => setFee(t.id, m, { electricity_amount: v })} status={st} error={saveErrors[k]} onRetry={() => retry(k)} ariaLabel={`Điện ${t.name} ${monthLabel(m)}`} />
                          </td>,
                          <td key={`${t.id}m`} className="px-1 py-1 w-[64px]">
                            <CountInput value={f?.moto || 0} onChange={v => setFee(t.id, m, { motorbike_count: v })} status={st} ariaLabel={`Xe máy ${t.name} ${monthLabel(m)}`} />
                          </td>,
                          <td key={`${t.id}c`} className="px-1 py-1 w-[64px]">
                            <CountInput value={f?.car || 0} onChange={v => setFee(t.id, m, { car_count: v })} status={st} ariaLabel={`Ô tô ${t.name} ${monthLabel(m)}`} />
                          </td>,
                        ];
                      })}
                      <td className={`${cls.td} ${cls.num} font-semibold`}>{fmtVND(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!csv} onClose={() => setCsv(null)} wide
        title={`Nhập CSV phí điện / xe — ${csv?.name || ''}`}
        footer={<>
          <button className={`${cls.btn} ${cls.secondary}`} onClick={() => setCsv(null)}>Đóng</button>
          {!!csv?.result.rows.length && (
            <button className={`${cls.btn} ${cls.primary}`} disabled={importing} onClick={doImport}>
              {importing ? 'Đang nhập…' : `Nhập ${csv.result.rows.length} dòng hợp lệ`}
            </button>
          )}
        </>}
      >
        {csv && <CsvResultView result={csv.result} />}
      </Modal>
    </Card>
  );
}

function FeeHead() {
  return (
    <>
      <th className={`${cls.th} text-right border-l border-gray-200`}>Điện (đ)</th>
      <th className={`${cls.th} text-right`}>Xe máy</th>
      <th className={`${cls.th} text-right`}>Ô tô</th>
    </>
  );
}

function CsvResultView({ result }: { result: FeeCsvResult }) {
  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of result.rows) m.set(r.month, (m.get(r.month) || 0) + 1);
    return [...m.entries()].sort();
  }, [result.rows]);
  return (
    <div className="space-y-3 text-[12px]">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5"><div className="text-[10.5px] uppercase font-semibold text-emerald-700">Dòng hợp lệ</div><div className="text-[18px] font-semibold text-emerald-700">{result.rows.length}</div></div>
        <div className={`rounded-lg border p-2.5 ${result.errors.length ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}><div className={`text-[10.5px] uppercase font-semibold ${result.errors.length ? 'text-red-700' : 'text-gray-500'}`}>Dòng lỗi</div><div className={`text-[18px] font-semibold ${result.errors.length ? 'text-red-700' : 'text-gray-500'}`}>{result.errors.length}</div></div>
      </div>
      {byMonth.length > 0 && <div className="text-gray-600">Theo tháng: {byMonth.map(([m, n]) => `${monthLabel(m)} (${n})`).join(' · ')}. Dữ liệu cũ của đúng khách + tháng đó sẽ được ghi đè.</div>}
      {result.errors.length > 0 && (
        <Banner tone="red">
          <div className="font-semibold mb-1">Các dòng lỗi (sẽ bỏ qua):</div>
          <ul className="space-y-0.5 max-h-[200px] overflow-y-auto">
            {result.errors.map((e, i) => <li key={i}><b>Dòng {e.line}:</b> {e.message}</li>)}
          </ul>
        </Banner>
      )}
      {result.warnings.length > 0 && (
        <Banner tone="amber">
          <ul className="space-y-0.5">{result.warnings.map((w, i) => <li key={i}><b>Dòng {w.line}:</b> {w.message}</li>)}</ul>
        </Banner>
      )}
      {result.rows.length > 0 && (
        <div className="overflow-x-auto max-h-[240px] border border-gray-100 rounded-lg">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0"><tr>
              <th className={`${cls.th} text-left`}>Dòng</th><th className={`${cls.th} text-left`}>Tháng</th><th className={`${cls.th} text-left`}>Khách</th>
              <th className={`${cls.th} text-right`}>Điện</th><th className={`${cls.th} text-right`}>Xe máy</th><th className={`${cls.th} text-right`}>Ô tô</th>
            </tr></thead>
            <tbody>
              {result.rows.map(r => (
                <tr key={r.line} className="border-t border-gray-100">
                  <td className={cls.td}>{r.line}</td><td className={cls.td}>{monthLabel(r.month)}</td><td className={cls.td}>{r.tenantName}</td>
                  <td className={`${cls.td} ${cls.num}`}>{fmtVND(r.fee.electricity)}</td><td className={`${cls.td} ${cls.num}`}>{r.fee.moto}</td><td className={`${cls.td} ${cls.num}`}>{r.fee.car}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[11px] text-gray-400">Định dạng: <code>Thang,Khach_hang,Dien,Xe_may,O_to</code> · tháng YYYY-MM · tên khách khớp không phân biệt hoa thường.</div>
    </div>
  );
}

export default function Revenue() {
  const { rows } = useOffice();
  const [showInactive, setShowInactive] = useState(false);
  const inactive = rows.bds_tenants.filter(t => !t.active).length;
  return (
    <div className="space-y-3 md:space-y-4">
      <TenantConfig />
      {inactive > 0 && (
        <Toggle checked={showInactive} onChange={setShowInactive} label={`Hiện cả ${inactive} khách đã ngừng thuê trong bảng nhập (tổng luôn tính đủ mọi khách)`} />
      )}
      <RentGrid showInactive={showInactive} />
      <FeePanel showInactive={showInactive} />
    </div>
  );
}
