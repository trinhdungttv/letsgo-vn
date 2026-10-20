// Bottom sheet ghi nhận nhanh (port PRM QuickLogSheet): 1 chạm "Đã liên hệ" là lưu —
// kênh + loại tự điền. Phần mở rộng gập sẵn: ghi chú 1 dòng, kết quả nhanh,
// "Họ chủ động liên hệ", việc tiếp theo + hạn nhanh. Nút "Chưa" = bỏ qua, không hỏi lại.
import { useState } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { interactionTypeOfChannel, type ContactActionChannel } from '../../../lib/cskh/contactActions';
import { hasRememberNotes, REMEMBER_KEYS } from '../../../lib/cskh/remember';
import type { CskhContact, InitiatedBy, InteractionChannel, InteractionType } from '../../../lib/cskh/types';
import { CHANNEL_LABEL, INTERACTION_LABEL, REMEMBER_LABEL } from '../../../lib/cskh/types';
import { EMPTY_FOLLOW_UP, inputCls, type FollowUpValue } from '../ui';
import { FollowUpPicker } from './FollowUpPicker';
import { ChoiceChip, Sheet } from './Sheet';

export interface QuickLogInput {
  type: InteractionType;
  channel: InteractionChannel;
  initiatedBy: InitiatedBy;
  content: string;
  followUpAction: string;
  followUpDue: string | null;
}

/** Hình thức khi ghi thủ công (gặp trực tiếp…). */
const MANUAL_TYPES: readonly InteractionType[] = ['meet', 'coffee', 'call', 'message', 'gift', 'other'];

const OUTCOMES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'good', label: 'Vui vẻ' },
  { id: 'neutral', label: 'Bình thường' },
  { id: 'attention', label: 'Cần chú ý' },
];

export function RememberList({ contact }: { contact: Pick<CskhContact, 'rememberNotes'> }) {
  if (!hasRememberNotes(contact.rememberNotes)) return null;
  return (
    <dl className="mt-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-[10px] px-3 py-2 space-y-1">
      {REMEMBER_KEYS.filter(k => (contact.rememberNotes[k] ?? '').trim() !== '').map(k => (
        <div key={k} className="text-[12.5px] leading-snug">
          <dt className="inline font-semibold text-[#92400E]">{REMEMBER_LABEL[k]}: </dt>
          <dd className="inline text-[#333]">{contact.rememberNotes[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function QuickLogSheet({ contact, channel, today, onSave, onSkip }: {
  contact: CskhContact;
  /** Kênh vừa bấm (Gọi/Zalo/SMS); null = ghi nhận thủ công. */
  channel: ContactActionChannel | null;
  today: string;
  /** Trả về câu lỗi (giữ sheet mở) hoặc null khi đã lưu. */
  onSave: (input: QuickLogInput) => Promise<string | null>;
  onSkip: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [manualType, setManualType] = useState<InteractionType>('meet');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [theyInitiated, setTheyInitiated] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpValue>(EMPTY_FOLLOW_UP);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const action = followUp.action.trim();
    if (action !== '' && followUp.due === '') {
      setError('Việc tiếp theo cần có hạn');
      setExpanded(true);
      return;
    }
    const outcomeLabel = OUTCOMES.find(o => o.id === outcome)?.label;
    const content = [outcomeLabel ? `Kết quả: ${outcomeLabel}` : '', note.trim()].filter(Boolean).join(' — ');
    setSaving(true);
    setError('');
    const err = await onSave({
      type: channel ? interactionTypeOfChannel(channel) : manualType,
      channel: channel ?? '',
      initiatedBy: theyInitiated ? 'them' : 'me',
      content,
      followUpAction: action,
      followUpDue: action !== '' ? followUp.due : null,
    });
    setSaving(false);
    if (err) setError(err);
  };

  const via = channel ? ` qua ${CHANNEL_LABEL[channel]}` : '';

  return (
    <Sheet label={`Ghi nhận liên hệ với ${contact.fullName}`} onClose={onSkip}>
      <p className="text-[16px] md:text-[15px] font-semibold text-[#111] pr-6">
        {channel ? 'Đã liên hệ với ' : 'Ghi nhận đã liên hệ với '}
        <span className="text-[#1D4ED8]">{contact.fullName}</span>{via}?
      </p>
      <p className="text-[12px] text-[#888] mt-0.5">
        {contact.organization ? `${contact.organization} · ` : ''}Một chạm là xong — chi tiết thêm nếu muốn.
      </p>

      <RememberList contact={contact} />

      {channel === null && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {MANUAL_TYPES.map(t => (
            <ChoiceChip key={t} active={manualType === t} onClick={() => setManualType(t)}>{INTERACTION_LABEL[t]}</ChoiceChip>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 mt-4">
        <button type="button" onClick={onSkip} disabled={saving}
          className="flex-1 h-12 md:h-10 rounded-[12px] border border-gray-300 bg-white text-[14px] md:text-[13px] font-medium text-gray-600 hover:bg-gray-50">
          Chưa
        </button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-[2] h-12 md:h-10 rounded-[12px] bg-[#1D4ED8] text-white text-[14px] md:text-[13px] font-semibold hover:bg-[#1E40AF] disabled:bg-gray-400 inline-flex items-center justify-center gap-1.5">
          <Check size={17} strokeWidth={2.6} /> {saving ? 'Đang lưu…' : 'Đã liên hệ'}
        </button>
      </div>

      <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}
        className="mt-3 w-full flex items-center justify-center gap-1 text-[12.5px] text-[#666] py-1.5 hover:text-[#1D4ED8]">
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Thu gọn' : 'Thêm ghi chú, việc tiếp theo'}
      </button>

      {expanded && (
        <div className="space-y-3 mt-1">
          <input type="text" value={note} onChange={e => setNote(e.target.value)} className={inputCls}
            placeholder="Ghi chú 1 dòng (nói gì, hứa gì…)" aria-label="Ghi chú" />
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map(o => (
              <ChoiceChip key={o.id} active={outcome === o.id} onClick={() => setOutcome(outcome === o.id ? null : o.id)}>{o.label}</ChoiceChip>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[#444] cursor-pointer min-h-[40px] md:min-h-0">
            <input type="checkbox" checked={theyInitiated} onChange={e => setTheyInitiated(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            Họ chủ động liên hệ mình
          </label>
          <div>
            <p className="text-[11.5px] font-medium text-[#666] mb-1.5">Việc tiếp theo (tuỳ chọn) — tự tạo việc trong Workspace</p>
            <FollowUpPicker value={followUp} onChange={setFollowUp} today={today} />
          </div>
        </div>
      )}
    </Sheet>
  );
}
