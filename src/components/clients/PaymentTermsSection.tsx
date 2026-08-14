import { useState } from 'react';
import { FileText, Save, Info, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { calcExpectedDue, getDueStatusConfig } from '../../lib/paymentDate';
import type { Client } from '../../lib/types';
import DayCell from '../DayCell';
import { resolveDay, anchorDay } from '../../utils/timelineDays';
import PaymentActualTermFields from './PaymentActualTermFields';

interface Props {
  client: Client;
  onUpdate: (c: Client) => void;
  toast: (msg: string) => void;
  embedded?: boolean;
}

const WEEKDAYS = [
  { value: 'monday', label: 'Thứ 2' },
  { value: 'tuesday', label: 'Thứ 3' },
  { value: 'wednesday', label: 'Thứ 4 (SIKA)' },
  { value: 'thursday', label: 'Thứ 5' },
  { value: 'friday', label: 'Thứ 6' },
];

export default function PaymentTermsSection({ client, onUpdate, toast, embedded }: Props) {
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  // Moc xuat HD co the duoc nhap o o "bat dau" hoac o "ket thuc" ben Tai chinh.
  const invoiceSlot: 'invoice_day' | 'invoice_day_end' =
    client.invoice_day == null && client.invoice_day_end != null ? 'invoice_day_end' : 'invoice_day';
  const savedDay = anchorDay(client.invoice_day, client.invoice_day_end)
    ?? (client.invoice_date ? new Date(client.invoice_date).getDate() : null);

  const [invoiceDay, setInvoiceDay] = useState<number | null>(savedDay);

  // invoice_day co the la moc dong (-1 cuoi thang, -2 cuoi thang -1) => quy ra
  // ngay that cua thang hien tai truoc khi dung.
  const daysInCurMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const curInvoiceDay = resolveDay(invoiceDay, daysInCurMonth);
  const autoInvoiceDate = curInvoiceDay
    ? `${curYear}-${String(curMonth + 1).padStart(2, '0')}-${String(curInvoiceDay).padStart(2, '0')}`
    : '';

  const [form, setForm] = useState({
    payment_group:     client.payment_group     ?? 1,
    payment_days:      client.payment_days      ?? 15,
    payment_wday:      client.payment_wday      ?? false,
    payment_holiday:   client.payment_holiday   ?? 'before',
    payment_fixed_day: client.payment_fixed_day ?? 10,
    payment_cutoff:    client.payment_cutoff    ?? 5,
    payment_weekday:   client.payment_weekday   ?? '',
    payment_ca_from:   client.payment_ca_from   ?? 25,
    payment_ca_to:     client.payment_ca_to     ?? 30,
    payment_cb_from:   client.payment_cb_from   ?? 10,
    payment_cb_to:     client.payment_cb_to     ?? 15,
    invoice_date:      autoInvoiceDate,
    payment_actual_mode:      client.payment_actual_mode      ?? null,
    payment_actual_days:      client.payment_actual_days      ?? 15,
    payment_actual_fixed_day: client.payment_actual_fixed_day ?? 10,
    payment_actual_cutoff:    client.payment_actual_cutoff    ?? 5,
  });

  const invDate = form.invoice_date ? new Date(form.invoice_date) : null;
  const dueResult = invDate ? calcExpectedDue({ ...client, ...form }, invDate) : null;
  const statusConfig = dueResult ? getDueStatusConfig(dueResult.status, dueResult.daysRemaining) : null;
  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleInvoiceDayChange = (day: number | null) => {
    setInvoiceDay(day);
    const d = resolveDay(day, new Date(curYear, curMonth + 1, 0).getDate());
    if (d) {
      set('invoice_date', `${curYear}-${String(curMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    } else {
      set('invoice_date', '');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    // Ghi lai dung o dang giu gia tri de khong lam lech voi timeline Tai chinh.
    const updates = { ...form, [invoiceSlot]: invoiceDay, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
    setSaving(false);
    if (error) { toast('Loi: ' + error.message); return; }
    onUpdate({ ...client, ...updates });
    toast('Da luu dieu khoan thanh toan!');
  };

  const groupLabels: Record<number, string> = {
    1: 'Sau N ngày kể từ xuất HĐ',
    2: 'Ngày cố định hàng tháng / hàng tuần',
    3: 'Chu kỳ nửa tháng (Longwell)',
  };

  return (
    <div className={embedded ? '' : 'bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden'}>
      <div className={`px-4 py-3 ${embedded ? '' : 'border-b border-[#E8E7E2]'} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-[#1D4ED8]" />
          <span className="text-[12px] font-semibold text-[#111]">Dieu khoan thanh toan</span>
        </div>
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-50 transition">
          <Save size={11} />{saving ? '...' : 'Luu'}
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <div className="text-[11px] text-[#888] font-medium mb-2">LOẠI ĐIỀU KHOẢN</div>
          <div className="flex gap-2 flex-wrap">
            {[1,2,3].map(g => (
              <button key={g} onClick={() => set('payment_group', g)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition ${form.payment_group===g ? 'bg-[#EEF2FF] text-[#1D4ED8] border-[#BFDBFE]' : 'bg-white text-[#888] border-[#E8E7E2] hover:border-[#ccc]'}`}>
                Nhóm {g}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-[#1D4ED8] mt-1.5 font-medium">{groupLabels[form.payment_group]}</div>
        </div>

        {form.payment_group === 1 && (
          <div className="bg-[#F9F9F7] rounded-lg p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[#888] block mb-1">Số ngày sau xuất HĐ</label>
                <input type="number" min={1} max={90} value={form.payment_days} onChange={e => set('payment_days', +e.target.value)}
                  className="w-full text-[13px] font-semibold text-center px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              </div>
              <div>
                <label className="text-[11px] text-[#888] block mb-1">Loại ngày</label>
                <div className="flex gap-3 mt-1.5">
                  {[{val:false,label:'Ngày lịch'},{val:true,label:'Ngày làm việc'}].map(opt => (
                    <label key={String(opt.val)} className="flex items-center gap-1.5 cursor-pointer text-[12px] text-[#555]">
                      <input type="radio" checked={form.payment_wday===opt.val} onChange={() => set('payment_wday', opt.val)} className="accent-[#1D4ED8]" />{opt.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-[#888] block mb-1.5">Nếu trùng lễ / cuối tuần</label>
              <div className="flex gap-3 flex-wrap">
                {[{val:'before',label:'Dời về trước'},{val:'after',label:'Dời sang sau'},{val:'manual',label:'Xác nhận thủ công'}].map(opt => (
                  <label key={opt.val} className="flex items-center gap-1.5 cursor-pointer text-[12px] text-[#555]">
                    <input type="radio" checked={form.payment_holiday===opt.val} onChange={() => set('payment_holiday', opt.val)} className="accent-[#1D4ED8]" />{opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {form.payment_group === 2 && (
          <div className="bg-[#F9F9F7] rounded-lg p-3 space-y-3">
            <div>
              <label className="text-[11px] text-[#888] block mb-1.5">Lịch thanh toán</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-[#555]">
                  <input type="radio" checked={!form.payment_weekday} onChange={() => set('payment_weekday', '')} className="accent-[#1D4ED8]" />Ngày cố định hàng tháng
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[12px] text-[#555]">
                  <input type="radio" checked={!!form.payment_weekday} onChange={() => set('payment_weekday', 'wednesday')} className="accent-[#1D4ED8]" />Thứ cố định hàng tuần
                </label>
              </div>
            </div>
            {!form.payment_weekday ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#888] block mb-1">Thanh toán vào ngày</label>
                  <input type="number" min={1} max={31} value={form.payment_fixed_day} onChange={e => set('payment_fixed_day', +e.target.value)}
                    className="w-full text-[13px] font-semibold text-center px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                  <div className="text-[10.5px] text-[#aaa] mt-0.5">hàng tháng</div>
                </div>
                <div>
                  <label className="text-[11px] text-[#888] block mb-1">Chốt hồ sơ trước ngày</label>
                  <input type="number" min={1} max={31} value={form.payment_cutoff} onChange={e => set('payment_cutoff', +e.target.value)}
                    className="w-full text-[13px] font-semibold text-center px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
                  <div className="text-[10.5px] text-[#aaa] mt-0.5">để vào chu kỳ tháng này</div>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-[11px] text-[#888] block mb-1">Thứ thanh toán hàng tuần</label>
                <div className="relative">
                  <select value={form.payment_weekday} onChange={e => set('payment_weekday', e.target.value)}
                    className="w-full appearance-none text-[12.5px] px-2.5 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]">
                    {WEEKDAYS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-2 text-[#aaa] pointer-events-none" />
                </div>
              </div>
            )}
          </div>
        )}

        {form.payment_group === 3 && (
          <div className="bg-[#F9F9F7] rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-[#888] min-w-[110px]">HĐ xuất ngày 01–15</span>
              <span className="text-[#aaa]">→</span>
              <span className="text-[#555]">Thu từ ngày</span>
              <input type="number" min={1} max={31} value={form.payment_ca_from} onChange={e => set('payment_ca_from', +e.target.value)}
                className="w-12 text-[12px] font-semibold text-center px-1.5 py-1 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <span className="text-[#555]">đến</span>
              <input type="number" min={1} max={31} value={form.payment_ca_to} onChange={e => set('payment_ca_to', +e.target.value)}
                className="w-12 text-[12px] font-semibold text-center px-1.5 py-1 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <span className="text-[#888] text-[11px]">cùng tháng</span>
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-[#888] min-w-[110px]">HĐ xuất ngày 16–31</span>
              <span className="text-[#aaa]">→</span>
              <span className="text-[#555]">Thu từ ngày</span>
              <input type="number" min={1} max={31} value={form.payment_cb_from} onChange={e => set('payment_cb_from', +e.target.value)}
                className="w-12 text-[12px] font-semibold text-center px-1.5 py-1 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <span className="text-[#555]">đến</span>
              <input type="number" min={1} max={31} value={form.payment_cb_to} onChange={e => set('payment_cb_to', +e.target.value)}
                className="w-12 text-[12px] font-semibold text-center px-1.5 py-1 border border-[#E8E7E2] rounded-lg outline-none focus:border-[#1D4ED8]" />
              <span className="text-[#888] text-[11px]">tháng sau</span>
            </div>
          </div>
        )}

        <div>
          <label className="text-[11px] text-[#888] font-medium block mb-1.5">NGAY XUAT HOA DON HANG THANG</label>
          <div className="flex items-center gap-3">
            <div className="relative w-[150px]">
              <DayCell quick="both" value={invoiceDay} onChange={handleInvoiceDayChange} />
            </div>
            <div className="text-[12px] text-[#555]">
              {curInvoiceDay ? (
                <>hang thang · Thang nay: <span className="font-semibold text-[#111]">{form.invoice_date ? new Date(form.invoice_date + 'T00:00').toLocaleDateString('vi-VN') : '—'}</span></>
              ) : (
                <span className="text-[#aaa]">Nhap ngay co dinh xuat HD (VD: 5, 20, 25...)</span>
              )}
            </div>
          </div>
          <div className="text-[10.5px] text-[#aaa] mt-1">He thong tu tinh ngay xuat HD cho thang hien tai. Sang thang moi se tu cap nhat.</div>
        </div>

        <div>
          <div className="text-[11px] text-[#888] font-medium mb-2">KỲ TT THỰC TẾ (nếu khác Kỳ TT Trên HĐ ở trên)</div>
          <PaymentActualTermFields
            value={form}
            onChange={patch => setForm(f => ({ ...f, ...patch } as typeof f))}
            invoiceDate={invDate}
          />
        </div>

        {dueResult && statusConfig ? (
          <div className={`rounded-lg p-3 border flex items-center justify-between ${statusConfig.bg} ${statusConfig.border}`}>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[#888] mb-0.5">Dự kiến thu tiền</div>
              <div className={`text-[16px] font-semibold ${statusConfig.text}`}>{dueResult.label}</div>
              <div className="text-[10.5px] text-[#888] mt-0.5">{dueResult.note}</div>
            </div>
            <span className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-full border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
              {statusConfig.label}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 bg-[#F9F9F7] rounded-lg text-[12px] text-[#aaa]">
            <Info size={13} />Nhập ngày xuất HĐ để tính ngày thu dự kiến
          </div>
        )}
      </div>
    </div>
  );
}
