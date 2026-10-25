// "Sửa đợt ghi nhóm" (port PRM BatchEditModal): đổi hình thức / nội dung / ngày cho cả loạt,
// bỏ người ghi nhầm (có Hoàn tác trước khi Lưu), thêm người bị sót (cùng dấu đợt), xoá cả
// đợt. Mọi thay đổi chỉ ghi khi bấm Lưu; bỏ hết người = xoá đợt. Chỉ người tạo đợt / admin.
import { useMemo, useState } from 'react';
import { Minus, RotateCcw, Trash2 } from 'lucide-react';
import type { BatchEdit, InteractionBatch } from '../../../lib/cskh/groupLog';
import type { CskhContact, CskhGift, InteractionType } from '../../../lib/cskh/types';
import { INTERACTION_LABEL, INTERACTION_TYPES } from '../../../lib/cskh/types';
import { compareVnName } from '../../../lib/vnName';
import { inputCls } from '../ui';
import { ContactAvatar } from './ContactAvatar';
import { ChoiceChip, Sheet, SHEET_FOOTER } from './Sheet';

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';

export function BatchEditModal({ batch, gifts, contacts, today, onApply, onDelete, onClose }: {
  batch: InteractionBatch;
  /** Lịch sử quà cùng đợt (đổi ngày / nội dung theo, bỏ người thì xoá theo). */
  gifts: readonly CskhGift[];
  contacts: readonly CskhContact[];
  today: string;
  /** Trả về câu lỗi hoặc null. */
  onApply: (edit: BatchEdit) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [type, setType] = useState<InteractionType>(batch.type);
  const [content, setContent] = useState(batch.content);
  const [occurredAt, setOccurredAt] = useState(batch.occurredAt);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const byId = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);
  const inBatch = useMemo(() => new Set(batch.items.map(i => i.contactId)), [batch]);
  const addable = useMemo(
    () => contacts.filter(c => !c.isArchived && !inBatch.has(c.id) && !added.includes(c.id)).sort((a, b) => compareVnName(a.fullName, b.fullName)),
    [contacts, inBatch, added],
  );
  const remaining = batch.items.length - removed.size + added.length;
  const changed = type !== batch.type || content.trim() !== batch.content || occurredAt !== batch.occurredAt || removed.size > 0 || added.length > 0;

  const toggleRemove = (contactId: string) => setRemoved(cur => {
    const next = new Set(cur);
    if (next.has(contactId)) next.delete(contactId); else next.add(contactId);
    return next;
  });

  const handleDelete = async () => {
    const giftNote = gifts.length > 0 ? ` và ${gifts.length} dòng lịch sử quà` : '';
    if (!confirm(`Xoá cả đợt “${batch.content || INTERACTION_LABEL[batch.type]}” (${batch.items.length} người)${giftNote}?\n\nKhôi phục được ở trang Lịch sử.`)) return;
    setBusy(true);
    const err = await onDelete();
    setBusy(false);
    if (err) setError(err);
  };

  const handleSave = async () => {
    if (!changed) { onClose(); return; }
    if (remaining === 0) { await handleDelete(); return; }
    if (!occurredAt || occurredAt > today) { setError('Ngày không được sau hôm nay'); return; }
    setBusy(true);
    setError('');
    const err = await onApply({ type, content, occurredAt, removeContactIds: [...removed], addContactIds: added });
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <Sheet label="Sửa đợt ghi nhóm" onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Sửa đợt ghi nhóm</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">
        {batch.items.length} người · ghi bởi {batch.createdByName || 'không rõ'} — mọi thay đổi chỉ ghi khi bấm Lưu.
      </p>

      <section className="mt-4 space-y-3 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4">
        <div>
          <span className={labelCls}>Hình thức</span>
          <div className="flex flex-wrap gap-1.5">
            {INTERACTION_TYPES.map(t => <ChoiceChip key={t} active={type === t} onClick={() => setType(t)}>{INTERACTION_LABEL[t]}</ChoiceChip>)}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <div>
            <label className={labelCls}>Nội dung</label>
            <input type="text" value={content} onChange={e => setContent(e.target.value)} placeholder="Tặng hoa 20/10" maxLength={500} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Ngày</label>
            <input type="date" value={occurredAt} max={today} onChange={e => setOccurredAt(e.target.value)} className={`${inputCls} md:w-[10rem] min-w-[9.5rem]`} />
          </div>
        </div>
        {gifts.length > 0 && (
          <p className="text-[12px] text-[#86868B] leading-snug">
            {gifts.length} dòng lịch sử quà ({gifts[0].item}) của đợt đổi theo ngày + nội dung; bỏ người thì xoá theo.
            {type !== 'gift' && ' Đổi hình thức khác “Quà tặng” thì lịch sử quà vẫn giữ — xoá ở Sự kiện & Quà tặng nếu cần.'}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4">
        <h3 className="text-[13px] font-semibold text-[#1D1D1F] mb-1">Người trong đợt · {remaining}</h3>
        <div className="max-h-[40vh] overflow-y-auto">
          {batch.items.map(i => {
            const c = i.contactId ? byId.get(i.contactId) : undefined;
            const off = removed.has(i.contactId as string);
            return (
              <div key={i.id} className={`flex items-center gap-3 py-2 border-b border-[#F0F0F2] last:border-0 ${off ? 'opacity-50' : ''}`}>
                <ContactAvatar name={c?.fullName ?? i.contactPerson} url={c?.avatarUrl} tier={c?.tier ?? 'unclassified'} size={32} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13.5px] font-semibold text-[#1D1D1F] truncate ${off ? 'line-through' : ''}`}>{c?.fullName ?? i.contactPerson ?? 'Người liên hệ đã xoá'}</span>
                  {off && <span className="block text-[12px] text-[#86868B]">Sẽ bỏ khỏi đợt khi bấm Lưu</span>}
                </span>
                {off ? (
                  <button type="button" onClick={() => toggleRemove(i.contactId as string)}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-medium text-[#0066CC] hover:bg-[#0071E3]/10 transition">
                    <RotateCcw size={12} strokeWidth={2.4} /> Hoàn tác
                  </button>
                ) : (
                  <button type="button" onClick={() => toggleRemove(i.contactId as string)} aria-label={`Bỏ ${c?.fullName ?? ''} khỏi đợt`}
                    className="shrink-0 w-7 h-7 rounded-full bg-[#FF3B30] text-white flex items-center justify-center hover:brightness-95 active:scale-95 transition">
                    <Minus size={14} strokeWidth={3} />
                  </button>
                )}
              </div>
            );
          })}
          {added.map(id => {
            const c = byId.get(id);
            return (
              <div key={id} className="flex items-center gap-3 py-2 border-b border-[#F0F0F2] last:border-0">
                <ContactAvatar name={c?.fullName ?? '?'} url={c?.avatarUrl} tier={c?.tier ?? 'unclassified'} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-[#1D1D1F] truncate">{c?.fullName}</span>
                  <span className="block text-[12px] text-[#248A3D]">Thêm mới khi bấm Lưu</span>
                </span>
                <button type="button" onClick={() => setAdded(list => list.filter(x => x !== id))} aria-label={`Bỏ ${c?.fullName ?? ''}`}
                  className="shrink-0 w-7 h-7 rounded-full bg-[#FF3B30] text-white flex items-center justify-center hover:brightness-95 active:scale-95 transition">
                  <Minus size={14} strokeWidth={3} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-2">
          <label className={labelCls}>Thêm người bị sót</label>
          <select value="" onChange={e => { const v = e.target.value; if (v) setAdded(list => [...list, v]); }} aria-label="Thêm người vào đợt" className={inputCls}>
            <option value="">Chọn người…</option>
            {addable.map(c => <option key={c.id} value={c.id}>{c.fullName}{c.organization ? ` · ${c.organization}` : ''}</option>)}
          </select>
          <p className="text-[11.5px] text-[#86868B] mt-1">Người thêm vào nhận đúng hình thức, nội dung, ngày{gifts.length > 0 ? ' và lịch sử quà' : ''} của đợt.</p>
        </div>
      </section>

      {error && <p className="mt-3 text-[13px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{error}</p>}

      <div className={`${SHEET_FOOTER} mt-4 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleDelete} disabled={busy}
            className="inline-flex items-center gap-1.5 h-10 md:h-9 px-3.5 rounded-full bg-[#FF3B30]/10 text-[#D70015] text-[13px] font-medium hover:bg-[#FF3B30]/[0.16] disabled:opacity-40 transition">
            <Trash2 size={14} /> Xoá cả đợt
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-10 md:h-9 px-4 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] transition">Huỷ</button>
          <button type="button" onClick={handleSave} disabled={busy}
            className="h-10 md:h-9 px-5 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold hover:bg-[#0077ED] disabled:opacity-40 transition">
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
