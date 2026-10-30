// Quản lý nhóm tự tạo (port PRM GroupManagerModal). Nhóm nằm CHUNG danh sách "Nhóm"
// với các hạng mặc định — mỗi nhóm chọn "nhắc liên hệ như" 1 hạng có sẵn (nhịp + điểm
// theo hạng đó). Đổi hạng gốc → mọi thành viên đổi hạng theo. Xoá = lưu trữ, thành
// viên về nhóm mặc định đúng hạng đang có.
import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { CadenceConfig, CskhClassifiedTier, CskhGroup, GroupColor } from '../../../lib/cskh/types';
import { CLASSIFIED_TIERS, GROUP_COLORS } from '../../../lib/cskh/types';
import { GROUP_COLOR, inputCls } from '../ui';
import { Sheet } from './Sheet';
import { useSpace } from '../space';

const COLOR_NAME: Readonly<Record<GroupColor, string>> = {
  blue: 'Xanh dương', green: 'Xanh lá', orange: 'Cam', red: 'Đỏ', purple: 'Tím', gray: 'Xám',
};

function ColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  return (
    <div className="flex gap-1.5" role="group" aria-label="Màu nhóm">
      {GROUP_COLORS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-pressed={value === c} aria-label={COLOR_NAME[c]} title={COLOR_NAME[c]}
          className="w-8 h-8 md:w-6 md:h-6 rounded-full flex items-center justify-center text-white"
          style={{ background: GROUP_COLOR[c], outline: value === c ? `2px solid ${GROUP_COLOR[c]}` : 'none', outlineOffset: 2 }}>
          {value === c && <Check size={12} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

function BaseTierSelect({ value, cadence, onChange }: { value: CskhClassifiedTier; cadence: CadenceConfig; onChange: (t: CskhClassifiedTier) => void }) {
  const { tierLabel } = useSpace();
  return (
    <label className="flex items-center gap-2 text-[12px] text-[#6E6E73]">
      <span className="shrink-0">Nhắc liên hệ như</span>
      <select value={value} onChange={e => onChange(e.target.value as CskhClassifiedTier)}
        className="flex-1 min-w-0 text-[13px] h-9 md:h-8 px-3 rounded-[10px] border border-black/[0.12] bg-white outline-none focus:border-[#0071E3] focus:ring-4 focus:ring-[#0071E3]/15">
        {CLASSIFIED_TIERS.map(t => <option key={t} value={t}>{`${tierLabel[t]} · ${cadence[t]} ngày`}</option>)}
      </select>
    </label>
  );
}

interface Draft {
  name: string;
  color: GroupColor;
  baseTier: CskhClassifiedTier;
}

export function GroupManagerModal({ groups, counts, cadence, onAdd, onUpdate, onRemove, onClose }: {
  groups: readonly CskhGroup[];
  /** Số người trong từng nhóm — cảnh báo trước khi xoá. */
  counts: ReadonlyMap<string, number>;
  cadence: CadenceConfig;
  /** Trả về câu lỗi hoặc null. */
  onAdd: (d: Draft) => Promise<string | null>;
  onUpdate: (g: CskhGroup, d: Draft) => Promise<string | null>;
  onRemove: (g: CskhGroup) => Promise<string | null>;
  onClose: () => void;
}) {
  const { tierLabel } = useSpace();
  const [draft, setDraft] = useState<Draft>({ name: '', color: 'blue', baseTier: 'partner' });
  const [editing, setEditing] = useState<{ id: string; d: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<string | null>, after?: () => void) => {
    setBusy(true);
    setError('');
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
    else after?.();
  };

  return (
    <Sheet label="Nhóm chăm sóc" onClose={onClose}>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F] pr-6">Nhóm chăm sóc của tôi</h2>
      <p className="text-[12px] text-[#86868B] mt-0.5">
        VD: "Khách Samsung", "Ban giám đốc VSIP". Mỗi nhóm nhắc liên hệ theo nhịp của một hạng có sẵn.
      </p>

      <div className="mt-3 space-y-2">
        {groups.length === 0 && <p className="text-[12px] text-[#AEAEB2] py-2">Chưa có nhóm nào.</p>}
        {groups.map(g => {
          const n = counts.get(g.id) ?? 0;
          const isEditing = editing?.id === g.id;
          if (isEditing && editing) {
            return (
              <div key={g.id} className="rounded-[14px] bg-[#0071E3]/[0.06] ring-1 ring-[#0071E3]/25 p-3 space-y-2">
                <input value={editing.d.name} maxLength={60} onChange={e => setEditing({ id: g.id, d: { ...editing.d, name: e.target.value } })} className={inputCls} aria-label="Tên nhóm" />
                <ColorPicker value={editing.d.color} onChange={c => setEditing({ id: g.id, d: { ...editing.d, color: c } })} />
                <BaseTierSelect value={editing.d.baseTier} cadence={cadence} onChange={t => setEditing({ id: g.id, d: { ...editing.d, baseTier: t } })} />
                {editing.d.baseTier !== (g.baseTier ?? 'other') && n > 0 && (
                  <p className="text-[11.5px] text-[#B25000]">{n} thành viên sẽ đổi sang nhịp {tierLabel[editing.d.baseTier]} ({cadence[editing.d.baseTier]} ngày).</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setEditing(null)} className="h-9 md:h-8 px-3.5 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] transition">Huỷ</button>
                  <button type="button" disabled={busy} onClick={() => run(() => onUpdate(g, editing.d), () => setEditing(null))}
                    className="h-9 md:h-8 px-4 rounded-full bg-[#0071E3] text-white active:scale-[0.98] transition text-[13px] font-semibold disabled:opacity-40">Lưu</button>
                </div>
              </div>
            );
          }
          return (
            <div key={g.id} className="flex items-center gap-2.5 rounded-[12px] bg-white md:bg-[#F5F5F7] px-3.5 py-2.5">
              <i className="w-3 h-3 rounded-full shrink-0" style={{ background: GROUP_COLOR[g.color] }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[#1D1D1F] truncate">{g.name}</span>
                <span className="block text-[11px] text-[#86868B]">
                  {n} người · nhắc như {tierLabel[g.baseTier ?? 'other']} ({cadence[g.baseTier ?? 'other']} ngày)
                </span>
              </span>
              <button type="button" onClick={() => setEditing({ id: g.id, d: { name: g.name, color: g.color, baseTier: g.baseTier ?? 'other' } })}
                aria-label={`Sửa nhóm ${g.name}`} className="w-9 h-9 md:w-8 md:h-8 rounded-full hover:bg-black/[0.05] flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] transition">
                <Pencil size={13} />
              </button>
              <button type="button" disabled={busy} aria-label={`Xoá nhóm ${g.name}`}
                onClick={() => {
                  if (!confirm(`Xoá nhóm "${g.name}"?${n ? `\n\n${n} người trong nhóm vẫn được chăm sóc, về nhóm mặc định ${tierLabel[g.baseTier ?? 'other']}.` : ''}`)) return;
                  void run(() => onRemove(g));
                }}
                className="w-9 h-9 md:w-8 md:h-8 rounded-full hover:bg-[#FF3B30]/10 flex items-center justify-center text-[#FF3B30] transition">
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-5 space-y-2">
        <p className="px-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#86868B]">Tạo nhóm mới</p>
        <input value={draft.name} maxLength={60} onChange={e => setDraft({ ...draft, name: e.target.value })} className={inputCls} placeholder="Tên nhóm" aria-label="Tên nhóm mới" />
        <ColorPicker value={draft.color} onChange={c => setDraft({ ...draft, color: c })} />
        <BaseTierSelect value={draft.baseTier} cadence={cadence} onChange={t => setDraft({ ...draft, baseTier: t })} />
        {error && <p className="text-[13px] text-[#D70015] bg-[#FF3B30]/10 rounded-[12px] px-3.5 py-2.5">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 h-11 md:h-9 rounded-full bg-[rgba(118,118,128,0.12)] text-[13px] font-medium text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)] active:scale-[0.98] transition inline-flex items-center justify-center gap-1">
            <X size={14} /> Đóng
          </button>
          <button type="button" disabled={busy || !draft.name.trim()}
            onClick={() => run(() => onAdd(draft), () => setDraft({ name: '', color: draft.color, baseTier: draft.baseTier }))}
            className="flex-[2] h-11 md:h-9 rounded-full bg-[#0071E3] text-white active:scale-[0.98] transition text-[13px] font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1">
            <Plus size={14} /> Tạo nhóm
          </button>
        </div>
      </div>
    </Sheet>
  );
}
