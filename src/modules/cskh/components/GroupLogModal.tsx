// "Ghi cho nhóm" (port PRM GroupLogModal) — 1 hành động chung cho nhiều người: VD 20/10 tặng
// hoa mọi "TP Nhân sự" nữ của khách ở chi nhánh X. Lọc giới tính (Nữ gồm cả người ĐOÁN là nữ,
// hiện "Nữ?", có nút lưu xác nhận), phạm vi Đang chăm sóc / Cả danh bạ, nhóm, chi nhánh, công
// ty, chức vụ, tìm tên → "Chọn tất cả N người đang lọc" → mỗi người 1 dòng nhật ký (+ quà).
import { useMemo, useState } from 'react';
import { useBranchLookup } from '../../../hooks/useBranchLookup';
import { branchOf } from '../../../lib/branchRef';
import { effectiveGender } from '../../../lib/cskh/gender';
import { GROUP_ACTIONS, GROUP_OCCASIONS, groupLogContent, suggestOccasion, type GroupLogPlan } from '../../../lib/cskh/groupLog';
import { contactSearchHaystack, matchesQuery } from '../../../lib/cskh/search';
import type { CskhContact, CskhGroup, Gender } from '../../../lib/cskh/types';
import { GENDER_LABEL } from '../../../lib/cskh/types';
import { compareVnName } from '../../../lib/vnName';
import type { Client } from '../../../lib/types';
import { groupDisplayOf, inputCls } from '../ui';
import { PillSelect, SearchField, Segmented, Switch } from './apple';
import { ContactAvatar } from './ContactAvatar';
import { GroupOptions } from './GroupSelect';
import { ChoiceChip, Sheet, SHEET_FOOTER } from './Sheet';

type GenderPick = 'all' | 'female' | 'male';
type Scope = 'care' | 'all';
/** Danh sách dài chỉ vẽ tối đa bấy nhiêu dòng — "Chọn tất cả" vẫn chọn đủ. */
const SHOW_MAX = 150;
const labelCls = 'block text-[12px] font-medium text-[#6E6E73] mb-1';

export function GroupLogModal({ contacts, groups, clients, today, initialSelected, onSave, onSetGender, onClose }: {
  contacts: readonly CskhContact[];
  groups: readonly CskhGroup[];
  clients: readonly Client[];
  today: string;
  /** Chọn sẵn (mở từ thanh thao tác hàng loạt ở Ma trận). */
  initialSelected?: readonly string[];
  /** Trả về câu lỗi hoặc null khi đã ghi. */
  onSave: (plan: GroupLogPlan) => Promise<string | null>;
  /** Lưu giới tính cho người được gợi ý theo tên. Trả về câu lỗi hoặc null. */
  onSetGender: (ids: readonly string[], gender: Exclude<Gender, ''>) => Promise<string | null>;
  onClose: () => void;
}) {
  const { branches } = useBranchLookup();
  const people = useMemo(() => contacts.filter(c => !c.isArchived), [contacts]);
  const preset = (initialSelected?.length ?? 0) > 0;
  const careCount = people.filter(c => c.tier !== 'unclassified').length;
  const [genderPick, setGenderPick] = useState<GenderPick>('all');
  const [scope, setScope] = useState<Scope>(preset || careCount === 0 ? 'all' : 'care');
  const [groupKey, setGroupKey] = useState('all');
  const [branch, setBranch] = useState('all');
  const [company, setCompany] = useState('all');
  const [role, setRole] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initialSelected ?? []));

  const [actionKey, setActionKey] = useState(GROUP_ACTIONS[0].key);
  const action = GROUP_ACTIONS.find(a => a.key === actionKey) ?? GROUP_ACTIONS[0];
  const [occasion, setOccasion] = useState(() => suggestOccasion(today));
  /** null = nội dung tự ghép từ hành động + dịp; gõ tay thì giữ nguyên. */
  const [contentEdit, setContentEdit] = useState<string | null>(null);
  const content = contentEdit ?? groupLogContent(action, occasion);
  const [occurredAt, setOccurredAt] = useState(today);
  const [logGift, setLogGift] = useState(true);
  const [giftItemEdit, setGiftItemEdit] = useState<string | null>(null);
  const giftItem = giftItemEdit ?? action.giftItem;
  const [giftValue, setGiftValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [genderBusy, setGenderBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const meta = useMemo(() => new Map(people.map(c => {
    const branchIds = new Set<string>();
    for (const id of c.clientIds) {
      const b = branchOf(clientById.get(id) ?? null, branches);
      if (b) branchIds.add(b.id);
    }
    return [c.id, { gender: effectiveGender(c), branchIds, haystack: contactSearchHaystack(c) }] as const;
  })), [people, clientById, branches]);

  const options = useMemo(() => {
    const bIds = new Set<string>();
    const cIds = new Set<string>();
    const roles = new Set<string>();
    for (const c of people) {
      meta.get(c.id)?.branchIds.forEach(id => bIds.add(id));
      c.clientIds.forEach(id => cIds.add(id));
      if (c.jobTitle.trim()) roles.add(c.jobTitle.trim());
    }
    return {
      branches: branches.filter(b => bIds.has(b.id)),
      companies: clients.filter(c => cIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
      roles: [...roles].sort((a, b) => a.localeCompare(b, 'vi')),
    };
  }, [people, meta, branches, clients]);

  const filtered = useMemo(() => {
    const list = people.filter(c => {
      const m = meta.get(c.id);
      if (!m) return false;
      if (scope === 'care' && c.tier === 'unclassified') return false;
      if (genderPick !== 'all' && m.gender.gender !== genderPick) return false;
      if (groupKey !== 'all' && groupDisplayOf(c, groupById).key !== groupKey) return false;
      if (branch !== 'all' && !m.branchIds.has(branch)) return false;
      if (company !== 'all' && !c.clientIds.includes(company)) return false;
      if (role !== 'all' && c.jobTitle.trim() !== role) return false;
      return !query.trim() || matchesQuery(m.haystack, query);
    });
    return list.sort((a, b) =>
      (preset ? Number(selected.has(b.id)) - Number(selected.has(a.id)) : 0) || compareVnName(a.fullName, b.fullName));
    // Thứ tự chỉ tính khi đổi bộ lọc — không nhảy dòng khi đang tích chọn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, meta, scope, genderPick, groupKey, branch, company, role, query, groupById, preset]);

  const allFilteredOn = filtered.length > 0 && filtered.every(c => selected.has(c.id));
  const toggleAll = () => setSelected(cur => {
    const next = new Set(cur);
    for (const c of filtered) { if (allFilteredOn) next.delete(c.id); else next.add(c.id); }
    return next;
  });
  const toggle = (id: string) => setSelected(cur => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const guessedHere = genderPick === 'all' ? [] : filtered.filter(c => meta.get(c.id)?.gender.guessed);
  const confirmGuesses = async () => {
    if (genderPick === 'all' || guessedHere.length === 0) return;
    setGenderBusy(true);
    const err = await onSetGender(guessedHere.map(c => c.id), genderPick);
    setGenderBusy(false);
    setError(err ?? '');
    setNote(err ? '' : `Đã lưu giới tính ${GENDER_LABEL[genderPick]} cho ${guessedHere.length} người`);
  };

  const selectedNoCompany = useMemo(
    () => people.filter(c => selected.has(c.id) && c.clientIds.length === 0).length,
    [people, selected],
  );
  const isGift = action.type === 'gift' && logGift;

  const handleSave = async () => {
    if (selected.size === 0) { setError('Chọn ít nhất 1 người'); return; }
    if (!content.trim()) { setError('Nhập nội dung'); return; }
    if (!occurredAt || occurredAt > today) { setError('Ngày không được sau hôm nay'); return; }
    if (isGift && !giftItem.trim()) { setError('Nhập tên món quà'); return; }
    setSaving(true);
    setError('');
    const value = giftValue.replace(/\D/g, '');
    const err = await onSave({
      contactIds: [...selected],
      type: action.type,
      occurredAt,
      content,
      gift: isGift ? { item: giftItem, estimatedValue: value ? Number(value) : null } : null,
    });
    setSaving(false);
    if (err) setError(err);
  };

  const shown = filtered.slice(0, SHOW_MAX);

  return (
    <Sheet label="Ghi cho nhóm" onClose={onClose} wide="xl">
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">Ghi cho nhóm</h2>
      <p className="text-[12.5px] text-[#86868B] mt-0.5">Mỗi người được chọn nhận 1 dòng nhật ký — tính là đã liên hệ, hết nhắc trong hàng đợi. Ghi nhầm thì sửa cả đợt ở Nhật ký CSKH.</p>

      {/* ── Hành động chung ── */}
      <section className="mt-4 space-y-3 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4">
        <div>
          <span className={labelCls}>Hành động</span>
          <div className="flex flex-wrap gap-1.5">
            {GROUP_ACTIONS.map(a => (
              <ChoiceChip key={a.key} active={actionKey === a.key} onClick={() => { setActionKey(a.key); setGiftItemEdit(null); }}>{a.label}</ChoiceChip>
            ))}
          </div>
        </div>
        <div>
          <span className={labelCls}>Dịp</span>
          <div className="flex flex-wrap gap-1.5">
            {GROUP_OCCASIONS.map(o => (
              <ChoiceChip key={o} active={occasion === o} onClick={() => setOccasion(cur => (cur === o ? '' : o))}>{o}</ChoiceChip>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <div>
            <label className={labelCls}>Nội dung</label>
            <input type="text" value={content} onChange={e => setContentEdit(e.target.value)} placeholder="Tặng hoa 20/10" maxLength={300} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Ngày</label>
            <input type="date" value={occurredAt} max={today} onChange={e => setOccurredAt(e.target.value || today)} className={`${inputCls} md:w-[10rem] min-w-[9.5rem]`} />
          </div>
        </div>
        {action.type === 'gift' && (
          <div className="space-y-2">
            <Switch checked={logGift} onChange={setLogGift} label="Ghi vào lịch sử quà (Sự kiện & Quà tặng)" />
            {logGift && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Món quà</label>
                  <input type="text" value={giftItem} onChange={e => setGiftItemEdit(e.target.value)} placeholder="Hoa hồng" maxLength={120} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Giá trị / người (không bắt buộc)</label>
                  <div className="relative">
                    <input type="text" inputMode="numeric" value={giftValue ? Number(giftValue).toLocaleString('vi-VN') : ''}
                      onChange={e => setGiftValue(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="VD: 300.000" className={`${inputCls} pr-8`} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[#86868B]">đ</span>
                  </div>
                </div>
              </div>
            )}
            {logGift && selectedNoCompany > 0 && (
              <p className="text-[12px] text-[#B25000]">{selectedNoCompany} người chưa gắn công ty — chỉ ghi nhật ký, không ghi được dòng quà (quà khách hàng phải gắn công ty).</p>
            )}
          </div>
        )}
      </section>

      {/* ── Người nhận ── */}
      <section className="mt-4 rounded-[14px] bg-white md:bg-[#F5F5F7] p-3.5 md:p-4">
        <h3 className="text-[13px] font-semibold text-[#1D1D1F] mb-2">Người nhận · đã chọn {selected.size}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Lọc giới tính" fit value={genderPick} onChange={setGenderPick}
            options={[{ key: 'all', label: 'Tất cả' }, { key: 'female', label: 'Nữ' }, { key: 'male', label: 'Nam' }]} />
          <Segmented label="Phạm vi" fit value={scope} onChange={setScope}
            options={[{ key: 'care', label: 'Đang chăm sóc' }, { key: 'all', label: 'Cả danh bạ' }]} />
          <PillSelect value={groupKey} active={groupKey !== 'all'} label="Lọc theo nhóm" onChange={setGroupKey}>
            <option value="all">Mọi nhóm</option>
            <GroupOptions groups={groups} includeUnclassified={scope === 'all'} />
          </PillSelect>
          {options.branches.length > 0 && (
            <PillSelect value={branch} active={branch !== 'all'} label="Lọc theo chi nhánh" onChange={setBranch}>
              <option value="all">Mọi chi nhánh</option>
              {options.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </PillSelect>
          )}
          <PillSelect value={company} active={company !== 'all'} label="Lọc theo công ty" onChange={setCompany}>
            <option value="all">Mọi công ty</option>
            {options.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </PillSelect>
          {options.roles.length > 0 && (
            <PillSelect value={role} active={role !== 'all'} label="Lọc theo chức vụ" onChange={setRole}>
              <option value="all">Mọi chức vụ</option>
              {options.roles.map(r => <option key={r} value={r}>{r}</option>)}
            </PillSelect>
          )}
          <SearchField value={query} onChange={setQuery} placeholder="Tìm tên, công ty…" className="flex-1 min-w-[200px]" />
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3 pb-2 border-b border-[#E5E5EA]">
          <label className="inline-flex items-center gap-2 text-[13px] font-medium text-[#1D1D1F] cursor-pointer min-h-[36px]">
            <input type="checkbox" checked={allFilteredOn} onChange={toggleAll} disabled={filtered.length === 0} className="w-4 h-4 accent-[#0071E3]" />
            {allFilteredOn ? 'Bỏ chọn' : 'Chọn tất cả'} {filtered.length} người đang lọc
          </label>
          {guessedHere.length > 0 && genderPick !== 'all' && (
            <button type="button" onClick={confirmGuesses} disabled={genderBusy}
              className="ml-auto h-8 px-3 rounded-full bg-[#0071E3]/10 text-[#0066CC] text-[12.5px] font-medium hover:bg-[#0071E3]/[0.16] disabled:opacity-40 transition">
              {genderBusy ? 'Đang lưu…' : `Lưu “${GENDER_LABEL[genderPick]}” cho ${guessedHere.length} người gợi ý`}
            </button>
          )}
        </div>

        {filtered.length === 0 && (
          <p className="py-6 text-center text-[13px] text-[#86868B]">
            {genderPick !== 'all'
              ? `Chưa có ai là ${GENDER_LABEL[genderPick]} trong bộ lọc này — đặt giới tính trong hồ sơ hoặc ở Ma trận (chọn nhiều người → Giới tính).`
              : 'Không có ai khớp bộ lọc.'}
          </p>
        )}
        <div className="max-h-[42vh] overflow-y-auto -mx-1 px-1">
          {shown.map(c => {
            const g = meta.get(c.id)?.gender;
            const sub = [groupDisplayOf(c, groupById).label, c.jobTitle, c.organization].filter(Boolean).join(' · ');
            return (
              <label key={c.id} className="flex items-center gap-3 py-2 border-b border-[#F0F0F2] last:border-0 cursor-pointer">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Chọn ${c.fullName}`} className="w-4 h-4 accent-[#0071E3] shrink-0" />
                <ContactAvatar name={c.fullName} url={c.avatarUrl} tier={c.tier} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-[#1D1D1F] truncate">{c.fullName}</span>
                  {sub && <span className="block text-[12px] text-[#86868B] truncate">{sub}</span>}
                </span>
                {g?.gender && (
                  <span title={g.guessed ? 'Gợi ý theo tên — chưa lưu' : undefined}
                    className={`shrink-0 px-2 h-6 inline-flex items-center rounded-full text-[11.5px] font-medium ${g.guessed ? 'border border-dashed border-[#AEAEB2] text-[#6E6E73]' : 'bg-black/[0.05] text-[#3A3A3C]'}`}>
                    {GENDER_LABEL[g.gender as Exclude<Gender, ''>]}{g.guessed ? '?' : ''}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {filtered.length > SHOW_MAX && (
          <p className="pt-2 text-[12px] text-[#86868B]">Còn {filtered.length - SHOW_MAX} người không hiện — “Chọn tất cả” vẫn chọn đủ; gõ tìm để thu hẹp.</p>
        )}
        <p className="pt-2 text-[11.5px] text-[#86868B]">“Nữ?” / “Nam?” = đoán theo tên (Ms, Mr, Chị, Anh, Thị, Văn…) — bấm lưu để xác nhận cho cả nhóm.</p>
      </section>

      {note && !error && <p className="mt-3 text-[13px] text-[#248A3D] bg-[#34C759]/10 rounded-[12px] px-3.5 py-2.5">{note}</p>}
      {error && <p className="mt-3 text-[13px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{error}</p>}

      <div className={`${SHEET_FOOTER} mt-4 bg-[#F2F2F7]/90 md:bg-white/90`}>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 md:flex-none md:px-6 h-11 md:h-9 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] transition">Huỷ</button>
          <span className="hidden md:block flex-1" />
          <button type="button" onClick={handleSave} disabled={saving || selected.size === 0}
            className="flex-[2] md:flex-none md:px-6 h-11 md:h-9 rounded-full bg-[#0071E3] text-white text-[13px] font-semibold hover:bg-[#0077ED] disabled:opacity-40 transition">
            {saving ? 'Đang ghi…' : `Ghi (${selected.size})`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
