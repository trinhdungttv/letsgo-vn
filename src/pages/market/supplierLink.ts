import { supabase } from '../../lib/supabase';
import type { MarketLeadSupplier, CompetitorClient, Competitor } from '../../lib/types';
import { insertCompetitorClient, updateCompetitorClient } from './competitorClients';

/**
 * Nối "NCC đang cung ứng cho công ty X" giữa 2 nơi đang cùng mô tả MỘT sự việc:
 *
 *  A. `clients.market_suppliers` / `market_leads.suppliers` (JSON) — nhập ở thẻ công ty bên
 *     tab Công ty/Dự án. Giữ Let's Go VN + mức lương & chi tiết lương riêng của từng NCC
 *     tại dự án đó (dùng cho bảng "So sánh lương").
 *  B. `competitor_clients` (bảng) — nhập ở hồ sơ Đối thủ hoặc trong hồ sơ KCN. Giữ số LĐ,
 *     KCN và thông tin sale phụ trách.
 *
 * Trước đây 2 nơi không biết nhau: nhập 6 NCC cho "TTI - CỦ CHI" trong KCN thì thẻ công ty
 * vẫn hiện 0% fill. Nay:
 *  - ĐỌC : gộp lại, số LĐ ưu tiên lấy từ (B) vì đó là nơi nhập chi tiết theo từng nhà máy.
 *  - GHI : thêm/sửa/xoá NCC ở thẻ công ty ghi sang CẢ (B) khi tên NCC khớp một hồ sơ Đối thủ,
 *          nên hồ sơ Đối thủ và hồ sơ KCN thấy ngay, không phải nhập lại.
 */

/** So khớp tên công ty/nhà máy: bỏ dấu, bỏ ký tự phân cách ("TTI - CỦ CHI" ≡ "TTI CU CHI"). */
export const companyKey = (s?: string | null) => (s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const sameCompany = (a?: string | null, b?: string | null) => {
  const ka = companyKey(a);
  return !!ka && ka === companyKey(b);
};

export interface MergedSupplier extends MarketLeadSupplier {
  /** Vị trí trong mảng JSON gốc — null nghĩa là dòng này chỉ có ở competitor_clients. */
  jsonIndex: number | null;
  /** Các dòng competitor_clients đứng sau (thường 1; >1 là dữ liệu nhập trùng). */
  ccIds: string[];
  /** Hồ sơ đối thủ tương ứng, nếu tên NCC khớp một hồ sơ đã tạo. */
  competitorId: string | null;
}

/**
 * Gộp danh sách NCC của một công ty. Số LĐ ưu tiên competitor_clients; dòng chỉ có trong
 * JSON (NCC gõ tay, chưa có hồ sơ đối thủ) giữ nguyên như cũ.
 */
export function mergeSuppliers(
  jsonSuppliers: MarketLeadSupplier[],
  ccRows: CompetitorClient[],
  companyName: string,
  competitors: Competitor[],
): MergedSupplier[] {
  const compById = new Map(competitors.map(c => [c.id, c]));

  // Gom các dòng competitor_clients của đúng công ty này theo từng đối thủ.
  const byCompetitor = new Map<string, CompetitorClient[]>();
  for (const r of ccRows) {
    if (!sameCompany(r.client_name, companyName)) continue;
    if (!compById.has(r.competitor_id)) continue; // hồ sơ đối thủ đã bị xoá
    const arr = byCompetitor.get(r.competitor_id) ?? [];
    arr.push(r);
    byCompetitor.set(r.competitor_id, arr);
  }

  const merged: MergedSupplier[] = jsonSuppliers.map((s, i) => ({
    ...s, jsonIndex: i, ccIds: [], competitorId: null,
  }));

  for (const [competitorId, rows] of byCompetitor) {
    const comp = compById.get(competitorId)!;
    const qty = rows.reduce((sum, r) => sum + (r.worker_count ?? 0), 0);
    const existing = merged.find(m => !m.is_us && sameCompany(m.name, comp.company_name));
    if (existing) {
      existing.qty = qty;                       // competitor_clients là nơi nhập chi tiết → ưu tiên
      existing.ccIds = rows.map(r => r.id);
      existing.competitorId = competitorId;
    } else {
      merged.push({
        name: comp.company_name, qty, is_us: false,
        wage_min: comp.wage_paid ?? null, wage_max: comp.wage_paid ?? null,
        jsonIndex: null, ccIds: rows.map(r => r.id), competitorId,
      });
    }
  }

  // Đánh dấu hồ sơ đối thủ cho cả các dòng JSON khớp tên nhưng chưa có competitor_clients,
  // để sửa/xoá ở thẻ công ty biết đường tạo dòng bên hồ sơ đối thủ.
  for (const m of merged) {
    if (m.is_us || m.competitorId) continue;
    m.competitorId = competitors.find(c => sameCompany(c.company_name, m.name))?.id ?? null;
  }

  return merged;
}

/** Tải toàn bộ competitor_clients (dữ liệu nhỏ, lọc trong JS bằng sameCompany). */
export async function fetchSupplyRows(): Promise<CompetitorClient[]> {
  const { data, error } = await supabase.from('competitor_clients').select('*');
  if (error) throw error;
  return data ?? [];
}

/**
 * Ghi số LĐ sang competitor_clients khi thao tác từ thẻ công ty. Chỉ chạy khi tên NCC khớp
 * một hồ sơ Đối thủ — NCC gõ tay tự do vẫn chỉ nằm ở JSON như trước.
 * Nhiều dòng trùng (cùng đối thủ, cùng công ty) thì KHÔNG tự đoán chia số: giữ nguyên và
 * báo về để người dùng tự dọn trong hồ sơ đối thủ, tránh sửa nhầm mất dữ liệu.
 */
export async function writeSupplyQty(
  row: { competitorId: string | null; ccIds: string[] },
  companyName: string,
  kcn: string | null,
  qty: number,
  existingRows: CompetitorClient[],
): Promise<{ skipped?: 'multiple' | 'no-competitor' }> {
  if (!row.competitorId) return { skipped: 'no-competitor' };

  // Thêm NCC ở thẻ công ty cho đơn vị ĐÃ có dòng bên hồ sơ đối thủ (nhập từ hồ sơ KCN chẳng
  // hạn) — sửa dòng đó thay vì tạo dòng thứ hai, nếu không sẽ tự sinh ra dữ liệu trùng.
  const ccIds = row.ccIds.length ? row.ccIds : existingRows
    .filter(r => r.competitor_id === row.competitorId && sameCompany(r.client_name, companyName))
    .map(r => r.id);

  if (ccIds.length > 1) return { skipped: 'multiple' };

  if (ccIds.length === 1) {
    const target = existingRows.find(r => r.id === ccIds[0]);
    if (!target) return {};
    const { error } = await updateCompetitorClient(target, {
      client_name: target.client_name,
      kcn: target.kcn ?? kcn,
      worker_count: qty,
      sale_name: target.sale_name,
      sale_phone: target.sale_phone,
      sale_fee: target.sale_fee,
    });
    if (error) throw error;
    return {};
  }

  const { error } = await insertCompetitorClient(row.competitorId, {
    client_name: companyName, kcn, worker_count: qty,
  });
  if (error) throw error;
  return {};
}

export async function deleteSupplyRows(ccIds: string[]) {
  if (!ccIds.length) return;
  const { error } = await supabase.from('competitor_clients').delete().in('id', ccIds);
  if (error) throw error;
}
