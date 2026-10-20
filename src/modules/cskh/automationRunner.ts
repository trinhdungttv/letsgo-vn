// ============================================================================
// Chạy việc nhắc tự động CSKH (chuẩn bị quà, kết nối lại) — dùng chung cho:
//   • App: mỗi ngày 1 lần khi mở app ở BẤT KỲ trang nào (trước đây chỉ chạy khi có
//     người mở trang CSKH → vài ngày không ai mở là lỡ nhắc sinh nhật);
//   • trang CSKH: 1 lần mỗi phiên với dữ liệu đã tải sẵn (như trước).
// Hai nơi có thể chạy gần như cùng lúc (mở app rồi vào ngay CSKH) → dùng chung 1 lượt
// đang chạy, không để 2 lượt cùng kiểm "đã có việc chưa" rồi cùng tạo → trùng việc.
// ============================================================================
import { emitCskhDataChanged } from '../../lib/cskh/events';
import { loadCskhData, runCareAutomation, type AutomationResult, type CskhData, type WriteCtx } from './data/api';

/** Tài khoản đã chạy trong phiên này (tải lại trang = phiên mới). */
const ranFor = new Set<string>();
let inflight: Promise<AutomationResult | null> | null = null;

const dayKey = (userId: string) => `lgvn_cskh_automation_${userId}`;

function ranToday(userId: string, today: string): boolean {
  try { return localStorage.getItem(dayKey(userId)) === today; } catch { return false; }
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
}): Promise<AutomationResult | null> {
  const user = opts.ctx.user;
  if (!user) return Promise.resolve(null);
  // Lượt đang chạy thuộc về nơi gọi trước — nơi gọi sau chỉ chờ xong, không báo lại lần 2
  if (inflight) return inflight.then(() => null);
  if (ranFor.has(user.id) || (opts.daily && ranToday(user.id, opts.today))) return Promise.resolve(null);

  inflight = (async () => {
    const data = opts.data ?? await loadCskhData();
    if (!data.migrationReady) return null;
    ranFor.add(user.id);
    const result = await runCareAutomation(data, opts.ctx, opts.today);
    try { localStorage.setItem(dayKey(user.id), opts.today); } catch { /* chế độ riêng tư — bỏ qua */ }
    if (result.gift || result.reconnect) emitCskhDataChanged();
    return result;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Câu thông báo sau khi chạy; null = không tạo việc nào. */
export function automationMessage(r: AutomationResult | null): string | null {
  if (!r) return null;
  const total = r.gift + r.reconnect;
  return total ? `Đã tạo ${total} việc nhắc trong Workspace (${r.gift} chuẩn bị quà, ${r.reconnect} kết nối lại)` : null;
}
