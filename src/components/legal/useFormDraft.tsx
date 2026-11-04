// Pháp lý — tự lưu NHÁP form vào trình duyệt (localStorage) mỗi khi gõ; đóng tab / tải lại / lỡ bấm X rồi mở lại form
// thì khôi phục. Xoá nháp khi Lưu thành công hoặc bấm Huỷ / "Bỏ nháp". Nháp chỉ nằm trên máy này (chưa vào database).
import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

const PREFIX = 'legal-draft:';

export function useFormDraft<T>(key: string, snapshot: T, restore: (v: T) => void) {
  const baseline = useRef(JSON.stringify(snapshot));
  const done = useRef(false);
  const [restored, setRestored] = useState(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return;
      const v = JSON.parse(raw) as T;
      if (JSON.stringify(v) === baseline.current) return;
      restoreRef.current(v);
      setRestored(true);
    } catch { /* nháp hỏng → bỏ qua */ }
  }, [key]);

  const json = JSON.stringify(snapshot);
  useEffect(() => {
    if (done.current) return;
    try {
      if (json === baseline.current) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, json);
    } catch { /* đầy bộ nhớ / chế độ riêng tư */ }
  }, [json, key]);

  /** Gọi khi Lưu thành công / Huỷ: xoá nháp và không ghi lại nữa. */
  const clear = () => {
    done.current = true;
    try { localStorage.removeItem(PREFIX + key); } catch { /* bỏ qua */ }
  };
  return { restored, clear };
}

export function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[12px] bg-[#FFF8E1] text-[12.5px] text-[#7A5600]">
      <span className="flex-1 min-w-0">Đã khôi phục bản nháp bạn đang nhập dở. Bấm Lưu để giữ lại.</span>
      <button type="button" onClick={onDiscard} className="shrink-0 inline-flex items-center gap-1 font-medium text-[#B25000] hover:underline"><RotateCcw size={12} /> Bỏ nháp</button>
    </div>
  );
}
