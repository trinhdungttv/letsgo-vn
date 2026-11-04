// Pháp lý — thêm / sửa 1 MỐC trên dòng thời gian pháp nhân: ngày, loại (thành lập, thay đổi ĐKKD lần N, giấy phép…),
// nội dung thay đổi TRƯỚC → SAU, file đính kèm (link Google Drive). Có thể ghi luôn giá trị mới vào hồ sơ hiện tại.
import { useMemo, useState } from 'react';
import { Loader2, Paperclip, Plus, X } from 'lucide-react';
import { Sheet, SHEET_FOOTER, ChoiceChip } from '../../modules/cskh/components/Sheet';
import { archive, patchEntity, saveDoc, saveMilestone } from '../../lib/legal/api';
import { parseDocLink, resolveFileType } from '../../lib/legal/drive';
import { currentValueFor, defaultMilestoneTitle, entityPatchFromChanges, suggestChangeNo, todayIso } from '../../lib/legal/timeline';
import {
  CHANGE_ASPECTS, ENTITY_DOC_CATEGORIES, MILESTONE_KIND_IDS, MILESTONE_KINDS, MILESTONE_STATUS, rid,
  type LegalEntity, type LegalMilestone, type MilestoneChange, type MilestoneKind, type MilestoneStatus,
} from '../../lib/legal/types';
import { BTN_PRIMARY, BTN_SECONDARY } from '../workspace/wsTheme';
import { DraftNotice, useFormDraft } from './useFormDraft';
import { DocKindIcon, Field, INPUT_CLS, TEXTAREA_CLS } from './ui';
import type { LegalStore } from './useLegal';

const KIND_CATEGORY: Partial<Record<MilestoneKind, string>> = {
  thanh_lap: 'dkkd', thay_doi: 'dkkd', giay_phep: 'giay_phep', thue: 'thue', lao_dong: 'lao_dong', con_dau: 'dieu_le',
};

interface NewAttach { id: string; title: string; url: string }

export default function MilestoneForm({ store, entity, initial, userName, toast, onClose, onSaved }: {
  store: LegalStore; entity: LegalEntity; initial: LegalMilestone | null; userName: string; toast: (m: string) => void;
  onClose: () => void; onSaved: (m: LegalMilestone) => void;
}) {
  const [date, setDate] = useState(initial?.event_date ?? todayIso());
  const [kind, setKind] = useState<MilestoneKind>(initial?.kind ?? (store.milestones.some(m => m.entity_id === entity.id) ? 'thay_doi' : 'thanh_lap'));
  const [status, setStatus] = useState<MilestoneStatus>(initial?.status ?? 'done');
  const suggested = suggestChangeNo(store.milestones, entity.id, date, initial?.id);
  const [changeNo, setChangeNo] = useState<string>(initial?.change_no != null ? String(initial.change_no) : '');
  const effectiveNo = kind === 'thay_doi' ? (changeNo.trim() ? Number(changeNo) || null : suggested) : null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [titleTouched, setTitleTouched] = useState(!!initial);
  const shownTitle = titleTouched ? title : defaultMilestoneTitle(kind, effectiveNo);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [changes, setChanges] = useState<MilestoneChange[]>(initial?.changes ?? []);
  const [attach, setAttach] = useState<NewAttach[]>([]);
  const [removeDocs, setRemoveDocs] = useState<string[]>([]);
  const patch = entityPatchFromChanges(changes);
  const canApply = Object.keys(patch).length > 0;
  // Mốc cũ hơn mốc đã xong gần nhất (đang nhập bù lịch sử) → mặc định KHÔNG ghi đè thông tin hiện tại
  const latestDone = store.milestones.filter(m => m.entity_id === entity.id && m.id !== initial?.id && m.status === 'done' && !m.deleted_at)
    .reduce((mx, m) => (m.event_date > mx ? m.event_date : mx), '');
  const isLatest = date >= latestDone;
  const [applyPick, setApplyPick] = useState<boolean | null>(null);
  const apply = applyPick ?? (!initial && isLatest);
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(`milestone:${entity.id}:${initial?.id ?? 'new'}`,
    { date, kind, status, changeNo, title, titleTouched, description, changes, attach, applyPick },
    v => {
      setDate(v.date); setKind(v.kind); setStatus(v.status); setChangeNo(v.changeNo); setTitle(v.title); setTitleTouched(v.titleTouched);
      setDescription(v.description); setChanges(v.changes); setAttach(v.attach); setApplyPick(v.applyPick);
    });
  const discard = () => { draft.clear(); onClose(); };

  const existingDocs = useMemo(() => (initial ? store.docs.filter(d => d.milestone_id === initial.id && !removeDocs.includes(d.id)) : []), [initial, store.docs, removeDocs]);

  const toggleAspect = (key: string) => {
    setChanges(cs => cs.some(c => c.aspect === key)
      ? cs.filter(c => c.aspect !== key)
      : [...cs, { id: rid(), aspect: key, from: currentValueFor(entity, key), to: '' }]);
  };

  const submit = async () => {
    if (!date) { toast('Chưa chọn ngày'); return; }
    const badLink = attach.find(a => a.url.trim() && parseDocLink(a.url).source === 'invalid');
    if (badLink) { toast(`Link chưa đúng: ${badLink.url}`); return; }
    setBusy(true);
    try {
      const saved = await saveMilestone({
        id: initial?.id ?? null, entity_id: entity.id, event_date: date, kind, status,
        change_no: kind === 'thay_doi' ? effectiveNo : null,
        title: shownTitle.trim() || defaultMilestoneTitle(kind, effectiveNo),
        description: description.trim(),
        changes: changes.filter(c => c.from.trim() || c.to.trim() || c.aspect !== 'other'),
      }, userName);
      // file đính kèm → legal_docs gắn mốc + pháp nhân (hiện cả ở tab Hồ sơ giấy tờ)
      for (const a of attach.filter(x => x.url.trim())) {
        const url = /^https?:\/\//i.test(a.url.trim()) ? a.url.trim() : `https://${a.url.trim()}`;
        const link = parseDocLink(url);
        const doc = await saveDoc({
          kind: link.google || link.source === 'pdf' ? 'drive' : 'link', title: a.title.trim() || saved.title, url,
          file_type: resolveFileType(link, a.title), entity_id: entity.id, milestone_id: saved.id,
          category: KIND_CATEGORY[kind] ?? 'khac',
        }, userName);
        store.putDoc(doc);
      }
      if (removeDocs.length) {
        await archive('legal_docs', removeDocs, userName);
        store.drop('doc', removeDocs);
      }
      if (apply && canApply && status === 'done') {
        const next = await patchEntity(entity.id, patch, userName);
        store.putEntity(next);
        toast('Đã lưu mốc và cập nhật thông tin hiện tại của pháp nhân');
      }
      draft.clear();
      onSaved(saved);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet label={initial ? 'Sửa mốc thời gian' : 'Thêm mốc thời gian'} onClose={onClose} wide="xl">
      <div className="pr-10 mb-4">
        <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-[#1D1D1F]">{initial ? 'Sửa mốc' : 'Thêm mốc thời gian'}</h3>
        <div className="text-[12.5px] text-[#86868B]">{entity.short_name || entity.name}</div>
      </div>

      {draft.restored && <DraftNotice onDiscard={discard} />}
      <div className="space-y-4">
        <Field label="Loại mốc">
          <div className="flex flex-wrap gap-1.5">
            {MILESTONE_KIND_IDS.map(k => {
              const info = MILESTONE_KINDS[k];
              const on = k === kind;
              return (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`inline-flex items-center gap-1.5 h-9 md:h-8 px-3 rounded-full text-[13px] font-medium transition active:scale-[0.97] ${on ? 'text-white' : 'bg-[rgba(118,118,128,0.12)] text-[#1D1D1F] hover:bg-[rgba(118,118,128,0.2)]'}`}
                  style={on ? { background: info.color } : undefined}>
                  {!on && <span className="w-2 h-2 rounded-full" style={{ background: info.color }} />}{info.label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Ngày"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={INPUT_CLS} /></Field>
          {kind === 'thay_doi' && (
            <Field label="Thay đổi lần thứ" hint={`Gợi ý: ${suggested}`}>
              <input value={changeNo} onChange={e => setChangeNo(e.target.value.replace(/\D/g, ''))} placeholder={String(suggested)} inputMode="numeric" className={INPUT_CLS} />
            </Field>
          )}
          <Field label="Trạng thái" className={kind === 'thay_doi' ? '' : 'sm:col-span-2'}>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(MILESTONE_STATUS) as MilestoneStatus[]).map(s => <ChoiceChip key={s} active={status === s} onClick={() => setStatus(s)}>{MILESTONE_STATUS[s].label}</ChoiceChip>)}
            </div>
          </Field>
        </div>

        <Field label="Tiêu đề">
          <input value={shownTitle} onChange={e => { setTitle(e.target.value); setTitleTouched(true); }} className={INPUT_CLS} />
        </Field>

        <Field label="Nội dung thay đổi" hint="Chọn mục thay đổi — ô Trước điền sẵn thông tin hiện tại, ghi giá trị mới vào ô Sau">
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {CHANGE_ASPECTS.map(a => <ChoiceChip key={a.key} active={changes.some(c => c.aspect === a.key)} onClick={() => toggleAspect(a.key)}>{a.label}</ChoiceChip>)}
          </div>
          {changes.length > 0 && (
            <div className="space-y-2">
              {changes.map(c => {
                const upd = (p: Partial<MilestoneChange>) => setChanges(cs => cs.map(x => (x.id === c.id ? { ...x, ...p } : x)));
                return (
                  <div key={c.id} className="rounded-[12px] bg-black/[0.03] p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12.5px] font-semibold text-[#1D1D1F]">{CHANGE_ASPECTS.find(a => a.key === c.aspect)?.label ?? c.aspect}</span>
                      <button type="button" onClick={() => setChanges(cs => cs.filter(x => x.id !== c.id))} className="text-[#AEAEB2] hover:text-[#D70015]" aria-label="Bỏ"><X size={14} /></button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <textarea value={c.from} onChange={e => upd({ from: e.target.value })} rows={2} placeholder="Trước" className={`${TEXTAREA_CLS} !bg-[#FFF5F4]`} />
                      <textarea value={c.to} onChange={e => upd({ to: e.target.value })} rows={2} placeholder="Sau" className={`${TEXTAREA_CLS} !bg-[#F1FBF4]`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {canApply && (
            <label className="mt-2.5 flex items-start gap-2 text-[13px] text-[#1D1D1F] cursor-pointer">
              <input type="checkbox" checked={apply} onChange={e => setApplyPick(e.target.checked)} className="mt-[3px] w-4 h-4 accent-[#0071E3]" />
              <span>Ghi giá trị mới vào thông tin hiện tại của pháp nhân
                <span className="block text-[11.5px] text-[#86868B]">{status === 'done' ? `Sẽ cập nhật: ${CHANGE_ASPECTS.filter(a => a.field && a.field in patch).map(a => a.label).join(', ')}` : 'Chỉ áp dụng khi mốc ở trạng thái Đã xong'}</span>
                {!isLatest && <span className="block text-[11.5px] text-[#B25000]">Mốc này cũ hơn mốc gần nhất ({latestDone.split('-').reverse().join('/')}) — đang nhập bù lịch sử thì thường KHÔNG nên ghi đè.</span>}
              </span>
            </label>
          )}
        </Field>

        <Field label="Mô tả / ghi chú">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Lý do thay đổi, người làm hồ sơ, số biên nhận…" className={TEXTAREA_CLS} />
        </Field>

        <Field label="File đính kèm (link Google Drive)" hint="Giấy chứng nhận ĐKDN lần này, quyết định, biên bản họp… — xem được ngay trong app">
          <div className="space-y-2">
            {existingDocs.map(d => (
              <div key={d.id} className="flex items-center gap-2 h-10 px-3 rounded-[10px] bg-black/[0.03]">
                <span className="text-[#86868B]"><DocKindIcon kind={d.kind} fileType={d.file_type} size={15} /></span>
                <span className="flex-1 min-w-0 truncate text-[13px] text-[#1D1D1F]">{d.title}</span>
                <button type="button" onClick={() => setRemoveDocs(r => [...r, d.id])} className="text-[#AEAEB2] hover:text-[#D70015]" aria-label="Gỡ file"><X size={14} /></button>
              </div>
            ))}
            {attach.map(a => (
              <div key={a.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-center">
                <input value={a.title} onChange={e => setAttach(xs => xs.map(x => (x.id === a.id ? { ...x, title: e.target.value } : x)))} placeholder="Tên file (vd Giấy ĐKDN lần 3)" className={INPUT_CLS} />
                <button type="button" className="sm:hidden text-[#AEAEB2] hover:text-[#D70015] p-2" onClick={() => setAttach(xs => xs.filter(x => x.id !== a.id))} aria-label="Bỏ"><X size={15} /></button>
                <input value={a.url} onChange={e => setAttach(xs => xs.map(x => (x.id === a.id ? { ...x, url: e.target.value } : x)))} placeholder="https://drive.google.com/…" className={`${INPUT_CLS} col-span-2 sm:col-span-1`} inputMode="url" />
                <button type="button" className="hidden sm:inline-flex text-[#AEAEB2] hover:text-[#D70015] p-2" onClick={() => setAttach(xs => xs.filter(x => x.id !== a.id))} aria-label="Bỏ"><X size={15} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setAttach(xs => [...xs, { id: rid(), title: '', url: '' }])} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-black/[0.05] text-[13px] font-medium text-[#1D1D1F] hover:bg-black/[0.08]">
              <Paperclip size={14} /> Đính kèm link <Plus size={13} />
            </button>
          </div>
        </Field>
        <div className="text-[11.5px] text-[#86868B]">Nhóm hồ sơ của file đính kèm: {ENTITY_DOC_CATEGORIES.find(c => c.key === (KIND_CATEGORY[kind] ?? 'khac'))?.label}</div>
      </div>

      <div className={`${SHEET_FOOTER} bg-[#F2F2F7]/90 md:bg-white/90 mt-5 flex gap-2 justify-end`}>
        <button type="button" onClick={discard} className={`${BTN_SECONDARY} h-10 px-5 text-[14px]`}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={`${BTN_PRIMARY} h-10 px-5 text-[14px]`}>{busy && <Loader2 size={15} className="animate-spin" />} Lưu mốc</button>
      </div>
    </Sheet>
  );
}
