// Admin → "Ảnh & lưu trữ": xem R2 đã bật chưa, quét các link ảnh ngoài đang có và chuyển về kho Cloudflare một lần.
import { useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, Undo2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { r2Status } from '../../lib/r2Upload';
import { migrateOne, revertOne, scanExternalImages, type ImageLinkItem, type ImageLinkResult } from '../../lib/migrateImageLinks';

const card = 'bg-white border border-[#E8E7E2] rounded-[10px] p-4';
const host = (u: string) => { try { return new URL(u).hostname; } catch { return u.slice(0, 30); } };

export default function ImageLinksPanel() {
  const { user } = useAuth();
  const [r2, setR2] = useState<boolean | null>(null);
  const [items, setItems] = useState<ImageLinkItem[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImageLinkResult[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { void r2Status().then(s => setR2(s.enabled)); }, []);

  const scan = async () => {
    setScanning(true); setMsg(null); setResults([]);
    try {
      const r = await scanExternalImages();
      setItems(r.items); setSkipped(r.skipped);
    } catch (e) { setMsg((e as Error).message); }
    setScanning(false);
  };

  const run = async () => {
    if (!items?.length) return;
    if (!window.confirm(`Tải ${items.length} ảnh từ link ngoài về kho Cloudflare và thay link trong hệ thống?\n\nKhông xoá gì: link gốc được ghi vào Nhật ký hoạt động và hoàn tác được từng ảnh ở bảng kết quả.`)) return;
    setRunning(true); setProgress(0); setResults([]);
    const out: ImageLinkResult[] = [];
    for (const it of items) {
      out.push(await migrateOne(it, user));
      setProgress(out.length); setResults([...out]);
    }
    setRunning(false);
    setMsg(`Xong: ${out.filter(r => r.status === 'ok').length}/${out.length} ảnh đã chuyển. Ảnh lỗi vẫn giữ link gốc.`);
    // Quét lại để danh sách chỉ còn ảnh chưa chuyển được
    try { const r = await scanExternalImages(); setItems(r.items); } catch { /* giữ danh sách cũ */ }
  };

  const revert = async (r: ImageLinkResult) => {
    const err = await revertOne(r, user);
    setMsg(err ?? 'Đã hoàn tác 1 ảnh về link gốc');
    if (!err) setResults(list => list.map(x => (x === r ? { ...x, status: 'fail', error: 'Đã hoàn tác về link gốc', to: undefined } : x)));
  };

  return (
    <div className="space-y-3 max-w-3xl">
      <div className={card}>
        <div className="text-[13px] font-semibold text-[#111] mb-1">Lưu ảnh trên Cloudflare R2</div>
        <p className="text-[12px] text-[#666] leading-relaxed">
          Khi anh dán link ảnh (Facebook, website…) vào ảnh bìa, ảnh tuyển dụng, ảnh đại diện… rồi <b>Lưu</b>, hệ thống tự tải ảnh về kho Cloudflare và dùng link của kho —
          link không còn hỏng khi nguồn gỡ hoặc hết hạn. Ảnh chụp khảo sát cũng lưu ở đây. Chưa cài hoặc lỗi thì giữ link gốc, không mất gì.
        </p>
        <div className="mt-2 text-[12px]">
          Trạng thái: {r2 === null ? 'đang kiểm tra…' : r2
            ? <span className="text-emerald-700 font-medium">Đã bật — ảnh mới tự lưu vào Cloudflare</span>
            : <span className="text-amber-700 font-medium">Chưa bật (thiếu cấu hình R2 trên Vercel) — xem docs/HUONG_DAN_CLOUDFLARE_R2.md</span>}
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-[#111]">Chuyển ảnh đang dùng link ngoài</div>
            <div className="text-[11.5px] text-[#888]">Quét Khách hàng, Khu vực, Đối thủ, Công ty / Dự án, Chi nhánh, Liên hệ.</div>
          </div>
          <button onClick={scan} disabled={scanning || running || !r2}
            className="h-9 px-3 rounded-lg border border-[#D8D6D0] text-[12.5px] inline-flex items-center gap-1.5 hover:bg-[#F9F9F7] disabled:opacity-40">
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Quét link ngoài
          </button>
        </div>

        {items && (
          <div className="mt-3 space-y-2">
            <div className="text-[12.5px]">
              {items.length === 0 ? <span className="text-emerald-700">Không còn link ảnh ngoài nào cần chuyển.</span> : <>Tìm thấy <b>{items.length}</b> ảnh đang dùng link ngoài.</>}
              {skipped.length > 0 && <span className="text-[#999]"> (bỏ qua {skipped.length} cột chưa có trong CSDL)</span>}
            </div>
            {items.length > 0 && (
              <>
                <div className="border border-[#E8E7E2] rounded-lg divide-y divide-[#F0EEE9] max-h-60 overflow-y-auto">
                  {items.map((it, i) => (
                    <div key={`${it.table}${it.id}${i}`} className="px-3 py-1.5 text-[12px] flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate"><b>{it.label || it.id}</b> <span className="text-[#999]">· {it.table}.{it.col}</span></span>
                      <span className="text-[11px] text-[#888] shrink-0">{host(it.url)}</span>
                    </div>
                  ))}
                </div>
                <button onClick={run} disabled={running}
                  className="h-9 px-4 rounded-lg bg-[#0A84FF] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                  {running ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {running ? `Đang chuyển ${progress}/${items.length}…` : `Chuyển ${items.length} ảnh về Cloudflare`}
                </button>
              </>
            )}
          </div>
        )}
        {msg && <div className="mt-3 text-[12px] rounded-lg bg-[#F4F8FF] text-[#0A4DB5] px-3 py-2">{msg}</div>}

        {results.length > 0 && (
          <div className="mt-3 border border-[#E8E7E2] rounded-lg divide-y divide-[#F0EEE9] max-h-72 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className="px-3 py-1.5 text-[12px] flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${r.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="flex-1 min-w-0 truncate"><b>{r.label}</b> <span className="text-[#999]">· {host(r.url)}</span>{r.status === 'fail' && <span className="text-red-600"> — {r.error}</span>}</span>
                {r.status === 'ok' && r.to && (
                  <>
                    <a href={r.to} target="_blank" rel="noopener noreferrer" className="text-[#0A84FF] shrink-0" title="Mở ảnh mới"><ExternalLink size={13} /></a>
                    <button onClick={() => void revert(r)} className="text-[#888] hover:text-[#111] shrink-0" title="Hoàn tác về link gốc"><Undo2 size={13} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
