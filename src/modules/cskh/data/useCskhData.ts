// Tải toàn bộ dữ liệu CSKH một lần cho các tab; tự tải lại khi nơi khác vừa ghi
// (bottom sheet ghi nhận nhanh, form Ghi tương tác…) qua sự kiện cskh:data-changed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { onCskhDataChanged } from '../../../lib/cskh/events';
import type { CskhSpace } from '../../../lib/cskh/space';
import { loadCskhData, type CskhData } from './api';

export function useCskhData(toast: (msg: string) => void, space: CskhSpace = 'client') {
  const { user } = useAuth();
  const userId = user?.id;
  const [data, setData] = useState<CskhData | null>(null);
  const [loading, setLoading] = useState(true);
  // toast của App đổi danh tính mỗi lần hiện thông báo → giữ qua ref, tránh tải lại liên tục
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Bài học từ PRM: KHÔNG dùng cờ "chỉ chạy 1 lần lúc mount" — refresh phụ thuộc
  // userId nên đăng nhập xong (userId tới muộn) là tự tải lại.
  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setData(await loadCskhData(space));
    } catch (e) {
      toastRef.current('Lỗi tải dữ liệu CSKH: ' + ((e as Error).message || 'không rõ'));
    } finally {
      setLoading(false);
    }
  }, [userId, space]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => onCskhDataChanged(() => { void refresh(); }), [refresh]);

  return { data, loading, refresh };
}
