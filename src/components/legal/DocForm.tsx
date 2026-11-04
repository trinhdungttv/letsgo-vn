// Pháp lý — thêm / sửa 1 tài liệu: chọn loại (Drive, trang web, sơ đồ tư duy, bài học trực quan, thẻ ghi nhớ),
// nơi lưu (chủ đề thư viện / hồ sơ pháp nhân), thông tin văn bản (số hiệu, cơ quan, hiệu lực), nhãn, tóm tắt.
import { useMemo, useState } from 'react';
import { ChevronDown, Layers, Link2, Loader2, Network, NotebookPen, Sheet as SheetIcon } from 'lucide-react';
import { Sheet, SHEET_FOOTER, ChoiceChip } from '../../modules/cskh/components/Sheet';
import { loadDocContent, saveDoc, type DocInput } from '../../lib/legal/api';
import { cardsFromLesson, cardsFromMindmap } from '../../lib/legal/cards';
import { parseDocLink, resolveFileType } from '../../lib/legal/drive';
import { parseLesson, starterLesson } from '../../lib/legal/lesson';
import { entityOverviewMap, MAP_TEMPLATES, templateMap, type MapTemplate } from '../../lib/legal/maps';
import { parseDoc } from '../../lib/quickNotes/mindmap/parse';
import {
  DOC_KINDS, ENTITY_DOC_CATEGORIES, FILE_TYPES, LAW_STATUS, SWATCHES,
  type DocKind, type DocMeta, type FileType, type LawStatus, type LegalDoc,
} from '../../lib/legal/types';
import { BTN_PRIMARY, BTN_SECONDARY } from '../workspace/wsTheme';
import { sourceLabel } from './Embed';
import { DraftNotice, useFormDraft } from './useFormDraft';
import { ColorTile, Field, INPUT_CLS, TEXTAREA_CLS, Swatches } from './ui';
import type { LegalStore } from './useLegal';

export interface DocPreset {
  kind?: DocKind;
  topicId?: string | null;
  entityId?: string | null;
  category?: string;
  milestoneId?: string | null;
  template?: MapTemplate | 'overview';
}

const KIND_ICON: Record<DocKind, typeof Link2> = { drive: SheetIcon, link: Link2, mindmap: Network, lesson: NotebookPen, cards: Layers };

export default function DocForm({ store, userName, toast, initial, preset, onClose, onSaved }: {
  store: LegalStore; userName: string; toast: (m: string) => void; initial?: LegalDoc | null; preset?: DocPreset;
  onClose: () => void; onSaved: (doc: LegalDoc, openNow: boolean) => void;
}) {
  const editing = !!initial;
  const [kind, setKind] = useState<DocKind | null>(initial?.kind ?? preset?.kind ?? null);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [fileType, setFileType] = useState<FileType | ''>(initial?.file_type ?? '');
  const [place, setPlace] = useState<'library' | 'entity'>(initial ? (initial.entity_id ? 'entity' : 'library') : preset?.entityId ? 'entity' : 'library');
  const [topicId, setTopicId] = useState<string>(initial?.topic_id ?? preset?.topicId ?? '');
  const [entityId, setEntityId] = useState<string>(initial?.entity_id ?? preset?.entityId ?? store.entities[0]?.id ?? '');
  const [category, setCategory] = useState(initial?.category || preset?.category || (preset?.entityId ? 'dkkd' : ''));
  const [meta, setMeta] = useState<DocMeta>(initial?.meta ?? {});
  const [tags, setTags] = useState((initial?.meta.tags ?? []).join(', '));
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [color, setColor] = useState(initial?.color ?? '');
  const [template, setTemplate] = useState<MapTemplate | 'overview'>(preset?.template ?? (preset?.entityId ? 'overview' : 'procedure'));
  const [lessonStart, setLessonStart] = useState<'starter' | 'blank'>('starter');
  const [cardsFrom, setCardsFrom] = useState<string>('');
  const [metaOpen, setMetaOpen] = useState(() => !!(initial && (initial.meta.number || initial.meta.issuer || initial.meta.status)));
  const [busy, setBusy] = useState(false);
  const draft = useFormDraft(`doc:${initial?.id ?? `new:${preset?.entityId ?? preset?.topicId ?? ''}`}`,
    { kind, title, url, fileType, place, topicId, entityId, category, meta, tags, summary, color, template, lessonStart, cardsFrom },
    v => {
      setKind(v.kind); setTitle(v.title); setUrl(v.url); setFileType(v.fileType); setPlace(v.place); setTopicId(v.topicId);
      setEntityId(v.entityId); setCategory(v.category); setMeta(v.meta); setTags(v.tags); setSummary(v.summary); setColor(v.color);
      setTemplate(v.template); setLessonStart(v.lessonStart); setCardsFrom(v.cardsFrom);
    });
  const discard = () => { draft.clear(); onClose(); };

  const link = url.trim() ? parseDocLink(url) : null;
  const autoType = link ? resolveFileType(link, title) : null;
  const sortedTopics = useMemo(() => {
    const tops = store.topics.filter(t => !t.parent_id).sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'vi'));
    return tops.flatMap(t => [{ t, depth: 0 }, ...store.topics.filter(c => c.parent_id === t.id).sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'vi')).map(c => ({ t: c, depth: 1 }))]);
  }, [store.topics]);
  const sourceDocs = store.docs.filter(d => d.kind === 'mindmap' || d.kind === 'lesson');
  const entity = store.entities.find(e => e.id === entityId) ?? null;

  const submit = async () => {
    if (!kind) return;
    const name = title.trim();
    if (!name) { toast('Chưa đặt tên tài liệu'); return; }
    if ((kind === 'drive' || kind === 'link') && !url.trim()) { toast('Chưa dán link tài liệu'); return; }
    if (link?.source === 'invalid') { toast('Link chưa đúng — cần dạng https://…'); return; }
    if (place === 'entity' && !entityId) { toast('Chưa chọn pháp nhân'); return; }
    setBusy(true);
    try {
      const tagList = tags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
      const body: DocInput = {
        kind, title: name, summary, color,
        // giữ nguyên link người dán (Drive cũ cần tham số resourcekey), chỉ thêm https:// nếu thiếu
        url: kind === 'drive' || kind === 'link' ? (/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`) : '',
        file_type: kind === 'drive' || kind === 'link' ? (fileType || autoType || '') : '',
        topic_id: place === 'library' ? topicId || null : null,
        entity_id: place === 'entity' ? entityId : null,
        category: place === 'entity' ? category || 'khac' : '',
        meta: { ...meta, ...(tagList.length ? { tags: tagList } : { tags: undefined }) },
      };
      if (editing) {
        const saved = await saveDoc({ id: initial!.id, ...body }, userName);
        draft.clear();
        onSaved(saved, false);
        return;
      }
      body.milestone_id = preset?.milestoneId ?? null;
      if (kind === 'mindmap') {
        body.content = template === 'overview' && entity
          ? entityOverviewMap(entity, store.milestones.filter(m => m.entity_id === entity.id))
          : templateMap(template === 'overview' ? 'blank' : template, name, entity);
      } else if (kind === 'lesson') {
        body.content = lessonStart === 'starter' ? starterLesson(name) : { v: 1, accent: '#FF9500', blocks: [] };
      } else if (kind === 'cards') {
        let cards: ReturnType<typeof cardsFromMindmap> = [];
        const src = sourceDocs.find(d => d.id === cardsFrom);
        if (src) {
          const raw = await loadDocContent(src.id);
          if (src.kind === 'mindmap') { const m = parseDoc(raw); if (m) cards = cardsFromMindmap(m); }
          else cards = cardsFromLesson(parseLesson(raw), src.title);
        }
        body.content = { v: 1, cards };
      }
      const saved = await saveDoc(body, userName);
      draft.clear();
      onSaved(saved, kind === 'mindmap' || kind === 'lesson' || kind === 'cards');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── bước 1: chọn loại ──
  if (!kind) {
    return (
      <Sheet label="Thêm tài liệu" onClose={onClose} wide>
        <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-[#1D1D1F] pr-10">Thêm tài liệu</h3>
        <p className="text-[13px] text-[#86868B] mt-0.5 mb-4">Chọn cách đưa tài liệu vào</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(DOC_KINDS) as DocKind[]).map(k => {
            const info = DOC_KINDS[k];
            const Icon = KIND_ICON[k];
            return (
              <button key={k} type="button" onClick={() => setKind(k)}
                className="flex items-start gap-3 p-3.5 rounded-[16px] text-left bg-black/[0.03] hover:bg-black/[0.06] active:scale-[0.99] transition">
                <ColorTile color={info.color} size={40} radius={11}><Icon size={19} /></ColorTile>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-[#1D1D1F]">{info.label}</span>
                  <span className="block text-[12px] text-[#86868B] leading-snug mt-0.5">{info.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    );
  }

  const info = DOC_KINDS[kind];
  const Icon = KIND_ICON[kind];
  const isLink = kind === 'drive' || kind === 'link';

  return (
    <Sheet label={editing ? 'Sửa tài liệu' : 'Thêm tài liệu'} onClose={onClose} wide>
      <div className="flex items-center gap-3 pr-10 mb-4">
        <ColorTile color={color || info.color} size={38} radius={10}><Icon size={18} /></ColorTile>
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-[#1D1D1F]">{editing ? 'Sửa tài liệu' : info.label}</h3>
          {!editing && <button type="button" onClick={() => setKind(null)} className="text-[12px] text-[#0066CC] hover:underline">Đổi loại tài liệu</button>}
        </div>
      </div>

      {draft.restored && <DraftNotice onDiscard={discard} />}
      <div className="space-y-3.5">
        {isLink && (
          <Field label={kind === 'drive' ? 'Link Google Drive' : 'Link trang web / video'}
            hint={link && link.source !== 'invalid'
              ? <span className={link.embedUrl ? 'text-[#1E7B34]' : 'text-[#B25000]'}>{sourceLabel(link.source)} — {link.embedUrl ? 'xem được ngay trong app' : 'trang này thường chặn xem trong app, sẽ mở tab mới'}</span>
              : 'PDF, Word, Excel, PowerPoint, thư mục Drive, Google Docs / Sheets / Slides, YouTube…'}>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://drive.google.com/file/d/…" className={INPUT_CLS} autoFocus={!editing} inputMode="url" />
          </Field>
        )}
        <Field label="Tên tài liệu">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={isLink ? 'vd Nghị định 145/2020/NĐ-CP – Điều kiện lao động' : 'vd Thủ tục cấp giấy phép cho thuê lại lao động'} className={INPUT_CLS} autoFocus={!isLink && !editing} />
        </Field>

        {isLink && (
          <Field label="Loại file">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(FILE_TYPES) as FileType[]).map(ft => (
                <ChoiceChip key={ft} active={(fileType || autoType) === ft} onClick={() => setFileType(ft)}>{FILE_TYPES[ft].label}</ChoiceChip>
              ))}
            </div>
          </Field>
        )}

        {!editing && kind === 'mindmap' && (
          <Field label="Bắt đầu từ mẫu">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {[...(place === 'entity' ? [{ id: 'overview' as const, label: 'Tổng quan pháp nhân (tự dựng)', hint: 'Lấy từ hồ sơ + dòng thời gian' }] : []),
                ...MAP_TEMPLATES.filter(t => !t.entityOnly || place === 'entity')].map(t => (
                <button key={t.id} type="button" onClick={() => setTemplate(t.id)}
                  className={`text-left p-2.5 rounded-[12px] transition ${template === t.id ? 'bg-[#AF52DE]/[0.12] shadow-[inset_0_0_0_1.5px_#AF52DE]' : 'bg-black/[0.03] hover:bg-black/[0.06]'}`}>
                  <span className="block text-[13px] font-semibold text-[#1D1D1F]">{t.label}</span>
                  <span className="block text-[11.5px] text-[#86868B] leading-snug">{t.hint}</span>
                </button>
              ))}
            </div>
          </Field>
        )}
        {!editing && kind === 'lesson' && (
          <Field label="Bắt đầu">
            <div className="flex gap-1.5">
              <ChoiceChip active={lessonStart === 'starter'} onClick={() => setLessonStart('starter')}>Bài mẫu (Hiểu nhanh · Thủ tục · Mức phạt · Mẹo nhớ)</ChoiceChip>
              <ChoiceChip active={lessonStart === 'blank'} onClick={() => setLessonStart('blank')}>Trang trống</ChoiceChip>
            </div>
          </Field>
        )}
        {!editing && kind === 'cards' && (
          <Field label="Tạo thẻ tự động từ" hint="Mỗi nhánh có nhánh con / mỗi khối màu thành 1 thẻ hỏi – đáp. Sau đó sửa thêm thoải mái.">
            <select value={cardsFrom} onChange={e => setCardsFrom(e.target.value)} className={INPUT_CLS}>
              <option value="">Bộ thẻ trống — tự soạn</option>
              {sourceDocs.map(d => <option key={d.id} value={d.id}>{d.kind === 'mindmap' ? 'Sơ đồ' : 'Bài học'}: {d.title}</option>)}
            </select>
          </Field>
        )}

        {/* nơi lưu */}
        <Field label="Lưu vào">
          <div className="inline-flex bg-[#767680]/[0.12] rounded-[9px] p-[2px] mb-2">
            {([['library', 'Thư viện ngành'], ['entity', 'Hồ sơ pháp nhân']] as const).map(([p, label]) => (
              <button key={p} type="button" onClick={() => setPlace(p)} disabled={p === 'entity' && !store.entities.length}
                className={`h-7 px-3 rounded-[7px] text-[12.5px] font-medium transition disabled:opacity-40 ${place === p ? 'bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)] text-[#1D1D1F]' : 'text-[#3A3A3C]'}`}>{label}</button>
            ))}
          </div>
          {place === 'library' ? (
            <select value={topicId} onChange={e => setTopicId(e.target.value)} className={INPUT_CLS}>
              <option value="">— Chưa xếp chủ đề —</option>
              {sortedTopics.map(({ t, depth }) => <option key={t.id} value={t.id}>{depth ? '    › ' : ''}{t.title}</option>)}
            </select>
          ) : (
            <div className="space-y-2">
              <select value={entityId} onChange={e => setEntityId(e.target.value)} className={INPUT_CLS}>
                {store.entities.map(e => <option key={e.id} value={e.id}>{e.short_name || e.name}</option>)}
              </select>
              <div className="flex flex-wrap gap-1.5">
                {ENTITY_DOC_CATEGORIES.map(c => <ChoiceChip key={c.key} active={category === c.key} onClick={() => setCategory(c.key)}>{c.label}</ChoiceChip>)}
              </div>
            </div>
          )}
        </Field>

        {/* thông tin văn bản */}
        <div className="rounded-[14px] bg-black/[0.03]">
          <button type="button" onClick={() => setMetaOpen(o => !o)} className="w-full flex items-center gap-2 px-3.5 h-11 text-left">
            <span className="text-[13px] font-medium text-[#1D1D1F] flex-1">Thông tin văn bản pháp luật</span>
            <span className="text-[11.5px] text-[#86868B] hidden sm:inline">số hiệu · cơ quan · hiệu lực</span>
            <ChevronDown size={16} className={`text-[#86868B] transition ${metaOpen ? 'rotate-180' : ''}`} />
          </button>
          {metaOpen && (
            <div className="grid sm:grid-cols-2 gap-3 px-3.5 pb-3.5">
              <Field label="Số hiệu"><input value={meta.number ?? ''} onChange={e => setMeta(m => ({ ...m, number: e.target.value }))} placeholder="145/2020/NĐ-CP" className={INPUT_CLS} /></Field>
              <Field label="Cơ quan ban hành"><input value={meta.issuer ?? ''} onChange={e => setMeta(m => ({ ...m, issuer: e.target.value }))} placeholder="Chính phủ" className={INPUT_CLS} /></Field>
              <Field label="Ngày ban hành"><input type="date" value={meta.issued ?? ''} onChange={e => setMeta(m => ({ ...m, issued: e.target.value }))} className={INPUT_CLS} /></Field>
              <Field label="Ngày có hiệu lực"><input type="date" value={meta.effective ?? ''} onChange={e => setMeta(m => ({ ...m, effective: e.target.value }))} className={INPUT_CLS} /></Field>
              <Field label="Tình trạng" className="sm:col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  <ChoiceChip active={!meta.status} onClick={() => setMeta(m => ({ ...m, status: '' }))}>Không ghi</ChoiceChip>
                  {(Object.keys(LAW_STATUS) as Exclude<LawStatus, ''>[]).map(s => (
                    <ChoiceChip key={s} active={meta.status === s} onClick={() => setMeta(m => ({ ...m, status: s }))}>{LAW_STATUS[s].label}</ChoiceChip>
                  ))}
                </div>
              </Field>
            </div>
          )}
        </div>

        <Field label="Nhãn" hint="Cách nhau bởi dấu phẩy — vd thuê lại LĐ, BHXH">
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="thuê lại LĐ, giấy phép" className={INPUT_CLS} />
        </Field>
        <Field label="Tóm tắt / ghi chú">
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3} placeholder="Ý chính, khi nào cần dùng tài liệu này…" className={TEXTAREA_CLS} />
        </Field>
        <Field label="Màu thẻ">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setColor('')} className={`h-7 px-2.5 rounded-full text-[12px] font-medium ${!color ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#1D1D1F]'}`}>Tự động</button>
            <Swatches value={color} onChange={setColor} colors={SWATCHES} />
          </div>
        </Field>
      </div>

      <div className={`${SHEET_FOOTER} bg-[#F2F2F7]/90 md:bg-white/90 mt-5 flex gap-2 justify-end`}>
        <button type="button" onClick={discard} className={`${BTN_SECONDARY} h-10 px-5 text-[14px]`}>Huỷ</button>
        <button type="button" onClick={submit} disabled={busy} className={`${BTN_PRIMARY} h-10 px-5 text-[14px]`}>
          {busy && <Loader2 size={15} className="animate-spin" />} {editing ? 'Lưu' : (kind === 'drive' || kind === 'link') ? 'Thêm tài liệu' : 'Tạo & mở'}
        </button>
      </div>
    </Sheet>
  );
}
