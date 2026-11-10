// Form lịch đi họp: ngày giờ · công ty (Khách hàng / KH tiềm năng, hoặc gõ tên tự do) · địa điểm / cổng · nội dung ·
// thành viên tham dự (theo thứ tự in danh sách vào cổng) · pháp nhân đứng tên · người bên khách · trạng thái, kết quả.
import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, Landmark, Plus, Trash2 } from 'lucide-react';
import { foldVn } from '../../../lib/companyMatch';
import { findEntity, type QuoteEntity } from '../../../lib/costPlan/entity';
import type { CskhContact } from '../../../lib/cskh/types';
import { MEETING_STATUS_LABEL, type Meeting, type MeetingDraft, type MeetingMember, type MeetingStatus } from '../../../lib/meetings/types';
import type { Client } from '../../../lib/types';
import { personInitial } from '../../../lib/vnName';
import { inputCls } from '../ui';
import { ChoiceChip, Sheet, SHEET_FOOTER } from '../components/Sheet';
import { ContactAvatar } from '../components/ContactAvatar';

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';
const LAST_ENTITY_KEY = 'lgvn_meeting_entity';
const lastEntity = (): string | null => { try { return localStorage.getItem(LAST_ENTITY_KEY); } catch { return null; } };
const rememberEntity = (id: string | null) => { try { if (id) localStorage.setItem(LAST_ENTITY_KEY, id); } catch { /* chế độ riêng tư */ } };

/** Ô chọn công ty: tìm không dấu trong Khách hàng + KH tiềm năng; không có thì giữ tên gõ tay. */
function CompanyField({ clients, clientId, name, onChange }: {
  clients: readonly Client[];
  clientId: string | null;
  name: string;
  onChange: (clientId: string | null, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const q = foldVn(name.trim());
  const matches = useMemo(() => {
    const list = clients.filter(c => !c.archived_at && (!q || foldVn(c.name).includes(q)));
    return list.sort((a, b) => Number(a.client_type === 'prospect') - Number(b.client_type === 'prospect') || a.name.localeCompare(b.name, 'vi')).slice(0, 8);
  }, [clients, q]);
  const picked = clientId ? clients.find(c => c.id === clientId) : null;
  return (
    <div className="relative">
      <div className="relative">
        <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868B] pointer-events-none" />
        <input value={name} placeholder="Tên công ty khách hàng (VD: TTI)" className={`${inputCls} pl-9`}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => { onChange(null, e.target.value); setOpen(true); }} />
        {picked && <Check size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#248A3D]" aria-label="Đã gắn khách hàng" />}
      </div>
      {open && matches.length > 0 && !(picked && picked.name === name) && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-[12px] shadow-[0_10px_30px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.08)] p-1 max-h-[260px] overflow-y-auto">
          {matches.map(c => (
            <button key={c.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onChange(c.id, c.name); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-left hover:bg-black/[0.04]">
              <Building2 size={14} className="text-[#0058B0] shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#1D1D1F]">{c.name}</span>
              {c.client_type === 'prospect' && <span className="text-[11px] text-[#86868B] shrink-0">Tiềm năng</span>}
            </button>
          ))}
        </div>
      )}
      {name.trim() && !picked && (
        <p className="text-[11.5px] text-[#86868B] mt-1">Chưa gắn với khách hàng trong hệ thống — vẫn lưu theo tên đã gõ.</p>
      )}
    </div>
  );
}

export function MeetingForm({ existing, members, entities, clients, contacts, today, readOnly, addAttendee, onOpenEntities, onNewMember, onSave, onDelete, onClose }: {
  existing: Meeting | null;
  members: readonly MeetingMember[];
  entities: readonly QuoteEntity[];
  clients: readonly Client[];
  contacts: readonly CskhContact[];
  today: string;
  readOnly: boolean;
  /** Thành viên vừa tạo bằng nút "Thành viên mới" → tự thêm vào người tham dự. */
  addAttendee?: string | null;
  onOpenEntities: () => void;
  onNewMember: () => void;
  onSave: (d: MeetingDraft) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [d, setD] = useState<MeetingDraft>(() => existing ? {
    meet_date: existing.meet_date, meet_time: existing.meet_time, client_id: existing.client_id, company_name: existing.company_name,
    location: existing.location, purpose: existing.purpose, entity_id: findEntity(entities, existing.entity_id)?.id ?? existing.entity_id, attendees: existing.attendees,
    contact_ids: existing.contact_ids, status: existing.status, note: existing.note, result: existing.result,
  } : {
    meet_date: today, meet_time: '', client_id: null, company_name: '', location: '', purpose: '',
    entity_id: findEntity(entities, lastEntity())?.id ?? entities[0]?.id ?? null,
    attendees: [], contact_ids: [], status: 'planned', note: '', result: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (p: Partial<MeetingDraft>) => setD(x => ({ ...x, ...p }));
  useEffect(() => {
    if (addAttendee) setD(x => (x.attendees.some(a => a.id === addAttendee) ? x : { ...x, attendees: [...x.attendees, { id: addAttendee, title: '' }] }));
  }, [addAttendee]);
  // Pháp nhân tải xong sau khi mở form (lần đầu) → chọn sẵn
  useEffect(() => {
    if (!existing && !d.entity_id && entities.length) set({ entity_id: findEntity(entities, lastEntity())?.id ?? entities[0].id });
  }, [entities]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = members.filter(m => !m.deleted_at);
  const chosen = new Set(d.attendees.map(a => a.id));
  // Hay đi họp lên trước; người đã chọn mà đang tắt "hay đi họp" vẫn hiện để bỏ chọn được
  const shown = live.filter(m => m.active || chosen.has(m.id));
  const hiddenCount = live.length - shown.length;
  const toggle = (id: string) => set({
    attendees: chosen.has(id)
      ? d.attendees.filter(a => a.id !== id)
      // Thêm theo thứ tự danh sách thành viên (người chức vụ cao xếp trên)
      : [...d.attendees, { id, title: '' }].sort((a, b) => live.findIndex(m => m.id === a.id) - live.findIndex(m => m.id === b.id)),
  });

  const clientContacts = d.client_id ? contacts.filter(c => !c.isArchived && c.clientIds.includes(d.client_id as string)) : [];
  const pickedContacts = new Set(d.contact_ids);
  const toggleContact = (id: string) => set({ contact_ids: pickedContacts.has(id) ? d.contact_ids.filter(x => x !== id) : [...d.contact_ids, id] });

  const save = async () => {
    if (!d.meet_date) { setError('Chọn ngày họp'); return; }
    if (!d.company_name.trim() && !d.location.trim()) { setError('Ghi công ty hoặc địa điểm họp'); return; }
    setSaving(true); setError('');
    // Người bên khách chỉ giữ người thuộc công ty đang chọn
    const keepContacts = d.client_id ? d.contact_ids.filter(id => clientContacts.some(c => c.id === id)) : [];
    const err = await onSave({ ...d, company_name: d.company_name.trim(), contact_ids: keepContacts });
    setSaving(false);
    if (err) setError(err); else rememberEntity(d.entity_id);
  };
  const remove = async () => {
    if (!onDelete || !existing) return;
    if (!window.confirm(`Xoá lịch họp ${existing.company_name || ''} ngày ${existing.meet_date.split('-').reverse().join('/')}?`)) return;
    setSaving(true);
    const err = await onDelete();
    setSaving(false);
    if (err) setError(err);
  };

  const title = readOnly ? 'Lịch họp' : existing ? 'Sửa lịch họp' : 'Thêm lịch họp';
  return (
    <Sheet label={title} onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] mb-3">{title}</h2>
      <fieldset disabled={readOnly} className="space-y-3 min-w-0">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Ngày họp</label>
            <input type="date" value={d.meet_date} onChange={e => set({ meet_date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Giờ</label>
            <input type="time" value={d.meet_time} onChange={e => set({ meet_time: e.target.value })} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Họp tại công ty</label>
          <CompanyField clients={clients} clientId={d.client_id} name={d.company_name}
            onChange={(clientId, name) => set({ client_id: clientId, company_name: name, ...(clientId !== d.client_id ? { contact_ids: [] } : {}) })} />
        </div>
        <div>
          <label className={labelCls}>Địa điểm / cổng vào</label>
          <input value={d.location} onChange={e => set({ location: e.target.value })} className={inputCls} placeholder="VD: Cổng 2 – KCN Long Đức, Đồng Nai" maxLength={300} />
        </div>
        <div>
          <label className={labelCls}>Nội dung họp</label>
          <input value={d.purpose} onChange={e => set({ purpose: e.target.value })} className={inputCls} placeholder="VD: Họp giao ban, ký phụ lục hợp đồng" maxLength={300} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={labelCls}>Thành viên tham dự{d.attendees.length ? ` · ${d.attendees.length}` : ''}</span>
            {!readOnly && <button type="button" onClick={onNewMember} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0066CC] hover:opacity-70"><Plus size={13} />Thành viên mới</button>}
          </div>
          {shown.length === 0 ? (
            <p className="text-[12.5px] text-[#86868B]">Chưa có thành viên — bấm “Thành viên mới” để thêm Ban điều hành.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {shown.map(m => (
                <button key={m.id} type="button" onClick={() => toggle(m.id)} aria-pressed={chosen.has(m.id)}
                  className={`inline-flex items-center gap-1.5 h-9 md:h-8 pl-1.5 pr-3 rounded-full text-[13px] transition ${chosen.has(m.id) ? 'bg-[#0071E3] text-white font-semibold' : 'bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] font-medium hover:bg-[rgba(118,118,128,0.2)]'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center ${chosen.has(m.id) ? 'bg-white/25' : 'bg-white'}`}>
                    {chosen.has(m.id) ? <Check size={13} strokeWidth={3} /> : <span className="text-[10px] font-bold text-[#6E6E73]">{personInitial(m.full_name)}</span>}
                  </span>
                  {m.full_name}
                </button>
              ))}
            </div>
          )}
          {hiddenCount > 0 && <p className="text-[11.5px] text-[#86868B] mt-1">{hiddenCount} người đang tắt “hay đi họp” không hiện ở đây.</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={labelCls}>Pháp nhân đứng tên danh sách vào cổng</span>
            <button type="button" onClick={onOpenEntities} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0066CC] hover:opacity-70"><Landmark size={13} />Pháp nhân</button>
          </div>
          {entities.length ? (
            <div className="flex flex-wrap gap-1.5">
              {entities.map(e => <ChoiceChip key={e.id} active={d.entity_id === e.id} onClick={() => set({ entity_id: e.id })}>{e.label}</ChoiceChip>)}
            </div>
          ) : (
            <p className="text-[12.5px] text-[#B25000]">Chưa có pháp nhân — bấm “Pháp nhân” để tạo (dùng chung với Phương án giá).</p>
          )}
        </div>

        {clientContacts.length > 0 && (
          <div>
            <span className={labelCls}>Người bên khách <span className="font-normal text-[#AEAEB2]">(tuỳ chọn — từ danh bạ CSKH)</span></span>
            <div className="flex flex-wrap gap-1.5">
              {clientContacts.map(c => (
                <button key={c.id} type="button" onClick={() => toggleContact(c.id)} aria-pressed={pickedContacts.has(c.id)}
                  className={`inline-flex items-center gap-1.5 h-9 md:h-8 pl-1 pr-3 rounded-full text-[13px] transition ${pickedContacts.has(c.id) ? 'bg-[#0071E3]/12 text-[#0058B0] font-semibold ring-1 ring-[#0071E3]/40' : 'bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] font-medium hover:bg-[rgba(118,118,128,0.2)]'}`}>
                  <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={24} />
                  {c.fullName}{c.jobTitle ? <span className="font-normal text-[#86868B]">· {c.jobTitle}</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className={labelCls}>Trạng thái</span>
          <div className="flex flex-wrap gap-1.5">
            {(['planned', 'done', 'cancelled'] as MeetingStatus[]).map(s => <ChoiceChip key={s} active={d.status === s} onClick={() => set({ status: s })}>{MEETING_STATUS_LABEL[s]}</ChoiceChip>)}
          </div>
        </div>
        {d.status === 'done' && (
          <div>
            <label className={labelCls}>Kết quả buổi họp</label>
            <textarea rows={3} value={d.result} onChange={e => set({ result: e.target.value })} className={`${inputCls} resize-y`} placeholder="Đã thống nhất…, việc cần làm tiếp…" maxLength={4000} />
          </div>
        )}
        <div>
          <label className={labelCls}>Ghi chú</label>
          <textarea rows={2} value={d.note} onChange={e => set({ note: e.target.value })} className={`${inputCls} resize-y`} placeholder="VD: mang theo hồ sơ năng lực, gửi danh sách cho bảo vệ trước 1 ngày" maxLength={2000} />
        </div>
      </fieldset>
      {error && <p className="mt-3 text-[13px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{error}</p>}
      {!readOnly && (
        <div className={`${SHEET_FOOTER} mt-4 flex gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
          {existing && onDelete && (
            <button type="button" onClick={remove} disabled={saving} aria-label="Xoá lịch họp" title="Xoá lịch họp"
              className="h-11 md:h-9 w-11 md:w-9 shrink-0 rounded-full bg-[#FF3B30]/10 text-[#D70015] hover:bg-[#FF3B30]/15 flex items-center justify-center transition disabled:opacity-40">
              <Trash2 size={16} />
            </button>
          )}
          <button type="button" onClick={onClose} className="flex-1 h-11 md:h-9 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] active:scale-[0.98] transition">Huỷ</button>
          <button type="button" onClick={save} disabled={saving}
            className="flex-[2] h-11 md:h-9 rounded-full bg-[#0071E3] text-white active:scale-[0.98] transition text-[13px] font-semibold disabled:opacity-40">
            {saving ? 'Đang lưu…' : existing ? 'Lưu' : 'Thêm lịch họp'}
          </button>
        </div>
      )}
    </Sheet>
  );
}
