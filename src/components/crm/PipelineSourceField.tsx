import { useEffect, useId, useRef, useState } from 'react';
import { UserRound, Handshake, Building2, Store, X } from 'lucide-react';
import type { Branch, CRMPipelineEntry } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { branchOptions } from '../../lib/branchRef';
import {
  SOURCE_TYPES, sourceTypeOf, sourceNeedsName, sourceShortLabel, sourceFullLabel, uniqueNames,
  type PipelineSource, type PipelineSourceType,
} from '../../lib/pipelineSource';

const ICONS: Record<PipelineSourceType, typeof UserRound> = {
  sale: UserRound, partner: Handshake, company: Building2, branch: Store,
};

/** Nhãn nguồn nhỏ trên thẻ kanban — biểu tượng + tên, rê chuột xem đầy đủ. */
export function PipelineSourceChip({ entry, branches, className = '' }: {
  entry: Partial<CRMPipelineEntry>; branches: Branch[]; className?: string;
}) {
  const t = sourceTypeOf(entry.source_type);
  const label = sourceShortLabel(entry, branches);
  if (!t || !label) return null;
  const Icon = ICONS[t.id];
  return (
    <span title={`Nguồn: ${sourceFullLabel(entry, branches)}`}
      className={`inline-flex items-center gap-0.5 min-w-0 px-1.5 rounded-full border text-[10.5px] font-medium leading-[16px] ${t.chip} ${className}`}>
      <Icon size={10} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Gợi ý tên: sale lấy từ tài khoản nhân viên + tên đã từng nhập; đối tác lấy từ tên đã từng nhập. */
function useSourceNameSuggestions() {
  const [names, setNames] = useState<{ sale: string[]; partner: string[] }>({ sale: [], partner: [] });
  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from('app_users').select('full_name').in('role', ['admin', 'kinhdoanh', 'bdh']),
      supabase.from('crm_pipeline').select('source_type, source_name').not('source_name', 'is', null),
    ]).then(([u, p]) => {
      if (!alive) return;
      const used = (p.data ?? []) as { source_type: string | null; source_name: string | null }[];
      setNames({
        sale: uniqueNames([...(u.data ?? []).map((x: { full_name: string | null }) => x.full_name), ...used.filter(r => r.source_type === 'sale').map(r => r.source_name)]),
        partner: uniqueNames(used.filter(r => r.source_type === 'partner').map(r => r.source_name)),
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return names;
}

/**
 * Chọn nguồn: 4 nút loại nguồn + ô tên (sale/đối tác) hoặc ô chọn chi nhánh.
 * - `onChange`: mỗi lần sửa nháp.
 * - `onCommit` (tuỳ chọn, dùng ở hồ sơ công ty): gọi khi nên lưu — chọn Công ty/Chi nhánh,
 *   bỏ nguồn, hoặc rời ô tên / bấm Enter.
 */
export function PipelineSourcePicker({ value, onChange, onCommit, branches, defaultBranchId }: {
  value: PipelineSource;
  onChange: (v: PipelineSource) => void;
  onCommit?: (v: PipelineSource) => void;
  branches: Branch[];
  defaultBranchId?: string | null;
}) {
  const listId = useId();
  const names = useSourceNameSuggestions();
  const nameRef = useRef<HTMLInputElement>(null);
  const [focusName, setFocusName] = useState(false);
  useEffect(() => { if (focusName) { nameRef.current?.focus(); setFocusName(false); } }, [focusName]);

  const pick = (t: PipelineSourceType) => {
    if (value.source_type === t) return;
    const next: PipelineSource = {
      source_type: t,
      // Đổi qua lại sale ↔ đối tác thì giữ tên đang gõ.
      source_name: sourceNeedsName(t) && sourceNeedsName(value.source_type) ? value.source_name : null,
      source_branch_id: t === 'branch' ? (value.source_branch_id || defaultBranchId || null) : null,
    };
    onChange(next);
    if (sourceNeedsName(t)) setFocusName(true);
    else onCommit?.(next);
  };
  const clear = () => {
    const next: PipelineSource = { source_type: null, source_name: null, source_branch_id: null };
    onChange(next); onCommit?.(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {SOURCE_TYPES.map(t => {
          const Icon = ICONS[t.id];
          const on = value.source_type === t.id;
          return (
            <button type="button" key={t.id} onClick={() => pick(t.id)}
              className={`inline-flex items-center gap-1 px-2 py-1 md:py-0.5 rounded-full border text-[12px] md:text-[11.5px] font-medium transition ${on ? t.chip + ' ring-1 ring-current' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
              <Icon size={11} /> {t.label}
            </button>
          );
        })}
        {value.source_type && (
          <button type="button" onClick={clear} title="Bỏ nguồn"
            className="inline-flex items-center gap-0.5 px-1.5 py-1 md:py-0.5 text-[11px] text-gray-400 hover:text-red-500">
            <X size={11} /> Bỏ
          </button>
        )}
      </div>
      {sourceNeedsName(value.source_type) && (
        <>
          <input
            ref={nameRef}
            list={listId}
            value={value.source_name ?? ''}
            onChange={e => onChange({ ...value, source_name: e.target.value })}
            onBlur={() => onCommit?.(value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
            placeholder={value.source_type === 'sale' ? 'Tên sale mang về…' : 'Tên đối tác / người giới thiệu…'}
            className="w-full text-[13px] md:text-[12.5px] px-2.5 py-1.5 md:py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
          />
          <datalist id={listId}>
            {(value.source_type === 'sale' ? names.sale : names.partner).map(n => <option key={n} value={n} />)}
          </datalist>
        </>
      )}
      {value.source_type === 'branch' && (
        <select
          value={value.source_branch_id ?? ''}
          onChange={e => { const next = { ...value, source_branch_id: e.target.value || null }; onChange(next); onCommit?.(next); }}
          className="w-full text-[13px] md:text-[12.5px] px-2.5 py-1.5 md:py-1 rounded-lg border border-gray-300 outline-none focus:border-blue-500"
        >
          <option value="">— Chọn chi nhánh mang về —</option>
          {branchOptions(branches).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
    </div>
  );
}
