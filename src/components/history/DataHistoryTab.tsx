import { useEffect, useState, useCallback } from 'react';
import { RotateCcw, ChevronDown, ChevronRight, Database, ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { tableLabel, recordName, formatValue, TABLE_LABELS } from '../../lib/historyTables';
import type { DataHistoryEntry } from '../../lib/types';

interface Props {
  toast: (msg: string) => void;
  onReload: () => void;
}

const PAGE_SIZE = 50;

const ACTION_UI: Record<string, { label: string; cls: string }> = {
  INSERT: { label: 'Thêm', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  UPDATE: { label: 'Sửa', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  DELETE: { label: 'Xóa', cls: 'bg-red-50 text-red-700 border border-red-200' },
};

export default function DataHistoryTab({ toast, onReload }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<DataHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [tableFilter, setTableFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [confirmRow, setConfirmRow] = useState<DataHistoryEntry | null>(null);

  const load = useCallback(async (offset: number) => {
    let q = supabase.from('data_history').select('*').order('id', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    if (tableFilter !== 'all') q = q.eq('table_name', tableFilter);
    if (actionFilter !== 'all') q = q.eq('action', actionFilter);
    if (search.trim()) q = q.eq('record_id', search.trim());
    const { data, error } = await q;
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205' || error.message?.includes('Could not find the table')) {
        setNotReady(true);
        return [];
      }
      toast('Lỗi tải nhật ký: ' + error.message);
      return [];
    }
    setNotReady(false);
    return (data || []) as DataHistoryEntry[];
  }, [tableFilter, actionFilter, search, toast]);

  const reload = useCallback(async () => {
    setLoading(true);
    const data = await load(0);
    setRows(data);
    setHasMore(data.length === PAGE_SIZE);
    setLoading(false);
  }, [load]);

  useEffect(() => { reload(); }, [reload]);

  const loadMore = async () => {
    const data = await load(rows.length);
    setRows(prev => [...prev, ...data]);
    setHasMore(data.length === PAGE_SIZE);
  };

  // Khôi phục 1 sự kiện: DELETE -> chèn lại dòng cũ; UPDATE -> trả dòng về bản cũ; INSERT -> xóa dòng đã thêm
  const doRestore = async (row: DataHistoryEntry) => {
    setConfirmRow(null);
    setRestoringId(row.id);
    try {
      if (row.action === 'DELETE') {
        if (!row.old_data) throw new Error('Không có dữ liệu cũ');
        const { error } = await supabase.from(row.table_name).insert(row.old_data);
        if (error) throw error;
        toast('Đã khôi phục bản ghi đã xóa');
      } else if (row.action === 'UPDATE') {
        if (!row.old_data) throw new Error('Không có dữ liệu cũ');
        const { error } = await supabase.from(row.table_name).update(row.old_data).eq('id', row.record_id);
        if (error) throw error;
        toast('Đã trả bản ghi về phiên bản trước thay đổi');
      } else {
        const { error } = await supabase.from(row.table_name).delete().eq('id', row.record_id);
        if (error) throw error;
        toast('Đã xóa bản ghi (hoàn tác thao tác thêm)');
      }
      onReload();
      reload();
    } catch (e: any) {
      toast('Lỗi khôi phục: ' + e.message);
    } finally {
      setRestoringId(null);
    }
  };

  if (notReady) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-[10px] p-5 text-[12.5px] text-amber-800 space-y-2">
        <div className="flex items-center gap-2 font-semibold"><Database size={15} /> Nhật ký Database chưa được kích hoạt</div>
        <p>Cần chạy migration <code className="bg-amber-100 px-1 rounded">090_data_history.sql</code> trên Supabase SQL Editor để bật hệ thống theo dõi mọi thay đổi ở tầng database (kể cả thay đổi do code/script gây ra, không qua giao diện).</p>
        <p>File nằm tại: <code className="bg-amber-100 px-1 rounded">supabase/migrations/20260709120000_090_data_history.sql</code></p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-[10px] px-4 py-2.5 text-[12px] text-blue-800 flex items-start gap-2">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
        <span>Nhật ký này được ghi <b>tự động ở tầng database</b>: mọi thêm/sửa/xóa trên tất cả các bảng đều được lưu toàn bộ nội dung — kể cả thay đổi do code, script hay đồng bộ gây ra (không qua giao diện). Lịch sử không thể bị sửa/xóa từ app.</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
          <option value="all">Tất cả bảng</option>
          {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
          <option value="all">Tất cả hành động</option>
          <option value="INSERT">Thêm</option>
          <option value="UPDATE">Sửa</option>
          <option value="DELETE">Xóa</option>
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Lọc theo ID bản ghi..."
          className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 w-64"
        />
      </div>

      <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr>
                {['', 'Thời gian', 'Hành động', 'Bảng', 'Bản ghi', 'Cột thay đổi', ''].map((h, i) => (
                  <th key={i} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-[#aaa]">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-[#aaa]">Chưa có thay đổi nào được ghi nhận (nhật ký bắt đầu ghi từ khi chạy migration)</td></tr>
              ) : rows.map(row => {
                const a = ACTION_UI[row.action];
                const name = recordName(row.new_data || row.old_data);
                const isOpen = expanded === row.id;
                return (
                  <FragmentRow
                    key={row.id}
                    row={row} a={a} name={name} isOpen={isOpen}
                    onToggle={() => setExpanded(isOpen ? null : row.id)}
                    canRestore={user?.role === 'admin'}
                    restoring={restoringId === row.id}
                    onRestore={() => (row.action === 'INSERT' ? setConfirmRow(row) : doRestore(row))}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore && !loading && (
        <div className="text-center">
          <button onClick={loadMore} className="px-4 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Tải thêm</button>
        </div>
      )}

      {confirmRow && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmRow(null)}>
          <div className="bg-white rounded-xl p-5 max-w-md w-full space-y-3" onClick={e => e.stopPropagation()}>
            <div className="font-semibold text-[14px] text-red-700">Xác nhận xóa bản ghi</div>
            <p className="text-[12.5px] text-gray-600">
              Hoàn tác thao tác <b>Thêm</b> nghĩa là <b>xóa</b> bản ghi <b>{recordName(confirmRow.new_data) || confirmRow.record_id}</b> khỏi bảng {tableLabel(confirmRow.table_name)}. Thao tác xóa này cũng sẽ được ghi vào nhật ký nên có thể khôi phục lại sau.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRow(null)} className="px-3 py-1.5 rounded-lg text-[12.5px] border border-gray-300 text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={() => doRestore(confirmRow)} className="px-3 py-1.5 rounded-lg text-[12.5px] bg-red-600 text-white hover:bg-red-700">Xóa bản ghi</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FragmentRow({ row, a, name, isOpen, onToggle, canRestore, restoring, onRestore }: {
  row: DataHistoryEntry;
  a: { label: string; cls: string };
  name: string;
  isOpen: boolean;
  onToggle: () => void;
  canRestore: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const restoreLabel = row.action === 'DELETE' ? 'Khôi phục' : row.action === 'UPDATE' ? 'Về bản cũ' : 'Hoàn tác';
  return (
    <>
      <tr className="border-b border-[#F0EEE9] align-top cursor-pointer hover:bg-[#FAFAF8]" onClick={onToggle}>
        <td className="px-3 py-2 text-[#aaa]">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
        <td className="px-3 py-2 text-[#888] whitespace-nowrap">{new Date(row.happened_at).toLocaleString('vi-VN')}</td>
        <td className="px-3 py-2"><span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${a.cls}`}>{a.label}</span></td>
        <td className="px-3 py-2 whitespace-nowrap">{tableLabel(row.table_name)}</td>
        <td className="px-3 py-2">{name || <span className="text-[#aaa] font-mono text-[11px]">{row.record_id.slice(0, 8)}</span>}</td>
        <td className="px-3 py-2 text-[#888]">{row.changed_fields?.join(', ') || '—'}</td>
        <td className="px-3 py-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
          {canRestore && (
            <button onClick={onRestore} disabled={restoring} className="inline-flex items-center gap-1 text-[11.5px] text-blue-600 hover:underline disabled:opacity-50">
              <RotateCcw size={11} /> {restoring ? 'Đang xử lý...' : restoreLabel}
            </button>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-[#F0EEE9] bg-[#FAFAF8]">
          <td colSpan={7} className="px-4 py-3">
            {row.action === 'UPDATE' && row.changed_fields ? (
              <table className="text-[12px] w-full max-w-2xl">
                <thead>
                  <tr>
                    <th className="text-left text-[11px] text-[#888] font-medium pb-1 pr-4">Cột</th>
                    <th className="text-left text-[11px] text-[#888] font-medium pb-1 pr-4">Trước</th>
                    <th className="text-left text-[11px] text-[#888] font-medium pb-1">Sau</th>
                  </tr>
                </thead>
                <tbody>
                  {row.changed_fields.map(f => (
                    <tr key={f}>
                      <td className="pr-4 py-0.5 font-mono text-[11px] text-[#666]">{f}</td>
                      <td className="pr-4 py-0.5 text-red-700 break-all">{formatValue(row.old_data?.[f])}</td>
                      <td className="py-0.5 text-emerald-700 break-all">{formatValue(row.new_data?.[f])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <pre className="text-[11px] text-[#555] whitespace-pre-wrap break-all max-h-64 overflow-y-auto bg-white border border-[#EEE] rounded-lg p-3">
                {JSON.stringify(row.new_data || row.old_data, null, 2)}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
