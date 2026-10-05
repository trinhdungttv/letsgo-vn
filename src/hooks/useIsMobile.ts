import { useEffect, useState } from 'react';

// Cùng mốc với Tailwind `md:` (768px) — dưới mốc này là giao diện điện thoại
// (có thanh điều hướng dưới, ẩn Sidebar).
const QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}
