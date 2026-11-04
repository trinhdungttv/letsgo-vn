// TẤT CẢ KCN của 1 công ty theo hồ sơ đã setup — dùng khi ghi "đối thủ đang phục vụ công ty X ở KCN nào".
// Công ty lớn có nhà máy ở nhiều KCN (VD Coherent: Nhơn Trạch + VSIP 3) → không được tự chọn KCN đầu tiên.
//
// Nguồn (giống quy tắc src/lib/pipelineZones.ts):
//   1. Khách hàng (clients.industrial_zones) — trang Khách hàng là chủ dữ liệu.
//   2. Công ty/Dự án đang tìm hiểu: các KCN chọn ở thẻ BD Pipeline (crm_pipeline.zone_ids, nối qua market_leads.crm_id)
//      + KCN chính cũ market_leads.region.
import { sameCompany } from './supplierLink';
import { sameZone } from '../../lib/zoneMatch';

export interface CompanyZoneSources {
  clients: readonly { name: string; industrial_zones?: readonly string[] | null }[];
  leads: readonly { company_name: string; region?: string | null; crm_id?: string | null }[];
  /** crm_pipeline.id → zone_ids */
  pipelineZoneIds: ReadonlyMap<string, readonly string[]>;
  /** danh mục Thị trường → Khu vực (market_zones) */
  zones: readonly { id: string; name: string }[];
}

function pushZone(out: string[], name: string | null | undefined) {
  const n = (name ?? '').trim();
  if (n && !out.some(x => sameZone(x, n) || x === n)) out.push(n);
}

/** Tên công ty khớp đúng chữ trước, không có mới so bỏ dấu / ký tự phân cách. */
function findByName<T>(list: readonly T[], name: string, key: (x: T) => string): T | undefined {
  return list.find(x => key(x) === name) ?? list.find(x => sameCompany(key(x), name));
}

export function companyZoneNames(companyName: string, src: CompanyZoneSources): string[] {
  const name = companyName.trim();
  if (!name) return [];
  const out: string[] = [];
  const cl = findByName(src.clients, name, c => c.name);
  for (const z of cl?.industrial_zones ?? []) pushZone(out, z);
  if (out.length) return out;
  const ld = findByName(src.leads, name, l => l.company_name);
  if (!ld) return out;
  const byId = new Map(src.zones.map(z => [z.id, z.name]));
  for (const id of (ld.crm_id ? src.pipelineZoneIds.get(ld.crm_id) : null) ?? []) pushZone(out, byId.get(id));
  pushZone(out, ld.region);
  return out;
}
