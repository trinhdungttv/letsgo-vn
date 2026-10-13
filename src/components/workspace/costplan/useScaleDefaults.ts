import { useCallback, useEffect, useRef, useState } from 'react';
import { FALLBACK_SCALE, loadScaleDefaults, saveScaleDefaults, type Scale, type ScaleDefaults } from '../../../lib/costPlan/scaleDefaults';
import type { ServiceKind } from '../../../lib/costPlan/referral';

/**
 * Quy mô chuẩn dùng chung (số người × số công). `remember` ghi lại số người dùng vừa nhập — gom nhiều phím gõ
 * thành 1 lần lưu (đang gõ "1" rồi "10" chỉ lưu 10).
 */
export function useScaleDefaults() {
  const [defaults, setDefaults] = useState<ScaleDefaults>(FALLBACK_SCALE);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<ScaleDefaults>(FALLBACK_SCALE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    loadScaleDefaults()
      .then(d => { if (alive) { latest.current = d; setDefaults(d); } })
      .catch(() => { /* không đọc được → dùng mặc định */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => () => {
    // Đóng màn khi còn số chưa kịp lưu → lưu ngay
    if (timer.current) { clearTimeout(timer.current); void saveScaleDefaults(latest.current).catch(() => {}); }
  }, []);

  const remember = useCallback((service: ServiceKind, p: Partial<Scale>) => {
    const next: ScaleDefaults = { ...latest.current, [service]: { ...latest.current[service], ...p } };
    latest.current = next;
    setDefaults(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void saveScaleDefaults(latest.current).catch(() => {}); }, 800);
  }, []);

  return { defaults, loaded, remember };
}
