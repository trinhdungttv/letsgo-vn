// ============================================================================
// "Chọn người chăm sóc" — đưa người liên hệ vào danh sách được nhắc + chấm điểm.
// ----------------------------------------------------------------------------
// Phần trên: GỢI Ý theo chức vụ cho người của khách ĐANG HỢP TÁC (chốt 19/10:
// tự xếp sẵn, xem trước, sửa từng dòng rồi mới áp dụng). Phần dưới (gập): những
// người còn lại chưa chăm sóc — khách ngưng hợp tác, tiềm năng, chưa gắn công ty.
// Tìm không dấu, chọn nhiều, "Gán chung" một nhóm (mặc định hoặc nhóm tự tạo) cho
// cả lô đã chọn. Người đã có nhóm thì đổi ở Ma trận.
// ============================================================================
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Sparkles } from 'lucide-react';
import { compareVnName } from '../../../lib/vnName';
import { contactSearchHaystack, matchesQuery } from '../../../lib/cskh/search';
import { buildSeedPlan, suggestTierForRole } from '../../../lib/cskh/seedTiers';
import type { CadenceConfig, CskhContact, CskhGroup } from '../../../lib/cskh/types';
import { CLASSIFIED_TIERS, TIER_HINT, TIER_LABEL } from '../../../lib/cskh/types';
import type { Client } from '../../../lib/types';
import type { GroupAssignment } from '../data/api';
import { chipStyle, GROUP_COLOR, inputCls, resolveGroupKey, TIER_COLOR } from '../ui';
import { ContactAvatar } from './ContactAvatar';
import { GroupOptions } from './GroupSelect';
import { Sheet } from './Sheet';

interface Row {
  contact: CskhContact;
  /** Khoá nhóm: hạng mặc định hoặc 'g:<id>' nhóm tự tạo. */
  groupKey: string;
  reason: string;
  checked: boolean;
}

export function CarePickerModal({ contacts, clients, groups, cadence, onApply, onClose }: {
  contacts: readonly CskhContact[];
  clients: readonly Client[];
  groups: readonly CskhGroup[];
  cadence: CadenceConfig;
  /** Trả về câu lỗi hoặc null khi đã lưu. */
  onApply: (rows: GroupAssignment[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const colorOf = (key: string) => (key.startsWith('g:') ? GROUP_COLOR[groupById.get(key.slice(2))?.color ?? 'gray'] : TIER_COLOR[key as keyof typeof TIER_COLOR]);
  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const byId = new Map(contacts.map(c => [c.id, c]));
    const out: Record<string, Row> = {};
    for (const p of buildSeedPlan(contacts, clients)) {
      const contact = byId.get(p.contactId);
      if (contact) out[contact.id] = { contact, groupKey: p.tier, reason: p.reason, checked: true };
    }
    for (const c of contacts) {
      if (out[c.id] || c.isArchived || c.tier !== 'unclassified') continue;
      const s = suggestTierForRole(c.jobTitle, c.primaryClientIds.length > 0);
      out[c.id] = { contact: c, groupKey: s.tier, reason: s.reason, checked: false };
    }
    return out;
  });
  const [suggestedIds] = useState(() => new Set(Object.values(rows).filter(r => r.checked).map(r => r.contact.id)));
  const [query, setQuery] = useState('');
  const [showOthers, setShowOthers] = useState(() => suggestedIds.size === 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const visible = useMemo(() => {
    const list = Object.values(rows)
      .filter(r => matchesQuery(contactSearchHaystack(r.contact), query))
      .sort((a, b) => compareVnName(a.contact.fullName, b.contact.fullName));
    return {
      suggested: list.filter(r => suggestedIds.has(r.contact.id)),
      others: list.filter(r => !suggestedIds.has(r.contact.id)),
    };
  }, [rows, query, suggestedIds]);

  const checked = Object.values(rows).filter(r => r.checked);
  const tally = [...new Set(checked.map(r => r.groupKey))]
    .map(key => ({ key, label: resolveGroupKey(key, groupById)?.label ?? key, n: checked.filter(r => r.groupKey === key).length }));
  const setCheckedGroup = (key: string) => setRows(prev => {
    const next = { ...prev };
    for (const r of Object.values(prev)) if (r.checked) next[r.contact.id] = { ...r, groupKey: key };
    return next;
  });

  const update = (id: string, patch: Partial<Row>) => setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const setAll = (list: Row[], value: boolean) =>
    setRows(prev => {
      const next = { ...prev };
      for (const r of list) next[r.contact.id] = { ...next[r.contact.id], checked: value };
      return next;
    });

  const apply = async () => {
    if (!checked.length) { setError('Chưa chọn ai'); return; }
    setSaving(true);
    setError('');
    const err = await onApply(checked.flatMap(r => {
      const t = resolveGroupKey(r.groupKey, groupById);
      return t && t.tier !== 'unclassified' ? [{ contactId: r.contact.id, tier: t.tier, groupId: t.groupId }] : [];
    }));
    setSaving(false);
    if (err) setError(err);
  };

  const renderRow = (r: Row) => (
    <div key={r.contact.id} className="flex flex-wrap md:flex-nowrap items-center gap-x-2.5 gap-y-1.5 py-2">
      <label className="flex items-center gap-2.5 min-w-0 flex-1 basis-full md:basis-auto cursor-pointer min-h-[40px] md:min-h-0">
        <input type="checkbox" checked={r.checked} onChange={e => update(r.contact.id, { checked: e.target.checked })}
          className="w-4 h-4 accent-blue-600 shrink-0" />
        <ContactAvatar name={r.contact.fullName} url={r.contact.avatarUrl} tier={r.checked ? resolveGroupKey(r.groupKey, groupById)?.tier ?? 'unclassified' : 'unclassified'} size={30} />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-[#111] truncate">{r.contact.fullName}</span>
          <span className="block text-[11px] text-[#999] truncate">
            {[r.contact.jobTitle || 'Chưa rõ chức vụ', r.contact.organization || 'Chưa gắn công ty'].join(' · ')}
          </span>
        </span>
      </label>
      <div className="flex items-center gap-2 pl-[62px] md:pl-0 shrink-0">
        <span className="hidden md:inline text-[10.5px] text-[#aaa] max-w-[150px] truncate" title={r.reason}>{r.reason}</span>
        <select value={r.groupKey} disabled={!r.checked}
          onChange={e => update(r.contact.id, { groupKey: e.target.value })}
          aria-label={`Nhóm chăm sóc của ${r.contact.fullName}`}
          className="text-[12px] h-9 md:h-7 px-2 rounded-lg border border-gray-300 bg-white disabled:opacity-40 outline-none focus:border-blue-500 max-w-[170px]"
          style={r.checked ? { color: colorOf(r.groupKey), fontWeight: 600 } : undefined}>
          <GroupOptions groups={groups} includeUnclassified={false} />
        </select>
      </div>
    </div>
  );

  return (
    <Sheet label="Chọn người chăm sóc" onClose={onClose} wide>
      <h2 className="text-[16px] md:text-[15px] font-semibold text-[#111] pr-6">Chọn người chăm sóc</h2>
      <p className="text-[12px] text-[#888] mt-0.5">
        Chỉ người được chọn mới được nhắc liên hệ, nhắc sinh nhật và chấm điểm. Hạng gợi ý theo chức vụ — sửa được từng dòng.
      </p>

      <details className="mt-2 text-[11.5px] text-[#666]">
        <summary className="cursor-pointer text-[#1D4ED8] select-none">Ý nghĩa các hạng</summary>
        <ul className="mt-1.5 space-y-0.5">
          {CLASSIFIED_TIERS.map(t => (
            <li key={t}><span className="px-1.5 py-0.5 rounded-full text-[10.5px] font-medium mr-1" style={chipStyle(TIER_COLOR[t])}>{TIER_LABEL[t]}</span>{TIER_HINT[t]}</li>
          ))}
        </ul>
      </details>

      <div className="relative mt-3">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} className={`${inputCls} pl-8`}
          placeholder="Tìm tên, công ty, SĐT… (gõ không dấu được)" aria-label="Tìm người liên hệ" />
      </div>

      <section className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11.5px] font-semibold text-[#333] flex items-center gap-1">
            <Sparkles size={13} className="text-[#1D4ED8]" /> Gợi ý — người của khách đang hợp tác ({visible.suggested.length})
          </p>
          {visible.suggested.length > 0 && (
            <button type="button" onClick={() => setAll(visible.suggested, !visible.suggested.every(r => r.checked))}
              className="text-[11.5px] text-[#1D4ED8] hover:underline min-h-[36px] md:min-h-0">
              {visible.suggested.every(r => r.checked) ? 'Bỏ chọn hết' : 'Chọn hết'}
            </button>
          )}
        </div>
        {visible.suggested.length === 0
          ? <p className="text-[12px] text-[#aaa] py-2">Không còn ai cần gợi ý — mọi người của khách đang hợp tác đã có hạng.</p>
          : <div className="divide-y divide-[#F0EFEB]">{visible.suggested.map(renderRow)}</div>}
      </section>

      {visible.others.length > 0 && (
        <section className="mt-3 border-t border-[#E8E7E2] pt-2">
          <button type="button" onClick={() => setShowOthers(v => !v)}
            className="w-full flex items-center gap-1 text-[11.5px] font-semibold text-[#333] min-h-[36px] md:min-h-0">
            {showOthers ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Người khác chưa chăm sóc ({visible.others.length}) — khách ngưng hợp tác, tiềm năng, chưa gắn công ty
          </button>
          {showOthers && <div className="divide-y divide-[#F0EFEB]">{visible.others.map(renderRow)}</div>}
        </section>
      )}

      {error && <p className="mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="sticky bottom-0 -mx-4 md:-mx-5 px-4 md:px-5 pt-3 mt-3 bg-[#F7F6F2] md:bg-white border-t border-[#E8E7E2]">
        {checked.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select value="" aria-label="Gán chung một nhóm cho các dòng đã chọn"
              onChange={e => { if (e.target.value) setCheckedGroup(e.target.value); }}
              className="text-[12px] h-9 md:h-7 px-2 rounded-lg border border-blue-200 bg-white outline-none">
              <option value="">Gán chung cho {checked.length} người đã chọn…</option>
              <GroupOptions groups={groups} cadence={cadence} includeUnclassified={false} />
            </select>
            <p className="text-[11px] text-[#888] flex flex-wrap gap-x-2 gap-y-1">
              {tally.map(x => <span key={x.key}><b style={{ color: colorOf(x.key) }}>{x.n}</b> {x.label}</span>)}
            </p>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose}
            className="flex-1 h-11 md:h-9 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-gray-600 hover:bg-gray-50">Huỷ</button>
          <button type="button" onClick={apply} disabled={saving || !checked.length}
            className="flex-[2] h-11 md:h-9 rounded-lg bg-[#1D4ED8] text-white text-[13px] font-semibold hover:bg-[#1E40AF] disabled:bg-gray-400">
            {saving ? 'Đang lưu…' : `Đưa ${checked.length} người vào chăm sóc`}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
