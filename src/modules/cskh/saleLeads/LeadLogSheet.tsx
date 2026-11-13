// Ghi 1 lần gọi / nhắn với đầu mối: kênh + kết quả (đổi tình trạng) + ghi chú. Hiện lại các lần trước
// để biết đã nói gì — tránh gọi lại mà không nhớ lần trước.
import { useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { todayVN } from '../../../lib/cskh/dates';
import { logLeadContact } from '../../../lib/saleLeads/api';
import { formatPhoneKey } from '../../../lib/saleLeads/parse';
import {
  LEAD_CHANNEL_LABEL, LEAD_CHANNELS, LEAD_CONTACT_RESULTS, SALE_LEAD_STATUS_HINT, SALE_LEAD_STATUS_LABEL,
  type LeadChannel, type LeadContactResult, type SaleLead,
} from '../../../lib/saleLeads/types';
import { ChoiceChip, Sheet, SHEET_FOOTER } from '../components/Sheet';
import { inputCls } from '../ui';
import { StatusPill } from './parts';
import { vnDate } from './helpers';

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1.5';

/** "YYYY-MM-DD" (giờ VN) + giờ hiện tại → ISO. Ngày hôm nay → đúng lúc này. */
function atOf(date: string): string {
  const now = new Date();
  if (date === todayVN(now)) return now.toISOString();
  return new Date(`${date}T09:00:00+07:00`).toISOString();
}

export function LeadLogSheet({ lead, channel: initialChannel = 'call', toast, onClose, onSaved }: {
  lead: SaleLead;
  channel?: LeadChannel;
  toast: (m: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [channel, setChannel] = useState<LeadChannel>(initialChannel);
  const [result, setResult] = useState<LeadContactResult | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayVN());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!result) { setError('Chọn kết quả'); return; }
    if (date > todayVN()) { setError('Ngày liên hệ không được ở tương lai'); return; }
    setSaving(true);
    setError('');
    try {
      await logLeadContact(lead, { at: atOf(date), channel, result, note }, user);
      toast(`Đã ghi: ${lead.fullName || lead.phone} — ${SALE_LEAD_STATUS_LABEL[result]}`);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const history = [...lead.contactLog].reverse();
  return (
    <Sheet label={`Ghi lần liên hệ với ${lead.fullName || lead.phone}`} onClose={onClose}>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] pr-10">Ghi lần liên hệ</h2>
      <p className="text-[13px] text-[#6E6E73] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <b className="text-[#1D1D1F]">{lead.fullName || '(chưa ghi tên)'}</b>
        {lead.phoneKeys[0] && <span className="tabular-nums">{formatPhoneKey(lead.phoneKeys[0])}</span>}
        {lead.company && <span>· {lead.company}</span>}
        <StatusPill status={lead.status} />
      </p>

      <div className="mt-4 space-y-3.5 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4">
        <div>
          <span className={labelCls}>Kênh</span>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_CHANNELS.map(c => <ChoiceChip key={c} active={channel === c} onClick={() => setChannel(c)}>{LEAD_CHANNEL_LABEL[c]}</ChoiceChip>)}
          </div>
        </div>
        <div>
          <span className={labelCls}>Kết quả</span>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_CONTACT_RESULTS.map(r => (
              <span key={r} title={SALE_LEAD_STATUS_HINT[r]}><ChoiceChip active={result === r} onClick={() => setResult(r)}>{SALE_LEAD_STATUS_LABEL[r]}</ChoiceChip></span>
            ))}
          </div>
          {result === 'meeting' && <p className="text-[12px] text-[#8944AB] mt-1.5">Gặp xong thì bấm «Chuyển sang Sale / CTV» ở dòng này để đưa vào danh sách chăm sóc.</p>}
          {lead.status === 'promoted' && <p className="text-[12px] text-[#86868B] mt-1.5">Đầu mối đã chuyển sang Sale / CTV — chỉ thêm vào nhật ký, tình trạng giữ nguyên.</p>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_150px] gap-3">
          <div>
            <label className={labelCls} htmlFor="lead-log-note">Ghi chú</label>
            <textarea id="lead-log-note" rows={2} value={note} onChange={e => setNote(e.target.value)} className={`${inputCls} resize-y`}
              placeholder="VD: Hẹn thứ 6 cà phê ở Bình Dương, đang làm cho Manpower" />
          </div>
          <div>
            <label className={labelCls} htmlFor="lead-log-date">Ngày</label>
            <input id="lead-log-date" type="date" value={date} max={todayVN()} onChange={e => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <section className="mt-4">
          <h3 className="px-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1.5">Các lần trước · {history.length}</h3>
          <ul className="rounded-[14px] bg-white md:bg-[#F5F5F7] px-3.5 md:px-4 divide-y divide-[#E5E5EA]">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="py-2.5 text-[13px] leading-snug">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b className="font-semibold text-[#1D1D1F] tabular-nums">{vnDate(h.at)}</b>
                  <span className="text-[#6E6E73]">{LEAD_CHANNEL_LABEL[h.channel]}</span>
                  <StatusPill status={h.result} />
                  {h.by && <span className="text-[12px] text-[#86868B]">· {h.by}</span>}
                </span>
                {h.note && <span className="block text-[#3C3C43] mt-0.5 whitespace-pre-line">{h.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="mt-3 text-[13px] text-[#D70015]">{error}</p>}

      <div className={`${SHEET_FOOTER} mt-4 flex items-center justify-end gap-2 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <button type="button" onClick={onClose} className="h-10 md:h-9 px-4 rounded-full text-[13px] font-medium text-[#1D1D1F] bg-black/[0.05] hover:bg-black/[0.08] transition">Huỷ</button>
        <button type="button" onClick={save} disabled={saving || !result}
          className="h-10 md:h-9 px-5 rounded-full text-[13px] font-semibold text-white bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-40 transition">
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </Sheet>
  );
}
