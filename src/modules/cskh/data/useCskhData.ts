// Tải toàn bộ dữ liệu CSKH một lần cho các tab; tự tải lại khi nơi khác vừa ghi
// (bottom sheet ghi nhận nhanh, form Ghi tương tác…) qua sự kiện cskh:data-changed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { onCskhDataChanged } from '../../../lib/cskh/events';
import type { CskhSpace } from '../../../lib/cskh/space';
import { loadCskhSpaces, type CskhData } from './api';

/**
 * Nạp nhiều tệp (Khách hàng / Sale) trong 1 lượt — trang CSKH chuyển tệp là có ngay,
 * không tải lại. Mỗi tệp vẫn là 1 CskhData riêng, không lẫn người của tệp kia.
 */
export function useCskhSpaces(toast: (msg: string) => void, spaces: readonly CskhSpace[]) {
  const { user } = useAuth();
  const userId = user?.id;
  const [data, setData] = useState<Partial<Record<CskhSpace, CskhData>> | null>(null);
  const [loading, setLoading] = useState(true);
  // toast của App đổi danh tính mỗi lần hiện thông báo → giữ qua ref, tránh tải lại liên tục
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // Mảng mới mỗi lần vẽ vẫn là cùng 1 bộ tệp → so theo chuỗi
  const key = spaces.join(',');

  // Bài học từ PRM: KHÔNG dùng cờ "chỉ chạy 1 lần lúc mount" — refresh phụ thuộc
  // userId nên đăng nhập xong (userId tới muộn) là tự tải lại.
  const refresh = useCallback(async () => {
    if (!userId || !key) return;
    setLoading(true);
    try {
      setData(await loadCskhSpaces(key.split(',') as CskhSpace[]));
    } catch (e) {
      toastRef.current('Lỗi tải dữ liệu CSKH: ' + ((e as Error).message || 'không rõ'));
    } finally {
      setLoading(false);
    }
  }, [userId, key]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => onCskhDataChanged(() => { void refresh(); }), [refresh]);

  return { data, loading, refresh };
}

/** Một tệp (VD khối CSKH trong hồ sơ Khách hàng chỉ cần tệp khách). */
export function useCskhData(toast: (msg: string) => void, space: CskhSpace = 'client') {
  const { data, loading, refresh } = useCskhSpaces(toast, [space]);
  return { data: data?.[space] ?? null, loading, refresh };
}
