import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Shield, Check, Lock, Unlock, Inbox } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import type { AppUser, PermissionRequest, PermissionAction } from '../lib/types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { ROLE_LABELS, ROLE_COLORS } from '../lib/constants';

interface AdminPageProps {
  toast: (msg: string) => void;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

type Tab = 'requests' | 'accounts' | 'matrix';

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'Xem', edit: 'Sửa/Nhập', delete: 'Xóa', export: 'Export',
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Chờ duyệt', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  approved: { label: 'Đã duyệt', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  rejected: { label: 'Đã từ chối', cls: 'bg-red-50 text-red-700 border border-red-200' },
};

const MODULES = ['Dashboard', 'Khách hàng', 'Chi nhánh', 'Tài chính', 'Thị trường', 'Báo giá', 'CRM', 'Báo cáo', 'Quản lý Users', 'Lịch sử', 'Bảng KD', 'Admin'];

// Access level per role per module: 'full' | 'view' | 'none' — derived from canAccess() rules,
// used only for the read-only matrix overview in Tab 3.
const MATRIX: Record<string, Record<string, 'full' | 'view' | 'none'>> = {
  admin:     { Dashboard: 'full', 'Khách hàng': 'full', 'Chi nhánh': 'full', 'Tài chính': 'full', 'Thị trường': 'full', 'Báo giá': 'full', CRM: 'full', 'Báo cáo': 'view', 'Quản lý Users': 'full', 'Lịch sử': 'full', 'Bảng KD': 'full', Admin: 'full' },
  ketoan:    { Dashboard: 'view', 'Khách hàng': 'full', 'Chi nhánh': 'none', 'Tài chính': 'full', 'Thị trường': 'none', 'Báo giá': 'none', CRM: 'none', 'Báo cáo': 'view', 'Quản lý Users': 'none', 'Lịch sử': 'none', 'Bảng KD': 'none', Admin: 'none' },
  kinhdoanh: { Dashboard: 'view', 'Khách hàng': 'full', 'Chi nhánh': 'none', 'Tài chính': 'none', 'Thị trường': 'full', 'Báo giá': 'full', CRM: 'full', 'Báo cáo': 'view', 'Quản lý Users': 'none', 'Lịch sử': 'none', 'Bảng KD': 'full', Admin: 'none' },
  bdh:       { Dashboard: 'view', 'Khách hàng': 'full', 'Chi nhánh': 'full', 'Tài chính': 'full', 'Thị trường': 'none', 'Báo giá': 'none', CRM: 'full', 'Báo cáo': 'view', 'Quản lý Users': 'none', 'Lịch sử': 'none', 'Bảng KD': 'full', Admin: 'none' },
};

const emptyForm = { username: '', full_name: '', email: '', password: '', role: 'kinhdoanh' as AppUser['role'] };

export default function AdminPage({ toast }: AdminPageProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('requests');

  // Tab 1 - permission requests
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const [loadingReq, setLoadingReq] = useState(true);
  const [reqFilter, setReqFilter] = useState<'pending' | 'all'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Tab 2 - accounts
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoadingReq(true);
    let query = supabase.from('permission_requests').select('*').order('created_at', { ascending: false });
    if (reqFilter === 'pending') query = query.eq('status', 'pending');
    const { data, error } = await query;
    if (error) toast('Lỗi tải yêu cầu quyền: ' + error.message);
    else setRequests((data || []) as PermissionRequest[]);
    setLoadingReq(false);
  }, [reqFilter, toast]);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    const { data, error } = await supabase.from('app_users').select('*').order('created_at');
    if (error) toast('Lỗi tải users: ' + error.message);
    else setUsers((data || []) as AppUser[]);
    setLoadingUsers(false);
  }, [toast]);

  useEffect(() => { loadRequests(); }, [loadRequests]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleReview = async (req: PermissionRequest, approve: boolean) => {
    setProcessingId(req.id);
    try {
      if (approve) {
        const { data: existing } = await supabase
          .from('user_permissions')
          .select('*')
          .eq('user_email', req.requester_email)
          .eq('module', req.module)
          .maybeSingle();

        const flagKey = `can_${req.action_requested}` as 'can_view' | 'can_edit' | 'can_delete' | 'can_export';
        if (existing) {
          const { error } = await supabase.from('user_permissions').update({ [flagKey]: true, granted_by: user?.full_name || null }).eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('user_permissions').insert({
            user_email: req.requester_email, module: req.module,
            can_view: req.action_requested === 'view', can_edit: req.action_requested === 'edit',
            can_delete: req.action_requested === 'delete', can_export: req.action_requested === 'export',
            granted_by: user?.full_name || null,
          });
          if (error) throw error;
        }
      }

      const { error } = await supabase.from('permission_requests').update({
        status: approve ? 'approved' : 'rejected',
        reviewed_by: user?.full_name || null,
        reviewed_at: new Date().toISOString(),
      }).eq('id', req.id);
      if (error) throw error;

      await logActivity({
        user, action: 'update', table: 'permission_requests', recordId: req.id,
        description: `${approve ? 'Duyệt' : 'Từ chối'} yêu cầu "${ACTION_LABELS[req.action_requested]} - ${req.module}" của ${req.requester_name || req.requester_email}`,
        oldData: req, newData: { ...req, status: approve ? 'approved' : 'rejected' },
      });
      toast(approve ? 'Đã duyệt yêu cầu' : 'Đã từ chối yêu cầu');
      await loadRequests();
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setProcessingId(null);
    }
  };

  const openAdd = () => { setEditUser(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (u: AppUser) => { setEditUser(u); setForm({ username: u.username, full_name: u.full_name, email: u.email || '', password: '', role: u.role }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.username || !form.full_name) { toast('Nhập username và họ tên'); return; }
    if (!editUser && !form.password) { toast('Nhập mật khẩu'); return; }
    setSaving(true);
    try {
      if (editUser) {
        const update: Record<string, string> = { username: form.username, full_name: form.full_name, email: form.email, role: form.role };
        if (form.password) update.password = form.password;
        const { error } = await supabase.from('app_users').update(update).eq('id', editUser.id);
        if (error) throw error;
        await logActivity({
          user, action: 'update', table: 'app_users', recordId: editUser.id,
          description: `Cập nhật tài khoản "${form.username}"`,
          oldData: editUser, newData: { ...editUser, ...update },
        });
        toast('Đã cập nhật user');
      } else {
        const { data, error } = await supabase.from('app_users').insert({
          username: form.username, full_name: form.full_name, email: form.email || null, password: form.password, role: form.role,
        }).select().single();
        if (error) throw error;
        await logActivity({
          user, action: 'insert', table: 'app_users', recordId: data.id,
          description: `Tạo tài khoản mới "${form.username}"`,
          newData: data,
        });
        toast('Đã tạo user mới');
      }
      await loadUsers();
      setShowModal(false);
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: AppUser) => {
    setBusyId(u.id);
    try {
      const newVal = !(u.is_active ?? true);
      const { error } = await supabase.from('app_users').update({ is_active: newVal }).eq('id', u.id);
      if (error) throw error;
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: newVal } : x));
      await logActivity({
        user, action: 'update', table: 'app_users', recordId: u.id,
        description: `${newVal ? 'Mở khóa' : 'Khóa'} tài khoản "${u.username}"`,
        oldData: u, newData: { ...u, is_active: newVal },
      });
      toast(newVal ? 'Đã mở khóa tài khoản' : 'Đã khóa tài khoản');
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u: AppUser) => {
    if (!confirm(`Xóa user "${u.username}"?`)) return;
    setBusyId(u.id);
    try {
      const { error } = await supabase.from('app_users').delete().eq('id', u.id);
      if (error) throw error;
      setUsers(prev => prev.filter(x => x.id !== u.id));
      await logActivity({
        user, action: 'delete', table: 'app_users', recordId: u.id,
        description: `Xóa tài khoản "${u.username}"`, oldData: u,
      });
      toast('Đã xóa user');
    } catch (e) {
      toast('Lỗi: ' + errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="Admin" subtitle="Yêu cầu quyền · Quản lý tài khoản · Ma trận phân quyền" />
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="flex gap-2">
          {([
            { key: 'requests', label: 'Yêu cầu quyền truy cập' },
            { key: 'accounts', label: 'Quản lý tài khoản' },
            { key: 'matrix', label: 'Ma trận phân quyền' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition ${tab === t.key ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB 1: Permission requests */}
        {tab === 'requests' && (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2]">
              <span className="text-[12.5px] font-semibold text-[#111]">Yêu cầu quyền truy cập</span>
              <select value={reqFilter} onChange={e => setReqFilter(e.target.value as 'pending' | 'all')}
                className="text-[12px] px-2 py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                <option value="pending">Chờ duyệt</option>
                <option value="all">Tất cả</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#E8E7E2]">
                    {['Người yêu cầu', 'Vai trò', 'Module', 'Hành động', 'Lý do', 'Trạng thái', 'Thời gian', ''].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingReq ? (
                    <tr><td colSpan={8} className="text-center py-8 text-[#aaa]">Đang tải...</td></tr>
                  ) : requests.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-10 text-[#aaa]"><Inbox className="w-6 h-6 mx-auto mb-1.5 opacity-40" />Không có yêu cầu nào</td></tr>
                  ) : requests.map(r => {
                    const st = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
                    return (
                      <tr key={r.id} className="border-b border-[#F0EEE9] last:border-0 align-top">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-[#111]">{r.requester_name || '—'}</div>
                          <div className="text-[11px] text-[#888]">{r.requester_email}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[#555]">{r.requester_role ? (ROLE_LABELS[r.requester_role] || r.requester_role) : '—'}</td>
                        <td className="px-3 py-2.5 font-medium text-[#111]">{r.module}</td>
                        <td className="px-3 py-2.5">{ACTION_LABELS[r.action_requested] || r.action_requested}</td>
                        <td className="px-3 py-2.5 text-[#555] max-w-[220px]">{r.reason || '—'}</td>
                        <td className="px-3 py-2.5"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{st.label}</span></td>
                        <td className="px-3 py-2.5 text-[#888] whitespace-nowrap">{new Date(r.created_at).toLocaleString('vi-VN')}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {r.status === 'pending' ? (
                            <div className="flex gap-1.5">
                              <button onClick={() => handleReview(r, true)} disabled={processingId === r.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11.5px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50">
                                <Check className="w-3 h-3" /> Duyệt
                              </button>
                              <button onClick={() => handleReview(r, false)} disabled={processingId === r.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11.5px] font-medium bg-red-50 text-red-700 hover:bg-red-100 transition disabled:opacity-50">
                                <X className="w-3 h-3" /> Từ chối
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-[#aaa]">{r.reviewed_by ? `Bởi ${r.reviewed_by}` : '—'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: Account management */}
        {tab === 'accounts' && (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E8E7E2]">
              <span className="text-[12.5px] font-semibold text-[#111]">Danh sách tài khoản ({users.length})</span>
              <button onClick={openAdd} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
                <Plus size={13} /> Thêm user
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#E8E7E2]">
                    {['Username', 'Họ & Tên', 'Email', 'Vai trò', 'Trạng thái', ''].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingUsers ? (
                    <tr><td colSpan={6} className="text-center py-8 text-[#aaa]">Đang tải...</td></tr>
                  ) : users.map(u => {
                    const active = u.is_active ?? true;
                    return (
                      <tr key={u.id} className="border-b border-[#F0EEE9] last:border-0">
                        <td className="px-3 py-2.5 font-mono text-[12px] font-semibold">{u.username}</td>
                        <td className="px-3 py-2.5 font-medium">{u.full_name}</td>
                        <td className="px-3 py-2.5 text-[#555]">{u.email || '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-600'}`}>
                            <Shield size={9} /> {ROLE_LABELS[u.role] || u.role}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                            {active ? 'Hoạt động' : 'Đã khóa'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(u)} className="p-1.5 rounded hover:bg-gray-100 text-[#888] transition" title="Sửa"><Pencil size={12} /></button>
                            <button onClick={() => handleToggleActive(u)} disabled={busyId === u.id} className="p-1.5 rounded hover:bg-gray-100 text-[#888] transition disabled:opacity-40" title={active ? 'Khóa tài khoản' : 'Mở khóa'}>
                              {active ? <Lock size={12} /> : <Unlock size={12} />}
                            </button>
                            <button onClick={() => handleDelete(u)} disabled={busyId === u.id} className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition disabled:opacity-40" title="Xóa"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Permission matrix (read-only overview) */}
        {tab === 'matrix' && (
          <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Ma trận phân quyền theo vai trò</div>
            <div className="px-4 pt-2.5 text-[11px] text-[#888]">✓ Toàn quyền &nbsp;·&nbsp; 👁 Chỉ xem &nbsp;·&nbsp; ✗ Không có quyền</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[#E8E7E2]">
                    <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] w-40">Module</th>
                    {Object.keys(MATRIX).map(r => (
                      <th key={r} className="text-center px-3 py-2 text-[11.5px] font-medium bg-[#F9F9F7]">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] ${ROLE_COLORS[r] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[r] || r}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map(mod => (
                    <tr key={mod} className="border-b border-[#F0EEE9] last:border-0">
                      <td className="px-3 py-2 text-[#555] font-medium">{mod}</td>
                      {Object.keys(MATRIX).map(role => {
                        const level = MATRIX[role][mod] || 'none';
                        return (
                          <td key={role} className="px-3 py-2 text-center">
                            {level === 'full' && <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100" title="Toàn quyền"><Check size={10} className="text-emerald-600" strokeWidth={3} /></span>}
                            {level === 'view' && <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-[11px]" title="Chỉ xem">👁</span>}
                            {level === 'none' && <span className="inline-block w-5 h-5 rounded-full bg-gray-50 border border-gray-100" title="Không có quyền" />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[12px] w-full max-w-sm p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#111]">{editUser ? 'Sửa user' : 'Thêm user mới'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={15} /></button>
            </div>
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-[#666]">Username *</label>
                <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="username" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-[#666]">Họ & Tên *</label>
                <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Nguyễn Văn A" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-[#666]">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@letsgo.vn" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-[#666]">{editUser ? 'Mật khẩu mới (để trống = giữ nguyên)' : 'Mật khẩu *'}</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-[#666]">Vai trò</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as AppUser['role'] }))} className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-[12px] font-medium text-gray-600 hover:bg-gray-50">Hủy</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-[#1D4ED8] text-white rounded-lg text-[12px] font-medium hover:bg-[#1E40AF] disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
