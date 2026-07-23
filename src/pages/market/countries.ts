// Danh sách quốc gia FDI tập trung (bảng countries, migration 106) — dùng chung cho tab
// Khu vực ("FDI từ quốc gia") để mọi nơi chọn cùng một danh sách, không gõ tay trùng lặp.
import { supabase } from '../../lib/supabase';

export async function fetchCountries(fallback: (string | null | undefined)[] = []): Promise<string[]> {
  const { data, error } = await supabase.from('countries').select('name').order('name');
  if (!error && data) return data.map(d => d.name as string);
  // Bảng countries chưa chạy migration 106 trên DB này — tạm dùng danh sách đã có sẵn.
  return [...new Set(fallback.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi'));
}

export async function addCountry(name: string): Promise<string | null> {
  const { error } = await supabase.from('countries').insert({ name });
  if (error && !/duplicate|unique/i.test(error.message)) return error.message;
  return null;
}
