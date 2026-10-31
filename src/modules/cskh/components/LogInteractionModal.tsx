// Form "Ghi tương tác" đầy đủ (port PRM LogInteractionModal): người liên hệ (tìm không
// dấu), công ty (khi người đó kiêm nhiều nơi), hình thức, ngày, nội dung, ai chủ động,
// việc tiếp theo + hạn nhanh → tự tạo việc trong Workspace.
// Hình thức "Quà tặng": thêm ô món quà (mình tặng / họ tặng, giá trị, sự kiện) → ghi luôn vào
// Sự kiện & Quà tặng → Lịch sử quà; sửa / xoá dòng nhật ký thì món quà đi theo.
// Có `existing` = SỬA dòng nhật ký: điền sẵn, khoá người liên hệ, lưu qua onUpdate.
// Ghi mới: đang gõ dở thì tự lưu nháp trên máy (logDraft.ts) — lỡ tay đóng, mở lại vẫn còn.
import { useEffect, useRef, useState } from 'react';
import { clearLogDraft, getLogDraftStorage, loadLogDraft, logDraftHasContent, logDraftSavedLabel, saveLogDraft, type LogDraft } from '../../../lib/cskh/logDraft';
import { EMPTY_GIFT_DRAFT, giftDraftOf, giftInputOf, giftOfLog, type LogGiftDraft } from '../../../lib/cskh/logGift';
import type { CskhContact, CskhGift, CskhInteraction, CskhOccasion, InteractionType } from '../../../lib/cskh/types';
import { INTERACTION_LABEL, INTERACTION_TYPES } from '../../../lib/cskh/types';
import type { Client } from '../../../lib/types';
import { defaultClientIdOf, type InteractionEdit, type InteractionInput } from '../data/api';
import { ContactAvatar } from './ContactAvatar';
import { ContactPicker } from './ContactPicker';
import { EMPTY_FOLLOW_UP, inputCls, type FollowUpValue } from '../ui';
import { FollowUpPicker } from './FollowUpPicker';
import { LogGiftFields } from './LogGiftFields';
import { ChoiceChip, Sheet } from './Sheet';

/** Việc thêm trên form: có taskId = việc đang có trong Workspace; done = đã xong (chỉ xem). */
type ExtraRow = FollowUpValue & { taskId?: string; done?: boolean };

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';

export function LogInteractionModal({ contacts, clients, gifts = [], occasions = [], initialContactId, existing, today, onSave, onUpdate, onClose }: {
  contacts: readonly CskhContact[];
  clients: readonly Client[];
  /** Quà đã ghi — tìm món quà của dòng đang sửa + gợi ý "đã tặng gì" để tránh tặng trùng. */
  gifts?: readonly CskhGift[];
  /** Sự kiện — để gắn món quà vào một dịp. */
  occasions?: readonly CskhOccasion[];
  initialContactId?: string;
  /** Dòng nhật ký đang sửa (không có = ghi mới). */
  existing?: CskhInteraction;
  today: string;
  /** Ghi mới — trả về câu lỗi hoặc null khi đã lưu. */
  onSave?: (input: InteractionInput) => Promise<string | null>;
  /** Lưu thay đổi khi sửa — trả về câu lỗi hoặc null khi đã lưu. */
  onUpdate?: (edit: InteractionEdit) => Promise<string | null>;
  onClose: () => void;
}) {
  const editing = !!existing;
  // Nháp gõ dở lần trước (chỉ khi ghi mới) — người trong nháp đã bị xoá thì bỏ người, giữ chữ
  const [draft, setDraft] = useState<LogDraft | null>(() => (existing ? null : loadLogDraft(getLogDraftStorage(), initialContactId, Date.now())));
  const draftContact = draft ? contacts.find(c => c.id === draft.contactId) ?? null : null;
  const [contactId, setContactId] = useState(existing?.contactId ?? initialContactId ?? draftContact?.id ?? '');
  const [clientId, setClientId] = useState<string | null>(() => {
    if (existing) return existing.clientId;
    if (draftContact && draft?.clientId && draftContact.clientIds.includes(draft.clientId)) return draft.clientId;
    const c = contacts.find(x => x.id === (initialContactId ?? draftContact?.id));
    return c ? defaultClientIdOf(c) : null;
  });
  const [type, setType] = useState<InteractionType>(existing?.type ?? draft?.type ?? 'call');
  const [occurredAt, setOccurredAt] = useState(existing?.occurredAt ?? (draft?.occurredAt || today));
  const [content, setContent] = useState(existing?.content ?? draft?.content ?? '');
  const [theyInitiated, setTheyInitiated] = useState(existing ? existing.initiatedBy === 'them' : !!draft?.theyInitiated);
  const [followUp, setFollowUp] = useState<FollowUpValue>(
    existing ? { action: existing.followUpAction, due: existing.followUpDue ?? '' } : draft?.followUp ?? EMPTY_FOLLOW_UP,
  );
  const [extras, setExtras] = useState<ExtraRow[]>(
    () => existing
      ? existing.extraTasks.map(t => ({ taskId: t.id, action: t.action, due: t.due ?? '', done: t.done }))
      : draft?.extras ?? [],
  );
  const existingGift = existing ? giftOfLog(gifts, existing) : null;
  const [giftDraft, setGiftDraft] = useState<LogGiftDraft>(() => {
    if (existing || !draft) return giftDraftOf(existingGift);
    // Sự kiện đã bị xoá / thuộc người khác thì bỏ gắn
    const okOccasion = occasions.some(o => o.id === draft.gift.occasionId && o.contactId === draftContact?.id);
    return { ...draft.gift, occasionId: okOccasion ? draft.gift.occasionId : '' };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Tự lưu nháp mỗi lần sửa form (ghi mới). Khoá theo người: đổi người giữa chừng thì nháp đi theo.
  const draftKey = useRef<string | null>(draft ? draft.contactId : null);
  const draftValue = { contactId, clientId, type, occurredAt, content, theyInitiated, followUp, extras: extras.map(e => ({ action: e.action, due: e.due })), gift: giftDraft };
  const dirty = !editing && logDraftHasContent(draftValue);
  useEffect(() => {
    if (editing) return;
    saveLogDraft(getLogDraftStorage(), { ...draftValue, savedAt: Date.now() }, draftKey.current);
    draftKey.current = contactId;
    // draftValue dựng lại mỗi lần render — chỉ cần chạy khi các ô của form đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, contactId, clientId, type, occurredAt, content, theyInitiated, followUp, extras, giftDraft]);

  /** Bỏ nháp, về form trắng (giữ người liên hệ nếu form mở cho 1 người cụ thể). */
  const resetForm = () => {
    clearLogDraft(getLogDraftStorage(), contactId, Date.now());
    const c = contacts.find(x => x.id === initialContactId);
    setContactId(initialContactId ?? '');
    setClientId(c ? defaultClientIdOf(c) : null);
    setType('call');
    setOccurredAt(today);
    setContent('');
    setTheyInitiated(false);
    setFollowUp(EMPTY_FOLLOW_UP);
    setExtras([]);
    setGiftDraft(EMPTY_GIFT_DRAFT);
    setDraft(null);
    setError('');
  };

  // "Huỷ" là chủ ý bỏ → hỏi trước nếu đang gõ dở rồi xoá nháp; còn bấm nền / Esc / X thì giữ nháp
  const handleCancel = () => {
    if (dirty) {
      if (!confirm('Bỏ nội dung đang nhập dở?\n\n(Chỉ muốn đóng tạm thì bấm ra ngoài hoặc nút X — nội dung vẫn được giữ.)')) return;
      clearLogDraft(getLogDraftStorage(), contactId, Date.now());
    }
    onClose();
  };

  const contact = contacts.find(c => c.id === contactId) ?? null;
  // Dòng cũ chưa gắn người (contact = null) không ghi quà được
  const giftActive = type === 'gift' && !!contact;
  // Sale (Mạng lưới Sale) không gắn công ty khách — quà ghi không cần công ty
  const giftNeedsClient = contact?.kind !== 'sale';
  const clientName = (id: string) => clients.find(c => c.id === id)?.name ?? 'Công ty';

  const pick = (c: CskhContact | null) => {
    setContactId(c?.id ?? '');
    setClientId(c ? defaultClientIdOf(c) : null);
    setGiftDraft(d => ({ ...d, occasionId: '' }));
  };

  const handleSave = async () => {
    if (!editing && !contact) { setError('Chọn người liên hệ'); return; }
    if (followUp.action.trim() && !followUp.due) { setError('Việc tiếp theo cần có hạn'); return; }
    if (!editing && !followUp.action.trim() && extras.some(e => e.action.trim())) { setError('Điền việc tiếp theo ở ô đầu trước, rồi mới thêm việc khác'); return; }
    if (extras.some(e => e.action.trim() && !e.due)) { setError('Mỗi việc cần có hạn'); return; }
    if (!occurredAt) { setError('Chọn ngày tương tác'); return; }
    if (occurredAt > today) { setError('Ngày tương tác không được ở tương lai'); return; }
    const giftInput = giftInputOf(giftDraft);
    if (giftActive && !giftInput.item && (!editing || existingGift)) {
      setError(editing ? 'Nhập món quà — hoặc đổi sang hình thức khác để bỏ món quà này khỏi Lịch sử quà' : 'Nhập món quà (sẽ ghi vào Lịch sử quà)');
      return;
    }
    if (giftActive && giftInput.item && !clientId && giftNeedsClient) { setError('Người này chưa gắn công ty — gắn công ty trong hồ sơ trước khi ghi quà'); return; }
    // Đổi dòng "Quà tặng" sang hình thức khác = bỏ món quà khỏi Lịch sử quà → hỏi trước (xoá mềm, khôi phục được)
    const dropGift = editing && existing.type === 'gift' && type !== 'gift' && !!existingGift;
    if (dropGift && !confirm(`Đổi sang hình thức khác “Quà tặng” thì món quà “${existingGift.item}” sẽ bị bỏ khỏi Lịch sử quà.\n\nKhôi phục được ở trang Lịch sử. Tiếp tục?`)) return;
    setSaving(true);
    setError('');
    if (existing) {
      const err = await onUpdate?.({
        clientId,
        type,
        // Dòng cũ không rõ ai chủ động: giữ "không rõ" nếu vẫn không đánh dấu
        initiatedBy: theyInitiated ? 'them' : existing.initiatedBy === null ? null : 'me',
        occurredAt,
        content,
        followUpAction: followUp.action,
        followUpDue: followUp.due || null,
        extraFollowUps: extras.filter(e => e.action.trim()).map(e => ({ taskId: e.taskId, action: e.action, due: e.due })),
        gift: giftActive ? giftInput : dropGift ? null : undefined,
      }) ?? null;
      setSaving(false);
      if (err) setError(err);
      return;
    }
    if (!contact) return;
    const err = await onSave?.({
      contact,
      clientId,
      type,
      channel: type === 'call' ? 'call' : '',
      initiatedBy: theyInitiated ? 'them' : 'me',
      occurredAt,
      content,
      followUpAction: followUp.action,
      followUpDue: followUp.due || null,
      extraFollowUps: extras.filter(e => e.action.trim()),
      gift: giftActive ? giftInput : undefined,
    });
    setSaving(false);
    if (err) setError(err);
    else clearLogDraft(getLogDraftStorage(), contactId, Date.now());
  };

  return (
    <Sheet label={editing ? 'Sửa nhật ký' : 'Ghi tương tác'} onClose={onClose} wide>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] mb-3">{editing ? 'Sửa nhật ký' : 'Ghi tương tác'}</h2>

      {draft && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] bg-[#0071E3]/[0.08] px-3.5 py-2.5 text-[12.5px] text-[#0058B0]">
          <span className="flex-1 min-w-[200px]">Đã mở lại nội dung đang nhập dở {logDraftSavedLabel(draft.savedAt, Date.now())}.</span>
          <button type="button" onClick={resetForm} className="font-semibold hover:opacity-70 min-h-[32px] md:min-h-0">Bỏ nháp, nhập mới</button>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className={labelCls}>Người liên hệ</label>
          {existing ? (
            // Sửa: không đổi người (ghi nhầm người thì xoá dòng rồi ghi lại cho đúng người)
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-[12px] bg-black/[0.04]">
              <ContactAvatar name={contact?.fullName || existing.contactPerson || '?'} url={contact?.avatarUrl || undefined} tier={contact?.tier ?? 'unclassified'} size={30} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[#1D1D1F] truncate">{contact?.fullName || existing.contactPerson || 'Không rõ người liên hệ'}</div>
                <div className="text-[11.5px] text-[#86868B] truncate">
                  {[contact?.organization || existing.clientName, existing.createdByName && `ghi bởi ${existing.createdByName}`].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          ) : (
            <ContactPicker contacts={contacts} value={contactId} onChange={pick} />
          )}
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

        {giftActive && (
          <LogGiftFields
            draft={giftDraft}
            onChange={setGiftDraft}
            past={gifts.filter(g => g.contactId === contactId && !g.isArchived && g.id !== existingGift?.id)}
            occasions={occasions.filter(o => o.contactId === contactId && o.source === 'special_date' && !o.isArchived)}
            notice={!clientId && giftNeedsClient
              ? { tone: 'warn', text: 'Người này chưa gắn công ty — gắn công ty trong hồ sơ trước khi ghi quà (Lịch sử quà tính theo công ty).' }
              : editing && !existingGift
                ? { tone: 'info', text: 'Nhật ký này chưa có món quà trong Lịch sử quà — điền món quà để ghi bổ sung (bỏ trống thì giữ nguyên).' }
                : null}
          />
        )}

        <label className="flex items-center gap-2 text-[13px] text-[#3A3A3C] cursor-pointer min-h-[40px] md:min-h-0">
          <input type="checkbox" checked={theyInitiated} onChange={e => setTheyInitiated(e.target.checked)} className="w-4 h-4 accent-[#0071E3]" />
          Họ chủ động liên hệ mình
        </label>

        <div>
          <label className={labelCls}>Nội dung quan trọng</label>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={3}
            className={`${inputCls} resize-y min-h-[72px]`}
            placeholder="VD: Chị Lan báo tháng 12 cần thêm 30 LĐ ca đêm cho xưởng 2; con trai vừa đậu đại học…" />
          <p className="text-[11px] text-[#AEAEB2] mt-1">Ghi đủ chi tiết để lần sau mở ra là nhớ ngay bối cảnh (≥ 80 ký tự được trọn điểm ghi chú).</p>
        </div>

        <div className="pt-3 border-t border-black/[0.08]">
          <p className="text-[12px] font-medium text-[#6E6E73] mb-1.5">
            {existing?.followUpTaskId || existing?.extraTasks.length
              ? 'Việc tiếp theo — sửa chữ / hạn thì việc trong Workspace đổi theo; xoá trắng / bỏ việc thì việc chưa xong bị xoá'
              : 'Việc tiếp theo (tuỳ chọn) — tự tạo việc trong Workspace, giao cho người phụ trách'}
          </p>
          <FollowUpPicker value={followUp} onChange={setFollowUp} today={today} minDate={occurredAt} />
          {extras.map((e, i) => (
            <div key={e.taskId ?? `new-${i}`} className="mt-2.5 pt-2.5 border-t border-dashed border-black/[0.1]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11.5px] text-[#86868B]">Việc thứ {i + 2}{e.taskId ? ' · có trong Workspace' : ''}</span>
                {!e.done && (
                  <button type="button" onClick={() => setExtras(list => list.filter((_, j) => j !== i))}
                    className="text-[12px] font-medium text-[#D70015] hover:opacity-70">Bỏ việc này</button>
                )}
              </div>
              {e.done ? (
                <p className="text-[13px] text-[#86868B]"><span className="line-through">{e.action}</span> <span className="text-[#248A3D] font-medium">· Đã xong</span></p>
              ) : (
                <FollowUpPicker value={e} today={today} minDate={occurredAt} placeholder="VD: nhắc ký phụ lục hợp đồng…"
                  onChange={v => setExtras(list => list.map((x, j) => (j === i ? { ...x, ...v } : x)))} />
              )}
            </div>
          ))}
          {(editing || followUp.action.trim() !== '') && extras.length < 8 && (
            <button type="button" onClick={() => setExtras(list => [...list, { ...EMPTY_FOLLOW_UP }])}
              className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-[#0066CC] hover:opacity-70 min-h-[32px]">
              + Thêm việc khác
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-[13px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{error}</p>}

      {dirty && <p className="mt-3 text-[11px] text-[#AEAEB2]">✓ Đã lưu nháp trên máy này — lỡ tay đóng, mở lại vẫn còn.</p>}

      <div className={`flex gap-2 ${dirty ? 'mt-2' : 'mt-4'}`}>
        <button type="button" onClick={handleCancel}
          className="flex-1 h-11 md:h-9 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] active:scale-[0.98] transition">Huỷ</button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-[2] h-11 md:h-9 rounded-full bg-[#0071E3] text-white active:scale-[0.98] transition text-[13px] font-semibold hover:bg-[#0077ED] disabled:opacity-40">
          {saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Lưu nhật ký'}
        </button>
      </div>
    </Sheet>
  );
}
