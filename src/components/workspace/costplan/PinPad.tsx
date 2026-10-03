import { useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';

/**
 * Bàn phím nhập mã 4 số kiểu mở khoá iPhone: 4 chấm tròn + bàn phím số. Nhập đủ 4 số là tự gửi.
 * Dùng được cả bằng bàn phím máy tính (gõ số, Backspace).
 * `error` đổi → rung nhẹ và xoá sạch để nhập lại.
 */
export default function PinPad({ onComplete, error, errorTick, disabled, busy }: {
  onComplete: (pin: string) => void;
  error?: string | null;
  /** Tăng lên mỗi lần sai (kể cả khi nội dung lỗi giống hệt lần trước) để bàn phím rung + xoá lại */
  errorTick?: number;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [pin, setPin] = useState('');
  const pinRef = useRef('');   // bản "thật" của mã đang nhập — tránh gọi onComplete 2 lần khi React chạy updater 2 lần (StrictMode)
  const [shake, setShake] = useState(false);
  const update = (v: string) => { pinRef.current = v; setPin(v); };
  const wrap = useRef<HTMLDivElement>(null);
  const locked = !!disabled || !!busy;

  // Có lỗi mới → rung + xoá
  useEffect(() => {
    if (!error) return;
    setShake(true);
    update('');
    const t = setTimeout(() => setShake(false), 450);
    return () => clearTimeout(t);
  }, [error, errorTick]);

  const push = (d: string) => {
    if (locked || pinRef.current.length >= 4) return;
    const next = pinRef.current + d;
    update(next);
    if (next.length === 4) setTimeout(() => onComplete(next), 120); // chừa chút để thấy chấm thứ 4 sáng lên
  };
  const back = () => { if (!locked) update(pinRef.current.slice(0, -1)); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) push(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div ref={wrap} className="flex flex-col items-center select-none">
      <div className={`flex gap-3.5 mb-6 ${shake ? 'animate-[pinshake_.4s]' : ''}`} aria-label={`Đã nhập ${pin.length} trên 4 số`}>
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${i < pin.length ? 'bg-[#1d1d1f] border-[#1d1d1f] scale-110' : 'border-[#c7c7cc] bg-transparent'} ${busy && i < pin.length ? 'animate-pulse' : ''}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        {keys.map(k => (
          <button key={k} type="button" disabled={locked} onClick={() => push(k)}
            className="w-[68px] h-[68px] rounded-full bg-white text-[26px] font-light text-[#1d1d1f] shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.05)] hover:bg-[#fafafa] active:bg-[#e8e8ed] active:scale-95 transition disabled:opacity-40">{k}</button>
        ))}
        <span />
        <button type="button" disabled={locked} onClick={() => push('0')}
          className="w-[68px] h-[68px] rounded-full bg-white text-[26px] font-light text-[#1d1d1f] shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.05)] hover:bg-[#fafafa] active:bg-[#e8e8ed] active:scale-95 transition disabled:opacity-40">0</button>
        <button type="button" disabled={locked || pin.length === 0} onClick={back} aria-label="Xoá số vừa nhập"
          className="w-[68px] h-[68px] rounded-full flex items-center justify-center text-[#667085] hover:bg-[#E9E8E2] active:scale-95 transition disabled:opacity-30"><Delete size={22} /></button>
      </div>
      <style>{'@keyframes pinshake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}'}</style>
    </div>
  );
}
