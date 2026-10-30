// ============================================================================
// Chạy việc nhắc tự động CSKH (chuẩn bị quà, kết nối lại) — dùng chung cho:
//   • App: mỗi ngày 1 lần khi mở app ở BẤT KỲ trang nào (trước đây chỉ chạy khi có
//     người mở trang CSKH → vài ngày không ai mở là lỡ nhắc sinh nhật);
//   • trang CSKH / Mạng lưới Sale: 1 lần mỗi phiên với dữ liệu đã tải sẵn (như trước).
// Hai nơi có thể chạy gần như cùng lúc (mở app rồi vào ngay CSKH) → dùng chung 1 lượt
// đang chạy, không để 2 lượt cùng kiểm "đã có việc chưa" rồi cùng tạo → trùng việc.
// Mỗi khu vực (khách / Sale) chạy riêng: dữ liệu riêng, dấu "đã chạy hôm nay" riêng.
// ============================================================================
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { SPACE_INFO, type CskhSpace } from '../../lib/cskh/space';
import { loadCskhData, runCareAutomation, type AutomationResult, type CskhData, type WriteCtx } from './data/api';

/** "<khu vực>:<tài khoản>" đã chạy trong phiên này (tải lại trang = phiên mới). */
const ranFor = new Set<string>();
const inflight = new Map<CskhSpace, Promise<AutomationResult | null>>();

// Khoá cũ của khách giữ nguyên để không chạy lại lần 2 trong ngày sau khi cập nhật
const dayKey = (userId: string, space: CskhSpace) => (space === 'client' ? `lgvn_cskh_automation_${userId}` : `lgvn_sale_automation_${userId}`);

function ranToday(userId: string, space: CskhSpace, today: string): boolean {
  try { return localStorage.getItem(dayKey(userId, space)) === today; } catch { return false; }
}

/**
 * Chạy việc nhắc nếu tài khoản này chưa chạy trong phiên.
 * `daily` = bỏ qua nếu trình duyệt này đã chạy hôm nay (dùng khi mở app — đỡ tải lại
 * dữ liệu CSKH mỗi lần F5); `data` = dữ liệu đã tải sẵn (trang CSKH), không có thì tự tải.
 * Trả về null khi không chạy (đã chạy / DB chưa chạy migration).
 */
export function runCareAutomationOnce(opts: {
  ctx: WriteCtx;
  today: string;
  data?: CskhData;
  daily?: boolean;
  /** Khu vực — mặc định theo `data`, không có thì khách hàng. */
  space?: CskhSpace;
}): Promise<AutomationResult | null> {
  const user = opts.ctx.user;
  const space = opts.space ?? opts.data?.space ?? 'client';
  if (!user) return Promise.resolve(null);
  // Lượt đang chạy thuộc về nơi gọi trước — nơi gọi sau chỉ chờ xong, không báo lại lần 2
  const running = inflight.get(space);
  if (running) return running.then(() => null);
  const key = `${space}:${user.id}`;
  if (ranFor.has(key) || (opts.daily && ranToday(user.id, space, opts.today))) return Promise.resolve(null);

  const job = (async () => {
    const data = opts.data ?? await loadCskhData(space);
    if (!data.migrationReady || (space === 'sale' && !data.saleReady)) return null;
    ranFor.add(key);
    const result = await runCareAutomation(data, opts.ctx, opts.today);
    try { localStorage.setItem(dayKey(user.id, space), opts.today); } catch { /* chế độ riêng tư — bỏ qua */ }
    if (result.gift || result.reconnect) emitCskhDataChanged();
    return result;
  })().finally(() => { inflight.delete(space); });
  inflight.set(space, job);
  return job;
}

/** Câu thông báo sau khi chạy; null = không tạo việc nào. */
export function automationMessage(r: AutomationResult | null, space: CskhSpace = 'client'): string | null {
  if (!r) return null;
  const total = r.gift + r.reconnect;
  if (!total) return null;
  return space === 'sale'
    ? `${SPACE_INFO.sale.title}: đã tạo ${total} việc nhắc chuẩn bị quà trong Workspace`
    : `Đã tạo ${total} việc nhắc trong Workspace (${r.gift} chuẩn bị quà, ${r.reconnect} kết nối lại)`;
}
