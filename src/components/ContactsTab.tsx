// ============================================================================
// ContactsTab — khối "Người liên hệ" trong Hồ sơ chăm sóc của một công ty.
// Cùng bảng `contacts` và cùng logic (lib/contactOps) với CRM → CSKH →
// Danh sách liên hệ, chỉ khác là ở đây công ty được gắn sẵn.
// ============================================================================
import { useState, useEffect } from 'react';
import { Plus, Edit2, UserX, UserCheck, Users, Star, Trash2, ExternalLink } from 'lucide-react';
import type { Client, Contact } from '../lib/types';
import { useContacts } from '../hooks/useContacts';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import ContactFormModal from './contacts/ContactFormModal';
import ContactDeleteDialog from './contacts/ContactDeleteDialog';
import {
  setPrimaryContact, unsetPrimaryContact,
  deactivateContact, reactivateContact,
} from '../lib/contactOps';

interface Props {
  clientId: string;
  toast: (msg: string) => void;
  /** Báo lên trang cha khi danh sách liên hệ đổi, để các ô chọn khác nạp lại. */
  onChanged?: () => void;
}

export default function ContactsTab({ clientId, toast, onChanged }: Props) {
  const { user } = useAuth();
  const { contacts, loading, reload } = useContacts(clientId);
  const [clients, setClients] = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  // Cần danh sách công ty để form cho phép chuyển người này sang công ty khác.
  useEffect(() => {
    supabase.from('clients').select('id, name').order('name')
      .then(({ data }) => setClients((data || []) as Client[]));
  }, []);

  const clientName = (id: string | null) => (id ? clients.find(c => c.id === id)?.name || null : null);
  const ctx = { user, clientName };

  const openAdd = () => { setEditing(null); setShowForm(true); };
  const openEdit = (c: Contact) => { setEditing(c); setShowForm(true); };

  const handleTogglePrimary = async (c: Contact) => {
    if (!c.is_active) { toast('Người đã nghỉ không thể là liên hệ chính'); return; }
    try {
      if (c.is_primary) await unsetPrimaryContact(c, ctx);
      else await setPrimaryContact(c, ctx);
      await reload();
      onChanged?.();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const handleToggleActive = async (c: Contact) => {
    try {
      if (c.is_active) {
        if (!confirm(`Đánh dấu "${c.name}" đã nghỉ? Bản ghi và toàn bộ lịch sử vẫn được giữ nguyên.`)) return;
        await deactivateContact(c, ctx);
        toast(`Đã đánh dấu "${c.name}" nghỉ việc`);
      } else {
        await reactivateContact(c, ctx);
        toast(`Đã mở lại "${c.name}"`);
      }
      await reload();
      onChanged?.();
    } catch (e: any) { toast('Lỗi: ' + e.message); }
  };

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-[13px] text-[#999]">Đang tải...</div>;
  }

  const activeCount = contacts.filter(c => c.is_active).length;
  const hasPrimary = contacts.some(c => c.is_primary);

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12.5px] font-semibold text-[#111]">
          Người liên hệ ({activeCount} đang phụ trách)
        </span>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition"
        >
          <Plus size={13} /> Thêm người liên hệ
        </button>
      </div>

      {activeCount > 0 && !hasPrimary && (
        <div className="mb-2.5 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Công ty này chưa có <b>liên hệ chính</b> — bấm ngôi sao ★ ở đầu dòng để chọn.
        </div>
      )}

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
                  {['', 'Họ tên', 'SĐT', 'Email', 'Vai trò', 'Từ ngày', 'Trạng thái', ''].map((h, i) => (
                    <th key={i} className="text-left px-3 py-2 text-[11.5px] text-[#888] font-medium bg-[#F9F9F7] whitespace-nowrap">
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
                        onClick={() => handleTogglePrimary(c)}
                        title={c.is_primary ? 'Liên hệ chính — bấm để bỏ' : 'Đặt làm liên hệ chính'}
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
                      {c.social_link && (
                        <a href={c.social_link} target="_blank" rel="noopener noreferrer"
                          className="ml-1.5 inline-flex text-blue-500 hover:text-blue-700 align-middle" title="Mở Facebook / LinkedIn">
                          <ExternalLink size={11} />
                        </a>
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
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500 whitespace-nowrap">
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
                        <button
                          onClick={() => handleToggleActive(c)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition ${
                            c.is_active
                              ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                              : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {c.is_active ? <><UserX size={11} /> Đánh dấu nghỉ</> : <><UserCheck size={11} /> Mở lại</>}
                        </button>
                        <button
                          onClick={() => setDeleting(c)}
                          title="Xoá liên hệ"
                          className="inline-flex items-center px-2 py-1 rounded text-[11px] font-medium border border-red-200 text-red-600 hover:bg-red-50 transition"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <ContactFormModal
          contact={editing}
          defaultClientId={clientId}
          clients={clients}
          allowPickExisting
          onClose={() => setShowForm(false)}
          onSaved={() => { reload(); onChanged?.(); }}
          toast={toast}
        />
      )}

      {deleting && (
        <ContactDeleteDialog
          contact={deleting}
          clients={clients}
          onClose={() => setDeleting(null)}
          onDone={() => { reload(); onChanged?.(); }}
          toast={toast}
        />
      )}
    </>
  );
}
