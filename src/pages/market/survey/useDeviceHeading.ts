// La bàn điện thoại cho mũi tên vị trí khi khảo sát (xoay máy hướng nào, mũi tên chỉ hướng đó — giống Google Maps).
// Hướng đọc vào ref (sự kiện tới ~60 lần/giây) để vẽ thẳng lên ghim bản đồ, không re-render React.
//
// iPhone (iOS 13+) phải xin quyền "Chuyển động & hướng" và lời xin phải nằm trong 1 lần bấm của người dùng → gọi
// request() trong onClick (nút Bắt đầu / nút bám vị trí / Cài đặt). Android Chrome có sẵn sự kiện "absolute".
import { useCallback, useEffect, useRef, useState } from 'react';
import { compassFromEvent, type OrientationLike } from '../../../lib/kcnSurvey/heading';

export type CompassStatus = 'off' | 'need-permission' | 'waiting' | 'on' | 'denied' | 'unsupported';

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied' | 'default'> };

const screenAngle = () => {
  const so = (screen as Screen & { orientation?: { angle?: number } }).orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
};

const needsPermission = () => typeof DeviceOrientationEvent !== 'undefined'
  && typeof (DeviceOrientationEvent as unknown as PermissionApi).requestPermission === 'function';

export function useDeviceHeading(enabled: boolean) {
  const headingRef = useRef<number | null>(null);
  const lastAtRef = useRef(0);
  const [granted, setGranted] = useState(() => !needsPermission());
  const [status, setStatus] = useState<CompassStatus>(() => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
    return needsPermission() ? 'need-permission' : 'waiting';
  });

  /** silent = thử ngầm lúc mở (không có lần bấm) → bị từ chối cũng không báo "đã từ chối". */
  const request = useCallback(async (silent = false): Promise<boolean> => {
    if (!needsPermission()) { setGranted(true); return true; }
    try {
      const res = await (DeviceOrientationEvent as unknown as PermissionApi).requestPermission!();
      const ok = res === 'granted';
      if (ok) { setGranted(true); setStatus('waiting'); }
      else if (!silent) setStatus('denied');
      return ok;
    } catch {
      // Không nằm trong lần bấm / trình duyệt chặn — để lần bấm sau xin lại
      return false;
    }
  }, []);

  // Chrome Android bản mới cũng có requestPermission nhưng cho luôn không cần bấm → thử 1 lần khi mở; iPhone sẽ từ chối
  // lặng lẽ (chưa có lần bấm) và đợi nút Bắt đầu / nút bám vị trí xin lại.
  useEffect(() => {
    if (enabled && needsPermission()) void request(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) { headingRef.current = null; if (status === 'on') setStatus('waiting'); return; }
    if (!granted || typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return;
    const onEvent = (e: Event) => {
      const ev = e as DeviceOrientationEvent & OrientationLike & { webkitCompassAccuracy?: number };
      // iPhone báo độ chính xác âm khi la bàn chưa hiệu chỉnh → bỏ
      if (typeof ev.webkitCompassAccuracy === 'number' && ev.webkitCompassAccuracy < 0) return;
      const h = compassFromEvent({ alpha: ev.alpha, absolute: e.type === 'deviceorientationabsolute' || ev.absolute, webkitCompassHeading: ev.webkitCompassHeading }, screenAngle());
      if (h == null) return;
      headingRef.current = h;
      lastAtRef.current = Date.now();
      setStatus(s => (s === 'on' ? s : 'on'));
    };
    const absolute = 'ondeviceorientationabsolute' in window;
    const type = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(type, onEvent);
    // Máy không có la bàn: không có sự kiện nào → sau 4 giây báo không hỗ trợ
    const t = window.setTimeout(() => { if (!lastAtRef.current) setStatus(s => (s === 'waiting' ? 'unsupported' : s)); }, 4000);
    return () => { window.removeEventListener(type, onEvent); window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, granted]);

  /** Hướng la bàn mới nhất, null nếu quá 3 giây không có sự kiện (máy để yên trên bàn / bị tạm dừng). */
  const read = useCallback(() => (Date.now() - lastAtRef.current < 3000 ? headingRef.current : null), []);

  return { status, request, read };
}
