// Đổi loại hình dịch vụ của khách: ghi service_type + 1 dòng lịch sử có NGÀY CHUYỂN.
// KHÔNG xoá chu kỳ Chốt công / Tính lương / Phát lương / Ứng lương / Kỳ TT — loại Giới thiệu chỉ ẨN các mốc đó,
// đổi ngược lại là mốc cũ hiện nguyên.
import { supabase } from './supabase';
import { logActivity } from './audit';
import type { Client, ServiceType } from './types';

export interface ClientServiceHistory {
  id: string; client_id: string; from_type: ServiceType | null; to_type: ServiceType;
  effective_from: string; created_by: string | null; created_at: string;
}

export const SERVICE_LABEL: Record<ServiceType, string> = {
  leasing: 'Cho thuê lao động', recruitment: 'Giới thiệu lao động', hoh: 'HOH',
};

export async function changeServiceType(opts: {
  client: Client; newType: ServiceType; effectiveFrom: string; user: Parameters<typeof logActivity>[0]['user'];
}): Promise<{ updates: Partial<Client>; history: ClientServiceHistory | null; historyError: string | null }> {
  const { client, newType, effectiveFrom, user } = opts;
  const from = (client.service_type ?? 'leasing') as ServiceType;
  const updates = { service_type: newType, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
  if (error) throw error;
  // Bảng lịch sử (migration 235) chưa chạy thì vẫn đổi được loại hình, chỉ báo là chưa ghi được ngày chuyển.
  const { data, error: hErr } = await supabase.from('client_service_history')
    .insert({ client_id: client.id, from_type: from, to_type: newType, effective_from: effectiveFrom, created_by: user?.full_name || null })
    .select().single();
  await logActivity({
    user, action: 'update', table: 'clients', recordId: client.id,
    description: `Đổi loại hình dịch vụ của "${client.name}": ${SERVICE_LABEL[from]} → ${SERVICE_LABEL[newType]} (từ ${effectiveFrom})`,
    oldData: client, newData: { ...client, ...updates },
  });
  return { updates, history: hErr ? null : (data as ClientServiceHistory), historyError: hErr ? hErr.message : null };
}
