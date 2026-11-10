// Hộp thoại "Khôi phục về trước": xem trước sẽ làm gì với từng bản ghi → bấm Khôi phục → báo kết quả.
// Dùng chung cho tab Cảnh báo (khôi phục cả 1 đợt) và Nhật ký nhân viên (khôi phục các thay đổi đã chọn).
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { revertEvents, summarizePlan, PLAN_LABEL, type RevertRow, type RevertPlan } from '../../lib/dataGuard';
import { tableLabel } from '../../lib/historyTables';
import type { DataHistoryEntry } from '../../lib/types';
import { eventName } from './EventDiff';

interface Props {
  title: string;
  /** Tải danh sách thay đổi cần đảo ngược (gọi 1 lần khi mở). */
  loadEvents: () => Promise<DataHistoryEntry[]>;
  onClose: () => void;
  /** Gọi sau khi khôi phục xong (kể cả có lỗi một phần). */
  onDone: (rows: RevertRow[]) => void;
}

const PLAN_TONE: Record<RevertPlan, string> = {
  reinsert: 'text-emerald-700',
  restore: 'text-blue-700',
  remove: 'text-red-700',
  noop: 'text-[#888]',
  conflict: 'text-amber-700',
  skip: 'text-[#888]',
};

export default function RevertDialog({ title, loadEvents, onClose, onDone }: Props) {
  const { token } = useAuth();
  const [events, setEvents] = useState<DataHistoryEntry[] | null>(null);
  const [preview, setPreview] = useState<RevertRow[] | null>(null);
  const [result, setResult] = useState<RevertRow[] | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!token) throw new Error('Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
        const ev = await loadEvents();
        if (!alive) return;
        setEvents(ev);
        if (ev.length) setPreview(await revertEvents(token, ev.map(e => e.id), false, false));
        else setPreview([]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Xem trước lại khi bật / tắt "ghi đè"
  useEffect(() => {
    if (!events?.length || !token || result) return;
    let alive = true;
    revertEvents(token, events.map(e => e.id), false, force)
      .then(rows => { if (alive) setPreview(rows); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [force]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events ?? []) {
      const k = `${e.table_name}|${e.record_id}`;
      if (!m.has(k)) m.set(k, eventName(e));
    }
    return m;
  }, [events]);

  const sum = preview ? summarizePlan(preview) : null;
  const actionable = sum ? sum.restore + sum.reinsert + sum.remove : 0;
  const hasConflict = !!events?.length && (sum?.conflict ?? 0) > 0;

  const apply = async () => {
    if (!token || !events?.length) return;
    setBusy(true); setError(null);
    try {
      const rows = await revertEvents(token, events.map(e => e.id), true, force);
      setResult(rows);
      onDone(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doneCount = result?.filter(r => r.status === 'done').length ?? 0;
  const errRows = result?.filter(r => r.status === 'error') ?? [];
  const listRows = (result ?? preview ?? []).filter(r => r.plan !== 'noop');

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-xl w-full max-w-[620px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-[#E8E7E2] flex items-center gap-2">
          <RotateCcw size={15} className="text-blue-600 shrink-0" />
          <div className="font-semibold text-[13.5px] text-[#111] flex-1 min-w-0 truncate">{title}</div>
          <button onClick={onClose} disabled={busy} className="text-[#888] hover:text-[#111] disabled:opacity-40"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] rounded-lg px-3 py-2">{error}</div>}

          {!error && (preview === null) && <div className="text-[12.5px] text-[#999] py-6 text-center">Đang kiểm tra từng bản ghi…</div>}

          {preview && events && events.length === 0 && (
            <div className="text-[12.5px] text-[#666] py-4 text-center">Không còn thay đổi nào cần khôi phục (có thể đã khôi phục trước đó).</div>
          )}

          {sum && events && events.length > 0 && !result && (
            <>
              <div className="text-[12px] text-[#555]">
                Đưa <b>{names.size}</b> bản ghi ({events.length} thay đổi) về đúng trạng thái <b>trước</b> các thay đổi này:
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(['reinsert', 'restore', 'remove', 'conflict', 'skip'] as RevertPlan[]).filter(p => sum[p] > 0).map(p => (
                  <div key={p} className={`border rounded-lg px-3 py-2 ${p === 'remove' ? 'border-red-200 bg-red-50' : p === 'conflict' ? 'border-amber-200 bg-amber-50' : 'border-[#E8E7E2] bg-[#FAFAF8]'}`}>
                    <div className={`text-[18px] font-semibold leading-tight ${PLAN_TONE[p]}`}>{sum[p]}</div>
                    <div className="text-[11px] text-[#666]">{PLAN_LABEL[p]}</div>
                  </div>
                ))}
              </div>
              {sum.remove > 0 && (
                <div className="flex gap-2 text-[11.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span><b>{sum.remove}</b> bản ghi do chính đợt này thêm vào sẽ bị <b>xoá</b> (kèm dữ liệu nối theo nếu có). Lần xoá này cũng được ghi lịch sử nên vẫn khôi phục lại được.</span>
                </div>
              )}
              {hasConflict && (
                <label className="flex gap-2 items-start text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="mt-0.5" />
                  <span>Có <b>{sum.conflict}</b> bản ghi đã được người khác sửa tiếp sau đó — mặc định <b>bỏ qua</b> để không mất việc mới. Tích vào đây để ghi đè cả những bản ghi này (không khuyến nghị).</span>
                </label>
              )}
            </>
          )}

          {result && (
            <div className={`flex gap-2 text-[12.5px] rounded-lg px-3 py-2.5 border ${errRows.length ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
              {errRows.length ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="shrink-0 mt-0.5" />}
              <span>Đã khôi phục <b>{doneCount}</b> bản ghi{errRows.length ? <>, <b>{errRows.length}</b> bản ghi lỗi (xem bên dưới)</> : ''}.</span>
            </div>
          )}

          {listRows.length > 0 && (
            <div className="border border-[#E8E7E2] rounded-lg max-h-60 overflow-y-auto divide-y divide-[#F0EEE9]">
              {listRows.slice(0, 200).map(r => (
                <div key={`${r.table_name}|${r.record_id}`} className="px-3 py-1.5 text-[11.5px] flex gap-2 items-start">
                  <span className="text-[#888] shrink-0 w-[120px] truncate">{tableLabel(r.table_name)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="text-[#222] break-words">{names.get(`${r.table_name}|${r.record_id}`) ?? r.record_id.slice(0, 8)}</span>
                    {r.detail && <span className="block text-[10.5px] text-[#999] break-words">{r.detail}</span>}
                  </span>
                  <span className={`shrink-0 ${r.status === 'error' ? 'text-red-600' : r.status === 'done' ? 'text-emerald-700' : PLAN_TONE[r.plan]}`}>
                    {r.status === 'done' ? '✓ Xong' : r.status === 'error' ? 'Lỗi' : PLAN_LABEL[r.plan]}
                  </span>
                </div>
              ))}
              {listRows.length > 200 && <div className="px-3 py-1.5 text-[11px] text-[#999]">… và {listRows.length - 200} bản ghi khác</div>}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[#E8E7E2] flex gap-2 justify-end">
          {result ? (
            <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[12.5px] bg-blue-600 text-white hover:bg-blue-700">Đóng</button>
          ) : (
            <>
              <button onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg text-[12.5px] border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Huỷ</button>
              <button onClick={apply} disabled={busy || actionable === 0}
                className="px-4 py-1.5 rounded-lg text-[12.5px] bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 inline-flex items-center gap-1.5">
                <RotateCcw size={12} /> {busy ? 'Đang khôi phục…' : `Khôi phục ${actionable} bản ghi`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
