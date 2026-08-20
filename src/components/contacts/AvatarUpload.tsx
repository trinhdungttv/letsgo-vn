// ============================================================================
// AvatarUpload — ảnh đại diện người liên hệ.
// Ảnh được cắt vuông và hạ về 256 px NGAY TRÊN TRÌNH DUYỆT trước khi tải lên,
// nên file nằm trong khoảng 10–25 KB thay vì vài MB của ảnh gốc từ điện thoại.
// Dùng lại bucket `avatars` (public) đã tạo ở migration 036.
// ============================================================================
import { useState, useRef } from 'react';
import { Camera, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { resizeImage, formatBytes } from '../../lib/imageResize';

/** Ảnh nguồn quá lớn thì canvas dễ hết bộ nhớ trên máy yếu — chặn từ đầu. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

interface Props {
  value: string;
  onChange: (url: string) => void;
  /** Tên để lấy chữ cái đầu khi chưa có ảnh. */
  name?: string;
  toast: (m: string) => void;
}

export function AvatarCircle({ url, name, size = 36 }: { url?: string | null; name?: string; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (url) {
    return (
      <img src={url} alt={name || ''} width={size} height={size} loading="lazy"
        className="rounded-full object-cover bg-gray-100 shrink-0"
        style={{ width: size, height: size }} />
    );
  }
  return (
    <span
      className="rounded-full bg-blue-100 text-blue-700 font-semibold inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initial}
    </span>
  );
}

export default function AvatarUpload({ value, onChange, name, toast }: Props) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (file.size > MAX_SOURCE_BYTES) {
      toast(`Ảnh gốc quá lớn (${formatBytes(file.size)}) — chọn ảnh dưới 15 MB`);
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      const resized = await resizeImage(file, { max: 256, quality: 0.85, square: true });
      const path = `contacts/${crypto.randomUUID()}.${resized.ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, resized.blob, { upsert: true, contentType: resized.blob.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      onChange(data.publicUrl);
      setInfo(`${resized.width}×${resized.height} · ${formatBytes(resized.size)} (gốc ${formatBytes(file.size)})`);
    } catch (e: any) {
      toast('Lỗi tải ảnh: ' + (e?.message || e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-3">
      <AvatarCircle url={value} name={name} size={56} />
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            {busy ? 'Đang xử lý...' : value ? 'Đổi ảnh' : 'Tải ảnh lên'}
          </button>
          {value && !busy && (
            <button type="button" onClick={() => { onChange(''); setInfo(null); }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition">
              <Trash2 className="w-3.5 h-3.5" /> Gỡ ảnh
            </button>
          )}
        </div>
        <p className="text-[10.5px] text-gray-500 mt-1">
          {info || 'Ảnh tự cắt vuông và nén còn 256px (~15 KB) để không làm nặng web app.'}
        </p>
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}
