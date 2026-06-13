import { useEffect, useState, useCallback } from 'react';
import { RotateCcw, Archive } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { undoActivity, logActivity } from '../lib/audit';
import type { AuditLogEntry, AuditAction, Client } from '../lib/types';

interface Props {
  toast: (msg: string) => void;
  onReload: () => void;
}

const TABLE_LABELS: Record<string, string> = {
  clients: 'Khách hàng',
  client_labor_history: 'Lao động',
  finance_records: 'Tài chính',
  market_surveys: 'Lương thị trường',
  competitors: 'Đối thủ',
  market_zones: 'Khu vực',
  market_leads: 'Công ty/Dự án',
  quotes: 'Báo giá',
  crm_pipeline: 'CRM Pipeline',
  crm_interactions: 'CRM Tương tác',
  crm_gifts: 'CRM Quà tặng',
  crm_pipeline_tasks: 'CRM Công việc',
  crm_leads: 'CRM Lead',
  crm_deals: 'CRM Deal',
  crm_products: 'Sản phẩm',
  crm_activities: 'CRM Hoạt động',
  contacts: 'Liên hệ',
  app_users: 'Người dùng',
  branches: 'Chi nhánh',
  regions: 'Khu vực phụ trách',
};

const ACTION_LABELS: Record<AuditAction, { label: string; cls: string }> = {
  insert: { label: 'Thêm', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  update: { label: 'Sửa', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  delete: { label: 'Xóa', cls: 'bg-red-50 text-red-700 border border-red-200' },
};

const PAGE_SIZE = 50;

export default function History({ toast, onReload }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'history' | 'archive'>('history');
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [tableFilter, setTableFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState<'all' | AuditAction>('all');
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [archivedClients, setArchivedClients] = useState<Client[]>([]);
  const [loadingArchive, setLoadingArchive] = useState(true);

  const loadArchived = useCallback(async () => {
    setLoadingArchive(true);
    const { data, error } = await supabase.from('clients').select('*').not('archived_at', 'is', null).order('archived_at', { ascending: false });
    if (error) { toast('Lỗi tải lưu trữ: ' + error.message); setLoadingArchive(false); return; }
    setArchivedClients((data || []) as Client[]);
    setLoadingArchive(false);
  }, [toast]);

  useEffect(() => { loadArchived(); }, [loadArchived]);

  const handleRestore = async (c: Client) => {
    setRestoringId(c.id);
    try {
      const { error } = await supabase.from('clients').update({ archived_at: null, updated_at: new Date().toISOString() }).eq('id', c.id);
      if (error) throw error;
      await logActivity({
        user, action: 'update', table: 'clients', recordId: c.id,
        description: `Khôi phục công ty "${c.name}" từ Lưu trữ`,
        oldData: c, newData: { ...c, archived_at: null },
      });
      toast(`Đã khôi phục "${c.name}"`);
      setArchivedClients(prev => prev.filter(ac => ac.id !== c.id));
      onReload();
    } catch (err: any) {
      toast('Lỗi: ' + err.message);
    } finally {
      setRestoringId(null);
    }
  };

  const load = useCallback(async (offset: number) => {
    let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    if (tableFilter !== 'all') query = query.eq('table_name', tableFilter);
    if (actionFilter !== 'all') query = query.eq('action', actionFilter);
    const { data, error } = await query;
    if (error) { toast('Lỗi tải lịch sử: ' + error.message); return []; }
    return (data || []) as AuditLogEntry[];
  }, [tableFilter, actionFilter, toast]);

  const reload = useCallback(async () => {
    setLoading(true);
    const data = await load(0);
    setLogs(data);
    setHasMore(data.length === PAGE_SIZE);
    setLoading(false);
  }, [load]);

  useEffect(() => { reload(); }, [reload]);

  const loadMore = async () => {
    const data = await load(logs.length);
    setLogs(prev => [...prev, ...data]);
    setHasMore(data.length === PAGE_SIZE);
  };

  const handleUndo = async (log: AuditLogEntry) => {
    setUndoingId(log.id);
    const { error } = await undoActivity(log, user);
    setUndoingId(null);
    if (error) { toast('Lỗi hoàn tác: ' + error); return; }
    toast('Đã hoàn tác thao tác');
    reload();
  };

  return (
    <>
      <PageHeader title="Lịch sử hoạt động" subtitle="Theo dõi thêm/sửa/xóa trên toàn hệ thống" />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setTab('history')} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition ${tab === 'history' ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            Lịch sử hoạt động
          </button>
          <button onClick={() => setTab('archive')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition ${tab === 'archive' ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            <Archive size={13} /> Lưu trữ {archivedClients.length > 0 && `(${archivedClients.length})`}
          </button>
        </div>

        {tab === 'archive' ? (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr>
                  {['Công ty', 'Chi nhánh', 'Quản lý', 'Đã xóa lúc', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingArchive ? (
                  <tr><td colSpan={5} className="text-center py-8 text-[#aaa]">Đang tải...</td></tr>
                ) : archivedClients.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-[#aaa]">Không có công ty nào trong Lưu trữ</td></tr>
                ) : archivedClients.map(c => (
                  <tr key={c.id} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2 font-semibold">{c.name}</td>
                    <td className="px-3 py-2 text-[#555]">{c.region || '—'}</td>
                    <td className="px-3 py-2 text-[#555]">{c.manager || '—'}</td>
                    <td className="px-3 py-2 text-[#888] whitespace-nowrap">{c.archived_at ? new Date(c.archived_at).toLocaleString('vi-VN') : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {user?.role === 'admin' ? (
                        <button onClick={() => handleRestore(c)} disabled={restoringId === c.id} className="inline-flex items-center gap-1 text-[11.5px] text-blue-600 hover:underline disabled:opacity-50">
                          <RotateCcw size={11} /> {restoringId === c.id ? 'Đang xử lý...' : 'Khôi phục'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
        <>
        <div className="flex gap-2 flex-wrap">
          <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
            <option value="all">Tất cả đối tượng</option>
            {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value as any)} className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
            <option value="all">Tất cả hành động</option>
            <option value="insert">Thêm</option>
            <option value="update">Sửa</option>
            <option value="delete">Xóa</option>
          </select>
        </div>

        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr>
                {['Thời gian', 'Người dùng', 'Hành động', 'Đối tượng', 'Mô tả', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-[#aaa]">Đang tải...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-[#aaa]">Chưa có hoạt động nào</td></tr>
              ) : logs.map(log => {
                const a = ACTION_LABELS[log.action];
                return (
                  <tr key={log.id} className="border-b border-[#F0EEE9] last:border-0 align-top">
                    <td className="px-3 py-2 text-[#888] whitespace-nowrap">{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{log.user_name || '—'}</td>
                    <td className="px-3 py-2"><span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${a.cls}`}>{a.label}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap">{TABLE_LABELS[log.table_name] || log.table_name}</td>
                    <td className="px-3 py-2">{log.description || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {log.undone ? (
                        <span className="text-[11px] text-[#aaa]">Đã hoàn tác</span>
                      ) : user?.role === 'admin' ? (
                        <button onClick={() => handleUndo(log)} disabled={undoingId === log.id} className="inline-flex items-center gap-1 text-[11.5px] text-blue-600 hover:underline disabled:opacity-50">
                          <RotateCcw size={11} /> {undoingId === log.id ? 'Đang xử lý...' : 'Hoàn tác'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {hasMore && !loading && (
          <div className="text-center">
            <button onClick={loadMore} className="px-4 py-1.5 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition">Tải thêm</button>
          </div>
        )}
        </>
        )}
      </div>
    </>
  );
}
