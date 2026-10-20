// Ô "Nhóm" hợp nhất (port PRM GroupSelect): Chưa chăm sóc / Nhóm mặc định (hạng) /
// Nhóm của tôi (nhóm tự tạo). Giá trị là khoá nhóm: hạng 'vvip'… hoặc 'g:<id>'.
import { ChevronDown, Plus } from 'lucide-react';
import type { CadenceConfig, CskhContact, CskhGroup } from '../../../lib/cskh/types';
import { CLASSIFIED_TIERS, TIER_LABEL } from '../../../lib/cskh/types';
import { chipStyle, groupDisplayOf, NEW_GROUP_VALUE } from '../ui';

export function GroupOptions({ groups, cadence, includeUnclassified = true, allowCreate = false }: {
  groups: readonly CskhGroup[];
  /** Có thì ghi kèm nhịp "· 45 ngày" cạnh tên nhóm. */
  cadence?: CadenceConfig;
  includeUnclassified?: boolean;
  allowCreate?: boolean;
}) {
  const days = (t: (typeof CLASSIFIED_TIERS)[number]) => (cadence ? ` · ${cadence[t]} ngày` : '');
  return (
    <>
      {includeUnclassified && <option value="unclassified">Chưa chăm sóc</option>}
      <optgroup label="Nhóm mặc định">
        {CLASSIFIED_TIERS.map(t => <option key={t} value={t}>{`${TIER_LABEL[t]}${days(t)}`}</option>)}
      </optgroup>
      {groups.length > 0 && (
        <optgroup label="Nhóm của tôi">
          {groups.map(g => <option key={g.id} value={`g:${g.id}`}>{`${g.name}${days(g.baseTier ?? 'other')}`}</option>)}
        </optgroup>
      )}
      {allowCreate && <option value={NEW_GROUP_VALUE}>＋ Tạo nhóm mới…</option>}
    </>
  );
}

/**
 * Chip nhóm trên từng dòng — chạm là bung ô chọn gốc của hệ điều hành (iPhone: bánh xe
 * chọn), chọn xong ghi ngay. <select> trong suốt phủ lên chip để bảng có overflow không cắt mất.
 */
export function QuickGroupSelect({ contact, groups, groupById, cadence, disabled, onPick, onCreate }: {
  contact: Pick<CskhContact, 'fullName' | 'tier' | 'groupId'>;
  groups: readonly CskhGroup[];
  groupById: ReadonlyMap<string, CskhGroup>;
  cadence?: CadenceConfig;
  disabled?: boolean;
  onPick: (key: string) => void;
  onCreate?: () => void;
}) {
  const d = groupDisplayOf(contact, groupById);
  const unclassified = d.key === 'unclassified';
  return (
    <span
      className={`relative inline-flex items-center gap-0.5 h-7 md:h-6 px-2 rounded-full text-[11px] font-medium whitespace-nowrap ${
        unclassified ? 'border border-dashed border-[#C9C7BE] text-[#888]' : ''
      } ${disabled ? 'opacity-50' : 'hover:brightness-95'}`}
      style={unclassified ? undefined : chipStyle(d.color)}
    >
      {unclassified ? <><Plus size={11} strokeWidth={2.8} /> Chọn nhóm</> : d.label}
      <ChevronDown size={11} strokeWidth={2.6} />
      <select
        value={d.key}
        disabled={disabled}
        aria-label={`Chọn nhóm cho ${contact.fullName} (hiện tại: ${d.label})`}
        onClick={e => e.stopPropagation()}
        onChange={e => {
          const v = e.target.value;
          if (v === NEW_GROUP_VALUE) onCreate?.();
          else if (v !== d.key) onPick(v);
        }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      >
        <GroupOptions groups={groups} cadence={cadence} allowCreate={!!onCreate} />
      </select>
    </span>
  );
}
