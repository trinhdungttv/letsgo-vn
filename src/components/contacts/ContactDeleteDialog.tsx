// ============================================================================
// ContactDeleteDialog — xoá liên hệ, 2 mức:
//   • Đánh dấu đã nghỉ (mặc định, an toàn): giữ bản ghi + toàn bộ lịch sử.
//   • Xoá vĩnh viễn (chỉ admin): xoá khỏi bảng contacts, có liệt kê ràng buộc.
// ============================================================================
import { useState, useEffect } from 'react';
import { AlertTriangle, UserX, Trash2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import type { Client, Contact } from '../../lib/types';
import {
  getContactUsage, deleteContact, deactivateContact, clientIdsOf,
  type ContactUsage,
} from '../../lib/contactOps';

interface Props {
  contact: Contact;
  clients: Client[];
  onClose: () => void;
  /** Gọi sau khi xoá vĩnh viễn hoặc đánh dấu nghỉ xong. */
  onDone: (action: 'deleted' | 'deactivated') => void;
  toast: (m: string) => void;
}

export default function ContactDeleteDialog({ contact, clients, onClose, onDone, toast }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [usage, setUsage] = useState<ContactUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => { getContactUsage(contact).then(setUsage); }, [contact]);

  const clientName = (id: string | null) => (id ? clients.find(c => c.id === id)?.name || null : null);
  const ctx = { user, clientName };

  const handleDeactivate = async () => {
    setBusy(true);
    try {
      await deactivateContact(contact, ctx);
      toast(`Đã đánh dấu "${contact.name}" nghỉ`);
      onDone('deactivated');
      onClose();
    } catch (e: any) { toast('Lỗi: ' + e.message); } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteContact(contact, ctx);
      toast(`Đã xoá vĩnh viễn "${contact.name}"`);
      onDone('deleted');
      onClose();
    } catch (e: any) { toast('Lỗi: ' + e.message); } finally { setBusy(false); }
  };

  const refs: { label: string; n: number }[] = usage ? [
    { label: 'hồ sơ chăm sóc / pipeline', n: usage.pipeline },
    { label: 'thương vụ (deal)', n: usage.deals },
    { label: 'quà tặng CRM', n: usage.crmGifts },
    { label: 'quà tặng khách hàng', n: usage.clientGifts },
  ].filter(r => r.n > 0) : [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-[15px] font-semibold text-gray-900">Xoá liên hệ</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-4 h-4 text-gray-500" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="text-[13px] text-gray-700">
            <b>{contact.name}</b>
            {contact.role ? ` — ${contact.role}` : ''}
            {clientIdsOf(contact).length
              ? ` @ ${clientIdsOf(contact).map(id => clientName(id)).filter(Boolean).join(', ')}`
              : ' (chưa gắn công ty)'}
          </div>

          {/* Lựa chọn 1 — an toàn */}
          {contact.is_active && (
            <button onClick={handleDeactivate} disabled={busy}
              className="w-full text-left border border-emerald-200 bg-emerald-50 rounded-lg p-3 hover:bg-emerald-100 transition disabled:opacity-50">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-800">
                <UserX className="w-4 h-4" /> Đánh dấu đã nghỉ <span className="text-[11px] font-normal">(khuyến nghị)</span>
              </div>
              <p className="text-[11.5px] text-emerald-700 mt-1">
                Giữ nguyên bản ghi và toàn bộ lịch sử chăm sóc, quà tặng. Chỉ đóng mốc thời gian
                phụ trách và ẩn khỏi danh sách đang hoạt động. Mở lại được bất cứ lúc nào.
              </p>
            </button>
          )}

          {/* Lựa chọn 2 — xoá thật */}
          <div className="border border-red-200 rounded-lg p-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-red-700">
              <Trash2 className="w-4 h-4" /> Xoá vĩnh viễn
            </div>

            {usage === null ? (
              <p className="text-[11.5px] text-gray-500 mt-1.5">Đang kiểm tra ràng buộc...</p>
            ) : (
              <>
                {usage.primaryCount > 0 && (
                  <div className="flex items-start gap-1.5 mt-2 text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Đây đang là <b>liên hệ chính</b> của {usage.primaryCount} công ty — xoá xong
                      {usage.primaryCount > 1 ? ' các công ty đó' : ' công ty đó'} sẽ không còn liên hệ chính.
                    </span>
                  </div>
                )}
                {refs.length > 0 ? (
                  <div className="mt-2 text-[11.5px] text-red-700">
                    Đang được tham chiếu ở:
                    <ul className="mt-0.5 space-y-0.5">
                      {refs.map(r => <li key={r.label}>• {r.n} {r.label}</li>)}
                    </ul>
                    <p className="mt-1.5 text-gray-600">
                      Các bản ghi đó <b>không bị xoá</b>, nhưng sẽ mất tên người liên hệ / người nhận.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11.5px] text-gray-600 mt-1.5">Không có bản ghi nào đang tham chiếu tới liên hệ này.</p>
                )}

                <p className="text-[11px] text-gray-500 mt-2">
                  Vẫn khôi phục được: bản ghi cũ nằm trong <b>Lịch sử</b> (nút Hoàn tác) và trong sao lưu tự động.
                </p>

                {!isAdmin ? (
                  <p className="text-[11.5px] text-gray-500 mt-2 italic">Chỉ quản trị viên mới xoá vĩnh viễn được.</p>
                ) : (
                  <div className="mt-2.5">
                    <label className="block text-[11.5px] text-gray-600 mb-1">
                      Gõ <b>XOA</b> để xác nhận:
                    </label>
                    <div className="flex gap-2">
                      <input value={confirmText} onChange={e => setConfirmText(e.target.value)}
                        placeholder="XOA"
                        className="flex-1 px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-lg outline-none focus:border-red-500" />
                      <button onClick={handleDelete} disabled={busy || confirmText.trim().toUpperCase() !== 'XOA'}
                        className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[12.5px] font-medium hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition">
                        {busy ? 'Đang xoá...' : 'Xoá vĩnh viễn'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-300 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50">Đóng</button>
        </div>
      </div>
    </div>
  );
}
