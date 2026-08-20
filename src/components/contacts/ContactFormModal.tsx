// ============================================================================
// ContactFormModal — form DUY NHẤT để thêm/sửa người liên hệ.
// Dùng chung cho CSKH → Danh sách liên hệ và Khách hàng → Người liên hệ, nên
// nhập ở đâu cũng ra cùng một bộ dữ liệu. Mọi ghi xuống DB đi qua contactOps.
// ============================================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { X, AlertTriangle, History, MapPin, ExternalLink, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import type { Client, Contact, ContactClientHistory } from '../../lib/types';
import { parseLatLngFromLink } from '../../lib/geo';
import RoleSelect from './RoleSelect';
import AvatarUpload from './AvatarUpload';
import SpecialDatesEditor, { type SpecialDateDraft } from './SpecialDatesEditor';
import { fetchSpecialDates, saveSpecialDates } from '../../lib/contactSpecialDates';
import {
  CONTACT_CHANNELS, emptyContactForm, contactToForm,
  saveContact, findPhoneDuplicates,
  type ContactFormValues,
} from '../../lib/contactOps';

const RICH_COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#0891b2', '#ec4899'];

// ── Rich Text Editor ────────────────────────────────────────────────────────
export function RichTextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastValue = useRef(value);

  useEffect(() => {
    const clean = DOMPurify.sanitize(value);
    if (ref.current && lastValue.current !== value && ref.current.innerHTML !== clean) {
      ref.current.innerHTML = clean;
      lastValue.current = value;
    }
  }, [value]);

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    ref.current?.focus();
  };

  const setSize = (px: number) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = px + 'px';
    span.appendChild(range.extractContents());
    range.insertNode(span);
    sel.removeAllRanges();
    onChange(ref.current?.innerHTML || '');
  };

  const handleInput = () => {
    const html = ref.current?.innerHTML || '';
    lastValue.current = html;
    onChange(html);
  };

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-wrap">
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('bold'); }} className="px-2 py-0.5 font-bold text-xs hover:bg-gray-200 rounded transition">B</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('italic'); }} className="px-2 py-0.5 italic text-xs hover:bg-gray-200 rounded transition">I</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('underline'); }} className="px-2 py-0.5 underline text-xs hover:bg-gray-200 rounded transition">U</button>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        {[12, 14, 16, 18, 20].map(s => (
          <button key={s} type="button" onMouseDown={e => { e.preventDefault(); setSize(s); }} className="px-1.5 py-0.5 text-[10px] hover:bg-gray-200 rounded transition">{s}</button>
        ))}
        <span className="w-px h-4 bg-gray-300 mx-1" />
        {RICH_COLORS.map(color => (
          <button key={color} type="button" onMouseDown={e => { e.preventDefault(); exec('foreColor', color); }}
            className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0" style={{ backgroundColor: color }} />
        ))}
      </div>
      <div ref={ref} contentEditable onInput={handleInput}
        className="min-h-[100px] px-3 py-2 text-sm focus:outline-none" suppressContentEditableWarning />
    </div>
  );
}

// ── Tag Input ────────────────────────────────────────────────────────────────
export function TagInput({ tags, onChange }: { tags: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const t = input.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput('');
  };
  return (
    <div className="border border-gray-300 rounded-lg px-3 py-2 flex flex-wrap gap-1 min-h-[38px]">
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-0.5 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter(t => t !== tag))} className="ml-0.5 text-blue-400 hover:text-blue-700 leading-none">&times;</button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={tags.length === 0 ? 'Golf, Đọc sách... nhấn Enter' : ''}
        className="text-xs outline-none flex-1 min-w-[100px] bg-transparent"
      />
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
interface Props {
  /** null = thêm mới; Contact = chỉnh sửa. */
  contact: Contact | null;
  /** Công ty điền sẵn khi mở từ trang Khách hàng. */
  defaultClientId?: string;
  clients: Client[];
  onClose: () => void;
  onSaved: (c: Contact) => void;
  toast: (m: string) => void;
  /**
   * Khi mở từ trang Khách hàng: cho chọn nhanh một người đã có trong CSKH
   * (chưa gắn công ty) thay vì gõ lại từ đầu.
   */
  allowPickExisting?: boolean;
}

export default function ContactFormModal({
  contact, defaultClientId = '', clients, onClose, onSaved, toast, allowPickExisting,
}: Props) {
  const { user } = useAuth();
  const [form, setForm] = useState<ContactFormValues>(
    contact ? contactToForm(contact) : emptyContactForm(defaultClientId)
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<Contact[]>([]);
  const [dupeAck, setDupeAck] = useState(false);
  const [pool, setPool] = useState<Contact[]>([]);
  const [pickedId, setPickedId] = useState('');
  const [history, setHistory] = useState<ContactClientHistory[]>([]);
  const [specialDates, setSpecialDates] = useState<SpecialDateDraft[]>([]);

  const clientName = useCallback(
    (id: string | null) => (id ? clients.find(c => c.id === id)?.name || null : null),
    [clients]
  );

  // Danh sách người đã có trong CSKH nhưng chưa gắn công ty — để gắn vào công ty này.
  useEffect(() => {
    if (!allowPickExisting || contact) return;
    supabase.from('contacts').select('*, clients(name)').is('client_id', null).order('name')
      .then(({ data }) => setPool((data || []) as Contact[]));
  }, [allowPickExisting, contact]);

  // Lịch sử chuyển công ty của chính người này.
  useEffect(() => {
    if (!contact) { setHistory([]); return; }
    supabase.from('contact_client_history').select('*')
      .eq('contact_id', contact.id).order('changed_at', { ascending: false }).limit(20)
      .then(({ data }) => setHistory((data || []) as ContactClientHistory[]));
  }, [contact]);

  // Ngày đặc biệt đã lưu của người này (sinh nhật nằm riêng ở trường Ngày sinh).
  useEffect(() => {
    if (!contact) { setSpecialDates([]); return; }
    fetchSpecialDates(contact.id).then(rows => setSpecialDates(rows.map(r => ({ id: r.id, label: r.label, date: r.date }))));
  }, [contact]);

  // Cảnh báo trùng SĐT (chỉ cảnh báo, vẫn lưu được nếu cố ý).
  useEffect(() => {
    const phone = form.phone.trim();
    if (!phone) { setDupes([]); return; }
    const t = setTimeout(() => {
      findPhoneDuplicates(phone, contact?.id).then(setDupes);
    }, 400);
    return () => clearTimeout(t);
  }, [form.phone, contact?.id]);

  useEffect(() => { setDupeAck(false); }, [form.phone]);

  const pick = (id: string) => {
    setPickedId(id);
    const c = pool.find(x => x.id === id);
    if (!c) { setForm(emptyContactForm(defaultClientId)); return; }
    // Nạp toàn bộ dữ liệu người đó rồi gắn vào công ty đang mở — vẫn là 1 bản ghi,
    // không tạo bản sao.
    setForm({ ...contactToForm(c), client_id: defaultClientId });
  };

  const picked = pool.find(x => x.id === pickedId) || null;
  const target = contact || picked;

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Vui lòng nhập họ tên'); return; }
    if (dupes.length > 0 && !dupeAck) {
      toast('Số điện thoại đang trùng — tick xác nhận bên dưới nếu vẫn muốn lưu');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveContact(form, target, { user, clientName });
      onSaved(saved);
      const dateErr = await saveSpecialDates(saved.id, specialDates);
      if (dateErr) {
        // Liên hệ đã lưu được, chỉ riêng ngày đặc biệt lỗi — giữ modal mở và
        // báo rõ ràng thay vì đóng lại để lỗi biến mất cùng toast góc màn hình.
        setSaveError(dateErr);
        toast('Đã lưu liên hệ, nhưng: ' + dateErr);
      } else {
        toast(target ? 'Đã cập nhật liên hệ' : 'Đã thêm liên hệ mới');
        onClose();
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      setSaveError(msg);
      toast('Lỗi: ' + msg);
    } finally {
      setSaving(false);
    }
  };

  const isLinked = !!form.client_id;
  const movedCompany = !!contact && (contact.client_id || '') !== form.client_id;

  const field = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'block text-xs font-semibold text-gray-700 mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-900">
            {contact ? 'Chỉnh sửa liên hệ' : 'Thêm liên hệ'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        {saveError && (
          <div className="mx-6 mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-[12.5px] text-red-800">
              <div className="font-semibold mb-0.5">Không lưu được</div>
              <div className="break-words">{saveError}</div>
            </div>
            <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-700 shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        <div className="px-6 py-5 space-y-5">
          {/* Chọn người đã có sẵn trong CSKH */}
          {allowPickExisting && !contact && pool.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <label className={label}>Người đã có trong CSKH (chưa gắn công ty)</label>
              <select value={pickedId} onChange={e => pick(e.target.value)} className={field}>
                <option value="">— Nhập người mới —</option>
                {pool.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` · ${c.phone}` : ''}{c.role ? ` (${c.role})` : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-blue-700 mt-1.5">
                Chọn để gắn người đó vào công ty này — dùng lại đúng bản ghi cũ, không tạo bản sao.
              </p>
            </div>
          )}

          {/* Thông tin cơ bản */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Thông tin cơ bản</h3>
            <div className="mb-3">
              <AvatarUpload
                value={form.avatar_url}
                onChange={v => setForm({ ...form, avatar_url: v })}
                name={form.name}
                toast={toast}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={label}>Họ và tên <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Nguyễn Văn A" className={field} />
              </div>
              <div>
                <label className={label}>Số điện thoại</label>
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="0909..." className={field} />
              </div>
              <div>
                <label className={label}>Email</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="hr@company.com" className={field} />
              </div>

              {/* Cảnh báo trùng SĐT */}
              {dupes.length > 0 && (
                <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-amber-800 mb-1">
                        Số điện thoại này đã có {dupes.length} người dùng:
                      </div>
                      <ul className="text-[11.5px] text-amber-800 space-y-0.5">
                        {dupes.map(d => (
                          <li key={d.id}>
                            • <b>{d.name}</b>{d.role ? ` — ${d.role}` : ''}
                            {d.clients?.name ? ` @ ${d.clients.name}` : ' (chưa gắn công ty)'}
                            {!d.is_active && ' · đã nghỉ'}
                          </li>
                        ))}
                      </ul>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                        <input type="checkbox" checked={dupeAck} onChange={e => setDupeAck(e.target.checked)} className="w-3.5 h-3.5 accent-amber-600" />
                        <span className="text-[11.5px] text-amber-900 font-medium">Đúng là người khác / dùng chung số — vẫn lưu</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className={label}>Chức vụ</label>
                <RoleSelect value={form.role} onChange={v => setForm({ ...form, role: v })} toast={toast} className={field} />
              </div>
              <div>
                <label className={label}>Gắn với công ty</label>
                <select value={form.client_id}
                  onChange={e => setForm({
                    ...form,
                    client_id: e.target.value,
                    // Cờ "liên hệ chính" thuộc về công ty cũ — đổi công ty thì
                    // bỏ cờ, muốn giữ thì tick lại cho công ty mới.
                    is_primary: e.target.value === (contact?.client_id || '') ? form.is_primary : false,
                  })}
                  className={field}>
                  <option value="">— Chưa gắn công ty —</option>
                  {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                </select>
                {movedCompany && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Đổi công ty: {clientName(contact!.client_id) || 'chưa gắn'} → {clientName(form.client_id || null) || 'chưa gắn'}.
                    Thay đổi sẽ được ghi vào lịch sử.
                  </p>
                )}
              </div>
              <div>
                <label className={label}>Phụ trách từ ngày</label>
                <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={field} />
              </div>
              <div>
                <label className={label}>Kênh tiếp cận</label>
                <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} className={field}>
                  <option value="">— Chọn —</option>
                  {CONTACT_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={label}>Địa chỉ nhà</label>
                <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder="123 Đường ABC, Quận 1, TP.HCM" className={field} />
                <div className="flex items-center gap-1.5 mt-1.5">
                  <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <input type="text" value={form.map_link}
                    onChange={e => setForm({ ...form, map_link: e.target.value })}
                    placeholder="Dán link Google Maps của địa chỉ này…"
                    className="flex-1 px-2.5 py-1.5 text-[13px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {form.map_link ? (
                    <a href={form.map_link} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 shrink-0">
                      <ExternalLink className="w-3.5 h-3.5" /> Mở
                    </a>
                  ) : (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.address.trim())}`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={e => { if (!form.address.trim()) { e.preventDefault(); toast('Nhập địa chỉ trước để tìm trên Google Maps'); } }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 shrink-0">
                      <Search className="w-3.5 h-3.5" /> Tìm
                    </a>
                  )}
                </div>
                {form.map_link && (
                  <p className="text-[10.5px] mt-1">
                    {parseLatLngFromLink(form.map_link)
                      ? <span className="text-emerald-600">✓ Link có toạ độ — định vị được chính xác</span>
                      : <span className="text-amber-600">
                          Link chưa có toạ độ. Link rút gọn (maps.app.goo.gl) vẫn mở được,
                          nhưng muốn định vị chính xác thì mở link rồi copy lại link đầy đủ trên thanh địa chỉ.
                        </span>}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Trạng thái */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Trạng thái</h3>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <button type="button"
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-[13px] text-gray-700 font-medium">
                  {form.is_active ? 'Đang phụ trách' : 'Đã nghỉ'}
                </span>
                {!form.is_active && (
                  <span className="text-[11px] text-gray-500">
                    Ngày kết thúc sẽ được ghi tự động{contact?.end_date ? ` (đang là ${contact.end_date})` : ''}
                  </span>
                )}
              </div>
              <label className={`flex items-center gap-2 select-none ${isLinked ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <input type="checkbox" disabled={!isLinked} checked={form.is_primary}
                  onChange={e => setForm({ ...form, is_primary: e.target.checked })} className="w-4 h-4 accent-amber-500" />
                <span className="text-[13px] text-gray-700">
                  Là <b>liên hệ chính</b> của công ty
                  {!isLinked && <span className="text-[11px] text-gray-500"> — cần gắn công ty trước</span>}
                </span>
              </label>
              {form.is_primary && isLinked && (
                <p className="text-[11px] text-gray-500 pl-6">
                  Mỗi công ty chỉ có 1 liên hệ chính — người đang giữ cờ này sẽ tự động được bỏ.
                </p>
              )}
            </div>
          </div>

          {/* Thông tin cá nhân */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Thông tin cá nhân</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Ngày sinh</label>
                  <input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} className={field} />
                </div>
                <div>
                  <label className={label}>Facebook / LinkedIn</label>
                  <input type="text" value={form.social_link} onChange={e => setForm({ ...form, social_link: e.target.value })}
                    placeholder="https://facebook.com/..." className={field} />
                </div>
              </div>
              <div>
                <label className={label}>Sở thích</label>
                <TagInput tags={form.hobbies} onChange={v => setForm({ ...form, hobbies: v })} />
              </div>
              <div>
                <label className={label}>Ngày đặc biệt khác</label>
                <SpecialDatesEditor items={specialDates} onChange={setSpecialDates} />
              </div>
            </div>
          </div>

          {/* Ghi chú */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Ghi chú</h3>
            <div className="space-y-3">
              <div>
                <label className={label}>Ghi chú ngắn</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
                  placeholder="Thông tin thêm..." className={`${field} resize-none`} />
              </div>
              <div>
                <label className={label}>Ghi chú chi tiết</label>
                <RichTextEditor value={form.rich_notes} onChange={v => setForm({ ...form, rich_notes: v })} />
              </div>
            </div>
          </div>

          {/* Lịch sử chuyển công ty */}
          {contact && history.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Lịch sử gắn công ty
              </h3>
              <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                {history.map(h => (
                  <li key={h.id} className="px-3 py-2 text-[11.5px] text-gray-700 flex items-start gap-2">
                    <span className="text-gray-400 whitespace-nowrap">
                      {new Date(h.changed_at).toLocaleDateString('vi-VN')}
                    </span>
                    <span className="flex-1">
                      {!h.from_client_name
                        ? <>Gắn vào <b>{h.to_client_name || '—'}</b></>
                        : !h.to_client_name
                          ? <>Gỡ khỏi <b>{h.from_client_name}</b></>
                          : <><b>{h.from_client_name}</b> → <b>{h.to_client_name}</b></>}
                      {h.note ? ` · ${h.note}` : ''}
                    </span>
                    {h.changed_by && <span className="text-gray-400 whitespace-nowrap">{h.changed_by}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex gap-2 justify-end sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Hủy</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}
