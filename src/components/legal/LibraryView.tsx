// Pháp lý — THƯ VIỆN NGÀNH: Topic (chủ đề lớn) → chủ đề con → tài liệu (link Drive / web, sơ đồ tư duy, bài học, thẻ ghi nhớ).
// Máy tính: cây chủ đề bên trái + nội dung bên phải. Điện thoại: lưới Topic → trang chủ đề → tài liệu (từng màn).
import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, GanttChart, Inbox, Library, Pencil, Pin, Plus, Sparkles, Trash2,
} from 'lucide-react';
import { archive, reorderTopics, saveTopic } from '../../lib/legal/api';
import { moveItem } from '../../lib/legal/timelineChart';
import type { DocKind, LegalDoc, LegalTopic } from '../../lib/legal/types';
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from '../workspace/wsTheme';
import type { LegalCtx } from './ctx';
import { DocCard } from './DocCard';
import TopicForm from './TopicForm';
import { ColorTile, Confirm, Empty, MoreMenu, shade, soft, TopicGlyph } from './ui';

export type LibrarySel = string | null | 'pinned' | 'all' | 'unsorted';

const QUICK_TOPICS: { title: string; icon: string; color: string; description: string }[] = [
  { title: 'Cho thuê lại lao động', icon: 'briefcase', color: '#0071E3', description: 'Giấy phép, ký quỹ, ngành nghề được cho thuê lại, hợp đồng' },
  { title: 'Bộ luật Lao động', icon: 'scale', color: '#5856D6', description: 'Hợp đồng LĐ, thời giờ làm việc, tiền lương, kỷ luật' },
  { title: 'BHXH – BHYT – BHTN', icon: 'shield', color: '#34C759', description: 'Mức đóng, thủ tục, chế độ' },
  { title: 'Thuế – Hoá đơn', icon: 'receipt', color: '#FF9500', description: 'Thuế TNCN, TNDN, GTGT, hoá đơn điện tử' },
  { title: 'Luật Doanh nghiệp', icon: 'building', color: '#AF52DE', description: 'Thành lập, thay đổi ĐKKD, góp vốn, chi nhánh' },
  { title: 'An toàn vệ sinh lao động', icon: 'hardhat', color: '#FF3B30', description: 'Huấn luyện, khám sức khoẻ, tai nạn LĐ' },
  { title: 'Lao động nước ngoài', icon: 'globe', color: '#30B0C7', description: 'Giấy phép LĐ, miễn GPLĐ, thẻ tạm trú' },
];

const KIND_FILTERS: { id: 'all' | 'files' | DocKind; label: string }[] = [
  { id: 'all', label: 'Tất cả' }, { id: 'files', label: 'Drive & web' }, { id: 'mindmap', label: 'Sơ đồ' }, { id: 'timeline', label: 'Dòng thời gian' }, { id: 'lesson', label: 'Bài học' }, { id: 'cards', label: 'Thẻ ghi nhớ' },
];
type SortKey = 'updated' | 'title' | 'issued';

const byOrder = (a: LegalTopic, b: LegalTopic) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'vi');

function sortDocs(list: LegalDoc[], sort: SortKey): LegalDoc[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'title') return a.title.localeCompare(b.title, 'vi');
    if (sort === 'issued') return (b.meta.issued ?? '').localeCompare(a.meta.issued ?? '');
    return b.updated_at.localeCompare(a.updated_at);
  });
}

type MenuItems = Parameters<typeof MoreMenu>[0]['items'];

interface DragProps { dragging: boolean; over: 'above' | 'below' | null; onStart: () => void; onOver: (e: DragEvent) => void; onDrop: () => void; onEnd: () => void }

function TreeItem({ icon, label, count, active, color, depth = 0, menu, toggle, open, onSelect, drag }: {
  icon: ReactNode; label: string; count?: number; active: boolean; color?: string; depth?: number;
  menu?: MenuItems; toggle?: () => void; open?: boolean; onSelect: () => void; drag?: DragProps;
}) {
  return (
    <div draggable={!!drag} onDragStart={drag ? e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', label); drag.onStart(); } : undefined}
      onDragOver={drag ? drag.onOver : undefined} onDrop={drag ? e => { e.preventDefault(); drag.onDrop(); } : undefined} onDragEnd={drag?.onEnd}
      className={`group relative flex items-center gap-1.5 h-9 pr-1 rounded-[10px] cursor-pointer transition ${drag?.dragging ? 'opacity-40' : ''} ${drag?.over === 'above' ? 'shadow-[0_-2px_0_0_#0071E3]' : drag?.over === 'below' ? 'shadow-[0_2px_0_0_#0071E3]' : ''} ${active ? 'bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_2px_8px_-4px_rgba(0,0,0,0.15)]' : 'hover:bg-black/[0.04]'}`}
      style={{ paddingLeft: depth ? 30 : 6 }} onClick={onSelect}>
      {toggle ? (
        <button type="button" onClick={e => { e.stopPropagation(); toggle(); }} className="w-4 h-4 inline-flex items-center justify-center text-[#AEAEB2] hover:text-[#1D1D1F]" aria-label={open ? 'Thu gọn' : 'Mở rộng'}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : !depth && <span className="w-4" />}
      {icon}
      <span className={`flex-1 min-w-0 truncate text-[13px] ${active ? 'font-semibold text-[#1D1D1F]' : 'text-[#3A3A3C]'}`} style={active && color ? { color: shade(color, -0.25) } : undefined}>{label}</span>
      {count != null && count > 0 && <span className={`text-[11px] text-[#AEAEB2] tabular-nums ${menu && menu.some(Boolean) ? 'group-hover:hidden' : ''}`}>{count}</span>}
      {menu && menu.some(Boolean) && <div className="hidden group-hover:block" onClick={e => e.stopPropagation()}><MoreMenu items={menu} /></div>}
    </div>
  );
}

export default function LibraryView({ ctx, sel, setSel }: { ctx: LegalCtx; sel: LibrarySel; setSel: (s: LibrarySel) => void }) {
  const { store, canEdit, mobile, toast, userName } = ctx;
  const [topicForm, setTopicForm] = useState<{ initial?: LegalTopic | null; parentId?: string | null } | null>(null);
  const [delTopic, setDelTopic] = useState<LegalTopic | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<'all' | 'files' | DocKind>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [quickBusy, setQuickBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const tops = useMemo(() => store.topics.filter(t => !t.parent_id).sort(byOrder), [store.topics]);
  const childrenOf = (id: string) => store.topics.filter(t => t.parent_id === id).sort(byOrder);
  const topicIds = useMemo(() => new Set(store.topics.map(t => t.id)), [store.topics]);
  const libDocs = useMemo(() => store.docs.filter(d => !d.entity_id), [store.docs]);
  const docsIn = (topicId: string) => libDocs.filter(d => d.topic_id === topicId);
  const countDeep = (topicId: string) => docsIn(topicId).length + childrenOf(topicId).reduce((s, c) => s + docsIn(c.id).length, 0);
  const unsorted = libDocs.filter(d => !d.topic_id || !topicIds.has(d.topic_id));
  const pinned = libDocs.filter(d => d.pinned);

  const filterKind = (list: LegalDoc[]) => list.filter(d => kindFilter === 'all' || (kindFilter === 'files' ? d.kind === 'drive' || d.kind === 'link' : d.kind === kindFilter));

  const topic = typeof sel === 'string' && !['pinned', 'all', 'unsorted'].includes(sel) ? store.topics.find(t => t.id === sel) ?? null : null;
  const parent = topic?.parent_id ? store.topics.find(t => t.id === topic.parent_id) ?? null : null;

  const quickCreate = async (q: typeof QUICK_TOPICS[number]) => {
    setQuickBusy(true);
    try {
      const t = await saveTopic({ title: q.title, description: q.description, color: q.color, icon: q.icon, parent_id: null, sort_order: tops.length + 1 }, userName);
      store.putTopic(t);
      toast(`Đã tạo Topic "${t.title}"`);
    } catch (e) { toast((e as Error).message); }
    setQuickBusy(false);
  };

  // ── sắp xếp thứ tự Topic: kéo thả trong cây (cùng cấp) hoặc ⋯ → Lên / Xuống ──
  const siblingsOf = (t: LegalTopic) => (t.parent_id ? childrenOf(t.parent_id) : tops);
  const applyOrder = async (list: LegalTopic[]) => {
    const changes = list.map((x, i) => ({ id: x.id, sort_order: i + 1 })).filter(c => list.find(x => x.id === c.id)!.sort_order !== c.sort_order);
    if (!changes.length) return;
    for (const c of changes) store.putTopic({ ...list.find(x => x.id === c.id)!, sort_order: c.sort_order });
    try { await reorderTopics(changes, userName); } catch (e) { toast(`Chưa lưu được thứ tự: ${(e as Error).message}`); void store.reload(); }
  };
  const moveTopicBy = (t: LegalTopic, delta: number) => {
    const list = siblingsOf(t);
    const from = list.findIndex(x => x.id === t.id);
    void applyOrder(moveItem(list, from, from + delta));
  };
  const dropOn = (targetId: string) => {
    const drag = store.topics.find(x => x.id === dragId);
    const target = store.topics.find(x => x.id === targetId);
    setDragId(null); setOverId(null);
    if (!drag || !target || drag.id === target.id || (drag.parent_id ?? null) !== (target.parent_id ?? null)) return;
    const list = siblingsOf(drag);
    void applyOrder(moveItem(list, list.findIndex(x => x.id === drag.id), list.findIndex(x => x.id === target.id)));
  };
  const dragProps = (t: LegalTopic): DragProps | undefined => {
    if (!canEdit) return undefined;
    const dragT = dragId ? store.topics.find(x => x.id === dragId) : null;
    const ok = !!dragT && dragT.id !== t.id && (dragT.parent_id ?? null) === (t.parent_id ?? null);
    const list = siblingsOf(t);
    const over = ok && overId === t.id ? (list.findIndex(x => x.id === dragT!.id) > list.findIndex(x => x.id === t.id) ? 'above' : 'below') : null;
    return {
      dragging: dragId === t.id, over,
      onStart: () => setDragId(t.id),
      onOver: e => { if (ok) { e.preventDefault(); setOverId(t.id); } },
      onDrop: () => dropOn(t.id),
      onEnd: () => { setDragId(null); setOverId(null); },
    };
  };

  const removeTopic = async (t: LegalTopic) => {
    const ids = [t.id, ...childrenOf(t.id).map(c => c.id)];
    await archive('legal_topics', ids, userName);
    store.drop('topic', ids);
    if (sel && ids.includes(sel)) setSel(t.parent_id ?? null);
    toast('Đã chuyển chủ đề vào Thùng rác — tài liệu bên trong nằm ở "Chưa xếp chủ đề"');
  };

  const topicMenu = (t: LegalTopic) => canEdit ? [
    { label: 'Sửa chủ đề', icon: <Pencil size={14} />, onClick: () => setTopicForm({ initial: t }) },
    siblingsOf(t).findIndex(x => x.id === t.id) > 0 && { label: 'Chuyển lên', icon: <ArrowUp size={14} />, onClick: () => moveTopicBy(t, -1) },
    siblingsOf(t).findIndex(x => x.id === t.id) < siblingsOf(t).length - 1 && { label: 'Chuyển xuống', icon: <ArrowDown size={14} />, onClick: () => moveTopicBy(t, 1) },
    !t.parent_id && { label: 'Thêm chủ đề con', icon: <Plus size={14} />, onClick: () => setTopicForm({ parentId: t.id }) },
    { label: 'Xoá chủ đề', icon: <Trash2 size={14} />, danger: true, onClick: () => setDelTopic(t) },
  ] : [];

  // ── cây chủ đề (máy tính) ──
  const tree = !mobile && (
    <aside className="w-[260px] xl:w-[280px] shrink-0 border-r border-black/[0.06] bg-[#FBFBFD]/70 overflow-y-auto">
      <div className="p-2.5 space-y-0.5">
        <TreeItem onSelect={() => setSel(null)} active={sel === null} label="Trang chủ thư viện" icon={<Library size={15} className="text-[#6E6E73]" />} />
        <TreeItem onSelect={() => setSel('pinned')} active={sel === 'pinned'} label="Đã ghim" count={pinned.length} icon={<Pin size={15} className="text-[#FF9500]" />} />
        <TreeItem onSelect={() => setSel('all')} active={sel === 'all'} label="Tất cả tài liệu" count={libDocs.length} icon={<FolderOpen size={15} className="text-[#6E6E73]" />} />
        {unsorted.length > 0 && <TreeItem onSelect={() => setSel('unsorted')} active={sel === 'unsorted'} label="Chưa xếp chủ đề" count={unsorted.length} icon={<Inbox size={15} className="text-[#6E6E73]" />} />}
      </div>
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#86868B]">Topic</span>
        {canEdit && <button type="button" onClick={() => setTopicForm({})} className="inline-flex items-center gap-0.5 text-[12px] font-medium text-[#0066CC] hover:underline"><Plus size={13} /> Thêm</button>}
      </div>
      <div className="px-2.5 pb-4 space-y-0.5">
        {tops.map(t => {
          const kids = childrenOf(t.id);
          const open = !collapsed.has(t.id);
          return (
            <div key={t.id}>
              <TreeItem onSelect={() => setSel(t.id)} active={sel === t.id} label={t.title} count={countDeep(t.id)} color={t.color} menu={topicMenu(t)} drag={dragProps(t)}
                icon={<ColorTile color={t.color} size={22} radius={6}><TopicGlyph icon={t.icon} size={12} /></ColorTile>}
                toggle={kids.length ? () => setCollapsed(s => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; }) : undefined} open={open} />
              {open && kids.map(c => (
                <TreeItem key={c.id} onSelect={() => setSel(c.id)} depth={1} active={sel === c.id} label={c.title} count={docsIn(c.id).length} color={c.color} menu={topicMenu(c)} drag={dragProps(c)}
                  icon={<span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />} />
              ))}
            </div>
          );
        })}
        {!tops.length && <div className="px-3 py-2 text-[12px] text-[#86868B]">Chưa có Topic nào</div>}
      </div>
    </aside>
  );

  // ── thanh lọc + lưới tài liệu ──
  const toolbar = (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {KIND_FILTERS.map(f => (
          <button key={f.id} type="button" onClick={() => setKindFilter(f.id)}
            className={`shrink-0 whitespace-nowrap h-8 px-3 rounded-full text-[12.5px] font-medium transition ${kindFilter === f.id ? 'bg-[#1D1D1F] text-white' : 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'}`}>{f.label}</button>
        ))}
      </div>
      <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="ml-auto h-8 px-2.5 rounded-full bg-black/[0.05] text-[12.5px] font-medium text-[#1D1D1F] outline-none">
        <option value="updated">Mới sửa</option>
        <option value="title">Tên A → Z</option>
        <option value="issued">Ngày ban hành</option>
      </select>
    </div>
  );
  const grid = (list: LegalDoc[], whereOf?: (d: LegalDoc) => string) => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {sortDocs(filterKind(list), sort).map(d => <DocCard key={d.id} ctx={ctx} doc={d} where={whereOf?.(d)} />)}
    </div>
  );
  const topicName = (d: LegalDoc) => store.topics.find(t => t.id === d.topic_id)?.title ?? '';

  let main: ReactNode;
  if (topic) {
    const kids = topic.parent_id ? [] : childrenOf(topic.id);
    const own = docsIn(topic.id);
    main = (
      <>
        {/* đầu trang chủ đề */}
        <div className="relative overflow-hidden rounded-[22px] mb-5" style={{ background: `linear-gradient(135deg, ${soft(topic.color, 0.18)} 0%, ${soft(topic.color, 0.04)} 60%, rgba(255,255,255,0.6) 100%)` }}>
          <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full" style={{ background: soft(topic.color, 0.12) }} />
          <div className="relative p-4 md:p-6">
            <div className="flex items-center gap-1 text-[12.5px] text-[#6E6E73] mb-3 min-w-0">
              <button type="button" onClick={() => setSel(null)} className="hover:text-[#1D1D1F] inline-flex items-center gap-0.5 shrink-0">{mobile && <ChevronLeft size={15} />}Thư viện</button>
              {parent && <><ChevronRight size={13} className="shrink-0 text-[#AEAEB2]" /><button type="button" onClick={() => setSel(parent.id)} className="hover:text-[#1D1D1F] truncate">{parent.title}</button></>}
            </div>
            <div className="flex items-start gap-3.5">
              <ColorTile color={topic.color} size={mobile ? 46 : 56} radius={mobile ? 13 : 16}><TopicGlyph icon={topic.icon} size={mobile ? 22 : 27} /></ColorTile>
              <div className="min-w-0 flex-1">
                <h2 className="text-[22px] md:text-[28px] font-semibold tracking-[-0.025em] leading-tight text-[#1D1D1F]">{topic.title}</h2>
                {topic.description && <p className="text-[13.5px] text-[#6E6E73] mt-1 leading-relaxed max-w-[720px]">{topic.description}</p>}
                <div className="text-[12px] text-[#86868B] mt-1.5">{countDeep(topic.id)} tài liệu{kids.length ? ` · ${kids.length} chủ đề con` : ''}</div>
              </div>
              <MoreMenu items={topicMenu(topic)} />
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2 mt-4">
                <button type="button" onClick={() => ctx.newDoc({ topicId: topic.id })} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={15} /> Tài liệu</button>
                <button type="button" onClick={() => ctx.newDoc({ topicId: topic.id, kind: 'mindmap', template: 'procedure' })} className={`${BTN_SECONDARY} h-9 px-4 text-[13px] !bg-white/70`}>Sơ đồ tư duy</button>
                <button type="button" onClick={() => ctx.newDoc({ topicId: topic.id, kind: 'timeline' })} className={`${BTN_SECONDARY} h-9 px-4 text-[13px] !bg-white/70`}><GanttChart size={15} /> Dòng thời gian</button>
                <button type="button" onClick={() => ctx.newDoc({ topicId: topic.id, kind: 'lesson' })} className={`${BTN_SECONDARY} h-9 px-4 text-[13px] !bg-white/70`}>Bài học</button>
                {!topic.parent_id && <button type="button" onClick={() => setTopicForm({ parentId: topic.id })} className={`${BTN_SECONDARY} h-9 px-4 text-[13px] !bg-white/70`}>Chủ đề con</button>}
              </div>
            )}
          </div>
        </div>

        {kids.length > 0 && (
          <div className="grid gap-2.5 grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 mb-6">
            {kids.map(c => (
              <button key={c.id} type="button" onClick={() => setSel(c.id)}
                className={`${CARD} text-left p-3 flex items-center gap-2.5 hover:-translate-y-0.5 transition`}>
                <span className="w-2.5 self-stretch rounded-full shrink-0" style={{ background: c.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-[#1D1D1F] truncate">{c.title}</span>
                  <span className="block text-[11.5px] text-[#86868B]">{docsIn(c.id).length} tài liệu</span>
                </span>
                <ChevronRight size={15} className="text-[#C7C7CC] shrink-0" />
              </button>
            ))}
          </div>
        )}

        {(own.length > 0 || !kids.length) && toolbar}
        {own.length > 0 ? grid(own) : !kids.length && (
          <Empty icon={<FolderOpen size={26} />} title="Chủ đề chưa có tài liệu"
            text="Dán link Google Drive (PDF, Excel, PowerPoint…) của cơ quan ban ngành, hoặc tự soạn sơ đồ tư duy / bài học trực quan / thẻ ghi nhớ."
            action={canEdit && <button type="button" onClick={() => ctx.newDoc({ topicId: topic.id })} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={15} /> Thêm tài liệu</button>} />
        )}

        {kids.filter(c => docsIn(c.id).length).map(c => (
          <section key={c.id} className="mt-7">
            <button type="button" onClick={() => setSel(c.id)} className="flex items-center gap-2 mb-2.5 group">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
              <h3 className="text-[15px] font-semibold text-[#1D1D1F] tracking-[-0.01em] group-hover:underline">{c.title}</h3>
              <span className="text-[12px] text-[#86868B]">{docsIn(c.id).length}</span>
              <ChevronRight size={14} className="text-[#AEAEB2]" />
            </button>
            {grid(docsIn(c.id))}
          </section>
        ))}
      </>
    );
  } else if (sel === 'pinned' || sel === 'all' || sel === 'unsorted') {
    const list = sel === 'pinned' ? pinned : sel === 'all' ? libDocs : unsorted;
    const label = sel === 'pinned' ? 'Đã ghim' : sel === 'all' ? 'Tất cả tài liệu' : 'Chưa xếp chủ đề';
    main = (
      <>
        <div className="flex items-center gap-2 mb-4">
          {mobile && <button type="button" onClick={() => setSel(null)} className="text-[#0071E3] inline-flex items-center"><ChevronLeft size={22} /></button>}
          <h2 className="text-[22px] md:text-[26px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">{label}</h2>
          <span className="text-[13px] text-[#86868B] mt-1">{list.length}</span>
        </div>
        {toolbar}
        {list.length ? grid(list, topicName) : <Empty icon={<Pin size={24} />} title="Chưa có tài liệu" text={sel === 'pinned' ? 'Bấm ⋯ trên thẻ tài liệu → Ghim lên đầu để gom tài liệu hay dùng về đây.' : undefined} />}
      </>
    );
  } else {
    // ── trang chủ thư viện ──
    const recent = [...libDocs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8);
    main = (
      <>
        <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
          <div>
            <h2 className="text-[24px] md:text-[30px] font-semibold tracking-[-0.025em] leading-tight text-[#1D1D1F]">Thư viện ngành</h2>
            <p className="text-[13.5px] text-[#86868B] mt-0.5">{tops.length} Topic · {libDocs.length} tài liệu — học bằng sơ đồ, màu sắc, thẻ ghi nhớ</p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setTopicForm({})} className={`${BTN_SECONDARY} h-9 px-4 text-[13px]`}><Plus size={15} /> Topic</button>
              <button type="button" onClick={() => ctx.newDoc({})} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={15} /> Tài liệu</button>
            </div>
          )}
        </div>

        {!tops.length && (
          <div className={`${CARD} p-5 md:p-6 mb-6`}>
            <div className="flex items-center gap-2 mb-1"><Sparkles size={16} className="text-[#AF52DE]" /><span className="text-[15px] font-semibold text-[#1D1D1F]">Bắt đầu nhanh</span></div>
            <p className="text-[13px] text-[#86868B] mb-3.5">Bấm để tạo ngay các Topic hay dùng trong ngành cung ứng lao động — đổi tên, màu, xoá thoải mái sau.</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_TOPICS.map(q => (
                <button key={q.title} type="button" disabled={!canEdit || quickBusy} onClick={() => void quickCreate(q)}
                  className="inline-flex items-center gap-2 h-10 pl-1.5 pr-3.5 rounded-full bg-black/[0.04] hover:bg-black/[0.07] text-[13px] font-medium text-[#1D1D1F] disabled:opacity-50 transition active:scale-[0.97]">
                  <ColorTile color={q.color} size={28} radius={14}><TopicGlyph icon={q.icon} size={14} /></ColorTile>{q.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {pinned.length > 0 && (
          <section className="mb-7">
            <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-[#1D1D1F] mb-2.5"><Pin size={14} className="text-[#FF9500]" /> Đã ghim</h3>
            {grid(pinned, topicName)}
          </section>
        )}

        {tops.length > 0 && (
          <section className="mb-7">
            <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-2.5">Topic</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tops.map(t => {
                const kids = childrenOf(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => setSel(t.id)}
                    className="group relative overflow-hidden rounded-[22px] text-left p-4 min-h-[148px] flex flex-col transition hover:-translate-y-0.5 shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_14px_30px_-18px_rgba(0,0,0,0.35)]"
                    style={{ background: `linear-gradient(145deg, ${shade(t.color, 0.08)} 0%, ${t.color} 60%, ${shade(t.color, -0.2)} 100%)` }}>
                    <span className="absolute -right-6 -bottom-8 text-white/15 group-hover:scale-110 transition-transform duration-500"><TopicGlyph icon={t.icon} size={120} /></span>
                    <span className="relative w-10 h-10 rounded-[12px] bg-white/20 backdrop-blur text-white inline-flex items-center justify-center"><TopicGlyph icon={t.icon} size={20} /></span>
                    <span className="relative mt-3 text-[17px] font-semibold text-white tracking-[-0.015em] leading-snug">{t.title}</span>
                    {t.description && <span className="relative mt-0.5 text-[12.5px] text-white/80 line-clamp-2">{t.description}</span>}
                    <span className="relative mt-auto pt-3 flex flex-wrap gap-1.5 text-[11.5px] text-white/90">
                      <span className="h-[22px] px-2 rounded-full bg-white/20 inline-flex items-center">{countDeep(t.id)} tài liệu</span>
                      {kids.slice(0, 3).map(k => <span key={k.id} className="h-[22px] px-2 rounded-full bg-black/15 inline-flex items-center truncate max-w-[140px]">{k.title}</span>)}
                      {kids.length > 3 && <span className="h-[22px] px-2 rounded-full bg-black/15 inline-flex items-center">+{kids.length - 3}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-2.5">Mới cập nhật</h3>
            {grid(recent, topicName)}
          </section>
        )}
        {tops.length > 0 && !libDocs.length && (
          <Empty icon={<FolderOpen size={26} />} title="Chưa có tài liệu nào" text="Mở 1 Topic rồi bấm + Tài liệu — dán link Google Drive hoặc tự soạn sơ đồ tư duy." />
        )}
      </>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex">
      {tree}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto px-3 md:px-6 xl:px-8 py-4 md:py-6 pb-10">{main}</div>
      </main>
      {topicForm && (
        <TopicForm store={store} userName={userName} toast={toast} initial={topicForm.initial} parentId={topicForm.parentId}
          onClose={() => setTopicForm(null)} onSaved={t => { store.putTopic(t); setTopicForm(null); if (!topicForm.initial) setSel(t.id); }} />
      )}
      {delTopic && (
        <Confirm title={`Xoá chủ đề "${delTopic.title}"?`} confirmLabel="Xoá" onClose={() => setDelTopic(null)} onConfirm={() => removeTopic(delTopic)}
          text={<>Chủ đề{childrenOf(delTopic.id).length ? ` và ${childrenOf(delTopic.id).length} chủ đề con` : ''} vào <b>Thùng rác</b> (khôi phục được). Tài liệu bên trong KHÔNG bị xoá — chuyển sang mục "Chưa xếp chủ đề".</>} />
      )}
    </div>
  );
}
