export interface PaymentResult {
  type: 'exact' | 'range' | 'manual';
  date?: Date;
  dateFrom?: Date;
  dateTo?: Date;
  label: string;
  note: string;
  daysRemaining?: number;
  status: 'ok' | 'soon' | 'urgent' | 'overdue' | 'manual';
}

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

function addCalendarDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function addWorkingDays(d: Date, n: number): Date {
  const r = new Date(d); let added = 0;
  while (added < n) { r.setDate(r.getDate() + 1); if (!isWeekend(r)) added++; }
  return r;
}

function adjustHoliday(d: Date, shift: string): { date: Date; adjusted: boolean } {
  if (!isWeekend(d)) return { date: d, adjusted: false };
  if (shift === 'before') { const r = new Date(d); while (isWeekend(r)) r.setDate(r.getDate() - 1); return { date: r, adjusted: true }; }
  if (shift === 'after') { const r = new Date(d); while (isWeekend(r)) r.setDate(r.getDate() + 1); return { date: r, adjusted: true }; }
  return { date: d, adjusted: true };
}

function nextWeekday(from: Date, weekday: string): Date {
  const days: Record<string, number> = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  const target = days[weekday.toLowerCase()] ?? 3;
  const r = new Date(from); r.setDate(r.getDate() + 1);
  while (r.getDay() !== target) r.setDate(r.getDate() + 1);
  return r;
}

export function formatDateVN(d: Date): string {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function calcStatus(date: Date): PaymentResult['status'] {
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff <= 3) return 'urgent';
  if (diff <= 7) return 'soon';
  return 'ok';
}

function calcDaysRemaining(date: Date): number {
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

export function calcExpectedDue(client: {
  payment_group?: number | null; payment_days?: number | null; payment_wday?: boolean | null;
  payment_holiday?: string | null; payment_fixed_day?: number | null; payment_cutoff?: number | null;
  payment_weekday?: string | null; payment_ca_from?: number | null; payment_ca_to?: number | null;
  payment_cb_from?: number | null; payment_cb_to?: number | null; invoice_date?: string | null;
}, invoiceDate?: Date): PaymentResult | null {
  const invDate = invoiceDate ?? (client.invoice_date ? new Date(client.invoice_date) : null);
  if (!invDate) return null;
  const group = client.payment_group ?? 1;
  const holiday = client.payment_holiday ?? 'before';

  if (group === 1) {
    const days = client.payment_days ?? 15;
    const useWorkDay = client.payment_wday ?? false;
    let due = useWorkDay ? addWorkingDays(invDate, days) : addCalendarDays(invDate, days);
    const adj = adjustHoliday(due, holiday);
    let note = `Xuất HĐ ${formatDateVN(invDate)} + ${days} ngày ${useWorkDay ? 'làm việc' : 'lịch'}`;
    if (adj.adjusted && holiday !== 'manual') note += ` → dời ${holiday === 'before' ? 'về trước' : 'sang sau'} do cuối tuần`;
    if (holiday === 'manual' && adj.adjusted) return { type: 'manual', label: formatDateVN(adj.date), note: note + ' → cần xác nhận thủ công', status: 'manual' };
    due = adj.date;
    return { type: 'exact', date: due, label: formatDateVN(due), note, daysRemaining: calcDaysRemaining(due), status: calcStatus(due) };
  }

  if (group === 2) {
    if (client.payment_weekday) {
      const due = nextWeekday(invDate, client.payment_weekday);
      return { type: 'exact', date: due, label: formatDateVN(due), note: `${client.payment_weekday} đầu tiên sau ${formatDateVN(invDate)}`, daysRemaining: calcDaysRemaining(due), status: calcStatus(due) };
    }
    const fixedDay = client.payment_fixed_day ?? 10;
    const cutoff = client.payment_cutoff ?? fixedDay;
    const invDay = invDate.getDate();
    // Tháng đích rồi mới quy ra ngày thật: -1 = cuối tháng, và ngày 31 ở tháng
    // chỉ có 28/29/30 phải lùi về ngày cuối — nếu để new Date(y, m, 31) thì JS
    // tự nhảy sang tháng sau, ra sai kỳ thu tiền.
    const dueYear = invDate.getFullYear();
    const dueMonthIdx = invDay >= cutoff ? invDate.getMonth() + 1 : invDate.getMonth();
    const daysInDueMonth = new Date(dueYear, dueMonthIdx + 1, 0).getDate();
    const realDay = fixedDay === -1 ? daysInDueMonth : Math.min(Math.max(fixedDay, 1), daysInDueMonth);
    let due = new Date(dueYear, dueMonthIdx, realDay);
    const adj = adjustHoliday(due, holiday);
    if (adj.adjusted && holiday !== 'manual') due = adj.date;
    const dayLabel = fixedDay === -1 ? `cuối tháng (${realDay})` : realDay !== fixedDay ? `${realDay} (rút từ ${fixedDay} cho khớp số ngày của tháng)` : String(realDay);
    const note = invDay >= cutoff ? `HĐ ngày ${invDay} ≥ cutoff ${cutoff} → thu ngày ${dayLabel} tháng sau` : `HĐ ngày ${invDay} < cutoff ${cutoff} → thu ngày ${dayLabel} tháng này`;
    return { type: 'exact', date: due, label: formatDateVN(due), note, daysRemaining: calcDaysRemaining(due), status: calcStatus(due) };
  }

  if (group === 3) {
    const invDay = invDate.getDate();
    if (invDay <= 15) {
      const from = new Date(invDate.getFullYear(), invDate.getMonth(), client.payment_ca_from ?? 25);
      const label = `${client.payment_ca_from??25}–${client.payment_ca_to??30}/${String(invDate.getMonth()+1).padStart(2,'0')}/${invDate.getFullYear()}`;
      return { type: 'range', dateFrom: from, label, note: `HĐ ngày ${invDay} (01–15) → thu cuối tháng ${invDate.getMonth()+1}`, daysRemaining: calcDaysRemaining(from), status: calcStatus(from) };
    } else {
      const from = new Date(invDate.getFullYear(), invDate.getMonth()+1, client.payment_cb_from ?? 10);
      const label = `${client.payment_cb_from??10}–${client.payment_cb_to??15}/${String(invDate.getMonth()+2).padStart(2,'0')}/${invDate.getFullYear()}`;
      return { type: 'range', dateFrom: from, label, note: `HĐ ngày ${invDay} (16–31) → thu đầu tháng ${invDate.getMonth()+2}`, daysRemaining: calcDaysRemaining(from), status: calcStatus(from) };
    }
  }
  return null;
}

/**
 * Kỳ TT Thực Tế — chỉ 2 cách (thu hẹp so với 3 nhóm của Kỳ TT Trên HĐ):
 *   'days'  = số ngày kể từ ngày xuất HĐ (tái dùng nhánh group=1 của calcExpectedDue)
 *   'fixed' = ngày cố định trong tháng, có mốc chốt (tái dùng nhánh group=2 không theo thứ)
 * Trả về null khi payment_actual_mode chưa được cấu hình (client.payment_actual_mode == null) —
 * gọi getPaymentDue() để tự fallback về Kỳ TT Trên HĐ trong trường hợp đó.
 */
export function calcExpectedDueActual(client: {
  payment_actual_mode?: string | null; payment_actual_days?: number | null;
  payment_actual_fixed_day?: number | null; payment_actual_cutoff?: number | null;
  invoice_date?: string | null;
}, invoiceDate?: Date): PaymentResult | null {
  if (!client.payment_actual_mode) return null;
  return calcExpectedDue({
    payment_group: client.payment_actual_mode === 'fixed' ? 2 : 1,
    payment_days: client.payment_actual_days ?? 15,
    payment_fixed_day: client.payment_actual_fixed_day ?? 10,
    payment_cutoff: client.payment_actual_cutoff ?? 5,
    invoice_date: client.invoice_date,
  }, invoiceDate);
}

/** true khi kết quả trả về là Kỳ TT Thực Tế đã tự cấu hình riêng (không phải fallback từ HĐ). */
export function hasActualOverride(client: { payment_actual_mode?: string | null }): boolean {
  return !!client.payment_actual_mode;
}

/**
 * Điểm vào chung cho cả 2 nơi hiển thị (Timeline + Lịch Thu Tiền): 'contract' luôn dùng
 * Kỳ TT Trên HĐ; 'actual' dùng Kỳ TT Thực Tế nếu đã cấu hình, chưa cấu hình thì tự fallback
 * về Kỳ TT Trên HĐ (không để trống — khách chưa tuỳ chỉnh vẫn thấy số hợp lý).
 */
export function getPaymentDue(client: Parameters<typeof calcExpectedDue>[0] & Parameters<typeof calcExpectedDueActual>[0], invoiceDate: Date | undefined, mode: 'contract' | 'actual'): PaymentResult | null {
  if (mode === 'actual') {
    const actual = calcExpectedDueActual(client, invoiceDate);
    if (actual) return actual;
  }
  return calcExpectedDue(client, invoiceDate);
}

export function getDueStatusConfig(status: PaymentResult['status'], daysRemaining?: number) {
  switch (status) {
    case 'overdue': return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', label: `Quá hạn ${Math.abs(daysRemaining??0)} ngày`, dot: 'bg-red-500' };
    case 'urgent': return { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', label: daysRemaining===0?'Hôm nay':`Còn ${daysRemaining} ngày`, dot: 'bg-red-400' };
    case 'soon': return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: `Còn ${daysRemaining} ngày`, dot: 'bg-amber-400' };
    case 'manual': return { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200', label: 'Cần xác nhận', dot: 'bg-gray-400' };
    default: return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: `Còn ${daysRemaining} ngày`, dot: 'bg-emerald-400' };
  }
}
