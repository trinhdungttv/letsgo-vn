// Hộp nhập mã 4 số của khoá chống xoá (kiểu iOS, migration 196): mở khoá / xoá mục đang khoá, đặt mã lần đầu,
// đổi mã, quên mã (đặt lại bằng mật khẩu đăng nhập). Esc = huỷ. Mã chỉ gửi lên server để so với bản băm — app
// không lưu mã ở đâu cả.
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { KeyRound, Loader2, Lock } from 'lucide-react';
import { changePin, errText, LockError, lockStatus, resetPin, setPin } from '../../lib/quickNotes/api';
import { cleanPin, isPin, PIN_LEN } from '../../lib/quickNotes/lock';

export type PinRequest =
  /** Cần mã đúng mới chạy (mở khoá, xoá mục đang khoá) */
  | { kind: 'verify'; title: string; message?: string; confirmLabel: string; danger?: boolean; run: (pin: string) => Promise<void> }
  /** Chưa có mã: đặt mã (nhập 2 lần) rồi chạy tiếp (khoá mục) */
  | { kind: 'set'; title: string; message?: string; run: () => Promise<void> }
  /** Nút "Mã khoá" trong cửa sổ danh sách: đặt / đổi / quên mã */
  | { kind: 'manage' };

type Step =
  | { s: 'loading' }
  | { s: 'menu'; hasPin: boolean }
  | { s: 'verify' }
  | { s: 'old' }
  | { s: 'password' }
  | { s: 'new'; via: 'set' | 'change' | 'reset'; old?: string; password?: string; first?: string };

const SET_HINT = 'Mã dùng chung cho mọi ghi chú & sơ đồ của bạn, trên mọi máy. Chỉ lưu dạng mã hoá — không ai xem được mã, kể cả quản trị.';

function PinBoxes({ value, onChange, onEnter, disabled, inputRef }: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement>;
}) {
  return (
    <div className="relative mx-auto mt-4 flex w-max justify-center gap-2.5">
      {Array.from({ length: PIN_LEN }, (_, i) => (
        <span key={i}
          className={`w-11 h-12 rounded-[12px] flex items-center justify-center bg-black/[0.05] transition ${i === value.length && !disabled ? 'ring-2 ring-[#0071E3]/70' : ''}`}>
          {i < value.length && <span className="w-2.5 h-2.5 rounded-full bg-[#1D1D1F]" />}
        </span>
      ))}
      {/* Ô thật (trong suốt) phủ lên 4 ô: bàn phím số trên điện thoại, dán được, không gợi ý lưu mật khẩu */}
      <input ref={inputRef} autoFocus value={value} disabled={disabled} aria-label="Mã 4 số"
        inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={PIN_LEN}
        onChange={e => onChange(cleanPin(e.target.value))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
        className="absolute inset-0 w-full h-full opacity-0 text-[16px] cursor-default" />
    </div>
  );
}

export default function PinDialog({ req, onClose, onDone }: {
  req: PinRequest;
  onClose: () => void;
  /** Xong việc (đã mở khoá / xoá / đổi mã…) — thông báo ngắn cho người dùng (nếu có) */
  onDone: (msg?: string) => void;
}) {
  const [step, setStep] = useState<Step>(() => (req.kind === 'verify' ? { s: 'verify' } : req.kind === 'set' ? { s: 'new', via: 'set' } : { s: 'loading' }));
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (req.kind !== 'manage') return;
    let alive = true;
    lockStatus()
      .then(st => { if (alive) setStep({ s: 'menu', hasPin: st.hasPin }); })
      .catch(e => { if (alive) { setStep({ s: 'menu', hasPin: false }); setErr(errText(e)); } });
    return () => { alive = false; };
  }, [req.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  // Đổi bước → con trỏ về ô nhập của bước đó
  useEffect(() => {
    if (step.s === 'password') pwRef.current?.focus();
    else inputRef.current?.focus();
  }, [step]);

  const go = (next: Step, opts: { err?: string | null; info?: string | null } = {}) => {
    setStep(next);
    setCode('');
    setErr(opts.err ?? null);
    setInfo(opts.info ?? null);
  };

  /** Chạy 1 lượt gọi server; lỗi thì hiện chữ đỏ, xoá ô mã để nhập lại. */
  const attempt = async (fn: () => Promise<void>, onFail?: (e: unknown) => boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      if (!onFail?.(e)) { setErr(errText(e)); setCode(''); }
    } finally {
      setBusy(false);
    }
  };

  const verifyLabel = req.kind === 'verify' ? req.confirmLabel.toLowerCase() : '';

  /** Đặt / đổi / đặt lại mã xong */
  const afterNewPin = (via: 'set' | 'change' | 'reset') => {
    if (req.kind === 'verify') {
      go({ s: 'verify' }, { info: `${via === 'set' ? 'Đã đặt mã' : 'Đã đặt mã mới'} — nhập mã để ${verifyLabel}.` });
      return;
    }
    onDone(via === 'change' ? 'Đã đổi mã khoá' : via === 'reset' ? 'Đã đặt lại mã khoá' : 'Đã đặt mã khoá chống xoá');
  };

  const submit = (value = code) => {
    if (busy) return;
    if (step.s === 'verify') {
      if (!isPin(value) || req.kind !== 'verify') return;
      void attempt(async () => { await req.run(value); onDone(); }, e => {
        // Mã đã bị quản trị xoá (quên mã) → cho đặt mã mới ngay tại đây
        if (e instanceof LockError && e.reason === 'no_pin') { go({ s: 'new', via: 'set' }, { info: 'Chưa có mã khoá — đặt mã mới 4 số.' }); return true; }
        return false;
      });
      return;
    }
    if (step.s === 'old') {
      if (isPin(value)) go({ s: 'new', via: 'change', old: value });
      return;
    }
    if (step.s === 'password') {
      if (password) go({ s: 'new', via: 'reset', password });
      return;
    }
    if (step.s !== 'new' || !isPin(value)) return;
    if (!step.first) { setStep({ ...step, first: value }); setCode(''); setErr(null); return; }
    if (step.first !== value) { go({ ...step, first: undefined }, { err: '2 lần nhập không khớp — nhập lại mã mới' }); return; }
    const { via } = step;
    if (via === 'set') {
      void attempt(async () => {
        await setPin(value);
        if (req.kind === 'set') { await req.run(); onDone(); } else afterNewPin('set');
      });
    } else if (via === 'change') {
      void attempt(async () => { await changePin(step.old ?? '', value); afterNewPin('change'); }, e => {
        if (e instanceof LockError && (e.reason === 'wrong_pin' || e.reason === 'locked')) { go({ s: 'old' }, { err: e.message }); return true; }
        return false;
      });
    } else {
      void attempt(async () => { await resetPin(step.password ?? '', value); setPassword(''); afterNewPin('reset'); }, e => {
        if (e instanceof LockError && (e.reason === 'wrong_password' || e.reason === 'locked')) { go({ s: 'password' }, { err: e.message }); return true; }
        return false;
      });
    }
  };

  // Gõ đủ 4 số thì tự đi tiếp — trừ khi xoá (phải bấm nút Xoá cho chắc)
  const autoSubmit = !(step.s === 'verify' && req.kind === 'verify' && req.danger);
  const onCode = (v: string) => {
    setCode(v);
    if (err) setErr(null);
    if (autoSubmit && v.length === PIN_LEN) submit(v);
  };

  const forgot = () => { setPassword(''); go({ s: 'password' }); };

  const heading = step.s === 'verify' && req.kind === 'verify' ? req.title
    : req.kind === 'set' && step.s === 'new' && step.via === 'set' ? req.title
      : step.s === 'password' || (step.s === 'new' && step.via === 'reset') ? 'Quên mã khoá'
        : step.s === 'old' || (step.s === 'new' && step.via === 'change') ? 'Đổi mã khoá'
          : step.s === 'new' ? 'Đặt mã khoá 4 số' : 'Mã khoá chống xoá';

  const message = step.s === 'verify' && req.kind === 'verify' ? req.message
    : step.s === 'new' && step.via === 'set' ? (req.kind === 'set' ? req.message ?? SET_HINT : SET_HINT)
      : step.s === 'password' ? 'Nhập mật khẩu đăng nhập CRM để đặt mã mới. Các mục đang khoá vẫn khoá, mở bằng mã mới.'
        : step.s === 'menu' ? (step.hasPin
          ? 'Mã 4 số dùng để mở khoá hoặc xoá các ghi chú / sơ đồ đã khoá.'
          : 'Chưa đặt mã. Đặt mã 4 số rồi bấm 🔒 trong ghi chú / sơ đồ quan trọng để chống xoá nhầm.')
          : undefined;

  const prompt = step.s === 'verify' ? 'Nhập mã 4 số'
    : step.s === 'old' ? 'Nhập mã đang dùng'
      : step.s === 'new' ? (step.first ? 'Nhập lại mã mới để xác nhận' : 'Nhập mã mới 4 số') : '';

  const btn = 'flex-1 h-10 rounded-[10px] text-[14px] font-medium disabled:opacity-40';
  const grayBtn = `${btn} bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]`;
  const blueBtn = `${btn} font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] inline-flex items-center justify-center gap-1.5`;

  return (
    <div className="fixed inset-0 z-[95] bg-black/35 flex items-center justify-center p-4" data-qn-keep data-qn-confirm
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="alertdialog" aria-modal="true" aria-label={heading}
        className="qn-pop w-full max-w-[340px] bg-white/95 backdrop-blur-xl rounded-[16px] p-5 text-center shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_24px_60px_-12px_rgba(0,0,0,0.4)]">
        <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-[#0071E3]/10 text-[#0071E3] flex items-center justify-center">
          {step.s === 'menu' || step.s === 'loading' ? <KeyRound size={19} /> : <Lock size={18} />}
        </div>
        <div className="text-[16px] font-semibold text-[#1D1D1F]">{heading}</div>
        {message && <div className="mt-1.5 text-[13px] leading-[1.45] text-[#6E6E73]">{message}</div>}
        {info && <div className="mt-2 text-[12.5px] text-[#248A3D]">{info}</div>}

        {step.s === 'loading' && <div className="flex justify-center py-6 text-[#86868B]"><Loader2 size={18} className="animate-spin" /></div>}

        {(step.s === 'verify' || step.s === 'old' || step.s === 'new') && (
          <>
            <div className="mt-3 text-[12.5px] font-medium text-[#3A3A3C]">{prompt}</div>
            <PinBoxes value={code} onChange={onCode} onEnter={() => submit()} disabled={busy} inputRef={inputRef} />
          </>
        )}

        {step.s === 'password' && (
          <input ref={pwRef} type="password" autoComplete="current-password" value={password} disabled={busy}
            onChange={e => { setPassword(e.target.value); if (err) setErr(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder="Mật khẩu đăng nhập"
            className="mt-4 w-full h-10 px-3 rounded-[10px] bg-black/[0.05] text-[16px] md:text-[14px] outline-none focus:ring-2 focus:ring-[#0071E3]/60" />
        )}

        {err && <div className="mt-2.5 text-[12.5px] text-[#D70015]">{err}</div>}

        {step.s === 'menu' && !err && (
          <div className="mt-4 flex flex-col gap-2">
            {step.hasPin ? (
              <>
                <button type="button" onClick={() => go({ s: 'old' })} className={grayBtn}>Đổi mã</button>
                <button type="button" onClick={forgot} className={grayBtn}>Quên mã — đặt lại bằng mật khẩu đăng nhập</button>
              </>
            ) : (
              <button type="button" onClick={() => go({ s: 'new', via: 'set' })} className={blueBtn}>Đặt mã</button>
            )}
          </div>
        )}

        {(step.s === 'verify') && (
          <button type="button" onClick={forgot} disabled={busy} className="mt-3 text-[12.5px] font-medium text-[#0071E3] hover:underline disabled:opacity-40">
            Quên mã?
          </button>
        )}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={grayBtn}>{step.s === 'menu' ? 'Đóng' : 'Huỷ'}</button>
          {step.s === 'verify' && req.kind === 'verify' && (
            <button type="button" onClick={() => submit()} disabled={busy || !isPin(code)}
              className={`${btn} font-semibold text-white inline-flex items-center justify-center gap-1.5 ${req.danger ? 'bg-[#FF3B30] hover:bg-[#E5352B]' : 'bg-[#0071E3] hover:bg-[#0077ED]'}`}>
              {busy && <Loader2 size={14} className="animate-spin" />} {req.confirmLabel}
            </button>
          )}
          {step.s === 'password' && (
            <button type="button" onClick={() => submit()} disabled={busy || !password} className={blueBtn}>Tiếp tục</button>
          )}
          {(step.s === 'old' || step.s === 'new') && busy && (
            <span className={`${blueBtn} opacity-60`}><Loader2 size={14} className="animate-spin" /> Đang lưu</span>
          )}
        </div>
      </div>
    </div>
  );
}
