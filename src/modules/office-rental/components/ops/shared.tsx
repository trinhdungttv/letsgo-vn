/* eslint-disable react-refresh/only-export-components */
import type { RoomStatus } from '../../lib/types';
import { fmtDate, type ContractState, type InvoiceState } from '../../lib/ops';
import { Badge } from '../ui';

export function InvoiceStateBadge({ st, paidAt }: { st: { state: InvoiceState; overdueDays: number }; paidAt?: string | null }) {
  if (st.state === 'paid') return <Badge tone="green">Đã thu{paidAt ? ` ${fmtDate(paidAt)}` : ''}</Badge>;
  if (st.state === 'overdue') return <Badge tone="red">Quá hạn {st.overdueDays} ngày</Badge>;
  if (st.state === 'unpaid') return <Badge tone="amber">Chưa thu</Badge>;
  return <Badge>Chưa lập</Badge>;
}

export const ROOM_STATUS: Record<RoomStatus, { label: string; tone: 'green' | 'amber' | 'gray' | 'blue' }> = {
  occupied: { label: 'Đang thuê', tone: 'green' },
  reserved: { label: 'Giữ chỗ', tone: 'blue' },
  vacant: { label: 'Trống', tone: 'amber' },
};

export function RoomStatusBadge({ status }: { status: RoomStatus }) {
  const s = ROOM_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ContractBadge({ c }: { c: { state: ContractState; days: number | null } }) {
  switch (c.state) {
    case 'expired': return <Badge tone="red">Đã hết hạn {-(c.days || 0)} ngày</Badge>;
    case 'urgent': return <Badge tone="red">⚠ Còn {c.days} ngày</Badge>;
    case 'soon': return <Badge tone="amber">Còn {c.days} ngày</Badge>;
    case 'active': return <Badge tone="green">Hiệu lực{c.days !== null && c.days < 400 ? ` · còn ${Math.round(c.days / 30)} th` : ''}</Badge>;
    case 'ended': return <Badge>Đã ngừng thuê</Badge>;
    default: return <Badge>Chưa nhập HĐ</Badge>;
  }
}
