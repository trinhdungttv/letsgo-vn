// Tạo nhanh / bổ sung nhanh 1 người liên hệ ngay tại ô "Người liên hệ (CSKH)" — dùng ở form Thêm công ty
// (CRM Pipeline) và hồ sơ công ty. Ghi vào bảng contacts qua saveContact (cùng đường với CRM → CSKH:
// gắn công ty, ghi lịch sử, audit). Người còn thiếu chức vụ / SĐT / email / ngày sinh thì hiện
// ContactInfoWarning để nhắc bổ sung.
import { useId, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { saveContact, emptyContactForm, contactToForm, findPhoneDuplicates } from '../../lib/contactOps';
import { contactMissingInfo } from '../../lib/contactCompleteness';
import type { Contact } from '../../lib/types';

const INPUT = 'text-[12.5px] px-2.5 py-1.5 bg-white border border-gray-300 rounded-lg outline-none focus:border-blue-500';

export function QuickContactForm({ contact, clientId, companyName, roleOptions, onSaved, onClose }: {
  /** null = tạo mới; có = bổ sung thông tin cho người này. */
  contact: Contact | null;
  /** Khách hàng để gắn người mới vào; công ty chưa là khách thì để trống — người mới chưa gắn công ty. */
  clientId?: string | null;
  companyName?: string;
  /** Gợi ý chức vụ (các chức vụ đã dùng). */
  roleOptions: readonly string[];
  onSaved: (c: Contact) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const listId = useId();
  const [form, setForm] = useState({
    name: contact?.name ?? '', role: contact?.role ?? '', phone: contact?.phone ?? '',
    email: contact?.email ?? '', birthday: contact?.birthday ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const missing = contactMissingInfo(form);

  const submit = async () => {
    const name = form.name.trim();
    if (!name || saving) return;
    setSaving(true); setError(null);
    try {
      const phone = form.phone.trim();
      const phoneChanged = phone && phone !== (contact?.phone ?? '');
      const dups = phoneChanged ? await findPhoneDuplicates(phone, contact?.id) : [];
      if (dups.length && !confirm(
        `Số ${phone} đã có ở: ${dups.map(d => d.name + (d.role ? ` — ${d.role}` : '')).join(', ')}.\n\n` +
        (contact ? 'Vẫn lưu số này?' : 'Vẫn tạo người liên hệ mới? (Bấm Huỷ để quay lại chọn người đã có trong danh sách.)')
      )) return;
      const fields = { name, role: form.role.trim(), phone, email: form.email.trim(), birthday: form.birthday };
      const saved = await saveContact(
        contact ? { ...contactToForm(contact), ...fields } : { ...emptyContactForm(clientId ?? ''), ...fields },
        contact,
        { user, clientName: id => (id && id === clientId ? companyName ?? null : null) },
      );
      onSaved(saved);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-blue-800">{contact ? `Bổ sung thông tin — ${contact.name}` : 'Tạo người liên hệ mới'}</div>
        <button type="button" onClick={onClose} title="Đóng" className="p-0.5 rounded text-blue-400 hover:text-blue-700"><X size={13} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input autoFocus={!contact} value={form.name} onChange={set('name')}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } if (e.key === 'Escape') onClose(); }}
          placeholder="Họ tên *" className={INPUT} />
        <input value={form.role} onChange={set('role')} list={listId} placeholder="Chức vụ (VD: Nhân sự)" className={INPUT} />
        <input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="Số điện thoại" className={INPUT} />
        <input value={form.email} onChange={set('email')} type="email" placeholder="Email" className={INPUT} />
        <label className={`${INPUT} flex items-center gap-2 sm:col-span-2 cursor-text`}>
          <span className="shrink-0 text-[#999]">Ngày sinh</span>
          <input type="date" value={form.birthday} onChange={set('birthday')} className="flex-1 min-w-0 bg-transparent outline-none" />
        </label>
      </div>
      <datalist id={listId}>{roleOptions.map(r => <option key={r} value={r} />)}</datalist>
      <div className="text-[10.5px] text-blue-900/60 leading-snug">
        {contact
          ? 'Lưu vào danh sách liên hệ chung (CRM → CSKH). Sở thích, địa chỉ… bổ sung thêm ở CSKH.'
          : `Lưu vào danh sách liên hệ chung (CRM → CSKH)${clientId ? ' và gắn vào công ty này' : ''}, rồi chọn luôn ở ô trên.`}
        {missing.length > 0 && <> Còn thiếu {missing.join(', ')} — hệ thống sẽ nhắc bổ sung sau.</>}
      </div>
      {error && <div className="text-[11.5px] text-red-600">Lỗi: {error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px] border border-gray-300 bg-white text-[#666] hover:bg-gray-50">Huỷ</button>
        <button type="button" onClick={() => void submit()} disabled={saving || !form.name.trim()}
          className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
          {saving ? 'Đang lưu…' : contact ? 'Lưu' : 'Tạo & chọn'}
        </button>
      </div>
    </div>
  );
}

/** Nhắc bổ sung thông tin người liên hệ đang chọn (ẩn khi đã đủ). */
export function ContactInfoWarning({ contact, onFix }: { contact: Contact | null | undefined; onFix: () => void }) {
  if (!contact) return null;
  const missing = contactMissingInfo(contact);
  if (!missing.length) return null;
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-800">
      <AlertTriangle size={12} className="shrink-0 mt-[2px]" />
      <span className="flex-1 min-w-0">
        <b className="font-semibold">{contact.name}</b> còn thiếu {missing.join(', ')}.{' '}
        <button type="button" onClick={onFix} className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950">Bổ sung ngay</button>
      </span>
    </div>
  );
}
