import { useState, useEffect } from 'react';
import { Plus, Edit2, UserX, Users, Star } from 'lucide-react';
import type { Contact } from '../lib/types';
import { useContacts } from '../hooks/useContacts';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import { supabase } from '../lib/supabase';

const ROLES = ['HR Manager', 'Giám đốc', 'Kế toán', 'Khác'];

interface FormState {
  name: string;
  phone: string;
  email: string;
  role: string;
  start_date: string;
  is_active: boolean;
  notes: string;
}

const emptyForm = (): FormState => ({
  name: '',
  phone: '',
  email: '',
  role: 'HR Manager',
  start_date: new Date().toISOString().slice(0, 10),
  is_active: true,
  notes: '',
});

interface Props {
  clientId: string;
  toast: (msg: string) => void;
}

export default function ContactsTab({ clientId, toast }: Props) {
  const { user } = useAuth();
  const { contacts, loading, addContact, updateContact, markInactive, setPrimary, reload } = useContacts(clientId);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [unlinkedContacts, setUnlinkedContacts] = useState<Contact[]>([]);
  const [linkContactIds, setLinkContactIds] = useState<string[]>([]);

  useEffect(() => {
    if (!showModal || editingId) return;
    supabase.from('contacts').select('*').is('client_id', null).order('name')
      .then(({ data }) => setUnlinkedContacts((data || []) as Contact[]));
  }, [showModal, editingId]);

  const toggleLinkContact = (id: string) => {
    setLinkContactIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setLinkContactIds([]);
    setShowModal(true);
  };

  const openEdit = (c: Contact) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      role: c.role || 'Khác',
      start_date: c.start_date || '',
      is_active: c.is_active,
      notes: c.notes || '',
    });
    setShowModal(true);
  };

  const handleLinkExisting = async () => {
    setSaving(true);
    try {
      for (const id of linkContactIds) {
        const linked = unlinkedContacts.find(c => c.id === id);
        if (!linked) continue;
        const updated = await updateContact(id, { client_id: clientId });
        await logActivity({
          user, action: 'update', table: 'contacts', recordId: id,
          description: `Gắn liên hệ CSKH "${linked.name}" vào công ty hiện tại`,
          oldData: linked, newData: updated,
        });
      }
      toast(`Đã gắn ${linkContactIds.length} người liên hệ vào công ty này`);
      await reload();
      setShowModal(false);
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editingId && linkContactIds.length > 0) return handleLinkExisting();
    if (!form.name.trim()) { toast('Vui lòng nhập họ tên'); return; }
    setSaving(true);
    try {
      const payload = {
        client_id: clientId,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        role: form.role || null,
        start_date: form.start_date || null,
        end_date: null as string | null,
        is_active: form.is_active,
        is_primary: editingId ? contacts.find(c => c.id === editingId)?.is_primary || false : false,
        notes: form.notes.trim() || null,
      };
      if (editingId) {
        const oldContact = contacts.find(c => c.id === editingId);
        const updated = await updateContact(editingId, payload);
        toast('Đã cập nhật người liên hệ');
        await logActivity({
          user, action: 'update', table: 'contacts', recordId: editingId,
          description: `Cập nhật người liên hệ "${payload.name}"`,
          oldData: oldContact, newData: updated,
        });
      } else {
        const created = await addContact(payload);
        toast('Đã thêm người liên hệ');
        await logActivity({
          user, action: 'insert', table: 'contacts', recordId: created.id,
          description: `Thêm người liên hệ "${payload.name}"`,
          newData: created,
        });
      }
      setShowModal(false);
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async (c: Contact) => {
    try {
      await setPrimary(c.id);
      toast(`Đã đặt "${c.name}" làm người liên hệ chính`);
      await logActivity({
        user, action: 'update', table: 'contacts', recordId: c.id,
        description: `Đặt "${c.name}" làm người liên hệ chính cho công ty`,
        oldData: c, newData: { ...c, is_primary: true },
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const handleMarkInactive = async (c: Contact) => {
    if (!confirm(`Đánh dấu "${c.name}" đã nghỉ?`)) return;
    try {
      await markInactive(c.id);
      toast(`Đã đánh dấu "${c.name}" nghỉ việc`);
      await logActivity({
        user, action: 'update', table: 'contacts', recordId: c.id,
        description: `Đánh dấu người liên hệ "${c.name}" đã nghỉ`,
        oldData: c, newData: { ...c, is_active: false, end_date: new Date().toISOString().slice(0, 10) },
      });
    } catch (e: any) {
      toast('Lỗi: ' + e.message);
    }
  };

  const fmt = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[13px] text-[#999]">
        Đang tải...
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12.5px] font-semibold text-[#111]">
          Người liên hệ ({contacts.filter(c => c.is_active).length} đang phụ trách)
        </span>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"
        >
          <Plus size={13} /> Thêm người liên hệ
        </button>
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 border border-dashed border-[#E8E7E2] rounded-[10px] gap-3">
          <Users size={28} className="text-[#ccc]" />
          <p className="text-[13px] text-[#888]">Chưa có người liên hệ.</p>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"
          >
            <Plus size={13} /> Thêm ngay
          </button>
        </div>
      ) : (
        <div className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-[#E8E7E2]">
                  {['', 'Họ tên', 'SĐT', 'Email', 'Vai trò', 'Từ ngày', 'Trạng thái', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id} className={`border-b border-[#F0EEE9] hover:bg-[#FAFAF8] transition ${!c.is_active ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => handleSetPrimary(c)}
                        title={c.is_primary ? 'Người liên hệ chính' : 'Đặt làm người liên hệ chính'}
                        className="inline-flex"
                      >
                        <Star size={14} className={c.is_primary ? 'text-amber-500 fill-amber-500' : 'text-gray-300 hover:text-amber-400'} />
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-[#111]">
                      {c.name}
                      {c.is_primary && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">Liên hệ chính</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#555]">{c.phone || '—'}</td>
                    <td className="px-3 py-2.5 text-[#555]">{c.email || '—'}</td>
                    <td className="px-3 py-2.5 text-[#555]">{c.role || '—'}</td>
                    <td className="px-3 py-2.5 text-[#555] whitespace-nowrap">{fmt(c.start_date)}</td>
                    <td className="px-3 py-2.5">
                      {c.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                          Đang phụ trách
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
                          Đã nghỉ {c.end_date ? `· ${fmt(c.end_date)}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEdit(c)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
                        >
                          <Edit2 size={11} /> Sửa
                        </button>
                        {c.is_active && (
                          <button
                            onClick={() => handleMarkInactive(c)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-red-200 text-red-600 hover:bg-red-50 transition"
                          >
                            <UserX size={11} /> Đánh dấu nghỉ
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[12px] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E7E2]">
              <h3 className="text-[14px] font-semibold text-[#111]">
                {editingId ? 'Chỉnh sửa người liên hệ' : 'Thêm người liên hệ'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-[#aaa] hover:text-[#555] transition text-lg leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              {!editingId && unlinkedContacts.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Chọn người có sẵn trong CSKH (chưa gắn công ty) — có thể chọn nhiều</label>
                  <div className="border border-gray-300 rounded-lg divide-y divide-gray-100 max-h-36 overflow-y-auto">
                    {unlinkedContacts.map(c => (
                      <label key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] cursor-pointer hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={linkContactIds.includes(c.id)}
                          onChange={() => toggleLinkContact(c.id)}
                          className="accent-blue-600"
                        />
                        <span>{c.name}{c.phone ? ` - ${c.phone}` : ''}{c.role ? ` (${c.role})` : ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className={`space-y-3 ${linkContactIds.length > 0 ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Họ tên <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Nguyễn Văn A"
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Số điện thoại</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="0909..."
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="hr@company.com"
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Vai trò</label>
                  <select
                    value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value })}
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                  >
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[12px] text-[#666] font-medium">Từ ngày</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={e => setForm({ ...form, start_date: e.target.value })}
                    className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[12px] text-[#666] font-medium">Ghi chú</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Thông tin thêm..."
                  className="text-[13px] px-2.5 py-1.5 rounded-lg border border-gray-300 outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-[12.5px] text-[#555] font-medium">
                  {form.is_active ? 'Đang phụ trách' : 'Đã nghỉ'}
                </span>
              </div>
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 rounded-lg text-[13px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] disabled:opacity-50 transition"
              >
                {saving ? 'Đang lưu...' : (linkContactIds.length > 0 ? `Gắn ${linkContactIds.length} người` : 'Lưu')}
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 rounded-lg text-[13px] font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
