// Danh sách ngành nghề tập trung (bảng industries, migration 099) — dùng chung cho
// Lương TT và Công ty/Dự án để mọi nơi chọn cùng một danh sách, không gõ tay trùng lặp.
import { supabase } from '../../lib/supabase';

export async function fetchIndustries(fallback: (string | null | undefined)[] = []): Promise<string[]> {
  const { data, error } = await supabase.from('industries').select('name').order('name');
  if (!error && data) return data.map(d => d.name as string);
  // Bảng industries chưa chạy migration 099 trên DB này — tạm dùng danh sách đã có sẵn.
  return [...new Set(fallback.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi'));
}

export async function addIndustry(name: string): Promise<string | null> {
  const { error } = await supabase.from('industries').insert({ name });
  if (error && !/duplicate|unique/i.test(error.message)) return error.message;
  return null;
}
