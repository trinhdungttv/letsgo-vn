// Pháp lý — thêm / sửa Topic (chủ đề lớn) hoặc chủ đề con trong Thư viện ngành: tên, mô tả, màu, biểu tượng.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SHEET_FOOTER } from '../../modules/cskh/components/Sheet';
import { saveTopic } from '../../lib/legal/api';
import { SWATCHES, TOPIC_ICONS, type LegalTopic } from '../../lib/legal/types';
import { BTN_PRIMARY, BTN_SECONDARY } from '../workspace/wsTheme';
import { ColorTile, Field, INPUT_CLS, TEXTAREA_CLS, Swatches, TopicGlyph } from './ui';
import type { LegalStore } from './useLegal';

export default function TopicForm({ store, userName, toast, initial, parentId, onClose, onSaved }: {
  store: LegalStore; userName: string; toast: (m: string) => void; initial?: LegalTopic | null; parentId?: string | null;
  onClose: () => void; onSaved: (t: LegalTopic) => void;
}) {
  const parent = store.topics.find(t => t.id === (initial?.parent_id ?? parentId)) ?? null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? parent?.color ?? SWATCHES[(store.topics.filter(t => !t.parent_id).length) % 9]);
  const [icon, setIcon] = useState(initial?.icon ?? parent?.icon ?? 'book');
  const [busy, setBusy] = useState(false);
  const isSub = !!parent;

  const submit = async () => {
    if (!title.trim()) { toast('Chưa đặt tên chủ đề'); return; }
    setBusy(true);
    try {
      const siblings = store.topics.filter(t => t.parent_id === (parent?.id ?? null));
      const saved = await saveTopic({
        id: initial?.id ?? null, parent_id: parent?.id ?? null, title: title.trim(), description: description.trim(), color, icon,
        sort_order: initial?.sort_order ?? (siblings.reduce((m, t) => Math.max(m, t.sort_order), 0) + 1),
      }, userName);
      onSaved(saved);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet label={initial ? 'Sửa chủ đề' : 'Thêm chủ đề'} onClose={onClose} wide>
      <div className="flex items-center gap-3 pr-10 mb-4">
        <ColorTile color={color} size={44} radius={12}><TopicGlyph icon={icon} size={21} /></ColorTile>
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-[#1D1D1F]">{initial ? 'Sửa chủ đề' : isSub ? 'Thêm chủ đề con' : 'Thêm Topic'}</h3>
          {isSub && <div className="text-[12px] text-[#86868B]">Thuộc Topic: {parent!.title}</div>}
        </div>
      </div>
      <div className="space-y-3.5">
        <Field label="Tên">
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder={isSub ? 'vd Điều kiện cấp giấy phép' : 'vd Cho thuê lại lao động'} className={INPUT_CLS}
            onKeyDown={e => { if (e.key === 'Enter') void submit(); }} />
        </Field>
        <Field label="Mô tả ngắn">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Chủ đề này gồm những gì…" className={TEXTAREA_CLS} />
        </Field>
        <Field label="Màu"><Swatches value={color} onChange={setColor} /></Field>
        <Field label="Biểu tượng">
          <div className="flex flex-wrap gap-1.5">
            {TOPIC_ICONS.map(ic => (
              <button key={ic} type="button" onClick={() => setIcon(ic)} aria-label={ic}
                className={`w-9 h-9 rounded-[10px] inline-flex items-center justify-center transition ${icon === ic ? 'text-white' : 'bg-black/[0.04] text-[#3A3A3C] hover:bg-black/[0.08]'}`}
                style={icon === ic ? { background: color } : undefined}>
                <TopicGlyph icon={ic} size={17} />
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div className={`${SHEET_FOOTER} bg-[#F2F2F7]/90 md:bg-white/90 mt-5 flex gap-2 justify-end`}>
        <button type="button" onClick={onClose} className={`${BTN_SECONDARY} h-10 px-5 text-[14px]`}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={`${BTN_PRIMARY} h-10 px-5 text-[14px]`}>{busy && <Loader2 size={15} className="animate-spin" />} Lưu</button>
      </div>
    </Sheet>
  );
}
