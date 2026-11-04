// Sơ đồ tổ chức bên khách hàng (tab "Sơ đồ tổ chức" trong hồ sơ khách) — bảng client_org_charts, migration 199.
// Dữ liệu = đúng định dạng Sơ đồ tư duy của Ghi chú nhanh (MindMapDoc) → dùng lại nguyên trình vẽ MindMapEditor.
// Mặc định kiểu "Tổ chức" (chủ đề trung tâm ở trên, các cấp xổ xuống dưới), nhánh nhiều màu.
import { supabase } from '../supabase';
import { newTopic } from '../quickNotes/mindmap/model';
import { DEFAULT_THEME, parseDoc, uid } from '../quickNotes/mindmap/parse';
import type { MindMapDoc } from '../quickNotes/mindmap/types';

export const CLIENT_MAPS_MIGRATION_HINT = 'Cần chạy migration 199 (Sơ đồ tổ chức & Mặt bằng khách hàng) trong Supabase → SQL Editor';

/** Bảng / cột chưa có trên DB (chưa chạy migration). */
export function isMissingTableError(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || /does not exist|schema cache|could not find the table/i.test(e.message ?? '');
}

/** Các cấp gợi ý ban đầu — đổi tên / thêm / xoá thoải mái. */
export const ORG_DEFAULT_LEVELS = ['Ban Giám đốc', 'Nhân sự (HR)', 'Sản xuất', 'Kho / Mua hàng'] as const;

/** Sơ đồ mới: tên công ty ở giữa trên cùng, 4 nhánh xổ xuống (giống mẫu Sơ đồ tư duy). */
export function defaultOrgChart(companyName: string): MindMapDoc {
  return {
    v: 1,
    root: { id: uid(), text: companyName.trim() || 'Công ty', children: ORG_DEFAULT_LEVELS.map(t => newTopic(t)) },
    floating: [],
    relations: [],
    structure: 'org',
    theme: DEFAULT_THEME,
  };
}

export interface OrgChartRow {
  doc: MindMapDoc | null;
  updatedAt: string | null;
  updatedBy: string;
}

export async function loadOrgChart(clientId: string): Promise<OrgChartRow> {
  const { data, error } = await supabase.from('client_org_charts')
    .select('mindmap, updated_at, updated_by').eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  if (!data) return { doc: null, updatedAt: null, updatedBy: '' };
  return { doc: parseDoc(data.mindmap), updatedAt: data.updated_at ?? null, updatedBy: data.updated_by ?? '' };
}

export async function saveOrgChart(clientId: string, doc: MindMapDoc, userName: string): Promise<string> {
  const { data, error } = await supabase.from('client_org_charts')
    .upsert({ client_id: clientId, mindmap: doc, updated_by: userName }, { onConflict: 'client_id' })
    .select('updated_at').single();
  if (error) throw error;
  return data?.updated_at ?? new Date().toISOString();
}
