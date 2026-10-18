// Engine sự kiện & thông báo — thuần TS. Gom mọi việc cần chú ý thành 1 danh sách có mức độ + ngày:
// HĐ khách sắp hết (3 / 2 / 1 tháng), mặt bằng sắp tăng giá, trả mặt bằng, hoá đơn quá hạn / sắp đến hạn,
// tháng trước chưa nhập doanh thu / chưa lập thông báo, chốt điện, khoản chi dự kiến, phòng trống, sự cố…
import type { CalcData, MonthKey } from './calc/types';
import { addMonths, monthLabel, toMonthKey } from './calc/months';
import { fmtTr, fmtVND } from './calc/money';
import { leaseCostVND, tenantMonth } from './calc/pl';
import { CONTRACT_TIERS, daysBetween, effectiveRoomStatus, fmtDate, invoiceBreakdown, invoiceState, ticketCode } from './ops';
import type { BdsAsset, BdsForecast, BdsHeadLease, BdsInvoice, BdsMeterReading, BdsOpexMonthly, BdsRoom, BdsTenant, BdsTicket } from './types';

export type EventKind =
  | 'contract_end' | 'contract_start' | 'lease_increase' | 'lease_end'
  | 'invoice_overdue' | 'invoice_due' | 'missing_invoice' | 'missing_revenue' | 'missing_opex' | 'meter_due'
  | 'forecast_expense' | 'room_vacant' | 'unassigned_tenant' | 'ticket' | 'asset';

export type Severity = 'critical' | 'warning' | 'info';

export interface OfficeEvent {
  /** Khoá ổn định để ghi nhớ "đã xử lý / nhắc lại sau". Có kèm ngày → đổi ngày thì nhắc lại. */
  key: string;
  kind: EventKind;
  severity: Severity;
  /** Ngày diễn ra 'YYYY-MM-DD' (null với cảnh báo trạng thái như phòng trống) */
  date: string | null;
  daysLeft: number | null;
  title: string;
  detail?: string;
  /** Ảnh hưởng tiền / tháng (VNĐ): dương = chi phí tăng, âm = doanh thu có nguy cơ mất */
  amount?: number;
  /** Link trong app */
  href: string;
}

export interface EventInput {
  data: CalcData;
  leases: BdsHeadLease[];
  tenants: BdsTenant[];
  rooms: BdsRoom[];
  invoices: BdsInvoice[];
  readings: BdsMeterReading[];
  opexRows: BdsOpexMonthly[];
  tickets: BdsTicket[];
  assets: BdsAsset[];
  forecasts: BdsForecast[];
  today: string;
  /** Nhắc trước tối đa (ngày) — mặc định 90 (3 tháng) */
  horizonDays: number;
  opsReady: boolean;
}

const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const KIND_LABEL: Record<EventKind, string> = {
  contract_end: 'Hợp đồng', contract_start: 'Khách mới', lease_increase: 'Tăng giá thuê', lease_end: 'Trả mặt bằng',
  invoice_overdue: 'Công nợ', invoice_due: 'Đến hạn thu', missing_invoice: 'Thông báo TT', missing_revenue: 'Nhập liệu',
  missing_opex: 'Nhập liệu', meter_due: 'Chốt điện', forecast_expense: 'Chi dự kiến', room_vacant: 'Phòng trống',
  unassigned_tenant: 'Nhập liệu', ticket: 'Sự cố', asset: 'Tài sản',
};

/** Tiền thuê gần nhất của khách (gross VNĐ / tháng) tính tới tháng `upTo`. */
export function latestMonthlyRevenue(data: CalcData, tenantId: string, upTo: MonthKey): { amount: number; month: MonthKey | null } {
  const t = data.tenants.find(x => x.id === tenantId);
  if (!t) return { amount: 0, month: null };
  const monthsWithRent = Object.keys(data.rent).filter(m => m <= upTo && (data.rent[m]?.[tenantId] || 0) > 0).sort();
  const m = monthsWithRent[monthsWithRent.length - 1];
  return m ? { amount: tenantMonth(data, m, t).total, month: m } : { amount: 0, month: null };
}

function tenantCoversMonth(t: BdsTenant, m: MonthKey): boolean {
  if (t.contract_start && toMonthKey(t.contract_start) > m) return false;
  if (t.contract_end && toMonthKey(t.contract_end) < m) return false;
  return true;
}

function sevByDays(days: number, tiers: { critical?: number; warning: number }): Severity {
  if (tiers.critical !== undefined && days <= tiers.critical) return 'critical';
  if (days <= tiers.warning) return 'warning';
  return 'info';
}

export function buildEvents(input: EventInput): OfficeEvent[] {
  const { data, today } = input;
  const horizon = Math.max(input.horizonDays || 90, CONTRACT_TIERS.soon);
  const out: OfficeEvent[] = [];
  const curMonth = today.slice(0, 7);
  const prevMonth = addMonths(curMonth, -1);
  const roomOf = new Map(input.rooms.map(r => [r.id, r]));
  const leaseOf = new Map(input.leases.map(l => [l.id, l]));
  const ctOf = new Map(data.tenants.map(t => [t.id, t]));
  const active = input.tenants.filter(t => t.active);

  // ── Hợp đồng khách thuê (đầu ra) ──────────────────────────────────────
  if (input.opsReady) {
    for (const t of active) {
      if (t.contract_end) {
        const days = daysBetween(today, t.contract_end);
        if (days <= horizon) {
          const rev = latestMonthlyRevenue(data, t.id, curMonth).amount;
          const room = t.room_id ? roomOf.get(t.room_id) : undefined;
          const parts = [
            room ? `Phòng ${room.code}` : null,
            rev ? `doanh thu ~${fmtTr(rev)} tr/tháng` : null,
            t.deposit_amount ? `cọc ${t.deposit_currency === 'USD' ? '$' + Number(t.deposit_amount).toLocaleString('en-US') : fmtVND(t.deposit_amount)} cần hoàn/khấu trừ` : null,
          ].filter(Boolean);
          out.push({
            key: `contract_end:${t.id}:${t.contract_end}`,
            kind: 'contract_end',
            severity: days < 0 ? 'critical' : sevByDays(days, { critical: CONTRACT_TIERS.urgent, warning: CONTRACT_TIERS.soon }),
            date: t.contract_end, daysLeft: days,
            title: days < 0
              ? `HĐ ${t.name} đã hết hạn ${-days} ngày — cần gia hạn hoặc thanh lý`
              : `HĐ ${t.name} hết hạn sau ${days} ngày (${fmtDate(t.contract_end)})`,
            detail: [...parts, days >= 0 ? 'Liên hệ khách để chốt gia hạn sớm' : null].filter(Boolean).join(' · '),
            amount: rev ? -rev : undefined,
            href: '#/office-rooms/hop-dong',
          });
        }
      }
      if (t.contract_start) {
        const days = daysBetween(today, t.contract_start);
        if (days >= 0 && days <= 30) {
          out.push({
            key: `contract_start:${t.id}:${t.contract_start}`, kind: 'contract_start', severity: 'info',
            date: t.contract_start, daysLeft: days,
            title: `${t.name} bắt đầu thuê từ ${fmtDate(t.contract_start)}`,
            detail: 'Chuẩn bị bàn giao phòng, chốt chỉ số điện đầu kỳ', href: '#/office-rooms/hop-dong',
          });
        }
      }
    }
  }

  // ── Mặt bằng đầu vào: mốc tăng giá + trả mặt bằng ────────────────────
  for (const l of data.headLeases) {
    for (const inc of l.increases) {
      const date = `${inc.month}-01`;
      const days = daysBetween(today, date);
      if (days < -30 || days > horizon) continue;
      const delta = leaseCostVND(l, inc.month, data.settings) - leaseCostVND(l, addMonths(inc.month, -1), data.settings);
      out.push({
        key: `lease_increase:${l.id}:${inc.month}`, kind: 'lease_increase',
        severity: days >= 0 && days <= CONTRACT_TIERS.urgent ? 'warning' : 'info',
        date, daysLeft: days,
        title: days >= 0
          ? `${l.name} tăng ${inc.percent}% từ ${fmtDate(date)} (còn ${days} ngày)`
          : `${l.name} đã tăng ${inc.percent}% từ ${fmtDate(date)}`,
        detail: `Chi phí thuê ${delta >= 0 ? '+' : ''}${fmtVND(delta)}/tháng → ${fmtVND(leaseCostVND(l, inc.month, data.settings))}/tháng. Cân nhắc điều chỉnh giá cho thuê lại.`,
        amount: delta,
        href: '#/office-pl/chi-phi-thue',
      });
    }
    const lease = leaseOf.get(l.id);
    if (lease?.end_month) {
      const days = daysBetween(today, lease.end_month);
      if (days >= -30 && days <= horizon) {
        out.push({
          key: `lease_end:${l.id}:${lease.end_month}`, kind: 'lease_end',
          severity: days >= 0 && days <= CONTRACT_TIERS.soon ? 'warning' : 'info',
          date: lease.end_month, daysLeft: days,
          title: `Trả mặt bằng ${l.name} từ ${fmtDate(lease.end_month)}`,
          detail: 'Kiểm tra khách đang thuê trong mặt bằng này, biên bản bàn giao, tiền cọc với chủ nhà',
          href: '#/office-pl/chi-phi-thue',
        });
      }
    }
  }

  // ── Thu tiền ──────────────────────────────────────────────────────────
  if (input.opsReady) {
    for (const inv of input.invoices) {
      const st = invoiceState(inv, today);
      const ct = ctOf.get(inv.tenant_id);
      if (!ct || st.state === 'paid' || st.state === 'none') continue;
      const total = invoiceBreakdown(data, toMonthKey(inv.month), ct).total;
      const label = monthLabel(toMonthKey(inv.month));
      if (st.state === 'overdue') {
        out.push({
          key: `invoice_overdue:${inv.id}`, kind: 'invoice_overdue', severity: 'critical',
          date: inv.due_date, daysLeft: inv.due_date ? daysBetween(today, inv.due_date) : null,
          title: `${ct.name} quá hạn thanh toán ${st.overdueDays} ngày (${label})`,
          detail: `Còn phải thu ${fmtVND(total)}`, amount: -total, href: '#/office-billing/hoa-don',
        });
      } else if (inv.due_date) {
        const days = daysBetween(today, inv.due_date);
        if (days <= 7) {
          out.push({
            key: `invoice_due:${inv.id}:${inv.due_date}`, kind: 'invoice_due', severity: 'info',
            date: inv.due_date, daysLeft: days,
            title: `${ct.name} đến hạn thanh toán ${label} ${days === 0 ? 'hôm nay' : `sau ${days} ngày`}`,
            detail: `Số tiền ${fmtVND(total)}`, href: '#/office-billing/hoa-don',
          });
        }
      }
    }

    // Tháng trước có doanh thu nhưng chưa lập thông báo thanh toán
    const prevInvoiced = new Set(input.invoices.filter(i => toMonthKey(i.month) === prevMonth).map(i => i.tenant_id));
    // Chỉ nhắc khi anh đã dùng tính năng lập thông báo (có ít nhất 1 thông báo từ tháng trước trở về trước)
    const usesInvoices = input.invoices.some(i => toMonthKey(i.month) <= prevMonth);
    const notInvoiced = data.tenants.filter(t => !prevInvoiced.has(t.id) && tenantMonth(data, prevMonth, t).total > 0);
    if (usesInvoices && notInvoiced.length) {
      out.push({
        key: `missing_invoice:${prevMonth}`, kind: 'missing_invoice', severity: 'warning',
        date: null, daysLeft: null,
        title: `Chưa lập thông báo thanh toán ${monthLabel(prevMonth)} cho ${notInvoiced.length} khách`,
        detail: notInvoiced.map(t => t.name).join(', '), href: '#/office-billing/hoa-don',
      });
    }

    // Đến kỳ chốt chỉ số điện (chỉ nhắc khi anh đã dùng tính năng này)
    if (input.readings.length && Number(today.slice(8, 10)) >= 25) {
      const done = new Set(input.readings.filter(r => toMonthKey(r.month) === curMonth).map(r => r.tenant_id));
      const missing = active.filter(t => !done.has(t.id));
      if (missing.length) {
        out.push({
          key: `meter_due:${curMonth}`, kind: 'meter_due', severity: 'info', date: null, daysLeft: null,
          title: `Đến kỳ chốt chỉ số điện ${monthLabel(curMonth)} (${missing.length} khách chưa có)`,
          detail: missing.map(t => t.name).join(', '), href: '#/office-billing/chi-so-dien',
        });
      }
    }
  }

  // ── Nhập liệu: tháng trước chưa có doanh thu / chi phí vận hành ───────
  const noRent = active.filter(t => tenantCoversMonth(t, prevMonth) && !(data.rent[prevMonth]?.[t.id] > 0));
  if (noRent.length) {
    out.push({
      key: `missing_revenue:${prevMonth}`, kind: 'missing_revenue', severity: 'warning', date: null, daysLeft: null,
      title: `${monthLabel(prevMonth)} chưa nhập tiền thuê của ${noRent.length} khách`,
      detail: noRent.map(t => t.name).join(', '), href: '#/office-pl/doanh-thu',
    });
  }
  if (input.opexRows.length && !input.opexRows.some(o => toMonthKey(o.month) === prevMonth)) {
    out.push({
      key: `missing_opex:${prevMonth}`, kind: 'missing_opex', severity: 'info', date: null, daysLeft: null,
      title: `${monthLabel(prevMonth)} chưa nhập chi phí vận hành`, href: '#/office-pl/van-hanh',
    });
  }
  const unassigned = active.filter(t => !t.head_lease_id);
  if (unassigned.length) {
    out.push({
      key: `unassigned_tenant:${unassigned.map(t => t.id).sort().join(',')}`, kind: 'unassigned_tenant', severity: 'warning',
      date: null, daysLeft: null,
      title: `${unassigned.length} khách chưa gán mặt bằng — lời/lỗ theo mặt bằng chưa chính xác`,
      detail: unassigned.map(t => t.name).join(', '), href: '#/office-pl/doanh-thu',
    });
  }

  // ── Khoản chi dự kiến trong 2 tháng tới ───────────────────────────────
  for (const f of input.forecasts) {
    const m = toMonthKey(f.month);
    if (m < curMonth || m > addMonths(curMonth, 2)) continue;
    const date = `${m}-01`;
    out.push({
      key: `forecast_expense:${f.id}:${m}`, kind: 'forecast_expense', severity: 'info',
      date, daysLeft: Math.max(0, daysBetween(today, date)),
      title: `Khoản chi dự kiến ${monthLabel(m)}: ${f.name}`,
      detail: [fmtVND(f.amount), f.note].filter(Boolean).join(' · '), amount: Number(f.amount) || 0,
      href: '#/office-pl/du-doan',
    });
  }

  // ── Phòng trống, sự cố, tài sản ───────────────────────────────────────
  if (input.opsReady) {
    for (const r of input.rooms) {
      if (effectiveRoomStatus(r, input.tenants) !== 'vacant') continue;
      const price = Number(r.list_price) || 0;
      const vnd = r.list_currency === 'USD' ? price * data.settings.exchangeRate : price;
      out.push({
        key: `room_vacant:${r.id}`, kind: 'room_vacant', severity: 'warning', date: null, daysLeft: null,
        title: `Phòng ${r.code}${r.name ? ` (${r.name})` : ''} đang trống`,
        detail: vnd > 0 ? `Bỏ phí ~${fmtVND(vnd)}/tháng theo giá chào` : 'Chưa có giá chào — nhập để biết mức thất thu',
        amount: vnd ? -vnd : undefined, href: '#/office-rooms/phong',
      });
    }
    for (const tk of input.tickets) {
      if (tk.status !== 'open' && tk.status !== 'in_progress') continue;
      const age = daysBetween(tk.reported_at.slice(0, 10), today);
      const sev: Severity = tk.priority === 'urgent' ? 'critical' : tk.priority === 'high' || age > 7 ? 'warning' : 'info';
      const room = tk.room_id ? roomOf.get(tk.room_id) : undefined;
      out.push({
        key: `ticket:${tk.id}`, kind: 'ticket', severity: sev, date: tk.reported_at.slice(0, 10), daysLeft: -age,
        title: `Sự cố #${ticketCode(tk.ticket_no)}: ${tk.title}`,
        detail: [`mở ${age} ngày`, `bước ${Math.min(tk.step_done + 1, 5)}/5`, room ? `phòng ${room.code}` : null].filter(Boolean).join(' · '),
        href: '#/office-tickets',
      });
    }
    for (const a of input.assets) {
      if (a.status !== 'broken' && a.status !== 'maintenance') continue;
      out.push({
        key: `asset:${a.id}:${a.status}`, kind: 'asset', severity: a.status === 'broken' ? 'warning' : 'info',
        date: null, daysLeft: null,
        title: `${a.name}${a.code ? ` (${a.code})` : ''} ${a.status === 'broken' ? 'đang hỏng' : 'cần bảo trì'}`,
        detail: a.room_id && roomOf.get(a.room_id) ? `Phòng ${roomOf.get(a.room_id)!.code}` : a.location || undefined,
        href: '#/office-assets',
      });
    }
  }

  return out.sort((a, b) =>
    SEV_RANK[a.severity] - SEV_RANK[b.severity]
    || (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999)
    || a.title.localeCompare(b.title, 'vi'));
}

// ── Trạng thái "đã xử lý / nhắc lại sau" ─────────────────────────────────

export interface NotificationState {
  event_key: string;
  status: 'dismissed' | 'snoozed';
  snooze_until: string | null;
}

export function isHidden(state: NotificationState | undefined, today: string): boolean {
  if (!state) return false;
  if (state.status === 'dismissed') return true;
  return !!state.snooze_until && state.snooze_until > today;
}

export function visibleEvents(events: OfficeEvent[], states: NotificationState[], today: string): OfficeEvent[] {
  const byKey = new Map(states.map(s => [s.event_key, s]));
  return events.filter(e => !isHidden(byKey.get(e.key), today));
}

/** Sự kiện có ngày, nhóm theo tháng — dùng cho lịch / dòng thời gian. */
export function groupByMonth(events: OfficeEvent[]): { month: MonthKey; events: OfficeEvent[] }[] {
  const map = new Map<MonthKey, OfficeEvent[]>();
  for (const e of events) {
    if (!e.date) continue;
    const m = e.date.slice(0, 7);
    map.set(m, [...(map.get(m) || []), e]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, evs]) => ({
    month, events: evs.sort((a, b) => (a.date || '').localeCompare(b.date || '')),
  }));
}
