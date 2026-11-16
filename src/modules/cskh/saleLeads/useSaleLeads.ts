// Nạp bảng nháp đầu mối + danh bạ (mọi người liên hệ, cả khách lẫn Sale) để dò trùng SĐT.
// Tải lại khi nơi khác ghi (cskh:data-changed — VD vừa chuyển 1 đầu mối sang Sale / CTV).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectContacts } from '../../../lib/contactOps';
import { contactKindOf } from '../../../lib/cskh/space';
import { onCskhDataChanged } from '../../../lib/cskh/events';
import type { ContactRow } from '../../../lib/cskh/mappers';
import { loadSaleLeadAreas, loadSaleLeads, type SaleLeadArea } from '../../../lib/saleLeads/api';
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
  /** Danh sách khu vực ngoài KCN (migration 229). */
  areas: SaleLeadArea[];
  /** false = DB chưa chạy migration 229. */
  areasReady: boolean;
  reload: () => Promise<void>;
  /** Chỉ nạp lại danh sách khu vực (sau khi thêm / sửa / xoá 1 mục). */
  reloadAreas: () => Promise<void>;
}

export function useSaleLeads(toast: (m: string) => void): SaleLeadsState {
  const [leads, setLeads] = useState<SaleLead[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<ContactPhoneLite[]>([]);
  const [areas, setAreas] = useState<SaleLeadArea[]>([]);
  const [areasReady, setAreasReady] = useState(true);
  const alive = useRef(true);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const reload = useCallback(async () => {
    try {
      const [rows, people, areaRows] = await Promise.all([
        loadSaleLeads(),
        selectContacts(q => q.order('name'), 'all') as Promise<ContactRow[]>,
        loadSaleLeadAreas().catch(() => null),
      ]);
      if (!alive.current) return;
      setReady(rows !== null);
      setLeads(rows ?? []);
      setAreasReady(areaRows !== null);
      setAreas(areaRows ?? []);
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

  const reloadAreas = useCallback(async () => {
    try {
      const rows = await loadSaleLeadAreas();
      if (!alive.current) return;
      setAreasReady(rows !== null);
      setAreas(rows ?? []);
    } catch (e) {
      if (alive.current) toastRef.current('Lỗi tải danh sách khu vực: ' + (e as Error).message);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    const off = onCskhDataChanged(() => { void reload(); });
    return () => { alive.current = false; off(); };
  }, [reload]);

  const phoneIndex = useMemo(() => buildPhoneIndex(leads, contacts), [leads, contacts]);
  return { leads, ready, loading, contacts, phoneIndex, areas, areasReady, reload, reloadAreas };
}
