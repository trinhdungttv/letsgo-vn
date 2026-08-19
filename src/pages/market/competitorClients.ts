import { supabase } from '../../lib/supabase';
import type { CompetitorClient } from '../../lib/types';

/**
 * Dùng chung cho danh sách "KH đang phục vụ" của đối thủ — bảng `competitor_clients`,
 * hiển thị ở 2 nơi: hồ sơ Đối thủ (CompetitorDetail) và hồ sơ KCN (ZoneCompetitors).
 *
 * Vì sao phải dò cột: PostgREST chỉ cần MỘT cột lạ trong câu lệnh là hỏng CẢ câu
 * (lỗi 42703), nên database chưa chạy migration sẽ làm hỏng luôn thao tác chính chứ
 * không phải chỉ mất cột mới. Đúng lỗi này đã khiến migration 104 (sale_phone) không
 * chạy suốt từ 23/07 mà không ai biết: form "KH đang phục vụ" im lặng không thêm được.
 * Dò 1 lần mỗi phiên rồi tự loại cột chưa có ra khỏi payload.
 */
const OPTIONAL_COLUMNS = ['sale_phone', 'updated_at', 'workers_updated_at'] as const;

let probe: Promise<Set<string>> | null = null;

export function competitorClientColumns(): Promise<Set<string>> {
  if (!probe) {
    probe = (async () => {
      const found = new Set<string>();
      await Promise.all(OPTIONAL_COLUMNS.map(async col => {
        const { error } = await supabase.from('competitor_clients').select(col).limit(1);
        if (!error) found.add(col);
      }));
      return found;
    })();
  }
  return probe;
}

/** Các cột database CHƯA có — dùng để nhắc chạy migration thay vì hỏng im lặng. */
export async function missingCompetitorClientColumns(): Promise<string[]> {
  const cols = await competitorClientColumns();
  return OPTIONAL_COLUMNS.filter(c => !cols.has(c));
}

/** Bỏ khỏi payload những cột database chưa có, giữ nguyên phần còn lại. */
async function prune(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cols = await competitorClientColumns();
  return Object.fromEntries(
    Object.entries(payload).filter(([k]) => !(OPTIONAL_COLUMNS as readonly string[]).includes(k) || cols.has(k)),
  );
}

export interface CompetitorClientInput {
  client_name: string;
  kcn: string | null;
  worker_count: number;
  sale_name?: string | null;
  sale_phone?: string | null;
  sale_fee?: number | null;
  /** Mốc chốt số LĐ — cho sửa tay để nhập được số liệu của kỳ trước. */
  workers_updated_at?: string | null;
}

export async function insertCompetitorClient(competitorId: string, input: CompetitorClientInput) {
  const now = new Date().toISOString();
  const payload = await prune({
    competitor_id: competitorId,
    client_name: input.client_name,
    kcn: input.kcn,
    worker_count: input.worker_count,
    sale_name: input.sale_name ?? null,
    sale_phone: input.sale_phone ?? null,
    sale_fee: input.sale_fee ?? null,
    workers_updated_at: input.workers_updated_at ?? now,
    updated_at: now,
  });
  return supabase.from('competitor_clients').insert(payload).select().single();
}

/**
 * Sửa 1 dòng. `workers_updated_at` chỉ tự nhảy về hiện tại khi số LĐ THỰC SỰ đổi —
 * sửa tên sale hay phí không được làm số liệu LĐ trông như vừa mới khảo sát lại.
 * Truyền input.workers_updated_at để ghi đè bằng ngày do người dùng tự chọn.
 */
export async function updateCompetitorClient(row: CompetitorClient, input: CompetitorClientInput) {
  const now = new Date().toISOString();
  const workersChanged = (row.worker_count ?? 0) !== input.worker_count;
  const payload = await prune({
    client_name: input.client_name,
    kcn: input.kcn,
    worker_count: input.worker_count,
    sale_name: input.sale_name ?? null,
    sale_phone: input.sale_phone ?? null,
    sale_fee: input.sale_fee ?? null,
    workers_updated_at: input.workers_updated_at
      ?? (workersChanged ? now : row.workers_updated_at ?? row.created_at ?? now),
    updated_at: now,
  });
  return supabase.from('competitor_clients').update(payload).eq('id', row.id).select().single();
}

/** Nhãn rê chuột cho ô số LĐ: cho biết con số đang xem chốt từ bao giờ. */
export function workersTooltip(row: CompetitorClient): string {
  const stamp = row.workers_updated_at || row.created_at;
  if (!stamp) return 'Chưa rõ thời điểm cập nhật số lao động';
  const d = new Date(stamp);
  const when = d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const age = days <= 0 ? 'hôm nay' : days === 1 ? '1 ngày trước' : `${days} ngày trước`;
  return `Số LĐ cập nhật: ${when} (${age})`;
}

/** Ngày (yyyy-mm-dd) để đổ vào <input type="date"> khi sửa mốc cập nhật. */
export function workersDateInput(row: CompetitorClient): string {
  const stamp = row.workers_updated_at || row.created_at;
  return stamp ? new Date(stamp).toISOString().slice(0, 10) : '';
}

/** Ngày người dùng chọn (yyyy-mm-dd) → ISO; giữ giờ hiện tại cho ngày hôm nay. */
export function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const today = new Date().toISOString().slice(0, 10);
  return value === today ? new Date().toISOString() : new Date(`${value}T12:00:00`).toISOString();
}
