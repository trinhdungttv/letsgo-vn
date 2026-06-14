import { supabase } from './supabase';
import type { Client, CRMPipelineEntry } from './types';

// Lấy entry crm_pipeline gắn với 1 Khách hàng (client_id); nếu chưa có thì
// tự tạo 1 entry "ẩn" để dùng làm gốc dữ liệu chung (lịch sử trao đổi, quà
// tặng, task, sở thích...) cho cả CSKH Radar, CRM Pipeline BD và trang
// Khách hàng.
export async function getOrCreatePipelineEntryForClient(client: Client): Promise<CRMPipelineEntry | null> {
  const { data: existing } = await supabase
    .from('crm_pipeline')
    .select('*')
    .eq('client_id', client.id)
    .maybeSingle();
  if (existing) return existing as CRMPipelineEntry;

  const { data: created, error } = await supabase
    .from('crm_pipeline')
    .insert({
      client_id: client.id,
      company_name: client.name,
      region: client.region || null,
      stage: 'hop-tac',
      rating: 'normal',
    })
    .select()
    .single();
  if (error) return null;
  return created as CRMPipelineEntry;
}
