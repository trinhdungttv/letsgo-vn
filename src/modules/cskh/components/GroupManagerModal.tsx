// Quản lý nhóm tự tạo (port PRM GroupManagerModal). Nhóm nằm CHUNG danh sách "Nhóm"
// với các hạng mặc định — mỗi nhóm chọn "nhắc liên hệ như" 1 hạng có sẵn (nhịp + điểm
// theo hạng đó). Đổi hạng gốc → mọi thành viên đổi hạng theo. Xoá = lưu trữ, thành
// viên về nhóm mặc định đúng hạng đang có.
import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { CadenceConfig, CskhClassifiedTier, CskhGroup, GroupColor } from '../../../lib/cskh/types';
import { CLASSIFIED_TIERS, GROUP_COLORS, TIER_LABEL } from '../../../lib/cskh/types';
import { GROUP_COLOR, inputCls } from '../ui';
import { Sheet } from './Sheet';

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
  return (
    <label className="flex items-center gap-2 text-[12px] text-[#666]">
      <span className="shrink-0">Nhắc liên hệ như</span>
      <select value={value} onChange={e => onChange(e.target.value as CskhClassifiedTier)}
        className="flex-1 min-w-0 text-[12.5px] h-9 md:h-8 px-2 rounded-lg border border-gray-300 bg-white outline-none focus:border-blue-500">
        {CLASSIFIED_TIERS.map(t => <option key={t} value={t}>{`${TIER_LABEL[t]} · ${cadence[t]} ngày`}</option>)}
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
      <h2 className="text-[16px] md:text-[15px] font-semibold text-[#111] pr-6">Nhóm chăm sóc của tôi</h2>
      <p className="text-[12px] text-[#888] mt-0.5">
        VD: "Khách Samsung", "Ban giám đốc VSIP". Mỗi nhóm nhắc liên hệ theo nhịp của một hạng có sẵn.
      </p>

      <div className="mt-3 space-y-2">
        {groups.length === 0 && <p className="text-[12px] text-[#aaa] py-2">Chưa có nhóm nào.</p>}
        {groups.map(g => {
          const n = counts.get(g.id) ?? 0;
          const isEditing = editing?.id === g.id;
          if (isEditing && editing) {
            return (
              <div key={g.id} className="border border-blue-200 bg-blue-50/40 rounded-[10px] p-3 space-y-2">
                <input value={editing.d.name} maxLength={60} onChange={e => setEditing({ id: g.id, d: { ...editing.d, name: e.target.value } })} className={inputCls} aria-label="Tên nhóm" />
                <ColorPicker value={editing.d.color} onChange={c => setEditing({ id: g.id, d: { ...editing.d, color: c } })} />
                <BaseTierSelect value={editing.d.baseTier} cadence={cadence} onChange={t => setEditing({ id: g.id, d: { ...editing.d, baseTier: t } })} />
                {editing.d.baseTier !== (g.baseTier ?? 'other') && n > 0 && (
                  <p className="text-[11.5px] text-amber-700">{n} thành viên sẽ đổi sang nhịp {TIER_LABEL[editing.d.baseTier]} ({cadence[editing.d.baseTier]} ngày).</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setEditing(null)} className="h-9 md:h-7 px-3 rounded-lg border border-gray-300 bg-white text-[12px]">Huỷ</button>
                  <button type="button" disabled={busy} onClick={() => run(() => onUpdate(g, editing.d), () => setEditing(null))}
                    className="h-9 md:h-7 px-3 rounded-lg bg-[#1D4ED8] text-white text-[12px] font-semibold disabled:bg-gray-400">Lưu</button>
                </div>
              </div>
            );
          }
          return (
            <div key={g.id} className="flex items-center gap-2 border border-[#E8E7E2] bg-white rounded-[10px] px-3 py-2">
              <i className="w-3 h-3 rounded-full shrink-0" style={{ background: GROUP_COLOR[g.color] }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[#111] truncate">{g.name}</span>
                <span className="block text-[11px] text-[#999]">
                  {n} người · nhắc như {TIER_LABEL[g.baseTier ?? 'other']} ({cadence[g.baseTier ?? 'other']} ngày)
                </span>
              </span>
              <button type="button" onClick={() => setEditing({ id: g.id, d: { name: g.name, color: g.color, baseTier: g.baseTier ?? 'other' } })}
                aria-label={`Sửa nhóm ${g.name}`} className="w-9 h-9 md:w-7 md:h-7 rounded-lg hover:bg-[#F4F3EF] flex items-center justify-center text-[#666]">
                <Pencil size={13} />
              </button>
              <button type="button" disabled={busy} aria-label={`Xoá nhóm ${g.name}`}
                onClick={() => {
                  if (!confirm(`Xoá nhóm "${g.name}"?${n ? `\n\n${n} người trong nhóm vẫn được chăm sóc, về nhóm mặc định ${TIER_LABEL[g.baseTier ?? 'other']}.` : ''}`)) return;
                  void run(() => onRemove(g));
                }}
                className="w-9 h-9 md:w-7 md:h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-red-500">
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-4 border-t border-[#E8E7E2] pt-3 space-y-2">
        <p className="text-[11.5px] font-semibold text-[#333]">Tạo nhóm mới</p>
        <input value={draft.name} maxLength={60} onChange={e => setDraft({ ...draft, name: e.target.value })} className={inputCls} placeholder="Tên nhóm" aria-label="Tên nhóm mới" />
        <ColorPicker value={draft.color} onChange={c => setDraft({ ...draft, color: c })} />
        <BaseTierSelect value={draft.baseTier} cadence={cadence} onChange={t => setDraft({ ...draft, baseTier: t })} />
        {error && <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 h-11 md:h-9 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-gray-600 inline-flex items-center justify-center gap-1">
            <X size={14} /> Đóng
          </button>
          <button type="button" disabled={busy || !draft.name.trim()}
            onClick={() => run(() => onAdd(draft), () => setDraft({ name: '', color: draft.color, baseTier: draft.baseTier }))}
            className="flex-[2] h-11 md:h-9 rounded-lg bg-[#1D4ED8] text-white text-[13px] font-semibold disabled:bg-gray-400 inline-flex items-center justify-center gap-1">
            <Plus size={14} /> Tạo nhóm
          </button>
        </div>
      </div>
    </Sheet>
  );
}
