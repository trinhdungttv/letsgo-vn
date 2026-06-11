import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Edit2, Link2, X, Plus, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { supabase } from '../lib/supabase';
import type { Client, Contact } from '../lib/types';

interface Props {
  clients: Client[];
  toast: (m: string) => void;
}

const ROLES = ['Giám đốc', 'HR Manager', 'Kế toán', 'Trưởng phòng', 'Nhân viên', 'Khác'];
const CHANNELS = ['Zalo', 'Facebook', 'Giới thiệu', 'Gặp trực tiếp'];
const RICH_COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#0891b2', '#ec4899'];

// ── Rich Text Editor ────────────────────────────────────────────────────────

function RichTextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastValue = useRef(value);

  useEffect(() => {
    if (ref.current && lastValue.current !== value && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
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
      <div
        ref={ref}
        contentEditable
        onInput={handleInput}
        className="min-h-[100px] px-3 py-2 text-sm focus:outline-none"
        suppressContentEditableWarning
      />
    </div>
  );
}

// ── Tag Input ────────────────────────────────────────────────────────────────

function TagInput({ tags, onChange }: { tags: string[]; onChange: (v: string[]) => void }) {
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
        placeholder={tags.length === 0 ? 'Golf, Đọc sách... nhấn Enter' : ''}
        className="text-xs outline-none flex-1 min-w-[100px] bg-transparent"
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type FormData = {
  name: string; phone: string; email: string; role: string;
  client_id: string; address: string; birthday: string;
  hobbies: string[]; channel: string; social_link: string;
  rich_notes: string; is_active: boolean;
};

const emptyForm = (): FormData => ({
  name: '', phone: '', email: '', role: 'HR Manager',
  client_id: '', address: '', birthday: '',
  hobbies: [], channel: '', social_link: '',
  rich_notes: '', is_active: true,
});

const CRMLeads: React.FC<Props> = ({ clients, toast }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkClientId, setLinkClientId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('contacts').select('*, clients(name)').order('created_at', { ascending: false });
    if (error) toast('Lỗi tải dữ liệu: ' + error.message);
    else setContacts((data || []) as Contact[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.clients?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (c: Contact) => {
    setEditing(c);
    setForm({
      name: c.name, phone: c.phone || '', email: c.email || '', role: c.role || 'HR Manager',
      client_id: c.client_id || '', address: c.address || '', birthday: c.birthday || '',
      hobbies: c.hobbies ? (JSON.parse(c.hobbies) as string[]) : [],
      channel: c.channel || '', social_link: c.social_link || '',
      rich_notes: c.rich_notes || '', is_active: c.is_active,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Vui lòng nhập họ tên'); return; }
    if (!form.phone.trim()) { toast('Vui lòng nhập số điện thoại'); return; }
    setSaving(true);
    const payload = {
      name: form.name, phone: form.phone, email: form.email || null,
      role: form.role || null, client_id: form.client_id || null,
      address: form.address || null, birthday: form.birthday || null,
      hobbies: form.hobbies.length ? JSON.stringify(form.hobbies) : null,
      channel: form.channel || null, social_link: form.social_link || null,
      rich_notes: form.rich_notes || null, is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };
    try {
      if (editing) {
        const { error } = await supabase.from('contacts').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast('Cập nhật thành công');
      } else {
        const { error } = await supabase.from('contacts').insert({ ...payload, created_at: new Date().toISOString() });
        if (error) throw error;
        toast('Đã thêm liên hệ mới');
      }
      await load();
      setShowModal(false);
    } catch (err: any) { toast('Lỗi: ' + err.message); }
    finally { setSaving(false); }
  };

  const handleLinkCompany = async (contactId: string) => {
    if (!linkClientId) { setLinkingId(null); return; }
    try {
      const { error } = await supabase.from('contacts').update({ client_id: linkClientId, updated_at: new Date().toISOString() }).eq('id', contactId);
      if (error) throw error;
      await load();
      toast('Đã gắn công ty');
    } catch (err: any) { toast('Lỗi: ' + err.message); }
    finally { setLinkingId(null); setLinkClientId(''); }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="CSKH"
        subtitle={`${contacts.length} liên hệ`}
        actions={
          <button onClick={openAdd} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
            <span className="flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Thêm liên hệ</span>
          </button>
        }
      />

      {/* Search */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Tìm tên, SĐT, email, công ty..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {['Họ tên', 'Công ty gắn', 'Chức vụ', 'SĐT', 'Email', 'Ngày tạo', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-xs">Đang tải...</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center">
                    <div className="text-gray-400 text-xs mb-2">Chưa có liên hệ nào</div>
                    <button onClick={openAdd} className="text-xs text-blue-600 hover:underline">+ Thêm ngay</button>
                  </td>
                </tr>
              ) : filtered.map(c => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{c.name}</div>
                    {!c.is_active && <span className="text-[10px] text-gray-400">Không hoạt động</span>}
                  </td>
                  <td className="px-4 py-3">
                    {linkingId === c.id ? (
                      <div className="flex items-center gap-1">
                        <select value={linkClientId} onChange={e => setLinkClientId(e.target.value)} autoFocus
                          className="text-xs px-2 py-1 border border-blue-400 rounded-md focus:outline-none min-w-[140px]">
                          <option value="">-- Chọn công ty --</option>
                          {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                        </select>
                        <button onClick={() => handleLinkCompany(c.id)} className="text-[11px] px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700">OK</button>
                        <button onClick={() => { setLinkingId(null); setLinkClientId(''); }} className="text-[11px] px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-100">Hủy</button>
                      </div>
                    ) : (
                      <button onClick={() => { setLinkingId(c.id); setLinkClientId(c.client_id || ''); }}
                        className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 transition">
                        <Link2 className="w-3.5 h-3.5" />
                        {c.clients?.name || <span className="text-gray-400 italic">Gắn công ty</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{c.role || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(c.created_at).toLocaleDateString('vi-VN')}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-gray-100 rounded-lg transition" title="Sửa">
                      <Edit2 className="w-3.5 h-3.5 text-gray-500" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
              <h2 className="text-base font-semibold text-gray-900">{editing ? 'Chỉnh sửa liên hệ' : 'Thêm liên hệ'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-5 h-5 text-gray-500" /></button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Section: Basic Info */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Thông tin cơ bản</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Họ và tên <span className="text-red-500">*</span></label>
                      <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                        placeholder="Nguyễn Văn A" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Số điện thoại <span className="text-red-500">*</span></label>
                      <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
                      <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Chức vụ</label>
                      <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Gắn với công ty</label>
                      <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">-- Không gắn --</option>
                        {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Địa chỉ</label>
                      <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                        placeholder="123 Đường ABC, Quận 1, TP.HCM" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section: Personal Info */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Thông tin cá nhân</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Ngày sinh</label>
                      <input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Kênh tiếp cận</label>
                      <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">-- Chọn --</option>
                        {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Sở thích</label>
                    <TagInput tags={form.hobbies} onChange={v => setForm({ ...form, hobbies: v })} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Facebook / LinkedIn</label>
                    <input type="text" value={form.social_link} onChange={e => setForm({ ...form, social_link: e.target.value })}
                      placeholder="https://facebook.com/..." className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>

              {/* Section: Rich Notes */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Ghi chú</h3>
                <RichTextEditor value={form.rich_notes} onChange={v => setForm({ ...form, rich_notes: v })} />
              </div>

              {/* Active toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4" />
                <span className="text-sm text-gray-700">Đang hoạt động</span>
              </label>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-2 justify-end sticky bottom-0 bg-white">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Hủy</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CRMLeads;
