import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UserRound, Handshake, Building2, Store, X, Check, ChevronDown, Pencil, Plus } from 'lucide-react';
import type { Branch, CRMPipelineEntry } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logActivity } from '../../lib/audit';
import { branchOptions } from '../../lib/branchRef';
import {
  SOURCE_TYPES, sourceTypeOf, sourceNeedsName, sourceHasName, sourceShortLabel, sourceFullLabel, sourceNameOptions, normSourceName, tidySourceName,
  DEFAULT_DEPARTMENTS, type NamedSourceType, type PipelineSource, type PipelineSourceType, type SourceNameOption,
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

/** Báo cho mọi nơi đang hiển thị nguồn (thẻ kanban, ô chọn khác) nạp lại sau khi đổi tên / gộp người giới thiệu. */
export const SOURCE_NAMES_CHANGED = 'lgvn:source-names-changed';

/**
 * Danh sách sale / đối tác cho ô chọn: lấy từ chính các dự án đã ghi nguồn (ai đã mang dự án về thì có trong danh sách,
 * kèm số dự án); Sale thêm cả nhân viên kinh doanh chưa có dự án nào.
 */
function useSourceNameOptions() {
  const [rows, setRows] = useState<{ source_type: string | null; source_name: string | null }[]>([]);
  const [staff, setStaff] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from('app_users').select('full_name').in('role', ['admin', 'kinhdoanh', 'bdh']),
      supabase.from('crm_pipeline').select('source_type, source_name').not('source_name', 'is', null),
    ]).then(([u, p]) => {
      if (!alive) return;
      setStaff(((u.data ?? []) as { full_name: string | null }[]).map(x => x.full_name ?? '').filter(Boolean));
      setRows((p.data ?? []) as { source_type: string | null; source_name: string | null }[]);
    }).catch(() => {});
    return () => { alive = false; };
  }, [tick]);
  useEffect(() => {
    window.addEventListener(SOURCE_NAMES_CHANGED, reload);
    return () => window.removeEventListener(SOURCE_NAMES_CHANGED, reload);
  }, [reload]);
  const options = useMemo(() => ({
    sale: sourceNameOptions(rows, 'sale', staff),
    partner: sourceNameOptions(rows, 'partner'),
    company: sourceNameOptions(rows, 'company', DEFAULT_DEPARTMENTS),
  }), [rows, staff]);
  return { options, reload };
}

const NOUN: Record<NamedSourceType, string> = { sale: 'sale', partner: 'đối tác', company: 'phòng ban' };

/** Ô chọn xổ xuống: chọn người / phòng ban đã có (kèm số dự án), gõ để tìm, hoặc thêm tên mới. */
function NameCombo({ kind, value, options, openSignal, onPick, onRename }: {
  kind: NamedSourceType;
  value: string | null;
  options: SourceNameOption[];
  /** Tăng lên để tự mở danh sách (vd vừa bấm nút "Đối tác giới thiệu") */
  openSignal: number;
  onPick: (name: string) => void;
  onRename: (o: SourceNameOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const noun = NOUN[kind];

  useEffect(() => { if (openSignal > 0) setOpen(true); }, [openSignal]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const nq = normSourceName(q);
  // Tìm không cần gõ dấu: "duong" ra "Dương"
  const fold = (x: string) => normSourceName(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const filtered = nq ? options.filter(o => fold(o.name).includes(fold(q))) : options;
  const exact = nq ? options.find(o => normSourceName(o.name) === nq) : undefined;
  const items: ({ kind: 'opt'; o: SourceNameOption } | { kind: 'new'; name: string })[] = [
    ...filtered.map(o => ({ kind: 'opt' as const, o })),
    ...(nq && !exact ? [{ kind: 'new' as const, name: tidySourceName(q) }] : []),
  ];
  const pick = (name: string) => { onPick(name); setOpen(false); setQ(''); };
  const choose = (i: number) => { const it = items[i]; if (it) pick(it.kind === 'opt' ? it.o.name : it.name); };

  return (
    <div ref={boxRef} className="relative">
      {open ? (
        <input
          autoFocus value={q} onChange={e => { setQ(e.target.value); setHi(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(items.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(hi); }
            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQ(''); }
          }}
          placeholder={`Tìm ${noun} hoặc gõ tên mới…`}
          className="w-full text-[13px] md:text-[12.5px] px-2.5 py-1.5 md:py-1 rounded-lg border border-blue-500 outline-none"
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 text-left text-[13px] md:text-[12.5px] px-2.5 py-1.5 md:py-1 rounded-lg border border-gray-300 hover:border-blue-400 bg-white">
          <span className={`flex-1 min-w-0 truncate ${value ? 'text-[#111]' : 'text-gray-400'}`}>{value || (kind === 'company' ? 'Chọn phòng ban (tuỳ chọn)…' : `Chọn ${noun} đã có, hoặc thêm mới…`)}</span>
          <ChevronDown size={14} className="text-gray-400 shrink-0" />
        </button>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white border border-[#E8E7E2] rounded-lg shadow-xl max-h-64 overflow-y-auto py-1">
          {options.length === 0 && !nq && <div className="px-3 py-2 text-[12px] text-[#999]">Chưa có {noun} nào mang dự án về — gõ tên để thêm.</div>}
          {kind === 'company' && value && !nq && (
            <div onMouseDown={e => { e.preventDefault(); pick(''); }} className="px-3 py-1.5 cursor-pointer text-[12.5px] text-[#888] hover:bg-[#F9F9F7] border-b border-[#F0EEE9]">Không ghi phòng ban</div>
          )}
          {items.map((it, i) => it.kind === 'opt' ? (
            <div key={it.o.name} onMouseEnter={() => setHi(i)}
              className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px] md:text-[12.5px] ${i === hi ? 'bg-blue-50' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(it.o.name); }}>
              <Check size={13} className={`shrink-0 ${normSourceName(value) === normSourceName(it.o.name) ? 'text-blue-600' : 'text-transparent'}`} />
              <span className="flex-1 min-w-0 truncate text-[#111]">{it.o.name}</span>
              <span className="shrink-0 text-[11px] text-[#999]">{it.o.count > 0 ? `${it.o.count} dự án` : kind === 'sale' ? 'nhân viên' : 'gợi ý'}</span>
              {it.o.count > 0 && (
                <button type="button" title="Đổi tên / gộp trùng ở mọi dự án"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(''); onRename(it.o); }}
                  className="shrink-0 p-1 rounded text-[#bbb] hover:text-blue-600 hover:bg-white md:opacity-0 md:group-hover:opacity-100"><Pencil size={11} /></button>
              )}
            </div>
          ) : (
            <div key="__new" onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); pick(it.name); }}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px] md:text-[12.5px] text-blue-700 border-t border-[#F0EEE9] ${i === hi ? 'bg-blue-50' : ''}`}>
              <Plus size={13} className="shrink-0" /> Thêm {noun} mới: <b className="truncate">“{it.name}”</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Chọn nguồn: 4 nút loại nguồn + ô chọn sale/đối tác (xổ xuống) hoặc ô chọn chi nhánh.
 * - `onChange`: mỗi lần sửa nháp.
 * - `onCommit` (tuỳ chọn, dùng ở hồ sơ công ty): gọi khi nên lưu — chọn loại Công ty/Chi nhánh, chọn tên, bỏ nguồn.
 */
export function PipelineSourcePicker({ value, onChange, onCommit, branches, defaultBranchId }: {
  value: PipelineSource;
  onChange: (v: PipelineSource) => void;
  onCommit?: (v: PipelineSource) => void;
  branches: Branch[];
  defaultBranchId?: string | null;
}) {
  const { user } = useAuth();
  const { options, reload } = useSourceNameOptions();
  const [openSignal, setOpenSignal] = useState(0);

  const pick = (t: PipelineSourceType) => {
    if (value.source_type === t) return;
    const next: PipelineSource = {
      source_type: t,
      // Đổi qua lại sale ↔ đối tác thì giữ tên đã chọn.
      source_name: sourceNeedsName(t) && sourceNeedsName(value.source_type) ? value.source_name : null,
      source_branch_id: t === 'branch' ? (value.source_branch_id || defaultBranchId || null) : null,
    };
    onChange(next);
    if (sourceNeedsName(t) && !next.source_name) setOpenSignal(n => n + 1);
    else {
      onCommit?.(next);
      if (t === 'company') setOpenSignal(n => n + 1);   // phòng ban không bắt buộc: lưu ngay, mở danh sách để chọn thêm
    }
  };
  const clear = () => {
    const next: PipelineSource = { source_type: null, source_name: null, source_branch_id: null };
    onChange(next); onCommit?.(next);
  };
  const pickName = (name: string) => {
    const next: PipelineSource = { ...value, source_name: name || null };
    onChange(next); onCommit?.(next);
  };

  // Đổi tên / gộp trùng: sửa cách viết ở MỌI dự án của người này để thống kê không bị tách đôi.
  const rename = async (o: SourceNameOption) => {
    if (!sourceHasName(value.source_type)) return;
    const kind = value.source_type;
    const list = options[kind];
    const raw = window.prompt(`Đổi tên “${o.name}” (${o.count} dự án) thành:\n(Gõ đúng một tên đã có trong danh sách để gộp 2 tên làm một)`, o.name);
    const next = tidySourceName(raw);
    if (!next || next === o.name) return;
    const target = list.find(x => x !== o && normSourceName(x.name) === normSourceName(next));
    const finalName = target?.name ?? next;
    const msg = target
      ? `Gộp “${o.name}” vào “${target.name}”?\n\n${o.count} dự án của “${o.name}” sẽ chuyển sang “${target.name}” (tổng ${o.count + target.count} dự án).`
      : `Đổi tên “${o.name}” → “${next}” ở ${o.count} dự án?`;
    if (!window.confirm(msg)) return;
    const { data, error } = await supabase.from('crm_pipeline').select('id, source_name').eq('source_type', kind).not('source_name', 'is', null);
    if (error) { window.alert('Lỗi: ' + error.message); return; }
    const ids = ((data ?? []) as { id: string; source_name: string | null }[])
      .filter(r => normSourceName(r.source_name) === normSourceName(o.name)).map(r => r.id);
    if (!ids.length) return;
    const { error: upErr } = await supabase.from('crm_pipeline').update({ source_name: finalName }).in('id', ids);
    if (upErr) { window.alert('Lỗi: ' + upErr.message); return; }
    await logActivity({
      user, action: 'update', table: 'crm_pipeline', recordId: ids.join(','),
      description: target
        ? `Gộp ${NOUN[kind]} “${o.name}” vào “${target.name}” (${ids.length} dự án)`
        : `Đổi tên ${NOUN[kind]} “${o.name}” → “${finalName}” (${ids.length} dự án)`,
      newData: { source_type: kind, from: o.name, to: finalName, ids },
    });
    if (normSourceName(value.source_name) === normSourceName(o.name)) onChange({ ...value, source_name: finalName });
    reload();
    window.dispatchEvent(new Event(SOURCE_NAMES_CHANGED));
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
      {sourceHasName(value.source_type) && (
        <NameCombo
          kind={value.source_type}
          value={value.source_name}
          options={options[value.source_type]}
          openSignal={openSignal}
          onPick={pickName}
          onRename={rename}
        />
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
