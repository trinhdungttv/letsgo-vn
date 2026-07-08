import { useState } from 'react';
import { Clock, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { tableLabel, recordName, TABLE_LABELS } from '../../lib/historyTables';

interface Props {
  toast: (msg: string) => void;
  onReload: () => void;
}

interface PreviewRow {
  record_id: string;
  action: 'RESTORE' | 'DELETE';
  snapshot: Record<string, any> | null;
}

export default function TimeMachineTab({ toast, onReload }: Props) {
  const { user } = useAuth();
  const [table, setTable] = useState('');
  const [time, setTime] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const isAdmin = user?.role === 'admin';

  const runPreview = async () => {
    if (!table || !time) { toast('Chọn bảng và thời điểm cần quay về'); return; }
    setLoading(true);
    setPreview(null);
    const { data, error } = await supabase.rpc('dh_time_machine', {
      p_table: table,
      p_time: new Date(time).toISOString(),
      p_apply: false,
    });
    setLoading(false);
    if (error) {
      if (error.code === '42883' || error.code === '42P01' || error.code === 'PGRST202' || error.message?.includes('Could not find the function')) {
        toast('Chưa chạy migration 090_data_history.sql trên Supabase');
      } else {
        toast('Lỗi: ' + error.message);
      }
      return;
    }
    setPreview((data || []) as PreviewRow[]);
  };

  const apply = async () => {
    setShowConfirm(false);
    setConfirmText('');
    setApplying(true);
    const { data, error } = await supabase.rpc('dh_time_machine', {
      p_table: table,
      p_time: new Date(time).toISOString(),
      p_apply: true,
    });
    setApplying(false);
    if (error) { toast('Lỗi khôi phục: ' + error.message); return; }
    toast(`Đã khôi phục "${tableLabel(table)}" về ${new Date(time).toLocaleString('vi-VN')} (${(data || []).length} bản ghi)`);
    setPreview(null);
    onReload();
  };

  const restoreCount = preview?.filter(p => p.action === 'RESTORE').length || 0;
  const deleteCount = preview?.filter(p => p.action === 'DELETE').length || 0;

  return (
    <>
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-[13.5px]"><Clock size={15} /> Cỗ máy thời gian</div>
        <p className="text-[12px] text-gray-500">
          Đưa <b>toàn bộ một bảng</b> về đúng trạng thái tại một thời điểm trong quá khứ — dùng khi code chạy nhầm làm ghi đè/xóa hàng loạt dữ liệu.
          Luôn <b>xem trước</b> những gì sẽ thay đổi trước khi thực hiện. Bản thân thao tác khôi phục cũng được ghi vào nhật ký nên có thể hoàn tác tiếp nếu cần.
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          <select value={table} onChange={e => { setTable(e.target.value); setPreview(null); }} className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
            <option value="">— Chọn bảng —</option>
            {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input
            type="datetime-local"
            value={time}
            onChange={e => { setTime(e.target.value); setPreview(null); }}
            className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
          />
          <button onClick={runPreview} disabled={loading || !table || !time} className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Đang phân tích...' : 'Xem trước thay đổi'}
          </button>
        </div>
      </div>

      {preview !== null && (
        preview.length === 0 ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-[10px] px-4 py-3 text-[12.5px] text-emerald-800">
            Không có thay đổi nào trên bảng "{tableLabel(table)}" sau thời điểm đã chọn — dữ liệu hiện tại đã đúng với trạng thái đó (hoặc nhật ký chưa ghi nhận thay đổi nào).
          </div>
        ) : (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 text-[12.5px] text-amber-800 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Khôi phục "<b>{tableLabel(table)}</b>" về <b>{new Date(time).toLocaleString('vi-VN')}</b>:{' '}
                <b>{restoreCount}</b> bản ghi sẽ được trả về nội dung cũ{deleteCount > 0 && <>, <b className="text-red-700">{deleteCount} bản ghi sẽ bị xóa</b> (vì được tạo sau thời điểm đó)</>}.
              </span>
            </div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <tbody>
                  {preview.map(p => (
                    <tr key={p.record_id} className="border-b border-[#F0EEE9] last:border-0">
                      <td className="px-4 py-1.5 w-28">
                        {p.action === 'RESTORE'
                          ? <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700 border border-blue-200"><RotateCcw size={10} /> Trả về cũ</span>
                          : <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full font-medium bg-red-50 text-red-700 border border-red-200"><Trash2 size={10} /> Sẽ xóa</span>}
                      </td>
                      <td className="px-3 py-1.5">{recordName(p.snapshot) || <span className="font-mono text-[11px] text-[#888]">{p.record_id.slice(0, 8)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[#F0EEE9] flex justify-end">
              {isAdmin ? (
                <button onClick={() => setShowConfirm(true)} disabled={applying} className="px-4 py-1.5 rounded-lg text-[12.5px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  {applying ? 'Đang khôi phục...' : 'Thực hiện khôi phục'}
                </button>
              ) : (
                <span className="text-[12px] text-gray-400">Chỉ Quản trị viên được thực hiện khôi phục</span>
              )}
            </div>
          </div>
        )
      )}

      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <div className="bg-white rounded-xl p-5 max-w-md w-full space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 font-semibold text-[14px] text-red-700"><AlertTriangle size={16} /> Xác nhận khôi phục hàng loạt</div>
            <p className="text-[12.5px] text-gray-600">
              Bảng <b>{tableLabel(table)}</b> sẽ quay về trạng thái lúc <b>{new Date(time).toLocaleString('vi-VN')}</b>.
              {restoreCount > 0 && <> {restoreCount} bản ghi bị ghi đè về nội dung cũ.</>}
              {deleteCount > 0 && <> <b className="text-red-700">{deleteCount} bản ghi tạo sau thời điểm này sẽ bị XÓA.</b></>}
            </p>
            <p className="text-[12.5px] text-gray-600">Gõ <b className="font-mono">KHOI PHUC</b> để xác nhận:</p>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              className="w-full text-[13px] px-3 py-2 rounded-lg border border-gray-300 outline-none focus:border-red-500 font-mono"
              placeholder="KHOI PHUC"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowConfirm(false); setConfirmText(''); }} className="px-3 py-1.5 rounded-lg text-[12.5px] border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={apply} disabled={confirmText.trim().toUpperCase() !== 'KHOI PHUC'} className="px-3 py-1.5 rounded-lg text-[12.5px] bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
                Khôi phục ngay
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
