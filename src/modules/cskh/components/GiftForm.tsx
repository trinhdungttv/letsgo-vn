// Form ghi quà (port PRM OccasionsPage — "tránh tặng trùng, thể hiện sự tinh tế"):
// Mình tặng / Họ tặng · món quà · giá trị (VND, tuỳ chọn) · ngày · gắn sự kiện · ghi chú.
// Quà gắn với công ty của người đó (client_gifts) — người kiêm nhiều công ty thì chọn.
import { useMemo, useState } from 'react';
import { formatCurrencyFull } from '../../../lib/format';
import { todayVN } from '../../../lib/cskh/dates';
import type { CskhContact, CskhGift, CskhOccasion, GiftDirection } from '../../../lib/cskh/types';
import { GIFT_DIRECTION_LABEL } from '../../../lib/cskh/types';
import type { Client } from '../../../lib/types';
import { defaultClientIdOf, type GiftInput } from '../data/api';
import { inputCls } from '../ui';
import { ContactPicker } from './ContactPicker';
import { ChoiceChip, Sheet } from './Sheet';

const labelCls = 'block text-[11.5px] font-medium text-[#666] mb-1';

export function GiftForm({ contacts, clients, occasions, gifts, existing, initialContactId, onSave, onClose }: {
  contacts: readonly CskhContact[];
  clients: readonly Client[];
  occasions: readonly CskhOccasion[];
  /** Quà đã ghi — hiện "đã tặng gì trước đây" để tránh tặng trùng. */
  gifts: readonly CskhGift[];
  existing: CskhGift | null;
  initialContactId?: string;
  onSave: (input: GiftInput) => Promise<string | null>;
  onClose: () => void;
}) {
  const [contactId, setContactId] = useState(existing?.contactId ?? initialContactId ?? '');
  const contact = contacts.find(c => c.id === contactId) ?? null;
  const [clientId, setClientId] = useState<string | null>(existing?.clientId ?? (contact ? defaultClientIdOf(contact) : null));
  const [direction, setDirection] = useState<GiftDirection>(existing?.direction ?? 'given');
  const [item, setItem] = useState(existing?.item ?? '');
  const [value, setValue] = useState(existing?.estimatedValue != null ? String(existing.estimatedValue) : '');
  const [givenAt, setGivenAt] = useState(existing?.givenAt ?? todayVN());
  const [occasionId, setOccasionId] = useState(existing?.occasionId ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const myOccasions = occasions.filter(o => o.contactId === contactId && o.source === 'special_date' && !o.isArchived);
  const past = useMemo(
    () => gifts.filter(g => g.contactId === contactId && !g.isArchived && g.id !== existing?.id).slice(0, 5),
    [gifts, contactId, existing?.id],
  );
  const amount = value.replace(/\D/g, '') ? Number(value.replace(/\D/g, '')) : null;
  const clientName = (id: string) => clients.find(c => c.id === id)?.name ?? 'Công ty';

  const handleSave = async () => {
    if (!contact) { setError('Chọn người liên hệ'); return; }
    setSaving(true);
    setError('');
    const err = await onSave({
      contact, clientId, direction, item, estimatedValue: amount, givenAt,
      occasionId: occasionId || null, note,
    });
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <Sheet label={existing ? 'Sửa quà' : 'Ghi quà'} onClose={onClose} wide>
      <h2 className="text-[16px] md:text-[15px] font-semibold text-[#111] mb-3">{existing ? 'Sửa quà' : 'Ghi quà'}</h2>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Người liên hệ</label>
          <ContactPicker contacts={contacts} value={contactId} autoFocus={!existing}
            onChange={c => { setContactId(c?.id ?? ''); setClientId(c ? defaultClientIdOf(c) : null); setOccasionId(''); }} />
          {contact && contact.clientIds.length === 0 && (
            <p className="text-[11.5px] text-amber-700 mt-1">Người này chưa gắn công ty — gắn công ty trong hồ sơ trước khi ghi quà.</p>
          )}
        </div>
        {contact && contact.clientIds.length > 1 && (
          <div>
            <label className={labelCls}>Ghi cho công ty</label>
            <div className="flex flex-wrap gap-1.5">
              {contact.clientIds.map(id => <ChoiceChip key={id} active={clientId === id} onClick={() => setClientId(id)}>{clientName(id)}</ChoiceChip>)}
            </div>
          </div>
        )}
        {past.length > 0 && (
          <div className="bg-[#F7F6F2] rounded-lg px-3 py-2 text-[11.5px] text-[#666]">
            <b className="text-[#444]">Đã ghi trước đây:</b>{' '}
            {past.map(g => `${g.item} (${GIFT_DIRECTION_LABEL[g.direction].toLowerCase()} ${g.givenAt.slice(8, 10)}/${g.givenAt.slice(5, 7)}/${g.givenAt.slice(0, 4)})`).join(' · ')}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <ChoiceChip active={direction === 'given'} onClick={() => setDirection('given')}>Mình tặng</ChoiceChip>
          <ChoiceChip active={direction === 'received'} onClick={() => setDirection('received')}>Họ tặng</ChoiceChip>
        </div>
        <div>
          <label className={labelCls}>Món quà</label>
          <input value={item} onChange={e => setItem(e.target.value)} className={inputCls} placeholder="VD: Giỏ trái cây, rượu vang, bánh trung thu" maxLength={200} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Giá trị (VND, tuỳ chọn)</label>
            <input value={value} onChange={e => setValue(e.target.value)} inputMode="numeric" className={inputCls} placeholder="500000" />
            {amount !== null && <p className="text-[10.5px] text-[#888] mt-0.5">{formatCurrencyFull(amount)}</p>}
          </div>
          <div>
            <label className={labelCls}>Ngày</label>
            <input type="date" value={givenAt} onChange={e => setGivenAt(e.target.value)} className={inputCls} />
          </div>
        </div>
        {myOccasions.length > 0 && (
          <div>
            <label className={labelCls}>Gắn với sự kiện (tuỳ chọn)</label>
            <select value={occasionId} onChange={e => setOccasionId(e.target.value)} className={inputCls}>
              <option value="">— Không gắn —</option>
              {myOccasions.map(o => <option key={o.id} value={o.id}>{o.title}{o.relatedPerson ? ` · ${o.relatedPerson}` : ''}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={labelCls}>Ghi chú</label>
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className={`${inputCls} resize-y`} placeholder="VD: anh ấy rất thích, nên tặng lại loại này" />
        </div>
      </div>
      {error && <p className="mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onClose} className="flex-1 h-11 md:h-9 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-gray-600">Huỷ</button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-[2] h-11 md:h-9 rounded-lg bg-[#1D4ED8] text-white text-[13px] font-semibold disabled:bg-gray-400">
          {saving ? 'Đang lưu…' : existing ? 'Lưu quà' : 'Ghi quà'}
        </button>
      </div>
    </Sheet>
  );
}
