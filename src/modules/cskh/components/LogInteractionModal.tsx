// Form "Ghi tương tác" đầy đủ (port PRM LogInteractionModal): người liên hệ (tìm không
// dấu), công ty (khi người đó kiêm nhiều nơi), hình thức, ngày, nội dung, ai chủ động,
// việc tiếp theo + hạn nhanh → tự tạo việc trong Workspace.
import { useState } from 'react';
import type { CskhContact, InteractionType } from '../../../lib/cskh/types';
import { INTERACTION_LABEL, INTERACTION_TYPES } from '../../../lib/cskh/types';
import type { Client } from '../../../lib/types';
import { defaultClientIdOf, type InteractionInput } from '../data/api';
import { ContactPicker } from './ContactPicker';
import { EMPTY_FOLLOW_UP, inputCls, type FollowUpValue } from '../ui';
import { FollowUpPicker } from './FollowUpPicker';
import { ChoiceChip, Sheet } from './Sheet';

const labelCls = 'block text-[11.5px] font-medium text-[#666] mb-1';

export function LogInteractionModal({ contacts, clients, initialContactId, today, onSave, onClose }: {
  contacts: readonly CskhContact[];
  clients: readonly Client[];
  initialContactId?: string;
  today: string;
  /** Trả về câu lỗi hoặc null khi đã lưu. */
  onSave: (input: InteractionInput) => Promise<string | null>;
  onClose: () => void;
}) {
  const [contactId, setContactId] = useState(initialContactId ?? '');
  const [clientId, setClientId] = useState<string | null>(() => {
    const c = contacts.find(x => x.id === initialContactId);
    return c ? defaultClientIdOf(c) : null;
  });
  const [type, setType] = useState<InteractionType>('call');
  const [occurredAt, setOccurredAt] = useState(today);
  const [content, setContent] = useState('');
  const [theyInitiated, setTheyInitiated] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpValue>(EMPTY_FOLLOW_UP);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const contact = contacts.find(c => c.id === contactId) ?? null;
  const clientName = (id: string) => clients.find(c => c.id === id)?.name ?? 'Công ty';

  const pick = (c: CskhContact | null) => {
    setContactId(c?.id ?? '');
    setClientId(c ? defaultClientIdOf(c) : null);
  };

  const handleSave = async () => {
    if (!contact) { setError('Chọn người liên hệ'); return; }
    if (followUp.action.trim() && !followUp.due) { setError('Việc tiếp theo cần có hạn'); return; }
    if (occurredAt > today) { setError('Ngày tương tác không được ở tương lai'); return; }
    setSaving(true);
    setError('');
    const err = await onSave({
      contact,
      clientId,
      type,
      channel: type === 'call' ? 'call' : '',
      initiatedBy: theyInitiated ? 'them' : 'me',
      occurredAt,
      content,
      followUpAction: followUp.action,
      followUpDue: followUp.due || null,
    });
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <Sheet label="Ghi tương tác" onClose={onClose} wide>
      <h2 className="text-[16px] md:text-[15px] font-semibold text-[#111] mb-3">Ghi tương tác</h2>

      <div className="space-y-3">
        <div>
          <label className={labelCls}>Người liên hệ</label>
          <ContactPicker contacts={contacts} value={contactId} onChange={pick} />
        </div>

        {contact && contact.clientIds.length > 1 && (
          <div>
            <label className={labelCls}>Ghi cho công ty</label>
            <div className="flex flex-wrap gap-1.5">
              {contact.clientIds.map(id => (
                <ChoiceChip key={id} active={clientId === id} onClick={() => setClientId(id)}>{clientName(id)}</ChoiceChip>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_160px] gap-3">
          <div>
            <label className={labelCls}>Hình thức</label>
            <div className="flex flex-wrap gap-1.5">
              {INTERACTION_TYPES.map(t => (
                <ChoiceChip key={t} active={type === t} onClick={() => setType(t)}>{INTERACTION_LABEL[t]}</ChoiceChip>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Ngày</label>
            <input type="date" value={occurredAt} max={today} onChange={e => setOccurredAt(e.target.value)} className={inputCls} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px] text-[#444] cursor-pointer min-h-[40px] md:min-h-0">
          <input type="checkbox" checked={theyInitiated} onChange={e => setTheyInitiated(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          Họ chủ động liên hệ mình
        </label>

        <div>
          <label className={labelCls}>Nội dung quan trọng</label>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={3}
            className={`${inputCls} resize-y min-h-[72px]`}
            placeholder="VD: Chị Lan báo tháng 12 cần thêm 30 LĐ ca đêm cho xưởng 2; con trai vừa đậu đại học…" />
          <p className="text-[11px] text-[#aaa] mt-1">Ghi đủ chi tiết để lần sau mở ra là nhớ ngay bối cảnh (≥ 80 ký tự được trọn điểm ghi chú).</p>
        </div>

        <div className="pt-3 border-t border-[#E8E7E2]">
          <p className="text-[11.5px] font-medium text-[#666] mb-1.5">Việc tiếp theo (tuỳ chọn) — tự tạo việc trong Workspace, giao cho người phụ trách</p>
          <FollowUpPicker value={followUp} onChange={setFollowUp} today={today} />
        </div>
      </div>

      {error && <p className="mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onClose}
          className="flex-1 h-11 md:h-9 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-gray-600 hover:bg-gray-50">Huỷ</button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-[2] h-11 md:h-9 rounded-lg bg-[#1D4ED8] text-white text-[13px] font-semibold hover:bg-[#1E40AF] disabled:bg-gray-400">
          {saving ? 'Đang lưu…' : 'Lưu nhật ký'}
        </button>
      </div>
    </Sheet>
  );
}
