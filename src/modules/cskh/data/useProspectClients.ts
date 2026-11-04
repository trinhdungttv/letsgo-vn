// Công ty "KH tiềm năng" (clients.client_type = 'prospect', chưa lưu trữ) cho CSKH.
// App chỉ nạp khách đang hợp tác → người liên hệ gắn công ty tiềm năng (VD vừa chuyển sang 1 công ty
// đang ở BD Pipeline) bị thiếu tên công ty / loại khách / chi nhánh, lọc "Tiềm năng" ở Danh bạ không ra.
// Nạp riêng và tải lại mỗi khi CSKH vừa ghi (cskh:data-changed) → công ty vừa tạo có ngay.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { onCskhDataChanged } from '../../../lib/cskh/events';
import type { Client } from '../../../lib/types';

export function useProspectClients(): Client[] {
  const [rows, setRows] = useState<Client[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void supabase.from('clients').select('*').eq('client_type', 'prospect').is('archived_at', null).order('name')
        .then(({ data, error }) => { if (alive && !error) setRows((data ?? []) as Client[]); });
    };
    load();
    const off = onCskhDataChanged(load);
    return () => { alive = false; off(); };
  }, []);
  return rows;
}

/** Khách đang hợp tác (từ App) + KH tiềm năng, không trùng id. */
export function useClientsWithProspects(clients: Client[]): Client[] {
  const prospects = useProspectClients();
  return useMemo(() => {
    if (!prospects.length) return clients;
    const ids = new Set(clients.map(c => c.id));
    const extra = prospects.filter(p => !ids.has(p.id));
    return extra.length ? [...clients, ...extra] : clients;
  }, [clients, prospects]);
}
