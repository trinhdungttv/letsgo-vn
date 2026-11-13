// Nạp bảng nháp đầu mối + danh bạ (mọi người liên hệ, cả khách lẫn Sale) để dò trùng SĐT.
// Tải lại khi nơi khác ghi (cskh:data-changed — VD vừa chuyển 1 đầu mối sang Sale / CTV).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectContacts } from '../../../lib/contactOps';
import { contactKindOf } from '../../../lib/cskh/space';
import { onCskhDataChanged } from '../../../lib/cskh/events';
import type { ContactRow } from '../../../lib/cskh/mappers';
import { loadSaleLeads } from '../../../lib/saleLeads/api';
import { buildPhoneIndex, type ContactPhoneLite, type PhoneOwner } from '../../../lib/saleLeads/match';
import type { SaleLead } from '../../../lib/saleLeads/types';

export interface SaleLeadsState {
  leads: SaleLead[];
  /** false = DB chưa chạy migration 226. */
  ready: boolean;
  loading: boolean;
  /** Danh bạ rút gọn (đủ để dò trùng SĐT). */
  contacts: ContactPhoneLite[];
  /** SĐT → ai đang giữ số đó. */
  phoneIndex: Map<string, PhoneOwner[]>;
  reload: () => Promise<void>;
}

export function useSaleLeads(toast: (m: string) => void): SaleLeadsState {
  const [leads, setLeads] = useState<SaleLead[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<ContactPhoneLite[]>([]);
  const alive = useRef(true);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const reload = useCallback(async () => {
    try {
      const [rows, people] = await Promise.all([
        loadSaleLeads(),
        selectContacts(q => q.order('name'), 'all') as Promise<ContactRow[]>,
      ]);
      if (!alive.current) return;
      setReady(rows !== null);
      setLeads(rows ?? []);
      setContacts(people.map(r => {
        const kind = contactKindOf(r);
        const org = kind === 'sale'
          ? (r.sale_company ?? '').trim()
          : (r.contact_clients ?? []).map(l => l.clients?.name).filter(Boolean).join(', ');
        return { id: r.id, name: r.name, phone: r.phone, kind, org };
      }));
    } catch (e) {
      if (alive.current) toastRef.current('Lỗi tải bảng nháp đầu mối: ' + (e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const off = onCskhDataChanged(() => { void reload(); });
    return () => { alive.current = false; off(); };
  }, [reload]);

  const phoneIndex = useMemo(() => buildPhoneIndex(leads, contacts), [leads, contacts]);
  return { leads, ready, loading, contacts, phoneIndex, reload };
}
