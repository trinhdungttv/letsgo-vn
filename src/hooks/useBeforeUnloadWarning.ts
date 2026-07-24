import { useEffect } from 'react';

// Cảnh báo trình duyệt (F5 / đóng tab / đóng cửa sổ) khi có dữ liệu đã nhập nhưng
// chưa bấm nút "Lưu" — nếu không có hook này, dữ liệu mất trắng mà không hề báo trước.
export function useBeforeUnloadWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
