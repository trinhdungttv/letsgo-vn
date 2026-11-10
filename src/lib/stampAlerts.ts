// Nhật ký DÙNG CHỮ KÝ / CON DẤU (migration 219, bảng stamp_alerts khoá — chỉ đọc qua RPC token admin).
// Nhân viên lấy ảnh ký/dấu để làm giấy tờ → server ghi 1 dòng → app của admin hiện popup (StampAlertWatcher):
//   • ngay lập tức nhờ tín hiệu Supabase Realtime (kênh broadcast, KHÔNG chứa dữ liệu — chỉ báo "có dòng mới")
//   • và dự phòng: admin tự hỏi lại mỗi 20 giây / khi quay lại tab.
import { supabase } from './supabase';
import { STAMP_HINT } from './costPlan/api';

export interface StampAlert {
  id: number;
  created_at: string;
  actor_name: string;
  actor_role: string;
  entity_label: string;
  company_name: string;
  parts: ('signature' | 'seal')[];
  purpose: string;
  context: string;
  actions: string[];
  last_action_at: string | null;
  seen_at: string | null;
  seen_by: string | null;
}

export const STAMP_CHANNEL = 'lgvn-stamp-alerts';

export const PURPOSE_LABEL: Record<string, string> = {
  gate_list: 'Danh sách vào cổng',
  quote_pdf: 'Báo giá PDF',
  quote_excel: 'Báo giá theo file Excel mẫu',
};
export const ACTION_LABEL: Record<string, string> = { preview: 'Xem trước', pdf: 'Tải PDF', xlsx: 'Tải Excel', print: 'In' };
export const partsText = (p: readonly string[]) => [p.includes('signature') && 'chữ ký', p.includes('seal') && 'con dấu'].filter(Boolean).join(' + ');

export async function listStampAlerts(token: string, limit = 50): Promise<{ unseen: number; items: StampAlert[] }> {
  const { data, error } = await supabase.rpc('stamp_alert_list', { p_token: token, p_limit: limit });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function|schema cache/i.test(error.message)) throw new Error(STAMP_HINT);
    throw new Error(error.message);
  }
  const r = data as { unseen: number; items: StampAlert[] | null };
  return { unseen: Number(r.unseen) || 0, items: r.items ?? [] };
}

/** Đánh dấu đã xem; ids bỏ trống = tất cả. */
export async function markStampAlertsSeen(token: string, ids?: number[]): Promise<void> {
  const { error } = await supabase.rpc('stamp_alert_seen', { p_token: token, p_ids: ids?.length ? ids : null });
  if (error) throw new Error(error.message);
}

/** Báo các máy admin đang mở app "có dòng nhật ký mới" — chỉ là tín hiệu, lỗi thì thôi (admin vẫn tự hỏi lại mỗi 20 giây). */
export async function pingStampAlert(): Promise<void> {
  try {
    const ch = supabase.channel(STAMP_CHANNEL);
    await new Promise<void>(res => {
      const t = setTimeout(res, 4000);
      ch.subscribe(s => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(t); res(); } });
    });
    await ch.send({ type: 'broadcast', event: 'new', payload: {} });
    setTimeout(() => { void supabase.removeChannel(ch); }, 1500);
  } catch { /* bỏ qua */ }
}
