// Ngày lễ & kỷ niệm công ty (migration 185) — tải 1 lần, tự tải lại khi nơi khác vừa ghi
// (form nhập nhanh, danh mục ngày lễ…) qua sự kiện cskh:data-changed.
import { useCallback, useEffect, useState } from 'react';
import { onCskhDataChanged } from '../lib/cskh/events';
import { EMPTY_COMPANY_DATES, loadCompanyDates, type CompanyDatesData } from '../lib/companyDatesApi';

export function useCompanyDates() {
  const [data, setData] = useState<CompanyDatesData>(EMPTY_COMPANY_DATES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadCompanyDates());
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Lỗi tải ngày lễ công ty');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => onCskhDataChanged(() => { void refresh(); }), [refresh]);

  return { data, loading, error, refresh };
}
