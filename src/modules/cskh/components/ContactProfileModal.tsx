// ============================================================================
// Hồ sơ người liên hệ (port PRM ContactModal) — mở từ mọi tab CSKH.
// ----------------------------------------------------------------------------
// Phần dùng chung với hồ sơ Khách hàng (tên, SĐT, email, công ty, chức vụ, địa chỉ,
// ngày sinh, sở thích, ảnh…) lưu qua lib/contactOps để giữ nguyên quy tắc gắn công ty,
// liên hệ chính, lịch sử chuyển công ty. Phần riêng CSKH (nhóm, nhịp riêng, người phụ
// trách, Điều cần nhớ, thấu hiểu…) lưu thẳng cột migration 169 + 174.
// Nâng cấp 24/10/2026 (theo PRM Tony Study): giới tính + gợi ý theo tên, ngày sinh & ngày
// quan trọng nhập ngay trong hồ sơ (tuổi âm, hợp/kỵ), địa chỉ nhà hiện tại + link Maps +
// ghim chấm tay (Chính xác / Tương đối), quê quán theo tỉnh, tìm hiểu vùng miền (AI), học vấn
// "cùng trường", gia đình có cấu trúc, đặc điểm dạng thẻ dùng chung, phần chuyên sâu thu gọn.
// Ghi chú chi tiết vẫn ở form đầy đủ (nút "Form đầy đủ").
// ============================================================================
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BadgeCheck, ChevronDown, ExternalLink, FileText, Minus, PenLine, Plus, RotateCcw, Star, Trash2, UserCheck, UserX, X,
} from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { useProvinces } from '../../../hooks/useProvinces';
import { CONTACT_CHANNELS, deactivateContact, emptyContactForm, reactivateContact, saveContact } from '../../../lib/contactOps';
import { buildContactStats, dueLabel } from '../../../lib/cskh/cadence';
import { contactActionLinks } from '../../../lib/cskh/contactActions';
import { formatDateVN, todayVN } from '../../../lib/cskh/dates';
import { buildSchoolIndex, cleanEducation, EDUCATION_MAX_ROWS, schoolKey } from '../../../lib/cskh/education';
import { emitCskhDataChanged } from '../../../lib/cskh/events';
import { guessGender } from '../../../lib/cskh/gender';
import { addressPrecision } from '../../../lib/cskh/mapPoints';
import { geocodeAddressDetailed, type LatLng } from '../../../lib/cskh/nearby';
import { draftError, draftFromOccasion, isBlankDraft, planOccasionSave } from '../../../lib/cskh/occasions';
import { provinceOptions } from '../../../lib/cskh/provinces';
import { regionCandidates } from '../../../lib/cskh/regionInsight';
import { cleanRememberNotes, FAMILY_MAX, familyAge, familyYearError, REMEMBER_MAX_CHARS, REMEMBER_PLACEHOLDER } from '../../../lib/cskh/remember';
import { SCORE_GRADE_LABEL, scoreGrade, weakestPart } from '../../../lib/cskh/score';
import { buildTagStats, joinTags, splitTags, TRAIT_FIELDS, TRAIT_LABEL, TRAIT_PRESETS, type TagStat, type TraitField } from '../../../lib/cskh/traits';
import type { CskhContext, CskhInteraction, EducationLevel, FamilyMember, FamilyRole, Gender, RememberNotes, SaleStage } from '../../../lib/cskh/types';
import { EDUCATION_LEVEL_LABEL, EDUCATION_LEVELS, GENDER_LABEL, MBTI_TYPES, REMEMBER_LABEL, SALE_STAGES } from '../../../lib/cskh/types';
import { isWonReferral, referralsByContact, referralStageLabel } from '../../../lib/cskh/saleReferrals';
import { SALE_STAGE_LABEL } from '../../../lib/cskh/space';
import { compareVnName } from '../../../lib/vnName';
import { joinSocialLinks, parseSocialLinks, socialKind, withScheme, type SocialKind } from '../../../lib/socialLinks';
import SocialBadge, { SOCIAL_META } from '../../../components/SocialBadge';
import type { Client, Contact } from '../../../lib/types';
import AvatarUpload from '../../../components/contacts/AvatarUpload';
import RoleSelect from '../../../components/contacts/RoleSelect';
import ContactDeleteDialog from '../../../components/contacts/ContactDeleteDialog';
import ContactFormModal, { RichTextEditor } from '../../../components/contacts/ContactFormModal';
import { mapContactRow } from '../../../lib/cskh/mappers';
import { expandOpenExtras, saveProfile, setFollowUpDone, type CskhData } from '../data/api';
import { mapLinkCoords, useMapLink } from '../data/mapLink';
import { markContactLaunched } from '../launch';
import {
  CARE_STATUS_COLOR, CHANNEL_META, chipStyle, groupDisplayOf, inputCls, NEW_GROUP_VALUE, resolveGroupKey, SALE_STAGE_COLOR, scoreColor,
} from '../ui';
import { AddressPinMap } from './AddressPinMap';
import { TaskCheck } from './apple';
import { ContactAvatar } from './ContactAvatar';
import { GroupOptions } from './GroupSelect';
import { OccasionEditor } from './OccasionEditor';
import { newOccasionRow, toOccasionRow, type OccasionRow } from './occasionRows';
import { RegionInsightPanel } from './RegionInsightPanel';
import { SchoolInput } from './SchoolInput';
import { Sheet, SHEET_FOOTER } from './Sheet';
import { TagInput } from './TagInput';
import { useSpace } from '../space';

const CONTEXT_LABEL: Readonly<Record<CskhContext, string>> = { work: 'Công việc', both: 'Cả hai', personal: 'Cá nhân' };

/** Nút viên ở chân hồ sơ. */
const FOOT_BTN = 'inline-flex items-center gap-1.5 h-10 md:h-9 px-3.5 rounded-full text-[13px] font-medium active:scale-[0.97] transition';
/** Ô nút liên hệ trong hồ sơ (Gọi / Zalo / SMS / Ghi lại). */
const ACTION_TILE = 'flex flex-col items-center justify-center gap-1 h-[58px] rounded-[12px] bg-white md:bg-[#F5F5F7] text-[#0071E3] text-[12px] font-medium hover:bg-[#0071E3]/10 active:scale-[0.97] transition';
/** Viên chọn 1 (Nam / Nữ). */
const PILL = 'h-9 md:h-8 px-4 rounded-full text-[13px] font-medium transition active:scale-[0.97]';

const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';

function Field({ label, hint, children, full, aside }: { label: string; hint?: ReactNode; children: ReactNode; full?: boolean; aside?: ReactNode }) {
  return (
    <div className={full ? 'md:col-span-2' : undefined}>
      <div className="flex items-center gap-1.5 mb-1">
        <label className={`${labelCls} !mb-0`}>{label}</label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-[11.5px] text-[#86868B] mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="px-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B] mb-1.5">{title}</h3>
      {/* Nhóm kiểu iOS: điện thoại thẻ trắng trên nền sheet xám, máy tính thẻ xám nhạt trên nền trắng */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4">{children}</div>
      {note && <p className="px-1 mt-1.5 text-[11.5px] text-[#86868B] leading-snug">{note}</p>}
    </section>
  );
}

/** Ô chữ tự cao theo nội dung (đo lại khi đổi cỡ màn — ResizeObserver). */
function AutoTextarea({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
      className={`${inputCls} resize-none overflow-hidden leading-snug`} />
  );
}

/** Giữ giá trị sau `ms` mili-giây không đổi (bản đồ / link không gọi theo từng phím gõ). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ── Gia đình / học vấn: dòng trên form (uid ổn định để xoá dòng giữa không lệch ô) ──
interface FamRow { uid: number; role: FamilyRole; name: string; year: string }
let famUid = 0;
const famRow = (role: FamilyRole, m?: FamilyMember): FamRow => ({ uid: ++famUid, role, name: m?.name ?? '', year: m?.year != null ? String(m.year) : '' });
/** Luôn có ô Vợ / Chồng + ít nhất 3 ô Con. */
function toFamRows(members: readonly FamilyMember[] = []): FamRow[] {
  const spouses = members.filter(m => m.role === 'spouse');
  const kids = members.filter(m => m.role === 'child');
  return [
    ...(spouses.length > 0 ? spouses.map(m => famRow('spouse', m)) : [famRow('spouse')]),
    ...kids.map(m => famRow('child', m)),
    ...Array.from({ length: Math.max(0, 3 - kids.length) }, () => famRow('child')),
  ];
}
const famMembersOf = (rows: readonly FamRow[]): FamilyMember[] =>
  rows.map(r => ({ role: r.role, name: r.name, year: r.year.trim() ? Number(r.year) : null }));

interface EduRow { uid: number; level: EducationLevel; school: string }
let eduUid = 0;
const blankEdu = (): EduRow => ({ uid: ++eduUid, level: '', school: '' });

/** Nút ⊖ đỏ kiểu iOS. */
const RemoveBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label}
    className="shrink-0 w-7 h-7 rounded-full bg-[#FF3B30] text-white flex items-center justify-center hover:brightness-95 active:scale-95 transition">
    <Minus size={14} strokeWidth={3} />
  </button>
);
/** Dòng ⊕ xanh lá "Thêm …". */
const AddRow = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="md:col-span-2 inline-flex items-center gap-2 min-h-[36px] text-[13px] font-medium text-[#0066CC] hover:opacity-70 w-fit">
    <span className="w-[22px] h-[22px] rounded-full bg-[#34C759] text-white flex items-center justify-center"><Plus size={14} strokeWidth={3} /></span>
    {children}
  </button>
);

/** Hồ sơ trống để dựng form "Thêm liên hệ" — cùng form với sửa hồ sơ, chỉ khác lúc lưu (tạo mới rồi lưu phần CSKH). */
function blankContactRaw(): Contact {
  const f = emptyContactForm();
  const now = new Date().toISOString();
  return {
    id: '', client_id: null, name: '', phone: null, email: null, role: f.role, start_date: f.start_date, end_date: null,
    is_active: true, is_primary: false, notes: null, address: null, birthday: null, hobbies: null, social_link: null,
    channel: null, rich_notes: null, map_link: null, avatar_url: null, created_at: now, updated_at: now, contact_clients: [],
  };
}

export function ContactProfileModal({ contactId, data, clients, toast, onClose, onLog, onOpenClient, onManageGroups }: {
  /** null = thêm liên hệ mới (form trống, lưu xong là tạo người + hồ sơ chăm sóc trong 1 lần). */
  contactId: string | null;
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
  const { tierLabel } = useSpace();
  const { user, token } = useAuth();
  const { provinces } = useProvinces();
  const isNew = contactId === null;
  const [blank] = useState(() => {
    if (!isNew) return null;
    const r = blankContactRaw();
    return { raw: r, current: mapContactRow(r) };
  });
  // Tạo xong mà lưu phần CSKH lỗi → bấm lưu lại phải dùng đúng người đã tạo, không tạo trùng
  const createdRaw = useRef<Contact | null>(null);
  const raw = (blank ? blank.raw : data.rawContacts.get(contactId as string)) as Contact;
  const current = blank ? blank.current : data.contacts.find(c => c.id === contactId)!;
  const today = todayVN();
  const thisYear = Number(today.slice(0, 4));
  const isSale = data.space === 'sale';
  const groupById = useMemo(() => new Map(data.groups.map(g => [g.id, g])), [data.groups]);
  const clientName = (id: string | null) => (id ? clients.find(c => c.id === id)?.name ?? null : null);
  const clientsSorted = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [clients]);
  const others = useMemo(() => data.contacts.filter(c => c.id !== contactId), [data.contacts, contactId]);
  const nameById = useMemo(() => new Map(data.contacts.map(c => [c.id, c.fullName])), [data.contacts]);

  // ── Trường dùng chung (contactOps) ──
  const [name, setName] = useState(current.fullName);
  const [phone, setPhone] = useState(raw.phone ?? '');
  const [email, setEmail] = useState(raw.email ?? '');
  const [social, setSocial] = useState(() => parseSocialLinks(raw.social_link));
  // Sale mới: không lấy chức vụ mặc định của khách (HR Manager)
  const [role, setRole] = useState(isNew && isSale ? '' : raw.role ?? '');
  const [clientIds, setClientIds] = useState<string[]>(current.clientIds);
  const [primaryIds, setPrimaryIds] = useState<string[]>(current.primaryClientIds);
  const [startDate, setStartDate] = useState(raw.start_date ?? '');
  const [channel, setChannel] = useState(raw.channel ?? '');
  const [address, setAddress] = useState(raw.address ?? '');
  const [mapLink, setMapLink] = useState(raw.map_link ?? '');
  const [interests, setInterests] = useState(joinTags(current.interests));
  const [avatarUrl, setAvatarUrl] = useState(raw.avatar_url ?? '');
  const [notes, setNotes] = useState(raw.notes ?? '');
  const [richNotes, setRichNotes] = useState(raw.rich_notes ?? '');
  // ── Trường CSKH ──
  // Thêm Sale mới: mặc định đã chăm sóc ở hạng "Trao đổi thông tin" (nhịp thưa) — thêm vào là để giữ liên lạc
  const [groupKey, setGroupKey] = useState(isNew && isSale ? 'partner' : groupDisplayOf(current, groupById, tierLabel).key);
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
  // ── Nâng cấp 24/10 ──
  const [gender, setGender] = useState<Gender>(current.gender);
  const [originProvince, setOriginProvince] = useState(current.originProvince);
  const [famRows, setFamRows] = useState<FamRow[]>(() => toFamRows(current.rememberNotes.members));
  const [eduRows, setEduRows] = useState<EduRow[]>(() =>
    current.education.length ? current.education.map(e => ({ ...e, uid: ++eduUid })) : [blankEdu()]);
  const myOccasions = useMemo(
    () => data.occasions.filter(o => o.contactId === contactId && !o.isArchived)
      .sort((a, b) => Number(b.source === 'birthday') - Number(a.source === 'birthday') || a.month - b.month || a.day - b.day),
    [data.occasions, contactId],
  );
  const [occRows, setOccRows] = useState<OccasionRow[]>(() =>
    myOccasions.length ? myOccasions.map(o => toOccasionRow(draftFromOccasion(o), o.relatedPerson)) : [newOccasionRow()]);
  const [manualPin, setManualPin] = useState<LatLng | null>(null);
  const [deepOpen, setDeepOpen] = useState(false);
  // ── Mạng lưới Sale (migration 178) ──
  const [saleCompany, setSaleCompany] = useState(current.saleCompany);
  const [competitorId, setCompetitorId] = useState(current.competitorId ?? '');
  const [saleStage, setSaleStage] = useState<SaleStage>(current.saleStage);
  const [saleArea, setSaleArea] = useState(current.saleArea);
  const [saleIndustries, setSaleIndustries] = useState(current.saleIndustries);
  const referrals = useMemo(
    () => (isSale && !isNew ? referralsByContact([current], data.referrals).get(current.id) ?? [] : []),
    [isSale, isNew, current, data.referrals],
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [fullForm, setFullForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingClient, setAddingClient] = useState(false);

  // ── Địa chỉ nhà hiện tại: ghim = chấm tay > link Maps > tra chữ ──
  const linkDebounced = useDebounced(mapLink, 500);
  const link = useMapLink(linkDebounced, token);
  const addressDebounced = useDebounced(address.trim(), 900);
  const [preview, setPreview] = useState<{ address: string; lat: number; lng: number; precise: boolean } | null>(null);
  const savedPin = current.lat !== null && current.lng !== null ? { lat: current.lat, lng: current.lng } : null;
  const addressUnchanged = address.trim() === current.address.trim() && mapLink.trim() === current.mapUrl.trim();
  const needPreview = !manualPin && link.status !== 'ok' && link.status !== 'resolving' && addressDebounced !== ''
    && !(addressDebounced === current.address.trim() && savedPin);
  useEffect(() => {
    if (!needPreview || preview?.address === addressDebounced) return;
    let cancelled = false;
    void geocodeAddressDetailed(addressDebounced).then(found => {
      if (!cancelled && found) setPreview({ address: addressDebounced, ...found });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [needPreview, addressDebounced, preview?.address]);
  const pin: LatLng | null = manualPin
    ?? link.coords
    ?? (preview && preview.address === address.trim() ? preview : null)
    ?? (address.trim() === current.address.trim() ? savedPin : null);
  const geoSourceNow = manualPin ? 'manual' : addressUnchanged ? current.geoSource : '';
  const precision = addressPrecision({ address, mapUrl: mapLink, geoSource: geoSourceNow });

  // ── Thẻ dùng chung + trường học (thống kê trên NGƯỜI KHÁC) ──
  const tagStats = useMemo(() => {
    const out = {} as Record<TraitField, TagStat[]>;
    for (const f of TRAIT_FIELDS) out[f] = buildTagStats(others, f);
    return out;
  }, [others]);
  const schoolIndex = useMemo(() => buildSchoolIndex(others), [others]);

  const stats = useMemo(
    () => buildContactStats([current], data.interactions, data.gifts, data.occasions, data.settings.cadence, today).get(current.id),
    [current, data, today],
  );
  const recent = useMemo(() => data.interactions.filter(i => i.contactId === current.id && !i.isArchived), [data.interactions, current.id]);
  const openFollowUps = [...recent, ...expandOpenExtras(recent)].filter(i => i.followUpAction.trim() && !i.followUpDone);
  const introduced = data.contacts.filter(c => c.introducedBy === current.id);
  const introducerOptions = useMemo(
    () => others.slice().sort((a, b) => compareVnName(a.fullName, b.fullName)),
    [others],
  );
  const target = resolveGroupKey(groupKey, groupById, tierLabel);
  const effectiveCadence = target && target.tier !== 'unclassified' ? data.settings.cadence[target.tier] : null;
  const links = contactActionLinks(current);
  const display = groupDisplayOf(current, groupById, tierLabel);
  const genderHint = gender === '' ? guessGender({ fullName: name, nickname }) : null;
  const provinceList = useMemo(() => provinceOptions([...provinces, province, originProvince]), [provinces, province, originProvince]);
  const regions = useMemo(() => regionCandidates({ originProvince, province }, link.place), [originProvince, province, link.place]);
  const famKids = famRows.filter(r => r.role === 'child');
  const deepCount = Object.keys(cleanRememberNotes({ ...remember, members: famMembersOf(famRows) }, thisYear)).length
    + [interests, habits, personality].filter(v => splitTags(v).length > 0).length + (mbti ? 1 : 0);

  const patchFam = (uid: number, p: Partial<FamRow>) => setFamRows(rows => rows.map(r => (r.uid === uid ? { ...r, ...p } : r)));
  const patchEdu = (uid: number, p: Partial<EduRow>) => setEduRows(rows => rows.map(r => (r.uid === uid ? { ...r, ...p } : r)));
  const removeEdu = (uid: number) => setEduRows(rows => (rows.length > 1 ? rows.filter(r => r.uid !== uid) : [blankEdu()]));

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
        if (!confirm(isSale
          ? `Ngừng theo dõi "${raw.name}"?\n\nNgười này ra khỏi hàng đợi chăm sóc nhưng giữ nguyên hạng và toàn bộ lịch sử. Mở lại được bất cứ lúc nào.`
          : `Đánh dấu "${raw.name}" đã nghỉ (rời công ty khách)?\n\nNgười này ra khỏi hàng đợi chăm sóc nhưng giữ nguyên hạng và toàn bộ lịch sử. Mở lại được bất cứ lúc nào.`)) return;
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
    for (const kind of ['facebook', 'linkedin'] as const) {
      const v = social[kind].trim();
      if (v && socialKind(v) !== kind) {
        setError(`Link ${SOCIAL_META[kind].label} không đúng — dán đường dẫn trang ${SOCIAL_META[kind].label} (có ${kind}.com)`);
        return;
      }
    }
    if (mapLink.trim() && !/^https?:\/\//i.test(mapLink.trim())) {
      setError('Link Google Maps phải bắt đầu bằng http(s):// — dán từ nút Chia sẻ trên Google Maps');
      return;
    }
    if (!target) { setError('Chọn nhóm'); return; }
    const occErr = occRows.map(r => draftError(r, thisYear)).find(Boolean);
    if (occErr) { setError(occErr); return; }
    const famErr = famRows.map(r => familyYearError(r.year, thisYear)).find(Boolean);
    if (famErr) { setError(`Gia đình: ${famErr}`); setDeepOpen(true); return; }
    setSaving(true);
    setError('');
    try {
      const linkCoords = mapLink.trim() ? await mapLinkCoords(mapLink, token) : null;
      const shared = {
        name, phone, email, role,
        // Sale không gắn công ty khách (DB cũng chặn)
        client_ids: isSale ? [] : clientIds,
        primary_client_ids: isSale ? [] : primaryIds.filter(id => clientIds.includes(id)),
        start_date: startDate, channel, address, map_link: mapLink,
        social_link: joinSocialLinks({ ...social, facebook: withScheme(social.facebook), linkedin: withScheme(social.linkedin) }),
        hobbies: splitTags(interests),
        avatar_url: avatarUrl, notes, rich_notes: richNotes,
      };
      let saveRaw = raw;
      let saveCurrent = current;
      if (isNew) {
        // Bước 1: tạo người (cùng đường lưu với form Khách hàng); bước 2: lưu phần chăm sóc như sửa hồ sơ
        createdRaw.current ??= await saveContact({ ...emptyContactForm(), ...shared }, null, { user, clientName, kind: data.space });
        saveRaw = createdRaw.current;
        saveCurrent = { ...current, id: saveRaw.id };
      }
      const { partial174 } = await saveProfile({
        raw: saveRaw,
        current: saveCurrent,
        user,
        clientName,
        shared,
        cskh: {
          tier: target.tier,
          groupId: target.groupId,
          cadenceDays: cadence,
          ownerId: ownerId || null,
          nickname, zaloPhone, habits, personality, mbti,
          rememberNotes: { ...remember, members: famMembersOf(famRows) },
          introducedBy: introducedBy || null,
          context, province,
          gender,
          education: cleanEducation(eduRows, schoolIndex),
          originProvince,
        },
        geo: { manualPin, linkCoords, preview },
        occasions: planOccasionSave(myOccasions, occRows.filter(r => !isBlankDraft(r))),
        sale: isSale ? { saleCompany, competitorId: competitorId || null, saleStage, saleArea, saleIndustries } : null,
      });
      setSaving(false);
      emitCskhDataChanged();
      toast(partial174 ? 'Đã lưu hồ sơ — riêng giới tính / học vấn / quê / nhắc sinh nhật chưa lưu được: cần chạy migration 174' : isNew ? `Đã thêm ${isSale ? 'Sale' : 'liên hệ'} "${name.trim()}"` : 'Đã cập nhật hồ sơ');
      onClose();
    } catch (e) {
      setSaving(false);
      setError((e as Error).message);
    }
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

  const tagField = (f: TraitField, placeholder: string, always = false) => {
    const value = f === 'interests' ? interests : f === 'habits' ? habits : f === 'personality' ? personality : remember[f] ?? '';
    const set = (v: string) => {
      if (f === 'interests') setInterests(v);
      else if (f === 'habits') setHabits(v);
      else if (f === 'personality') setPersonality(v);
      else setRemember(m => ({ ...m, [f]: v }));
    };
    return (
      <Field key={f} label={TRAIT_LABEL[f]} full>
        <TagInput value={value} onChange={set} stats={tagStats[f]} presets={TRAIT_PRESETS[f]} placeholder={placeholder} label={TRAIT_LABEL[f]} alwaysSuggest={always} />
      </Field>
    );
  };

  return (
    <Sheet label={isNew ? (isSale ? 'Thêm Sale' : 'Thêm liên hệ') : `Hồ sơ ${current.fullName}`} onClose={onClose} wide="xl">
      {/* ── Đầu hồ sơ ── */}
      <div className="flex items-center gap-4 pr-8">
        <ContactAvatar name={name || current.fullName} url={avatarUrl || undefined} tier={current.tier} size={64} />
        <div className="min-w-0 flex-1">
          <p className="text-[22px] md:text-[24px] font-bold tracking-[-0.02em] leading-tight text-[#1D1D1F] truncate">{isNew ? (name.trim() || (isSale ? 'Sale mới' : 'Liên hệ mới')) : current.fullName}</p>
          <p className="text-[13.5px] text-[#6E6E73] truncate mt-0.5">{isNew
            ? (isSale ? 'Thêm vào Mạng lưới Sale — tách riêng, không lẫn vào khách hàng' : 'Thêm liên hệ mới — điền xong bấm "Thêm liên hệ"')
            : [current.jobTitle, current.organization].filter(Boolean).join(' · ') || (isSale ? 'Chưa ghi nơi làm' : 'Chưa gắn công ty')}</p>
          {(isSale || !isNew) && <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* Nhãn SALE: nhìn là biết hồ sơ của Mạng lưới Sale, không phải khách */}
            {isSale && <span className="px-2.5 py-0.5 rounded-full text-[11.5px] font-bold tracking-[0.04em] bg-[#FF9500]/[0.16] text-[#B25000]">SALE</span>}
            {isSale && !isNew && current.saleStage !== 'none' && (
              <span className="px-2.5 py-0.5 rounded-full text-[12px] font-medium" style={chipStyle(SALE_STAGE_COLOR[current.saleStage])}>{SALE_STAGE_LABEL[current.saleStage]}</span>
            )}
            {!isNew && <span className="px-2.5 py-0.5 rounded-full text-[12px] font-medium" style={chipStyle(display.color)}>{display.label}</span>}
            {!isNew && !current.isActive && <span className="px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-black/[0.05] text-[#6E6E73]">{isSale ? 'Ngừng theo dõi' : 'Đã nghỉ'}</span>}
            {!isNew && stats && stats.status !== 'unclassified' && (
              <span className="px-2.5 py-0.5 rounded-full text-[12px] font-medium" style={chipStyle(CARE_STATUS_COLOR[stats.status])}>{dueLabel(stats)}</span>
            )}
            {!isNew && stats?.score && (
              <span className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold" style={chipStyle(scoreColor(stats.score.total))}
                title={`Yếu nhất: ${weakestPart(stats.score).label} — ${weakestPart(stats.score).hint}`}>
                {stats.score.total} điểm · {SCORE_GRADE_LABEL[scoreGrade(stats.score.total)]}
              </span>
            )}
          </div>}
        </div>
      </div>

      {/* Hàng nút liên hệ kiểu ứng dụng Danh bạ của Apple: ô vuông bo, icon + nhãn xanh */}
      {!isNew && <div className="grid grid-cols-4 gap-2 mt-4 md:max-w-[440px]">
        {links.map(l => {
          const meta = CHANNEL_META[l.channel];
          return (
            <a key={l.channel} href={l.url} onClick={() => markContactLaunched(current.id, l.channel)}
              {...(l.channel === 'zalo' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={ACTION_TILE}>
              <meta.Icon size={19} strokeWidth={2.1} /> {meta.label}
            </a>
          );
        })}
        <button type="button" onClick={() => onLog(current.id)} className={`${ACTION_TILE} !bg-[#0071E3] !text-white hover:!bg-[#0077ED]`}>
          <PenLine size={19} strokeWidth={2.1} /> Ghi lại
        </button>
      </div>}

      {openFollowUps.length > 0 && (
        <div className="mt-4 rounded-[14px] bg-[#FF9500]/[0.1] px-3.5 py-2.5">
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#C93400] mb-1">Việc đang mở · {openFollowUps.length}</p>
          <div className="space-y-1">
            {openFollowUps.map(i => (
              <div key={i.id} className="flex items-center gap-1 -ml-1.5">
                <TaskCheck busy={busyId === i.id} onDone={() => completeFollowUp(i)} label={`Đánh dấu xong: ${i.followUpAction}`} />
                <span className="flex-1 min-w-0 text-[13.5px] text-[#1D1D1F]">
                  {i.followUpAction}{i.followUpDue && <span className="text-[#86868B]"> — hạn {formatDateVN(i.followUpDue)}</span>}
                </span>
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

      {/* ── Công việc của Sale: nơi làm, mạnh ở đâu, tiến độ chiêu mộ, khách đã giới thiệu ── */}
      {isSale && (
        <Section title="Công việc của Sale" note="Sale tách riêng khỏi khách hàng — không gắn được vào công ty khách.">
          <Field label="Đang làm cho đối thủ" hint={data.competitors.length ? 'Chọn từ Thị trường → Đối thủ; làm công ty khác / tự do thì để trống và gõ ô bên cạnh' : 'Chưa có đối thủ nào trong Thị trường'}>
            <select value={competitorId} className={inputCls}
              onChange={e => {
                const next = e.target.value;
                const prevName = data.competitors.find(c => c.id === competitorId)?.name ?? '';
                const nextName = data.competitors.find(c => c.id === next)?.name ?? '';
                setCompetitorId(next);
                // Ô "Nơi làm" đang trống / đang là tên đối thủ cũ → điền theo đối thủ mới
                if (nextName && (!saleCompany.trim() || saleCompany.trim() === prevName)) setSaleCompany(nextName);
              }}>
              <option value="">— Không / công ty khác —</option>
              {data.competitors.map(c => <option key={c.id} value={c.id}>{c.name}{c.zone ? ` · ${c.zone}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Nơi làm hiện tại" hint="Tên công ty / tự do — hiện cạnh tên Sale ở mọi danh sách">
            <input value={saleCompany} onChange={e => setSaleCompany(e.target.value)} className={inputCls} placeholder="VD: Nhân lực MD, làm tự do" />
          </Field>
          <Field label="Chức vụ"><RoleSelect value={role} onChange={setRole} toast={toast} className={inputCls} /></Field>
          <Field label="Tiến độ chiêu mộ" hint="Mời về làm cho Let's Go">
            <select value={saleStage} onChange={e => setSaleStage(e.target.value as SaleStage)} className={inputCls}>
              {SALE_STAGES.map(st => <option key={st} value={st}>{SALE_STAGE_LABEL[st]}</option>)}
            </select>
          </Field>
          <Field label="Khu vực / KCN mạnh"><input value={saleArea} onChange={e => setSaleArea(e.target.value)} className={inputCls} placeholder="VD: VSIP, Bàu Bàng, Nhơn Trạch" /></Field>
          <Field label="Ngành quen"><input value={saleIndustries} onChange={e => setSaleIndustries(e.target.value)} className={inputCls} placeholder="VD: Điện tử, may mặc, gỗ" /></Field>
          <Field label="Quen biết từ ngày"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`${inputCls} min-w-[9.5rem]`} /></Field>
          <Field label="Kênh quen biết">
            <select value={channel} onChange={e => setChannel(e.target.value)} className={inputCls}>
              <option value="">— Chưa rõ —</option>
              {CONTACT_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {!isNew && (
            <Field label={`Khách đã giới thiệu${referrals.length ? ` · ${referrals.length} công ty` : ''}`} full
              hint={'Lấy từ BD Pipeline: nguồn "Sale" hoặc "Đối tác giới thiệu" ghi đúng tên người này'}>
              {referrals.length === 0
                ? <p className="text-[13px] text-[#86868B]">Chưa có công ty nào trong BD Pipeline ghi nguồn là {current.fullName}.</p>
                : (
                  <ul className="flex flex-wrap gap-1.5">
                    {referrals.map(r => (
                      <li key={r.id} className={`inline-flex items-center gap-1.5 rounded-full pl-3 pr-2.5 h-8 text-[12.5px] ${isWonReferral(r) ? 'bg-[#34C759]/[0.14] text-[#248A3D]' : 'bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)] text-[#1D1D1F]'}`}>
                        <span className="font-medium truncate max-w-[200px]">{r.companyName}</span>
                        <span className="text-[11.5px] opacity-75">{referralStageLabel(r.stage)}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Field>
          )}
          <Field label="Ghi chú ngắn" full>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={`${inputCls} resize-y`} />
          </Field>
          <Field label="Ghi chú chi tiết" full><RichTextEditor value={richNotes} onChange={setRichNotes} /></Field>
        </Section>
      )}

      {/* ── Liên lạc ── */}
      <Section title="Liên lạc">
        <Field label="Ảnh đại diện" full><AvatarUpload value={avatarUrl} onChange={setAvatarUrl} name={name} toast={toast} /></Field>
        <Field label="Họ tên *"><input value={name} onChange={e => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="Tên thân mật"><input value={nickname} onChange={e => setNickname(e.target.value)} className={inputCls} placeholder="VD: Anh Hùng, Chị Lan" /></Field>
        <Field label="Giới tính" full hint={genderHint ? undefined : 'Dùng để lọc khi chúc mừng 20/10, 8/3'}>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['male', 'female'] as const).map(g => (
              <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(gender === g ? '' : g)}
                className={`${PILL} ${gender === g ? 'bg-[#0071E3] text-white' : 'bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]'}`}>
                {GENDER_LABEL[g]}
              </button>
            ))}
            {genderHint && (
              <button type="button" onClick={() => setGender(genderHint.gender)} title={`${genderHint.reason} — bấm để chọn`}
                className="h-9 md:h-8 px-3 rounded-full text-[12.5px] font-medium text-[#0066CC] hover:bg-[#0071E3]/10 transition">
                Gợi ý: {GENDER_LABEL[genderHint.gender]}
              </button>
            )}
          </div>
        </Field>
        <Field label="Điện thoại" hint="Nhiều số thì ngăn bằng dấu phẩy">
          <input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} inputMode="tel" />
        </Field>
        <Field label="Zalo (nếu khác số chính)"><input value={zaloPhone} onChange={e => setZaloPhone(e.target.value)} className={inputCls} inputMode="tel" /></Field>
        <Field label="Email" full><input value={email} onChange={e => setEmail(e.target.value)} className={inputCls} inputMode="email" /></Field>
        {(['facebook', 'linkedin'] as const satisfies readonly SocialKind[]).map(kind => (
          <Field key={kind} label={SOCIAL_META[kind].label}>
            <div className="flex items-center gap-1.5">
              <SocialBadge kind={kind} size={32} />
              <input value={social[kind]} onChange={e => setSocial(m => ({ ...m, [kind]: e.target.value }))} className={inputCls}
                inputMode="url" placeholder={kind === 'facebook' ? 'facebook.com/…' : 'linkedin.com/in/…'} aria-label={`Link ${SOCIAL_META[kind].label}`} />
              {social[kind].trim() && (
                <a href={withScheme(social[kind])} target="_blank" rel="noopener noreferrer" title={`Mở ${SOCIAL_META[kind].label}`}
                  className="shrink-0 w-10 md:w-9 h-10 md:h-9 rounded-[10px] bg-[rgba(118,118,128,0.12)] flex items-center justify-center text-[#0066CC] hover:bg-[rgba(118,118,128,0.2)] transition">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </Field>
        ))}
      </Section>

      {/* ── Ngày sinh & ngày quan trọng ── */}
      <Section title="Ngày sinh & ngày quan trọng">
        <OccasionEditor rows={occRows} onChange={setOccRows} today={today} notCared={target?.tier === 'unclassified'} />
      </Section>

      {/* ── Địa chỉ & quê quán ── */}
      <Section title="Địa chỉ & quê quán">
        <Field label="Địa chỉ nhà hiện tại" full
          aside={precision === 'precise'
            ? <span className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold text-[#0071E3]" title="Có link Google Maps hoặc đã chấm tay"><BadgeCheck size={14} fill="#0071E3" color="#fff" /> Chính xác</span>
            : precision === 'approx'
              ? <span className="text-[11.5px] font-medium text-[#86868B]" title="Chỉ có chữ — dán link Google Maps hoặc chấm ghim để chính xác">~ Tương đối</span>
              : undefined}>
          <AutoTextarea value={address} onChange={setAddress} label="Địa chỉ nhà hiện tại" placeholder="Dán nguyên địa chỉ, VD: 12 Lê Lợi, P. Phú Cường, Thủ Dầu Một, Bình Dương" />
        </Field>
        <Field label="Link Google Maps (biết chính xác thì dán)" full
          hint={mapLink.trim() ? {
            empty: undefined,
            resolving: 'Đang mở link rút gọn…',
            ok: 'Đọc được vị trí từ link',
            nocoords: 'Link không có toạ độ — sẽ định vị theo chữ địa chỉ',
            fail: 'Không mở được link rút gọn lúc này — vẫn lưu link, định vị theo chữ',
          }[link.status] : undefined}>
          <div className="flex gap-1.5">
            <input value={mapLink} onChange={e => { setMapLink(e.target.value); setManualPin(null); }} className={inputCls} placeholder="https://maps.app.goo.gl/…" inputMode="url" />
            {mapLink.trim() && (
              <a href={mapLink.trim()} target="_blank" rel="noopener noreferrer" title="Mở Google Maps"
                className="shrink-0 w-10 md:w-9 rounded-[10px] bg-[rgba(118,118,128,0.12)] flex items-center justify-center text-[#0066CC] hover:bg-[rgba(118,118,128,0.2)] transition">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </Field>
        {(address.trim() || mapLink.trim() || pin) && (
          <div className="md:col-span-2">
            <AddressPinMap pin={pin} precise={precision === 'precise'} onPick={setManualPin} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11.5px] text-[#86868B]">
              <span>{manualPin ? 'Đã chấm tay — lưu vị trí này.' : pin ? 'Sai chỗ? Chạm hoặc kéo ghim để chấm lại.' : 'Đang tìm vị trí theo địa chỉ… hoặc chạm vào bản đồ để chấm.'}</span>
              {manualPin && (
                <button type="button" onClick={() => setManualPin(null)} className="inline-flex items-center gap-1 font-medium text-[#0066CC] hover:opacity-70">
                  <RotateCcw size={12} /> Bỏ chấm tay
                </button>
              )}
            </div>
          </div>
        )}
        <Field label="Tỉnh / thành nơi ở">
          <input list="cskh-provinces" value={province} onChange={e => setProvince(e.target.value)} className={inputCls} />
          <datalist id="cskh-provinces">{provinceList.map(p => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Quê quán (tỉnh)" hint="Chỉ cần tỉnh — trên bản đồ vẽ ở tâm tỉnh">
          <select value={originProvince} onChange={e => setOriginProvince(e.target.value)} className={inputCls}>
            <option value="">— Chưa rõ —</option>
            {provinceList.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        {user && regions.length > 0 && <RegionInsightPanel candidates={regions} userId={user.id} />}
      </Section>

      {/* ── Công ty & chức vụ (khách) — Sale có khối "Công việc của Sale" riêng ở trên ── */}
      {!isSale && <Section title="Công ty & chức vụ">
        <Field label="Công ty phụ trách" full hint="★ = liên hệ chính của công ty đó (mỗi công ty 1 người)">
          <div className="flex flex-wrap items-center gap-1.5">
            {clientIds.map(id => (
              <span key={id} className="inline-flex items-center gap-0.5 rounded-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12)] pl-3 pr-1 h-9 md:h-8">
                <button type="button" onClick={() => onOpenClient?.(id)} className="text-[13px] font-medium text-[#1D1D1F] hover:text-[#0066CC] transition-colors">{clientName(id) ?? 'Công ty'}</button>
                <button type="button" title={primaryIds.includes(id) ? 'Bỏ liên hệ chính' : 'Đặt làm liên hệ chính'} disabled={!raw.is_active}
                  onClick={() => setPrimaryIds(primaryIds.includes(id) ? primaryIds.filter(x => x !== id) : [...primaryIds, id])}
                  className="p-1.5 md:p-1 rounded-full hover:bg-[#FF9500]/10 disabled:opacity-40">
                  <Star size={13} className={primaryIds.includes(id) ? 'text-[#FF9500] fill-[#FF9500]' : 'text-[#D1D1D6] hover:text-[#FFB340]'} />
                </button>
                <button type="button" title="Gỡ khỏi công ty này" onClick={() => {
                  setClientIds(clientIds.filter(x => x !== id));
                  setPrimaryIds(primaryIds.filter(x => x !== id));
                }} className="p-1.5 md:p-1 rounded-full hover:bg-[#FF3B30]/10">
                  <X size={12} className="text-[#AEAEB2] hover:text-[#FF3B30]" />
                </button>
              </span>
            ))}
            {addingClient ? (
              <select autoFocus defaultValue="" onBlur={() => setAddingClient(false)}
                onChange={e => { if (e.target.value) setClientIds([...clientIds, e.target.value]); setAddingClient(false); }}
                className="text-[13px] h-9 md:h-8 px-3 rounded-full border border-[#0071E3] ring-4 ring-[#0071E3]/15 bg-white outline-none max-w-[240px]">
                <option value="">— Chọn công ty —</option>
                {clientsSorted.filter(c => !clientIds.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <button type="button" onClick={() => setAddingClient(true)}
                className="inline-flex items-center gap-1 h-9 md:h-8 px-3 rounded-full bg-[#0071E3]/10 text-[13px] font-medium text-[#0066CC] hover:bg-[#0071E3]/[0.16] transition">
                <Plus size={14} strokeWidth={2.4} /> Gắn công ty
              </button>
            )}
          </div>
        </Field>
        <Field label="Chức vụ"><RoleSelect value={role} onChange={setRole} toast={toast} className={inputCls} /></Field>
        <Field label="Phụ trách từ ngày"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`${inputCls} min-w-[9.5rem]`} /></Field>
        <Field label="Kênh tiếp cận">
          <select value={channel} onChange={e => setChannel(e.target.value)} className={inputCls}>
            <option value="">— Chưa rõ —</option>
            {CONTACT_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Ghi chú ngắn" full>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={`${inputCls} resize-y`} />
        </Field>
        <Field label="Ghi chú chi tiết" full><RichTextEditor value={richNotes} onChange={setRichNotes} /></Field>
      </Section>}

      {/* ── Học vấn ── */}
      <Section title="Học vấn" note="Gõ tên trường có gợi ý từ người khác đã nhập; khác dấu / hoa vẫn nhận là 1 trường.">
        {eduRows.map(r => {
          const mates = r.school.trim() ? (schoolIndex.get(schoolKey(r.school))?.contactIds ?? []) : [];
          const canRemove = eduRows.length > 1 || r.level !== '' || r.school.trim() !== '';
          return (
            <div key={r.uid} className="md:col-span-2">
              <div className="flex items-center gap-2">
                <select value={r.level} onChange={e => patchEdu(r.uid, { level: e.target.value as EducationLevel })} aria-label="Bậc học"
                  className={`${inputCls} !w-[118px] shrink-0`}>
                  <option value="">Bậc học</option>
                  {EDUCATION_LEVELS.map(l => <option key={l} value={l}>{EDUCATION_LEVEL_LABEL[l]}</option>)}
                </select>
                <SchoolInput value={r.school} onChange={school => patchEdu(r.uid, { school })} index={schoolIndex} />
                {canRemove && <RemoveBtn onClick={() => removeEdu(r.uid)} label="Bỏ dòng học vấn này" />}
              </div>
              {mates.length > 0 && (
                <p className="mt-1 text-[11.5px] text-[#0066CC]">
                  Cùng trường với <b>{mates.length} người</b>: {mates.slice(0, 4).map(id => nameById.get(id) ?? '').filter(Boolean).join(', ')}{mates.length > 4 && ` +${mates.length - 4}`}
                </p>
              )}
            </div>
          );
        })}
        {eduRows.length < EDUCATION_MAX_ROWS && eduRows.every(r => r.level !== '' || r.school.trim() !== '') && (
          <AddRow onClick={() => setEduRows(rows => [...rows, blankEdu()])}>Thêm trường</AddRow>
        )}
      </Section>

      {/* ── Thông tin chuyên sâu: không phải ai cũng nhập — mặc định thu gọn ── */}
      <section className="mt-5">
        <button type="button" onClick={() => setDeepOpen(v => !v)} aria-expanded={deepOpen}
          className="w-full flex items-center gap-3 rounded-[14px] bg-white md:bg-[#F5F5F7] px-4 min-h-[56px] text-left hover:bg-black/[0.02] transition">
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-[#1D1D1F]">Thông tin chuyên sâu</span>
            <span className="block text-[12px] text-[#86868B]">Gia đình · điều cần nhớ · sở thích · thói quen · tính cách{deepCount > 0 ? ` · đã nhập ${deepCount} mục` : ''}</span>
          </span>
          <ChevronDown size={18} className={`shrink-0 text-[#AEAEB2] transition-transform ${deepOpen ? 'rotate-180' : ''}`} />
        </button>
      </section>
      {deepOpen && (
        <>
          <Section title="Gia đình" note="Hiện nhanh trước khi liên hệ: hỏi thăm con khách, quà 1/6.">
            {famRows.map(r => {
              const label = r.role === 'spouse' ? 'Vợ / Chồng' : `Con ${famKids.indexOf(r) + 1}`;
              const age = r.year.length === 4 && !familyYearError(r.year, thisYear) ? familyAge(Number(r.year), thisYear) : null;
              return (
                <Fragment key={r.uid}>
                  <div className="md:col-span-2 flex items-center gap-2">
                    <span className="w-[76px] shrink-0 text-[12.5px] font-medium text-[#6E6E73]">{label}</span>
                    <input type="text" value={r.name} onChange={e => patchFam(r.uid, { name: e.target.value })} placeholder="Tên" maxLength={60}
                      aria-label={`Tên ${label}`} className={`${inputCls} flex-1 min-w-0`} />
                    <input type="text" inputMode="numeric" value={r.year} placeholder="Năm sinh" aria-label={`Năm sinh ${label}`}
                      onChange={e => patchFam(r.uid, { year: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={`${inputCls} !w-[92px] shrink-0`} />
                    <span className="w-[58px] shrink-0 text-[12px] text-[#86868B] tabular-nums">{age === null ? '' : age === 0 ? 'mới sinh' : `${age} tuổi`}</span>
                  </div>
                </Fragment>
              );
            })}
            {famKids.length < FAMILY_MAX - 1 && famKids.every(r => r.name.trim() !== '' || r.year.trim() !== '') && (
              <AddRow onClick={() => setFamRows(rows => [...rows, famRow('child')])}>Thêm con</AddRow>
            )}
            <Field label="Ghi chú gia đình" full>
              <input type="text" value={remember.family ?? ''} onChange={e => setRemember(m => ({ ...m, family: e.target.value }))}
                placeholder={REMEMBER_PLACEHOLDER.family} maxLength={REMEMBER_MAX_CHARS} className={inputCls} />
            </Field>
          </Section>

          <Section title="Điều cần nhớ — hiện ra mỗi lần chuẩn bị liên hệ" note="Mỗi ý là 1 thẻ — gõ rồi Enter; thẻ người khác đã có thì bấm chọn (số nhỏ = bao nhiêu người cũng có).">
            {tagField('likes', 'Cà phê, lẩu hải sản…')}
            {tagField('avoid', 'Không uống rượu bia…')}
            {(['work', 'other'] as const).map(k => (
              <Field key={k} label={REMEMBER_LABEL[k]} full>
                <input type="text" value={remember[k] ?? ''} onChange={e => setRemember(m => ({ ...m, [k]: e.target.value }))}
                  placeholder={REMEMBER_PLACEHOLDER[k]} maxLength={REMEMBER_MAX_CHARS} className={inputCls} />
              </Field>
            ))}
          </Section>

          <Section title="Thấu hiểu con người" note="Lọc những người giống nhau ở Ma trận → Mọi đặc điểm.">
            {tagField('interests', 'Golf, du lịch, cà phê…', true)}
            {tagField('habits', 'Dậy sớm, hay đi công tác…', true)}
            {tagField('personality', 'Quyết đoán, trọng chữ tín…', true)}
            <Field label="MBTI">
              <select value={mbti} onChange={e => setMbti(e.target.value)} className={inputCls}>
                <option value="">— Chưa rõ —</option>
                {MBTI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </Section>
        </>
      )}

      {error && <p className="mt-4 text-[13px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{error}</p>}

      <div className={`${SHEET_FOOTER} mt-5 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <div className="flex flex-wrap items-center gap-2">
          {!isNew && !isSale && <button type="button" onClick={() => setFullForm(true)} title="Các trường ít dùng"
            className={`${FOOT_BTN} bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]`}>
            <FileText size={14} /> Form đầy đủ
          </button>}
          {!isNew && <button type="button" onClick={toggleActive}
            className={`${FOOT_BTN} ${raw.is_active ? 'bg-[#FF9500]/[0.14] text-[#B25000] hover:bg-[#FF9500]/[0.2]' : 'bg-[#34C759]/[0.14] text-[#248A3D] hover:bg-[#34C759]/[0.2]'}`}>
            {raw.is_active ? <><UserX size={14} /> {isSale ? 'Ngừng theo dõi' : 'Đánh dấu nghỉ'}</> : <><UserCheck size={14} /> Mở lại</>}
          </button>}
          {!isNew && <button type="button" onClick={() => setDeleting(true)} className={`${FOOT_BTN} bg-[#FF3B30]/10 text-[#D70015] hover:bg-[#FF3B30]/[0.16]`}>
            <Trash2 size={14} /> Xoá
          </button>}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={`${FOOT_BTN} px-4 bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]`}>Huỷ</button>
          <button type="button" onClick={handleSave} disabled={saving}
            className={`${FOOT_BTN} px-5 bg-[#0071E3] text-white font-semibold hover:bg-[#0077ED] disabled:opacity-40`}>
            {saving ? 'Đang lưu…' : isNew ? (isSale ? 'Thêm Sale' : 'Thêm liên hệ') : 'Lưu hồ sơ'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
