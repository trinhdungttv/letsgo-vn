import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Eye, Printer, Undo2 } from 'lucide-react';
import { useOffice } from '../../data/OfficeDataProvider';
import { sortTenants } from '../../data/selectors';
import { monthLabel, monthToDate } from '../../lib/calc/months';
import { fmtUSD, fmtVND } from '../../lib/calc/money';
import type { CalcTenant, MonthKey } from '../../lib/calc/types';
import { defaultDueDate, fmtDate, invoiceBreakdown, invoiceState, todayStr, type InvoiceBreakdown } from '../../lib/ops';
import type { BdsInvoice, BdsMeterReading, BdsRoom, BdsSettings, BdsTenant } from '../../lib/types';
import { MoneyInput } from '../MoneyInput';
import { Card, Field, Kpi, Modal, MonthSelect, TextInput, cls } from '../ui';
import { InvoiceStateBadge } from './shared';

const PRINT_CSS = `
.bds-print-root { display: none; }
@media print {
  body > *:not(.bds-print-root) { display: none !important; }
  .bds-print-root { display: block !important; }
  .bds-print-page { page-break-after: always; break-after: page; }
  .bds-print-page:last-child { page-break-after: auto; break-after: auto; }
  @page { size: A4; margin: 14mm; }
}`;

interface DocProps {
  tenant: BdsTenant;
  ct: CalcTenant;
  month: MonthKey;
  b: InvoiceBreakdown;
  invoice?: BdsInvoice;
  room?: BdsRoom;
  reading?: BdsMeterReading;
  settings: BdsSettings;
  rate: number;
  prices: { moto: number; car: number };
}

export function InvoiceDoc({ tenant, ct, month, b, invoice, room, reading, settings, rate, prices }: DocProps) {
  const due = invoice?.due_date || defaultDueDate(month, settings.invoice_due_day ?? 10);
  const rentVatRate = Number(settings.vat_rate_rent);
  const utilVatRate = Number(settings.vat_rate_util);
  const rows: { label: string; detail?: string; amount: number; muted?: boolean }[] = [];
  if (b.rent.gross) {
    rows.push({
      label: `Tiền thuê văn phòng${room?.area_m2 ? ` (${Number(room.area_m2).toLocaleString('en-US')} m²)` : ''}`,
      detail: ct.currency === 'USD' ? `${fmtUSD(b.rentInput)} × ${rate.toLocaleString('en-US')}đ` : undefined,
      amount: b.rent.net,
    });
  }
  if (b.electricity.gross) {
    const kwh = reading ? Number(reading.curr_reading) - Number(reading.prev_reading) : 0;
    rows.push({ label: 'Tiền điện', detail: reading && kwh > 0 ? `${kwh.toLocaleString('en-US')} kWh × ${fmtVND(reading.unit_price)}` : undefined, amount: b.electricity.net });
  }
  if (b.parking.gross) {
    const parts = [b.moto ? `${b.moto} xe máy × ${fmtVND(prices.moto)}` : '', b.car ? `${b.car} ô tô × ${fmtVND(prices.car)}` : ''].filter(Boolean);
    rows.push({ label: 'Phí gửi xe', detail: parts.join(' + '), amount: b.parking.net });
  }
  if (b.rent.vat) rows.push({ label: `Thuế GTGT tiền thuê (${rentVatRate}%)`, amount: b.rent.vat, muted: true });
  if (b.electricity.vat + b.parking.vat) rows.push({ label: `Thuế GTGT điện & gửi xe (${utilVatRate}%)`, amount: b.electricity.vat + b.parking.vat, muted: true });

  return (
    <div className="bg-white text-[#111] text-[12.5px] leading-relaxed">
      <div className="flex justify-between items-start border-b-2 border-[#0c2340] pb-2 mb-3">
        <div>
          <div className="text-[15px] font-bold text-[#0c2340]">TTV HR GROUP</div>
          <div className="text-[11px] text-gray-500">Văn phòng cho thuê Orient Apartment · 331 Bến Vân Đồn, Quận 4, TP.HCM</div>
        </div>
        <div className="text-right text-[11px] text-gray-500">
          {invoice?.invoice_no && <div>Số: <b className="text-[#111]">{invoice.invoice_no}</b></div>}
          <div>Ngày lập: {fmtDate(todayStr())}</div>
        </div>
      </div>
      <div className="text-center mb-3">
        <div className="text-[16px] font-bold tracking-wide">THÔNG BÁO THANH TOÁN</div>
        <div className="text-gray-500">Tháng {Number(month.slice(5, 7))}/{month.slice(0, 4)}</div>
      </div>
      <div className="mb-3">
        <div>Kính gửi: <b>{tenant.name}</b></div>
        {room && <div className="text-gray-600">Phòng: {room.code}{room.name ? ` — ${room.name}` : ''}{room.location ? ` · ${room.location}` : ''}</div>}
      </div>
      <table className="w-full border-collapse mb-2">
        <thead>
          <tr className="border-y border-gray-300 bg-gray-50">
            <th className="text-left py-1.5 px-2 font-semibold">Khoản thu</th>
            <th className="text-right py-1.5 px-2 font-semibold">Thành tiền (VNĐ)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className={`py-1.5 px-2 ${r.muted ? 'text-gray-500' : ''}`}>{r.label}{r.detail && <div className="text-[11px] text-gray-500">{r.detail}</div>}</td>
              <td className={`py-1.5 px-2 text-right tabular-nums ${r.muted ? 'text-gray-500' : ''}`}>{fmtVND(r.amount)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={2} className="py-3 text-center text-gray-400">Chưa có khoản thu nào trong tháng này.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[#0c2340]">
            <td className="py-2 px-2 font-bold">TỔNG CỘNG</td>
            <td className="py-2 px-2 text-right font-bold text-[14px] tabular-nums">{fmtVND(b.total)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="text-[11px] text-gray-600 space-y-0.5">
        {ct.currency === 'USD' && b.rentInput > 0 && <div>* Tỷ giá áp dụng: 1 USD = {rate.toLocaleString('en-US')} VNĐ</div>}
        {ct.vatMode === 'incl' && b.vatTotal > 0 && <div>* Số tiền trên đã bao gồm thuế GTGT.</div>}
        <div>* Hạn thanh toán: <b>{fmtDate(due)}</b></div>
        {settings.invoice_footer && <div className="whitespace-pre-line">* {settings.invoice_footer}</div>}
      </div>
      {invoice?.status === 'paid' && (
        <div className="mt-3 inline-block border-2 border-emerald-600 text-emerald-700 font-bold px-3 py-1 rounded rotate-[-3deg]">
          ĐÃ THANH TOÁN {invoice.paid_at ? fmtDate(invoice.paid_at) : ''}
        </div>
      )}
    </div>
  );
}

export default function Invoices() {
  const { rows, calc, months, currentMonth, settings, insert, patch } = useOffice();
  const [sel, setSel] = useState<MonthKey>(() => (months.includes(currentMonth) ? currentMonth : months[0]));
  const month = months.includes(sel) ? sel : months[0];
  const md = monthToDate(month);
  const today = todayStr();
  const rate = calc.settings.exchangeRate || 1;
  const prices = { moto: calc.settings.parkingPriceMoto, car: calc.settings.parkingPriceCar };
  const roomOf = new Map(rows.bds_rooms.map(r => [r.id, r]));
  const invOf = new Map(rows.bds_invoices.filter(i => i.month === md).map(i => [i.tenant_id, i]));
  const readingOf = new Map(rows.bds_meter_readings.filter(r => r.month === md).map(r => [r.tenant_id, r]));
  const ctOf = new Map(calc.tenants.map(t => [t.id, t]));
  const list = sortTenants(rows.bds_tenants)
    .map(t => ({ t, ct: ctOf.get(t.id)!, b: invoiceBreakdown(calc, month, ctOf.get(t.id)!) }))
    .filter(x => x.t.active || !x.b.isEmpty);

  const [preview, setPreview] = useState<string[] | null>(null);
  const [paying, setPaying] = useState<{ tenantId: string; paid_at: string; paid_amount: number; note: string } | null>(null);

  const ensure = async (tenantId: string, seqOverride?: number): Promise<BdsInvoice | null> => {
    const ex = invOf.get(tenantId);
    if (ex) return ex;
    const seq = seqOverride ?? rows.bds_invoices.filter(i => i.month === md).length + 1;
    return insert('bds_invoices', {
      tenant_id: tenantId, month: md, status: 'unpaid',
      due_date: defaultDueDate(month, settings.invoice_due_day ?? 10),
      invoice_no: `TB-${month.replace('-', '')}-${String(seq).padStart(2, '0')}`,
    });
  };

  const issueAll = async () => {
    let seq = rows.bds_invoices.filter(i => i.month === md).length;
    for (const x of list) if (!invOf.get(x.t.id) && !x.b.isEmpty) await ensure(x.t.id, ++seq);
  };

  const confirmPaid = async () => {
    if (!paying) return;
    const inv = await ensure(paying.tenantId);
    if (inv) patch('bds_invoices', inv.id, { status: 'paid', paid_at: paying.paid_at, paid_amount: paying.paid_amount, note: paying.note || null }, true);
    setPaying(null);
  };

  const totals = list.reduce((a, x) => {
    const inv = invOf.get(x.t.id);
    const st = invoiceState(inv, today).state;
    a.due += x.b.total;
    if (st === 'paid') a.paid += inv?.paid_amount ?? x.b.total;
    else if (st === 'overdue') a.overdue += x.b.total;
    return a;
  }, { due: 0, paid: 0, overdue: 0 });

  const docs = (ids: string[]) => ids.map(id => {
    const x = list.find(l => l.t.id === id);
    if (!x) return null;
    return (
      <InvoiceDoc
        key={id} tenant={x.t} ct={x.ct} month={month} b={x.b} invoice={invOf.get(id)}
        room={x.t.room_id ? roomOf.get(x.t.room_id) : undefined} reading={readingOf.get(id)}
        settings={settings} rate={rate} prices={prices}
      />
    );
  });

  return (
    <div className="space-y-3 md:space-y-4">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-gray-500">Tháng</span>
        <MonthSelect months={months} value={month} onChange={setSel} />
        <div className="ml-auto flex flex-wrap gap-2">
          <button className={`${cls.btn} ${cls.secondary}`} onClick={issueAll}>Lập thông báo cho cả tháng</button>
          <button className={`${cls.btn} ${cls.secondary}`} onClick={() => setPreview(list.filter(x => !x.b.isEmpty).map(x => x.t.id))} disabled={!list.some(x => !x.b.isEmpty)}><Printer size={13} /> In tất cả</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        <Kpi label={`Phải thu ${monthLabel(month)}`} value={fmtVND(totals.due)} />
        <Kpi label="Đã thu" tone="pos" value={fmtVND(totals.paid)} />
        <Kpi label="Còn phải thu" value={fmtVND(Math.max(0, totals.due - totals.paid))} />
        <Kpi label="Quá hạn" tone={totals.overdue > 0 ? 'neg' : 'muted'} value={fmtVND(totals.overdue)} />
      </div>

      <Card pad={false} title="Thông báo thanh toán theo khách" desc="Số tiền luôn tính lại từ tiền thuê + điện + xe đã nhập ở Lời/Lỗ (không lưu bản sao). Hệ thống chỉ lưu trạng thái, hạn, ngày & số tiền đã thu.">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50/70">
              <tr>
                <th className={`${cls.th} text-left`}>Khách / Phòng</th>
                <th className={`${cls.th} text-right`}>Tiền thuê</th>
                <th className={`${cls.th} text-right`}>Điện</th>
                <th className={`${cls.th} text-right`}>Gửi xe</th>
                <th className={`${cls.th} text-right`}>VAT</th>
                <th className={`${cls.th} text-right`}>Tổng</th>
                <th className={`${cls.th} text-left`}>Hạn TT</th>
                <th className={`${cls.th} text-left`}>Trạng thái</th>
                <th className={cls.th} />
              </tr>
            </thead>
            <tbody>
              {list.map(({ t, b }) => {
                const inv = invOf.get(t.id);
                const st = invoiceState(inv, today);
                const room = t.room_id ? roomOf.get(t.room_id) : undefined;
                return (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className={cls.td}>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-[10.5px] text-gray-400">{room ? room.code : 'chưa gán phòng'}{inv?.invoice_no ? ` · ${inv.invoice_no}` : ''}</div>
                    </td>
                    <td className={`${cls.td} ${cls.num}`}>{t.currency === 'USD' && b.rentInput > 0 && <div className="text-[10.5px] text-gray-400">{fmtUSD(b.rentInput)}</div>}{fmtVND(b.rent.net)}</td>
                    <td className={`${cls.td} ${cls.num}`}>{fmtVND(b.electricity.net)}</td>
                    <td className={`${cls.td} ${cls.num}`}>{b.moto + b.car > 0 && <div className="text-[10.5px] text-gray-400">{b.moto} máy · {b.car} ô tô</div>}{fmtVND(b.parking.net)}</td>
                    <td className={`${cls.td} ${cls.num} text-gray-500`}>{b.vatTotal ? fmtVND(b.vatTotal) : '—'}</td>
                    <td className={`${cls.td} ${cls.num} font-semibold`}>{fmtVND(b.total)}</td>
                    <td className={cls.td}>
                      <input
                        type="date" className={cls.inputSm}
                        value={inv?.due_date || ''} placeholder={defaultDueDate(month, settings.invoice_due_day ?? 10)}
                        onChange={async e => { const v = e.target.value || null; const i = await ensure(t.id); if (i) patch('bds_invoices', i.id, { due_date: v }, true); }}
                      />
                    </td>
                    <td className={cls.td}><InvoiceStateBadge st={st} paidAt={inv?.paid_at} /></td>
                    <td className={`${cls.td} text-right`}>
                      <div className="flex justify-end gap-1">
                        <button className={`${cls.btn} ${cls.secondary} !py-1 !px-2`} title="Xem & in" onClick={() => setPreview([t.id])}><Eye size={12} /></button>
                        {st.state === 'paid' ? (
                          <button className={`${cls.btn} ${cls.ghost} !py-1 !px-2`} title="Huỷ đánh dấu đã thu" onClick={() => { if (inv && confirm(`Huỷ trạng thái "đã thu" của ${t.name}?`)) patch('bds_invoices', inv.id, { status: 'unpaid', paid_at: null, paid_amount: null }, true); }}><Undo2 size={12} /></button>
                        ) : (
                          <button className={`${cls.btn} ${cls.primary} !py-1 !px-2`} disabled={b.isEmpty} onClick={() => setPaying({ tenantId: t.id, paid_at: today, paid_amount: Math.round(b.total), note: '' })}><CheckCircle2 size={12} /> Đã thu</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={9} className="text-center text-gray-400 py-6">Chưa có khách thuê.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!preview} onClose={() => setPreview(null)} wide
        title={preview && preview.length > 1 ? `Xem trước ${preview.length} thông báo — ${monthLabel(month)}` : 'Xem trước thông báo thanh toán'}
        footer={<>
          <button className={`${cls.btn} ${cls.secondary}`} onClick={() => setPreview(null)}>Đóng</button>
          <button className={`${cls.btn} ${cls.primary}`} onClick={() => window.print()}><Printer size={13} /> In / Lưu PDF</button>
        </>}
      >
        <div className="space-y-6">{preview && docs(preview).map((d, i) => <div key={i} className="border border-gray-200 rounded-lg p-4">{d}</div>)}</div>
      </Modal>
      {preview && createPortal(
        <div className="bds-print-root">{docs(preview).map((d, i) => <div key={i} className="bds-print-page">{d}</div>)}</div>,
        document.body,
      )}

      <Modal
        open={!!paying} onClose={() => setPaying(null)} title="Ghi nhận đã thu tiền"
        footer={<><button className={`${cls.btn} ${cls.secondary}`} onClick={() => setPaying(null)}>Huỷ</button><button className={`${cls.btn} ${cls.primary}`} onClick={confirmPaid}>Xác nhận đã thu</button></>}
      >
        {paying && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Ngày thu"><input type="date" className={`${cls.inputSm} w-full`} value={paying.paid_at} onChange={e => setPaying({ ...paying, paid_at: e.target.value })} /></Field>
            <Field label="Số tiền đã thu (VNĐ)" hint="Mặc định = tổng thông báo"><MoneyInput value={paying.paid_amount} onChange={v => setPaying({ ...paying, paid_amount: v })} /></Field>
            <Field label="Ghi chú" className="sm:col-span-2"><TextInput className="w-full" value={paying.note} onChange={v => setPaying({ ...paying, note: v })} placeholder="VD: chuyển khoản VCB" /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
