// "Khách chưa nghe máy" (CSKH): đẩy người đó xuống cuối hàng đợi "Hôm nay cần liên hệ" trong NGÀY ĐÓ — bảng cskh_missed_calls (migration 206).
// Không phải 1 lần liên hệ: không vào nhật ký, không đổi điểm quan hệ, ngày sau tự xếp lại bình thường.
import { supabase } from '../supabase';

export async function loadMissedOn(day: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('cskh_missed_calls').select('contact_id').eq('missed_on', day);
  if (error) return new Set(); // chưa chạy migration 206 → coi như chưa ai bị đánh dấu
  return new Set((data ?? []).map(r => String(r.contact_id)));
}

export async function markMissed(contactId: string, day: string, userName: string): Promise<void> {
  const { error } = await supabase.from('cskh_missed_calls').insert({ contact_id: contactId, missed_on: day, user_name: userName });
  if (error) throw error;
}
