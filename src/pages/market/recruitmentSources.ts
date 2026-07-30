// Danh sách "Nguồn tuyển" dùng chung toàn hệ thống (migration 127) — thêm/xoá ở đây áp dụng
// ngay cho gợi ý chọn nhanh của mọi đối thủ, không phải cấu hình riêng từng đối thủ.
import { supabase } from '../../lib/supabase';

export interface RecruitmentSource {
  id: string;
  label: string;
  sortOrder: number;
}

const rowToSource = (r: any): RecruitmentSource => ({ id: r.id, label: r.label, sortOrder: r.sort_order });

export async function fetchRecruitmentSources(): Promise<RecruitmentSource[]> {
  const { data, error } = await supabase.from('competitor_recruitment_sources').select('*').order('sort_order').order('label');
  if (error || !data) return [];
  return data.map(rowToSource);
}

export async function addRecruitmentSource(label: string, existing: RecruitmentSource[]): Promise<string | null> {
  const trimmed = label.trim();
  if (!trimmed) return 'Nhập tên nguồn tuyển';
  if (existing.some(s => s.label.toLowerCase() === trimmed.toLowerCase())) return null;
  const sortOrder = Math.max(0, ...existing.map(s => s.sortOrder)) + 1;
  const { error } = await supabase.from('competitor_recruitment_sources').insert({ label: trimmed, sort_order: sortOrder });
  return error ? error.message : null;
}

export async function deleteRecruitmentSource(id: string): Promise<string | null> {
  const { error } = await supabase.from('competitor_recruitment_sources').delete().eq('id', id);
  return error ? error.message : null;
}
