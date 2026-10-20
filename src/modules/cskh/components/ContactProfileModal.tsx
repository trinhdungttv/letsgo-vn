// ============================================================================
// Hồ sơ người liên hệ (port PRM ContactModal) — mở từ mọi tab CSKH.
// ----------------------------------------------------------------------------
// Phần dùng chung với hồ sơ Khách hàng (tên, SĐT, email, công ty, chức vụ, địa chỉ,
// ngày sinh, sở thích, ảnh…) lưu qua lib/contactOps để giữ nguyên quy tắc gắn công ty,
// liên hệ chính, lịch sử chuyển công ty. Phần riêng CSKH (nhóm, nhịp riêng, người phụ
// trách, Điều cần nhớ, thấu hiểu…) lưu thẳng cột migration 169.
// Ngày đặc biệt + ghi chú chi tiết vẫn ở form đầy đủ (nút "Form đầy đủ") tới giai đoạn 5.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCheck, ExternalLink, FileText, Map as MapIcon, PenLine, Plus, Star, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { useProvinces } from '../../../hooks/useProvinces';
import { CONTACT_CHANNELS, deactivateContact, reactivateContact } from '../../../lib/contactOps';
import { buildContactStats, dueLabel } from '../../../lib/cskh/cadence';
import { contactActionLinks } from '../../../lib/cskh/contactActions';
import { formatDateVN, todayVN } from '../../../lib/cskh/dates';
import { emitCskhDataChanged } from '../../../lib/cskh/events';
import { REMEMBER_KEYS, REMEMBER_MAX_CHARS, REMEMBER_PLACEHOLDER } from '../../../lib/cskh/remember';
import { SCORE_GRADE_LABEL, scoreGrade, weakestPart } from '../../../lib/cskh/score';
import type { CskhContext, CskhInteraction, RememberNotes } from '../../../lib/cskh/types';
import { MBTI_TYPES, REMEMBER_LABEL } from '../../../lib/cskh/types';
import { compareVnName } from '../../../lib/vnName';
import type { Client, Contact } from '../../../lib/types';
import AvatarUpload from '../../../components/contacts/AvatarUpload';
import RoleSelect from '../../../components/contacts/RoleSelect';
import ContactDeleteDialog from '../../../components/contacts/ContactDeleteDialog';
import ContactFormModal from '../../../components/contacts/ContactFormModal';
import { saveProfile, setFollowUpDone, type CskhData } from '../data/api';
import { markContactLaunched } from '../launch';
import {
  CARE_STATUS_COLOR, CHANNEL_META, chipStyle, groupDisplayOf, HABIT_PRESETS, hasToken, inputCls, INTEREST_PRESETS,
  mapEmbedQuery, mapEmbedSrc, NEW_GROUP_VALUE, PERSONALITY_PRESETS, resolveGroupKey, scoreColor, toggleToken,
} from '../ui';
import { GroupOptions } from './GroupSelect';
import { Sheet } from './Sheet';

const CONTEXT_LABEL: Readonly<Record<CskhContext, string>> = { work: 'Công việc', both: 'Cả hai', personal: 'Cá nhân' };

const labelCls = 'block text-[11.5px] font-medium text-[#666] mb-1';

function Field({ label, hint, children, full }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'md:col-span-2' : undefined}>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="text-[10.5px] text-[#aaa] mt-0.5">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 pt-3 border-t border-[#E8E7E2]">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#999] mb-2">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

function PresetChips({ value, presets, onChange }: { value: string; presets: readonly string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {presets.map(p => {
        const on = hasToken(value, p);
        return (
          <button key={p} type="button" onClick={() => onChange(toggleToken(value, p))} aria-pressed={on}
            className={`px-2.5 h-8 md:h-6 rounded-full text-[11.5px] border transition ${on ? 'bg-[#1D4ED8] border-[#1D4ED8] text-white' : 'bg-white border-[#E0DFDA] text-[#555] hover:border-[#C9C7BE]'}`}>
            {p}
          </button>
        );
      })}
    </div>
  );
}

export function ContactProfileModal({ contactId, data, clients, toast, onClose, onLog, onOpenClient, onManageGroups }: {
  contactId: string;
  data: CskhData;
  clients: readonly Client[];
  toast: (m: string) => void;
  onClose: () => void;
  /** Mở form Ghi tương tác cho người này. */
  onLog: (contactId: string) => void;
  /** Mở hồ sơ công ty bên Khách hàng. */
  onOpenClient?: (clientId: string) => void;
  /** Mở màn quản lý nhóm (chọn "Tạo nhóm mới…"). */
  onManageGroups?: () => void;
}) {
  const { user } = useAuth();
  const { provinces } = useProvinces();
  const raw = data.rawContacts.get(contactId) as Contact;
  const current = data.contacts.find(c => c.id === contactId)!;
  const today = todayVN();
  const groupById = useMemo(() => new Map(data.groups.map(g => [g.id, g])), [data.groups]);
  const clientName = (id: string | null) => (id ? clients.find(c => c.id === id)?.name ?? null : null);
  const clientsSorted = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [clients]);

  // ── Trường dùng chung (contactOps) ──
  const [name, setName] = useState(current.fullName);
  const [phone, setPhone] = useState(raw.phone ?? '');
  const [email, setEmail] = useState(raw.email ?? '');
  const [role, setRole] = useState(raw.role ?? '');
  const [clientIds, setClientIds] = useState<string[]>(current.clientIds);
  const [primaryIds, setPrimaryIds] = useState<string[]>(current.primaryClientIds);
  const [startDate, setStartDate] = useState(raw.start_date ?? '');
  const [channel, setChannel] = useState(raw.channel ?? '');
  const [address, setAddress] = useState(raw.address ?? '');
  const [mapLink, setMapLink] = useState(raw.map_link ?? '');
  const [birthday, setBirthday] = useState(raw.birthday ?? '');
  const [interests, setInterests] = useState(current.interests.join(', '));
  const [avatarUrl, setAvatarUrl] = useState(raw.avatar_url ?? '');
  const [notes, setNotes] = useState(raw.notes ?? '');
  // ── Trường CSKH ──
  const [groupKey, setGroupKey] = useState(groupDisplayOf(current, groupById).key);
  const [cadenceDays, setCadenceDays] = useState(current.cadenceDays === null ? '' : String(current.cadenceDays));
  const [ownerId, setOwnerId] = useState(current.ownerId ?? '');
  const [nickname, setNickname] = useState(current.nickname);
  const [zaloPhone, setZaloPhone] = useState(current.zaloPhone);
  const [habits, setHabits] = useState(current.habits);
  const [personality, setPersonality] = useState(current.personality);
  const [mbti, setMbti] = useState(current.mbti);
  const [remember, setRemember] = useState<RememberNotes>(current.rememberNotes);
  const [introducedBy, setIntroducedBy] = useState(current.introducedBy ?? '');
  const [context, setContext] = useState<CskhContext>(current.context);
  const [province, setProvince] = useState(current.province);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fullForm, setFullForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newInterest, setNewInterest] = useState('');
  const [addingClient, setAddingClient] = useState(false);

  // Bản đồ nhúng — trì hoãn để iframe không tải lại theo từng phím gõ
  const [embedQuery, setEmbedQuery] = useState<string | null>(() => mapEmbedQuery(mapLink, address));
  useEffect(() => {
    const t = setTimeout(() => setEmbedQuery(mapEmbedQuery(mapLink, address)), 500);
    return () => clearTimeout(t);
  }, [mapLink, address]);

  const stats = useMemo(
    () => buildContactStats([current], data.interactions, data.gifts, data.occasions, data.settings.cadence, today).get(current.id),
    [current, data, today],
  );
  const recent = useMemo(() => data.interactions.filter(i => i.contactId === current.id && !i.isArchived), [data.interactions, current.id]);
  const openFollowUps = recent.filter(i => i.followUpAction.trim() && !i.followUpDone);
  const introduced = data.contacts.filter(c => c.introducedBy === current.id);
  const introducerOptions = useMemo(
    () => data.contacts.filter(c => c.id !== current.id).sort((a, b) => compareVnName(a.fullName, b.fullName)),
    [data.contacts, current.id],
  );
  const target = resolveGroupKey(groupKey, groupById);
  const effectiveCadence = target && target.tier !== 'unclassified' ? data.settings.cadence[target.tier] : null;
  const links = contactActionLinks(current);
  const display = groupDisplayOf(current, groupById);

  const completeFollowUp = async (it: CskhInteraction) => {
    setBusyId(it.id);
    try {
      await setFollowUpDone(it, true, user);
      emitCskhDataChanged();
      toast('Đã xong việc đã hứa');
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async () => {
    const ctx = { user, clientName };
    try {
      if (raw.is_active) {
        if (!confirm(`Đánh dấu "${raw.name}" đã nghỉ (rời công ty khách)?\n\nNgười này ra khỏi hàng đợi chăm sóc nhưng giữ nguyên hạng và toàn bộ lịch sử. Mở lại được bất cứ lúc nào.`)) return;
        await deactivateContact(raw, ctx);
        toast(`Đã đánh dấu "${raw.name}" nghỉ`);
      } else {
        await reactivateContact(raw, ctx);
        toast(`Đã mở lại "${raw.name}"`);
      }
      emitCskhDataChanged();
      onClose();
    } catch (e) {
      toast('Lỗi: ' + (e as Error).message);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Nhập họ tên'); return; }
    const cadence = cadenceDays.trim() === '' ? null : Number(cadenceDays);
    if (cadence !== null && (!Number.isInteger(cadence) || cadence <= 0 || cadence > 3650)) {
      setError('Nhịp riêng phải là số ngày nguyên dương (bỏ trống = theo nhóm)');
      return;
    }
    if (mapLink.trim() && !/^https?:\/\//i.test(mapLink.trim())) {
      setError('Link Google Maps phải bắt đầu bằng http(s):// — dán từ nút Chia sẻ trên Google Maps');
      return;
    }
    if (!target) { setError('Chọn nhóm'); return; }
    setSaving(true);
    setError('');
    try {
      await saveProfile({
        raw,
        current,
        user,
        clientName,
        shared: {
          name, phone, email, role,
          client_ids: clientIds,
          primary_client_ids: primaryIds.filter(id => clientIds.includes(id)),
          start_date: startDate, channel, address, map_link: mapLink, birthday,
          hobbies: interests.split(',').map(s => s.trim()).filter(Boolean),
          avatar_url: avatarUrl, notes,
        },
        cskh: {
          tier: target.tier,
          groupId: target.groupId,
          cadenceDays: cadence,
          ownerId: ownerId || null,
          nickname, zaloPhone, habits, personality, mbti,
          rememberNotes: remember,
          introducedBy: introducedBy || null,
          context, province,
        },
      });
    } catch (e) {
      setSaving(false);
      setError((e as Error).message);
      return;
    }
    setSaving(false);
    emitCskhDataChanged();
    toast('Đã cập nhật hồ sơ');
    onClose();
  };

  // Hộp thoại xoá / form đầy đủ nằm ở lớp thấp hơn bottom sheet → thay chỗ hồ sơ khi mở
  if (deleting) {
    return (
      <ContactDeleteDialog contact={raw} clients={clients as Client[]} onClose={() => setDeleting(false)} toast={toast}
        onDone={() => { emitCskhDataChanged(); onClose(); }} />
    );
  }
  if (fullForm) {
    return (
      <ContactFormModal contact={raw} clients={clients as Client[]} toast={toast} onClose={() => setFullForm(false)}
        onSaved={() => { emitCskhDataChanged(); onClose(); }} />
    );
  }

  return (
    <Sheet label={`Hồ sơ ${current.fullName}`} onClose={onClose} wide="xl">
      {/* ── Đầu hồ sơ ── */}
      <div className="flex items-start gap-3 pr-6">
        <AvatarUpload value={avatarUrl} onChange={setAvatarUrl} name={name} toast={toast} />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] md:text-[16px] font-bold text-[#111] truncate">{current.fullName}</p>
          <p className="text-[12px] text-[#888] truncate">{[current.jobTitle, current.organization].filter(Boolean).join(' · ') || 'Chưa gắn công ty'}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={chipStyle(display.color)}>{display.label}</span>
            {!current.isActive && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">Đã nghỉ</span>}
            {stats && stats.status !== 'unclassified' && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={chipStyle(CARE_STATUS_COLOR[stats.status])}>{dueLabel(stats)}</span>
            )}
            {stats?.score && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={chipStyle(scoreColor(stats.score.total))}
                title={`Yếu nhất: ${weakestPart(stats.score).label} — ${weakestPart(stats.score).hint}`}>
                {stats.score.total} điểm · {SCORE_GRADE_LABEL[scoreGrade(stats.score.total)]}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {links.map(link => {
          const meta = CHANNEL_META[link.channel];
          return (
            <a key={link.channel} href={link.url} onClick={() => markContactLaunched(current.id, link.channel)}
              {...(link.channel === 'zalo' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="inline-flex items-center gap-1 h-9 md:h-7 px-3 rounded-lg border border-[#E8E7E2] bg-white text-[12px] font-medium text-[#333] hover:border-blue-200 hover:text-[#1D4ED8]">
              <meta.Icon size={13} /> {meta.label}
            </a>
          );
        })}
        <button type="button" onClick={() => onLog(current.id)}
          className="inline-flex items-center gap-1 h-9 md:h-7 px-3 rounded-lg bg-[#1D4ED8] text-white text-[12px] font-semibold hover:bg-[#1E40AF]">
          <PenLine size={13} /> Ghi tương tác
        </button>
      </div>

      {openFollowUps.length > 0 && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-[10px] p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#D97706] mb-1">Việc đang mở ({openFollowUps.length})</p>
          <div className="space-y-1">
            {openFollowUps.map(i => (
              <div key={i.id} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-[12.5px] text-[#333]">
                  {i.followUpAction}{i.followUpDue && <span className="text-[#888]"> — hạn {formatDateVN(i.followUpDue)}</span>}
                </span>
                <button type="button" disabled={busyId === i.id} onClick={() => completeFollowUp(i)}
                  className="shrink-0 inline-flex items-center gap-1 h-9 md:h-7 px-2.5 rounded-lg border border-emerald-200 bg-white text-emerald-700 text-[12px] font-medium disabled:opacity-50">
                  <CheckCheck size={13} /> Xong
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Chăm sóc ── */}
      <Section title="Chăm sóc">
        <Field label="Nhóm" hint={effectiveCadence ? `Nhắc liên hệ mỗi ${effectiveCadence} ngày nếu không đặt nhịp riêng` : 'Chưa chăm sóc: không nhắc, không chấm điểm'}>
          <select value={groupKey} onChange={e => (e.target.value === NEW_GROUP_VALUE ? onManageGroups?.() : setGroupKey(e.target.value))} className={inputCls}>
            <GroupOptions groups={data.groups} cadence={data.settings.cadence} allowCreate={!!onManageGroups} />
          </select>
        </Field>
        <Field label="Nhịp riêng (ngày)" hint={`Bỏ trống = theo nhóm${effectiveCadence ? ` (${effectiveCadence} ngày)` : ''}`}>
          <input type="number" min={1} max={3650} inputMode="numeric" value={cadenceDays} onChange={e => setCadenceDays(e.target.value)} className={inputCls} placeholder="VD: 21" />
        </Field>
        <Field label="Người phụ trách">
          <select value={ownerId} onChange={e => setOwnerId(e.target.value)} className={inputCls}>
            <option value="">— Chưa giao —</option>
            {data.users.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.id === user?.id ? ' (tôi)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Ngữ cảnh">
          <select value={context} onChange={e => setContext(e.target.value as CskhContext)} className={inputCls}>
            {(['work', 'both', 'personal'] as const).map(c => <option key={c} value={c}>{CONTEXT_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Người giới thiệu" full
          hint={introduced.length ? `Đã giới thiệu: ${introduced.length} người — ${introduced.slice(0, 4).map(c => c.fullName).join(', ')}${introduced.length > 4 ? '…' : ''}` : undefined}>
          <select value={introducedBy} onChange={e => setIntroducedBy(e.target.value)} className={inputCls}>
            <option value="">— Không có —</option>
            {introducerOptions.map(c => <option key={c.id} value={c.id}>{c.fullName}{c.organization ? ` · ${c.organization}` : ''}</option>)}
          </select>
        </Field>
      </Section>

      {/* ── Điều cần nhớ ── */}
      <Section title="Điều cần nhớ — hiện ra mỗi lần chuẩn bị liên hệ">
        {REMEMBER_KEYS.map(k => (
          <Field key={k} label={REMEMBER_LABEL[k]} full={k === 'other'}>
            <textarea rows={2} maxLength={REMEMBER_MAX_CHARS} value={remember[k] ?? ''}
              onChange={e => setRemember({ ...remember, [k]: e.target.value })}
              className={`${inputCls} resize-y`} placeholder={REMEMBER_PLACEHOLDER[k]} />
          </Field>
        ))}
      </Section>

      {/* ── Thấu hiểu con người ── */}
      <Section title="Thấu hiểu con người">
        <Field label="Sở thích" full>
          <div className="flex gap-1.5">
            <input value={newInterest} onChange={e => setNewInterest(e.target.value)} className={inputCls} placeholder="Thêm sở thích khác rồi Enter"
              onKeyDown={e => {
                if (e.key !== 'Enter' || !newInterest.trim()) return;
                e.preventDefault();
                if (!hasToken(interests, newInterest.trim())) setInterests(toggleToken(interests, newInterest.trim()));
                setNewInterest('');
              }} />
          </div>
          <PresetChips value={interests} presets={[...INTEREST_PRESETS, ...interests.split(',').map(s => s.trim()).filter(s => s && !INTEREST_PRESETS.some(p => p.toLowerCase() === s.toLowerCase()))]}
            onChange={setInterests} />
        </Field>
        <Field label="Thói quen" full>
          <input value={habits} onChange={e => setHabits(e.target.value)} className={inputCls} placeholder="Gõ tự do, phẩy ngăn cách" />
          <PresetChips value={habits} presets={HABIT_PRESETS} onChange={setHabits} />
        </Field>
        <Field label="Tính cách" full>
          <input value={personality} onChange={e => setPersonality(e.target.value)} className={inputCls} placeholder="Gõ tự do, phẩy ngăn cách" />
          <PresetChips value={personality} presets={PERSONALITY_PRESETS} onChange={setPersonality} />
        </Field>
        <Field label="MBTI">
          <select value={mbti} onChange={e => setMbti(e.target.value)} className={inputCls}>
            <option value="">— Chưa rõ —</option>
            {MBTI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </Section>

      {/* ── Liên lạc ── */}
      <Section title="Liên lạc">
        <Field label="Họ tên *"><input value={name} onChange={e => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="Tên thân mật"><input value={nickname} onChange={e => setNickname(e.target.value)} className={inputCls} placeholder="VD: Anh Hùng, Chị Lan" /></Field>
        <Field label="Điện thoại" hint="Nhiều số thì ngăn bằng dấu phẩy">
          <input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} inputMode="tel" />
        </Field>
        <Field label="Zalo (nếu khác số chính)"><input value={zaloPhone} onChange={e => setZaloPhone(e.target.value)} className={inputCls} inputMode="tel" /></Field>
        <Field label="Email"><input value={email} onChange={e => setEmail(e.target.value)} className={inputCls} inputMode="email" /></Field>
        <Field label="Ngày sinh"><input type="date" value={birthday} onChange={e => setBirthday(e.target.value)} className={inputCls} /></Field>
        <Field label="Địa chỉ nhà" full><input value={address} onChange={e => setAddress(e.target.value)} className={inputCls} /></Field>
        <Field label="Link Google Maps (nhà riêng)" full>
          <div className="flex gap-1.5">
            <input value={mapLink} onChange={e => setMapLink(e.target.value)} className={inputCls} placeholder="https://maps.app.goo.gl/…" />
            {mapLink.trim() && (
              <a href={mapLink.trim()} target="_blank" rel="noopener noreferrer" title="Mở Google Maps"
                className="shrink-0 w-10 md:w-8 rounded-lg border border-gray-300 bg-white flex items-center justify-center text-[#666] hover:text-[#1D4ED8]">
                <ExternalLink size={14} />
              </a>
            )}
            {embedQuery && (
              <button type="button" onClick={() => setShowMap(v => !v)} title="Xem bản đồ" aria-pressed={showMap}
                className={`shrink-0 w-10 md:w-8 rounded-lg border flex items-center justify-center ${showMap ? 'border-[#1D4ED8] text-[#1D4ED8] bg-blue-50' : 'border-gray-300 bg-white text-[#666]'}`}>
                <MapIcon size={14} />
              </button>
            )}
          </div>
          {showMap && embedQuery && (
            <iframe title="Bản đồ" src={mapEmbedSrc(embedQuery)} loading="lazy" className="mt-2 w-full h-[220px] rounded-lg border border-[#E8E7E2]" />
          )}
        </Field>
        <Field label="Tỉnh / thành">
          <input list="cskh-provinces" value={province} onChange={e => setProvince(e.target.value)} className={inputCls} />
          <datalist id="cskh-provinces">{provinces.map(p => <option key={p} value={p} />)}</datalist>
        </Field>
      </Section>

      {/* ── Công ty & chức vụ ── */}
      <Section title="Công ty & chức vụ">
        <Field label="Công ty phụ trách" full hint="★ = liên hệ chính của công ty đó (mỗi công ty 1 người)">
          <div className="flex flex-wrap items-center gap-1.5">
            {clientIds.map(id => (
              <span key={id} className="inline-flex items-center gap-0.5 rounded-lg bg-white border border-[#E8E7E2] pl-2 pr-0.5 h-9 md:h-7">
                <button type="button" onClick={() => onOpenClient?.(id)} className="text-[12px] font-medium text-[#333] hover:text-[#1D4ED8] hover:underline">{clientName(id) ?? 'Công ty'}</button>
                <button type="button" title={primaryIds.includes(id) ? 'Bỏ liên hệ chính' : 'Đặt làm liên hệ chính'} disabled={!raw.is_active}
                  onClick={() => setPrimaryIds(primaryIds.includes(id) ? primaryIds.filter(x => x !== id) : [...primaryIds, id])}
                  className="p-1.5 md:p-1 rounded disabled:opacity-40">
                  <Star size={13} className={primaryIds.includes(id) ? 'text-amber-500 fill-amber-500' : 'text-gray-300 hover:text-amber-400'} />
                </button>
                <button type="button" title="Gỡ khỏi công ty này" onClick={() => {
                  setClientIds(clientIds.filter(x => x !== id));
                  setPrimaryIds(primaryIds.filter(x => x !== id));
                }} className="p-1.5 md:p-1 rounded hover:bg-red-50">
                  <X size={12} className="text-gray-400 hover:text-red-500" />
                </button>
              </span>
            ))}
            {addingClient ? (
              <select autoFocus defaultValue="" onBlur={() => setAddingClient(false)}
                onChange={e => { if (e.target.value) setClientIds([...clientIds, e.target.value]); setAddingClient(false); }}
                className="text-[12px] h-9 md:h-7 px-2 rounded-lg border border-blue-400 bg-white max-w-[220px]">
                <option value="">— Chọn công ty —</option>
                {clientsSorted.filter(c => !clientIds.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <button type="button" onClick={() => setAddingClient(true)}
                className="inline-flex items-center gap-1 h-9 md:h-7 px-2.5 rounded-lg border border-dashed border-[#C9C7BE] text-[12px] text-[#666] hover:text-[#1D4ED8]">
                <Plus size={12} /> Gắn công ty
              </button>
            )}
          </div>
        </Field>
        <Field label="Chức vụ"><RoleSelect value={role} onChange={setRole} toast={toast} className={inputCls} /></Field>
        <Field label="Phụ trách từ ngày"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Kênh tiếp cận">
          <select value={channel} onChange={e => setChannel(e.target.value)} className={inputCls}>
            <option value="">— Chưa rõ —</option>
            {CONTACT_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú ngắn" full>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={`${inputCls} resize-y`} />
        </Field>
      </Section>

      {error && <p className="mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="sticky bottom-0 -mx-4 md:-mx-5 px-4 md:px-5 pt-3 mt-4 bg-[#F7F6F2] md:bg-white border-t border-[#E8E7E2]">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setFullForm(true)} title="Ngày đặc biệt khác, ghi chú chi tiết, Facebook/LinkedIn"
            className="h-10 md:h-8 px-3 rounded-lg border border-gray-300 bg-white text-[12px] text-[#555] inline-flex items-center gap-1">
            <FileText size={13} /> Form đầy đủ
          </button>
          <button type="button" onClick={toggleActive}
            className={`h-10 md:h-8 px-3 rounded-lg border text-[12px] inline-flex items-center gap-1 ${raw.is_active ? 'border-amber-300 text-amber-700 bg-white' : 'border-emerald-300 text-emerald-700 bg-white'}`}>
            {raw.is_active ? <><UserX size={13} /> Đánh dấu nghỉ</> : <><UserCheck size={13} /> Mở lại</>}
          </button>
          <button type="button" onClick={() => setDeleting(true)} className="h-10 md:h-8 px-3 rounded-lg border border-red-200 bg-white text-[12px] text-red-600 inline-flex items-center gap-1">
            <Trash2 size={13} /> Xoá
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-10 md:h-8 px-4 rounded-lg border border-gray-300 bg-white text-[12.5px] font-medium text-gray-600">Huỷ</button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="h-10 md:h-8 px-4 rounded-lg bg-[#1D4ED8] text-white text-[12.5px] font-semibold hover:bg-[#1E40AF] disabled:bg-gray-400">
            {saving ? 'Đang lưu…' : 'Lưu hồ sơ'}
          </button>
        </div>
      </div>

    </Sheet>
  );
}
