import { useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { cutoutDataUrl, prepareStampImage } from '../../../lib/imageCutout';
import { Switch } from './ui';

export const CHECKER = { backgroundImage: 'linear-gradient(45deg,#e9e9ee 25%,transparent 25%,transparent 75%,#e9e9ee 75%),linear-gradient(45deg,#e9e9ee 25%,transparent 25%,transparent 75%,#e9e9ee 75%)', backgroundSize: '12px 12px', backgroundPosition: '0 0,6px 6px', backgroundColor: '#fff' } as const;

/** Chọn ảnh (logo / chữ ký / con dấu) kèm tự xoá nền trắng — nền caro để thấy phần trong suốt. */
export default function ImagePicker({ label, hint, value, onChange, cutoutDefault, disabled }: {
  label: string; hint: string; value: string | null; onChange: (v: string | null) => void; cutoutDefault: boolean; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [cut, setCut] = useState(cutoutDefault);
  const [orig, setOrig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (f: File) => {
    setBusy(true); setErr(null);
    try { const r = await prepareStampImage(f, { cutout: cut }); setOrig(r.original); onChange(r.dataUrl); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const toggle = async (on: boolean) => {
    setCut(on);
    if (!value) return;
    setBusy(true);
    try { onChange(on ? await cutoutDataUrl(orig ?? value) : orig ?? value); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  return (
    <div className="rounded-xl bg-[#f5f5f7] p-3">
      <div className="flex items-center gap-3">
        <div className="w-20 h-16 rounded-lg ring-1 ring-black/10 flex items-center justify-center overflow-hidden shrink-0" style={CHECKER}>
          {value ? <img src={value} alt="" className="max-w-full max-h-full object-contain" /> : <ImageIcon size={18} className="text-[#a1a1a6]" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#1d1d1f]">{label}</div>
          <div className="text-[11.5px] text-[#86868b] leading-snug">{hint}</div>
          {!disabled && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#0071e3]">{busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}{value ? 'Đổi ảnh' : 'Tải ảnh'}</button>
              {value && <button type="button" onClick={() => { onChange(null); setOrig(null); }} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#d70015]"><Trash2 size={12} />Xoá</button>}
              <label className="inline-flex items-center gap-1.5 text-[12px] text-[#6e6e73] cursor-pointer"><Switch on={cut} onChange={toggle} />Xoá nền trắng</label>
            </div>
          )}
        </div>
      </div>
      {err && <div className="mt-2 text-[12px] text-[#b3140a]">{err}</div>}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f); }} />
    </div>
  );
}
