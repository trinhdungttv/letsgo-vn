// ============================================================================
// RoleSelect — ô chọn chức vụ + bảng quản lý danh mục ngay tại chỗ.
// Danh mục nằm ở bảng `contact_roles`; `contacts.role` vẫn là chữ tự do nên xoá
// một chức vụ khỏi danh mục không làm mất chức vụ đã ghi trên hồ sơ người nào.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { Settings2, Plus, Check, X, Pencil, Trash2 } from 'lucide-react';
import {
  fetchContactRoles, addContactRole, renameContactRole,
  deleteContactRole, countContactsWithRole,
  type ContactRole,
} from '../../lib/contactRoles';

interface Props {
  value: string;
  onChange: (v: string) => void;
  toast: (m: string) => void;
  className?: string;
}

export default function RoleSelect({ value, onChange, toast, className }: Props) {
  const [roles, setRoles] = useState<ContactRole[]>([]);
  const [managing, setManaging] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { fetchContactRoles().then(setRoles); }, []);
  useEffect(() => { load(); }, [load]);

  // Chức vụ đang ghi trên hồ sơ nhưng đã bị xoá khỏi danh mục vẫn phải hiện ra,
  // nếu không ô chọn sẽ nhảy về rỗng và âm thầm ghi đè dữ liệu cũ khi lưu.
  const orphan = value && !roles.some(r => r.name === value) ? value : null;

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    const err = await addContactRole(name);
    setBusy(false);
    if (err) { toast(err); return; }
    setNewName('');
    load();
    onChange(name);
    toast(`Đã thêm chức vụ "${name}"`);
  };

  const handleRename = async (r: ContactRole) => {
    const name = editName.trim();
    if (!name || name === r.name) { setEditId(null); return; }
    setBusy(true);
    const err = await renameContactRole(r.id, r.name, name);
    setBusy(false);
    if (err) { toast(err); return; }
    setEditId(null);
    load();
    if (value === r.name) onChange(name);
    toast(`Đã đổi "${r.name}" thành "${name}"`);
  };

  const handleDelete = async (r: ContactRole) => {
    const used = await countContactsWithRole(r.name);
    const warn = used > 0
      ? `\n\n${used} người liên hệ đang mang chức vụ này. Hồ sơ của họ KHÔNG bị đổi — chỉ mất lựa chọn này trong ô chọn.`
      : '';
    if (!confirm(`Xoá chức vụ "${r.name}" khỏi danh mục?${warn}`)) return;
    setBusy(true);
    const err = await deleteContactRole(r.id);
    setBusy(false);
    if (err) { toast('Lỗi: ' + err); return; }
    load();
    toast(`Đã xoá chức vụ "${r.name}"`);
  };

  const field = className || 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <select value={value} onChange={e => onChange(e.target.value)} className={`${field} flex-1`}>
          <option value="">— Chọn chức vụ —</option>
          {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
          {orphan && <option value={orphan}>{orphan} (ngoài danh mục)</option>}
        </select>
        <button type="button" onClick={() => setManaging(m => !m)}
          title="Thêm / sửa / xoá chức vụ"
          className={`p-2 rounded-lg border transition shrink-0 ${
            managing ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
          }`}>
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {managing && (
        <div className="mt-2 border border-gray-200 rounded-lg bg-gray-50 p-2.5">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Danh mục chức vụ</div>

          <div className="flex gap-1.5 mb-2">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
              placeholder="Tên chức vụ mới…"
              className="flex-1 px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white" />
            <button type="button" onClick={handleAdd} disabled={busy || !newName.trim()}
              className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-[12px] font-medium hover:bg-blue-700 disabled:bg-gray-300 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Thêm
            </button>
          </div>

          <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
            {roles.length === 0 && <li className="px-2.5 py-2 text-[12px] text-gray-400">Chưa có chức vụ nào</li>}
            {roles.map(r => (
              <li key={r.id} className="flex items-center gap-1.5 px-2.5 py-1.5">
                {editId === r.id ? (
                  <>
                    <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); handleRename(r); }
                        if (e.key === 'Escape') setEditId(null);
                      }}
                      className="flex-1 px-2 py-1 text-[13px] border border-blue-400 rounded outline-none" />
                    <button type="button" onClick={() => handleRename(r)} disabled={busy}
                      className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700"><Check className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => setEditId(null)}
                      className="p-1 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-[13px] text-gray-800">{r.name}</span>
                    <button type="button" onClick={() => { setEditId(r.id); setEditName(r.name); }}
                      title="Đổi tên" className="p-1 text-gray-400 hover:text-blue-600">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => handleDelete(r)} disabled={busy}
                      title="Xoá khỏi danh mục" className="p-1 text-gray-400 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[10.5px] text-gray-500 mt-1.5">
            Đổi tên sẽ cập nhật luôn hồ sơ của những người đang giữ chức vụ đó. Xoá chỉ bỏ khỏi ô chọn,
            hồ sơ đã ghi vẫn giữ nguyên.
          </p>
        </div>
      )}
    </div>
  );
}
