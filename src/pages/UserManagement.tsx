import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Shield, Check } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import type { AppUser } from '../lib/types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { ROLE_LABELS, ROLE_COLORS } from '../lib/constants';

interface UserManagementProps {
  toast: (msg: string) => void;
}

interface UserRow extends AppUser {
  password?: string;
}

const ROLE_PAGES: Record<string, string[]> = {
  admin: ['Dashboard', 'Khách hàng', 'Tài chính', 'CSKH', 'Thị trường', 'Báo giá', 'CRM Pipeline', 'Báo cáo', 'Quản lý Users'],
  ketoan: ['Dashboard', 'Khách hàng', 'Tài chính', 'Báo cáo'],
  kinhdoanh: ['Dashboard', 'Khách hàng', 'CSKH', 'Thị trường', 'Báo giá', 'CRM Pipeline', 'Báo cáo'],
  bdh: ['Dashboard', 'Khách hàng', 'Tài chính', 'Báo cáo'],
};

const ALL_PAGES = ['Dashboard', 'Khách hàng', 'Tài chính', 'CSKH', 'Thị trường', 'Báo giá', 'CRM Pipeline', 'Báo cáo', 'Quản lý Users'];

const emptyForm = { username: '', full_name: '', password: '', role: 'kinhdoanh' as AppUser['role'] };

export default function UserManagement({ toast }: UserManagementProps) {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('app_users').select('id, username, full_name, role').order('created_at');
    if (error) { toast('Lỗi tải users: ' + error.message); }
    else setUsers(data || []);
    setLoading(false);
  };

  const openAdd = () => {
    setEditUser(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (u: UserRow) => {
    setEditUser(u);
    setForm({ username: u.username, full_name: u.full_name, password: '', role: u.role });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.username || !form.full_name) { toast('Nhập username và họ tên'); return; }
    if (!editUser && !form.password) { toast('Nhập mật khẩu'); return; }
    setSaving(true);
    try {
      if (editUser) {
        const update: Record<string, string> = { username: form.username, full_name: form.full_name, role: form.role };
        if (form.password) update.password = form.password;
        const { error } = await supabase.from('app_users').update(update).eq('id', editUser.id);
        if (error) throw error;
        toast('Đã cập nhật user!');
        await logActivity({
          user, action: 'update', table: 'app_users', recordId: editUser.id,
          description: `Cập nhật tài khoản "${form.username}"`,
          oldData: editUser, newData: { ...editUser, ...update },
        });
      } else {
        const { data, error } = await supabase.from('app_users').insert({ username: form.username, full_name: form.full_name, password: form.password, role: form.role }).select().single();
        if (error) throw error;
        toast('Đã tạo user mới!');
        await logActivity({
          user, action: 'insert', table: 'app_users', recordId: data.id,
          description: `Tạo tài khoản mới "${form.username}"`,
          newData: data,
        });
      }
      await fetchUsers();
      setShowModal(false);
    } catch (e: any) { toast('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`Xóa user "${username}"?`)) return;
    setDeletingId(id);
    const oldUser = users.find(u => u.id === id);
    const { error } = await supabase.from('app_users').delete().eq('id', id);
    if (error) toast('Lỗi xóa: ' + error.message);
    else {
      toast('Đã xóa user');
      setUsers(prev => prev.filter(u => u.id !== id));
      await logActivity({
        user, action: 'delete', table: 'app_users', recordId: id,
        description: `Xóa tài khoản "${username}"`,
        oldData: oldUser,
      });
    }
    setDeletingId(null);
  };

  return (
    <>
      <PageHeader title="Quản lý Users" subtitle="Tài khoản · Vai trò · Phân quyền" actions={
        <button onClick={openAdd} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
          <Plus size={13} /> Thêm user
        </button>
      } />

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Users table */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">
            Danh sách tài khoản ({users.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#E8E7E2]">
                  {['Username', 'Họ & Tên', 'Vai trò', 'Phân quyền', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-8 text-[#aaa]">Đang tải...</td></tr>
                ) : users.map(u => (
                  <tr key={u.id} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2.5 font-mono text-[12px] font-semibold">{u.username}</td>
                    <td className="px-3 py-2.5 font-medium">{u.full_name}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-600'}`}>
                        <Shield size={9} /> {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(ROLE_PAGES[u.role] || []).map(p => (
                          <span key={p} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">{p}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(u)} className="p-1.5 rounded hover:bg-gray-100 text-[#888] transition"><Pencil size={12} /></button>
                        <button onClick={() => handleDelete(u.id, u.username)} disabled={deletingId === u.id} className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition disabled:opacity-40"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Permissions matrix */}
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E8E7E2] text-[12.5px] font-semibold text-[#111]">Ma trận phân quyền</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#E8E7E2]">
                  <th className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] w-40">Tính năng</th>
                  {Object.keys(ROLE_PAGES).map(r => (
                    <th key={r} className="text-center px-3 py-2 text-[11.5px] font-medium bg-[#F9F9F7]">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] ${ROLE_COLORS[r] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[r] || r}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_PAGES.map(page => (
                  <tr key={page} className="border-b border-[#F0EEE9] last:border-0">
                    <td className="px-3 py-2 text-[#555] font-medium">{page}</td>
                    {Object.keys(ROLE_PAGES).map(role => {
                      const has = (ROLE_PAGES[role] || []).includes(page);
                      return (
                        <td key={role} className="px-3 py-2 text-center">
                          {has
                            ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100"><Check size={10} className="text-emerald-600" strokeWidth={3} /></span>
                            : <span className="inline-block w-5 h-5 rounded-full bg-gray-50 border border-gray-100" />
                          }
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
                <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="admin" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] font-medium text-[#666]">Họ & Tên *</label>
                <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Nguyễn Văn A" className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500" />
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
              {form.role && (
                <div className="p-2.5 bg-[#F9F9F7] rounded-lg">
                  <div className="text-[11px] text-[#888] mb-1.5">Quyền truy cập:</div>
                  <div className="flex flex-wrap gap-1">
                    {(ROLE_PAGES[form.role] || []).map(p => (
                      <span key={p} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10.5px]">{p}</span>
                    ))}
                  </div>
                </div>
              )}
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
