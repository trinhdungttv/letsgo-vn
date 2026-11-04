// ============================================================================
// Trang PHÁP LÝ (#/legal) — mở từ Workspace → nút "Pháp lý" (thay cho "Tạo báo giá").
// ----------------------------------------------------------------------------
//  • Pháp nhân: hồ sơ 5–6 công ty, dòng thời gian thay đổi (lần 1, 2, 3…), sơ đồ, hồ sơ giấy tờ (link Google Drive)
//  • Thư viện ngành: Topic → chủ đề con → tài liệu (Drive / web, sơ đồ tư duy, bài học trực quan, thẻ ghi nhớ)
// Không gian làm việc: nút Mở rộng (phủ cả menu app), Toàn màn hình (trình duyệt), Tập trung khi đọc tài liệu.
// Dữ liệu: migration 201 (legal_entities / legal_milestones / legal_topics / legal_docs) — xem lib/legal/.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArchiveRestore, Building2, ChevronLeft, Expand, Library, Loader2, Maximize2, Minimize2, RefreshCw, Scale, Search, Shrink, Trash2, X,
} from 'lucide-react';
import { legalLevel, useAuth } from '../lib/auth';
import { useIsMobile } from '../hooks/useIsMobile';
import { LEGAL_MIGRATION_HINT, loadTrash, restore, type TrashItem } from '../lib/legal/api';
import { aspectLabel, MILESTONE_KINDS, type LegalDoc } from '../lib/legal/types';
import { fmtDate } from '../lib/legal/timeline';
import { useLegal } from '../components/legal/useLegal';
import type { LegalCtx } from '../components/legal/ctx';
import EntitiesView, { type EntityTab } from '../components/legal/EntitiesView';
import LibraryView, { type LibrarySel } from '../components/legal/LibraryView';
import DocReader from '../components/legal/DocReader';
import DocForm, { type DocPreset } from '../components/legal/DocForm';
import { DocCard } from '../components/legal/DocCard';
import { ColorTile, EntityLogo, fmtWhen, TopicGlyph } from '../components/legal/ui';
import { Sheet } from '../modules/cskh/components/Sheet';
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from '../components/workspace/wsTheme';

type Tab = 'entities' | 'library';
interface Place { tab: Tab; entityId: string | null; entityTab: EntityTab; lib: LibrarySel }
const PLACE_KEY = 'legal-place';
const WIDE_KEY = 'legal-wide';
const DOC_HASH = /^#\/legal\/doc\/([0-9a-f-]{36})/i;

function readPlace(): Place {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY) || '{}') as Partial<Place>;
    return { tab: p.tab === 'library' ? 'library' : 'entities', entityId: p.entityId ?? null, entityTab: p.entityTab ?? 'overview', lib: p.lib ?? null };
  } catch {
    return { tab: 'entities', entityId: null, entityTab: 'overview', lib: null };
  }
}

/** Bỏ dấu tiếng Việt + chữ thường để tìm không cần gõ dấu. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export default function Legal({ toast, onBack }: { toast: (m: string) => void; onBack: () => void }) {
  const { user, rolePermissions } = useAuth();
  const mobile = useIsMobile();
  const store = useLegal();
  const level = user ? legalLevel(user.role, rolePermissions) : 'none';
  const canEdit = level === 'full' && store.phase === 'ready';
  const userName = user?.full_name || user?.username || '';

  const [place, setPlaceRaw] = useState<Place>(readPlace);
  const setPlace = useCallback((patch: Partial<Place>) => {
    setPlaceRaw(p => {
      const next = { ...p, ...patch };
      try { localStorage.setItem(PLACE_KEY, JSON.stringify(next)); } catch { /* bỏ qua */ }
      return next;
    });
  }, []);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem(WIDE_KEY) === '1'; } catch { return false; } });
  const [fullscreen, setFullscreen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [docForm, setDocForm] = useState<{ initial?: LegalDoc | null; preset?: DocPreset } | null>(null);
  const [docId, setDocId] = useState<string | null>(() => DOC_HASH.exec(window.location.hash)?.[1] ?? null);
  const pushedDoc = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── mở / đóng tài liệu theo hash (#/legal/doc/<id>) để nút Back của trình duyệt đóng tài liệu ──
  const openDoc = useCallback((id: string) => {
    setDocId(id);
    const h = `#/legal/doc/${id}`;
    if (window.location.hash !== h) {
      if (DOC_HASH.test(window.location.hash)) window.history.replaceState(null, '', h);
      else { window.history.pushState(null, '', h); pushedDoc.current = true; }
    }
  }, []);
  const closeDoc = useCallback(() => {
    setDocId(null);
    if (DOC_HASH.test(window.location.hash)) {
      if (pushedDoc.current) { pushedDoc.current = false; window.history.back(); }
      else window.history.replaceState(null, '', '#/legal');
    }
  }, []);
  useEffect(() => {
    const onPop = () => { const m = DOC_HASH.exec(window.location.hash); setDocId(m?.[1] ?? null); if (!m) pushedDoc.current = false; };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('hashchange', onPop); };
  }, []);

  // ── mở rộng / toàn màn hình ──
  const toggleWide = () => setWide(w => { try { localStorage.setItem(WIDE_KEY, w ? '0' : '1'); } catch { /* bỏ qua */ } return !w; });
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement && document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled && !mobile;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => toast('Trình duyệt không cho toàn màn hình'));
  };

  // ⌘K / Ctrl+K = tìm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !docId) { e.preventDefault(); setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docId]);

  const ctx: LegalCtx = useMemo(() => ({
    store, canEdit, userName, toast, mobile,
    openDoc,
    newDoc: (preset: DocPreset) => setDocForm({ preset }),
    editDoc: (d: LegalDoc) => setDocForm({ initial: d }),
  }), [store, canEdit, userName, toast, mobile, openDoc]);

  const openDocRow = docId ? store.docs.find(d => d.id === docId) ?? null : null;
  // tài liệu đã xoá / link cũ → đóng
  useEffect(() => { if (docId && store.phase === 'ready' && !openDocRow) closeDoc(); }, [docId, store.phase, openDocRow, closeDoc]);

  // ── tìm kiếm ──
  const q = fold(query.trim());
  const results = useMemo(() => {
    if (q.length < 2) return null;
    const hit = (...xs: (string | undefined | null)[]) => xs.some(x => x && fold(x).includes(q));
    return {
      entities: store.entities.filter(e => hit(e.name, e.short_name, e.english_name, e.tax_code, e.address, e.legal_rep, ...e.info.industries.map(i => `${i.code} ${i.name}`), ...e.info.licenses.map(l => l.name))),
      milestones: store.milestones.filter(m => store.entities.some(e => e.id === m.entity_id) && hit(m.title, m.description, ...m.changes.flatMap(c => [c.from, c.to, aspectLabel(c.aspect)]))).slice(0, 30),
      topics: store.topics.filter(t => hit(t.title, t.description)),
      docs: store.docs.filter(d => hit(d.title, d.summary, d.meta.number, d.meta.issuer, ...(d.meta.tags ?? []))).slice(0, 60),
    };
  }, [q, store.entities, store.milestones, store.topics, store.docs]);
  const resultCount = results ? results.entities.length + results.milestones.length + results.topics.length + results.docs.length : 0;
  const clearSearch = () => { setQuery(''); setSearchOpen(false); };

  const covering = !mobile && (wide || fullscreen);

  // ── giao diện ──
  const header = (
    <header className="shrink-0 bg-white/85 backdrop-blur-xl border-b border-black/[0.06] z-20">
      <div className="flex items-center gap-2 md:gap-3 px-3 md:px-5 h-[58px]">
        {covering ? (
          <button type="button" onClick={toggleWide} title="Thu nhỏ — hiện lại menu app" className="hidden md:inline-flex items-center h-9 pl-1 pr-2.5 rounded-full text-[#0071E3] text-[13.5px] font-medium hover:bg-[#0071E3]/[0.08]">
            <ChevronLeft size={20} /> Thu nhỏ
          </button>
        ) : (
          // điện thoại: App đã có thanh "‹ Trang trước" (MobileBackBar) → ẩn nút này cho đỡ trùng
          <button type="button" onClick={onBack} title="Về Workspace" className="hidden md:inline-flex items-center h-9 pl-0.5 pr-2 rounded-full text-[#0071E3] text-[13.5px] font-medium hover:bg-[#0071E3]/[0.08]">
            <ChevronLeft size={20} /> <span className="hidden lg:inline">Workspace</span>
          </button>
        )}
        <span className="hidden sm:inline-flex"><ColorTile color="#5856D6" size={34} radius={10}><Scale size={17} /></ColorTile></span>
        <div className="min-w-0 hidden xl:block">
          <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-[#1D1D1F] leading-tight">Pháp lý</h1>
          <div className="text-[11.5px] text-[#86868B] truncate">{store.entities.length} pháp nhân · {store.docs.length} tài liệu{level === 'view' ? ' · chỉ xem' : ''}</div>
        </div>

        {/* chọn khu */}
        <div className="mx-auto inline-flex bg-[#767680]/[0.12] rounded-[10px] p-[2px] min-w-0">
          {([['entities', 'Pháp nhân', 'Pháp nhân', Building2], ['library', 'Thư viện ngành', 'Thư viện', Library]] as const).map(([t, label, short, Icon]) => (
            <button key={t} type="button" onClick={() => { setPlace({ tab: t }); clearSearch(); }}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 md:px-4 rounded-[8px] text-[13px] font-medium whitespace-nowrap transition ${place.tab === t && !results ? 'bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] text-[#1D1D1F]' : 'text-[#3A3A3C]'}`}>
              <Icon size={14} className="hidden sm:block" /> <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 md:gap-1.5 shrink-0">
          <div className={`${searchOpen || query ? 'flex' : 'hidden lg:flex'} absolute lg:static left-2 right-2 top-[9px] z-30 lg:z-auto items-center gap-2 h-10 lg:h-9 px-3 rounded-[10px] bg-[#EDEDF0] lg:bg-black/[0.05] lg:w-[240px] xl:w-[300px] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#0071E3]/15 focus-within:shadow-[0_0_0_1px_#0071E3]`}>
            <Search size={15} className="text-[#86868B] shrink-0" />
            <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm pháp nhân, mốc, văn bản… (⌘K)"
              onKeyDown={e => { if (e.key === 'Escape') clearSearch(); }}
              className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] text-[#1D1D1F] placeholder:text-[#86868B]" />
            {(query || searchOpen) && <button type="button" onClick={clearSearch} aria-label="Xoá tìm kiếm" className="text-[#86868B] hover:text-[#1D1D1F]"><X size={15} /></button>}
          </div>
          <button type="button" onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }} className="lg:hidden w-9 h-9 rounded-full inline-flex items-center justify-center text-[#1D1D1F] hover:bg-black/[0.05]" aria-label="Tìm"><Search size={17} /></button>
          {canEdit && <button type="button" onClick={() => setTrashOpen(true)} title="Thùng rác" className="w-9 h-9 rounded-full inline-flex items-center justify-center text-[#6E6E73] hover:bg-black/[0.05] hover:text-[#1D1D1F]"><Trash2 size={16} /></button>}
          {!mobile && (
            <button type="button" onClick={toggleWide} title={wide ? 'Thu nhỏ (hiện menu app)' : 'Mở rộng: phủ kín cửa sổ, ẩn menu app'}
              className={`w-9 h-9 rounded-full inline-flex items-center justify-center transition ${wide ? 'bg-[#0071E3] text-white' : 'text-[#6E6E73] hover:bg-black/[0.05] hover:text-[#1D1D1F]'}`}>
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {canFullscreen && (
            <button type="button" onClick={toggleFullscreen} title={fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} className="w-9 h-9 rounded-full inline-flex items-center justify-center text-[#6E6E73] hover:bg-black/[0.05] hover:text-[#1D1D1F]">
              {fullscreen ? <Shrink size={16} /> : <Expand size={16} />}
            </button>
          )}
        </div>
      </div>
    </header>
  );

  let body;
  if (store.phase === 'loading') {
    body = <div className="flex-1 flex items-center justify-center text-[13px] text-[#86868B] gap-2"><Loader2 size={18} className="animate-spin" /> Đang tải…</div>;
  } else if (store.phase === 'missing' || store.phase === 'error') {
    body = (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className={`${CARD} max-w-[460px] p-6 text-center`}>
          <div className="w-12 h-12 mx-auto rounded-full bg-[#FF9500]/15 text-[#B25000] inline-flex items-center justify-center mb-3"><AlertTriangle size={22} /></div>
          <div className="text-[16px] font-semibold text-[#1D1D1F]">{store.phase === 'missing' ? 'Chưa cài đặt dữ liệu Pháp lý' : 'Không tải được dữ liệu'}</div>
          <div className="text-[13px] text-[#6E6E73] mt-1.5 leading-relaxed">{store.phase === 'missing' ? `${LEGAL_MIGRATION_HINT} rồi bấm Thử lại.` : store.error}</div>
          <button type="button" onClick={() => void store.reload()} className={`${BTN_PRIMARY} h-9 px-4 text-[13px] mt-4`}><RefreshCw size={14} /> Thử lại</button>
        </div>
      </div>
    );
  } else if (results) {
    body = (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1280px] mx-auto px-3 md:px-6 py-4 md:py-6 pb-10">
          <div className="text-[13px] text-[#86868B] mb-4">{resultCount ? `${resultCount} kết quả cho "${query.trim()}"` : `Không thấy kết quả cho "${query.trim()}"`}</div>
          {results.entities.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[14px] font-semibold text-[#1D1D1F] mb-2">Pháp nhân</h3>
              <div className="flex flex-wrap gap-2">
                {results.entities.map(e => (
                  <button key={e.id} type="button" onClick={() => { setPlace({ tab: 'entities', entityId: e.id, entityTab: 'overview' }); clearSearch(); }}
                    className={`${CARD} flex items-center gap-2.5 p-2 pr-4 hover:-translate-y-0.5 transition`}>
                    <EntityLogo name={e.short_name || e.name} color={e.color} url={e.logo_url} size={36} />
                    <span className="text-left"><span className="block text-[13.5px] font-semibold text-[#1D1D1F]">{e.short_name || e.name}</span><span className="block text-[11.5px] text-[#86868B]">{e.tax_code && `MST ${e.tax_code}`}</span></span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {results.milestones.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[14px] font-semibold text-[#1D1D1F] mb-2">Mốc thời gian</h3>
              <div className={`${CARD} p-1.5`}>
                {results.milestones.map(m => {
                  const e = store.entities.find(x => x.id === m.entity_id)!;
                  return (
                    <button key={m.id} type="button" onClick={() => { setPlace({ tab: 'entities', entityId: e.id, entityTab: 'timeline' }); clearSearch(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-left hover:bg-black/[0.03]">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: MILESTONE_KINDS[m.kind].color }} />
                      <span className="text-[12.5px] text-[#86868B] tabular-nums shrink-0">{fmtDate(m.event_date)}</span>
                      <span className="text-[13.5px] text-[#1D1D1F] truncate flex-1">{m.title}</span>
                      <span className="h-[20px] px-2 rounded-full text-[11px] font-medium text-white shrink-0" style={{ background: e.color }}>{e.short_name || e.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {results.topics.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[14px] font-semibold text-[#1D1D1F] mb-2">Chủ đề</h3>
              <div className="flex flex-wrap gap-2">
                {results.topics.map(t => (
                  <button key={t.id} type="button" onClick={() => { setPlace({ tab: 'library', lib: t.id }); clearSearch(); }}
                    className="inline-flex items-center gap-2 h-10 pl-1.5 pr-3.5 rounded-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)] text-[13px] font-medium text-[#1D1D1F] hover:-translate-y-0.5 transition">
                    <ColorTile color={t.color} size={28} radius={14}><TopicGlyph icon={t.icon} size={14} /></ColorTile>{t.title}
                  </button>
                ))}
              </div>
            </section>
          )}
          {results.docs.length > 0 && (
            <section>
              <h3 className="text-[14px] font-semibold text-[#1D1D1F] mb-2">Tài liệu</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {results.docs.map(d => {
                  const where = d.entity_id ? store.entities.find(e => e.id === d.entity_id)?.short_name || store.entities.find(e => e.id === d.entity_id)?.name : store.topics.find(t => t.id === d.topic_id)?.title;
                  return <DocCard key={d.id} ctx={ctx} doc={d} where={where} />;
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  } else if (place.tab === 'entities') {
    body = <EntitiesView ctx={ctx} entityId={place.entityId && store.entities.some(e => e.id === place.entityId) ? place.entityId : null}
      setEntityId={id => setPlace({ entityId: id, entityTab: 'overview' })} tab={place.entityTab} setTab={t => setPlace({ entityTab: t })} />;
  } else {
    body = <LibraryView ctx={ctx} sel={place.lib} setSel={s => setPlace({ lib: s })} />;
  }

  return (
    <div ref={rootRef} className={`${covering ? 'fixed inset-0 z-[60]' : 'flex-1 min-h-0'} flex flex-col bg-[#F5F5F7]`}>
      {header}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {body}
        {openDocRow && (
          <DocReader key={openDocRow.id} doc={openDocRow} store={store} canEdit={canEdit} userName={userName} toast={toast} mobile={mobile}
            onClose={closeDoc} onEdit={() => setDocForm({ initial: openDocRow })} onOpenDoc={openDoc} />
        )}
      </div>

      {docForm && (
        <DocForm store={store} userName={userName} toast={toast} initial={docForm.initial} preset={docForm.preset}
          onClose={() => setDocForm(null)}
          onSaved={(d, openNow) => {
            store.putDoc(d);
            setDocForm(null);
            toast(docForm.initial ? 'Đã lưu' : 'Đã thêm tài liệu');
            if (openNow || (!docForm.initial && (d.kind === 'drive' || d.kind === 'link'))) openDoc(d.id);
          }} />
      )}
      {trashOpen && <TrashDialog userName={userName} toast={toast} onClose={() => setTrashOpen(false)} onRestored={() => void store.reload()} />}
    </div>
  );
}

function TrashDialog({ userName, toast, onClose, onRestored }: { userName: string; toast: (m: string) => void; onClose: () => void; onRestored: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { loadTrash().then(setItems).catch(e => setErr((e as Error).message)); }, []);
  const back = async (it: TrashItem) => {
    try {
      await restore(it.table, it.id, userName);
      setItems(xs => (xs ?? []).filter(x => !(x.id === it.id && x.table === it.table)));
      toast(`Đã khôi phục "${it.title}"`);
      onRestored();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Sheet label="Thùng rác Pháp lý" onClose={onClose} wide>
      <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-[#1D1D1F] pr-10">Thùng rác</h3>
      <p className="text-[12.5px] text-[#86868B] mt-0.5 mb-4">Mục đã xoá trong trang Pháp lý — bấm Khôi phục để đưa về chỗ cũ. Không có gì bị xoá hẳn.</p>
      {err && <div className="text-[13px] text-[#D70015]">{err}</div>}
      {!items && !err && <div className="py-8 flex justify-center text-[#86868B]"><Loader2 size={18} className="animate-spin" /></div>}
      {items && !items.length && <div className="py-8 text-center text-[13px] text-[#86868B]">Thùng rác trống</div>}
      {items && items.length > 0 && (
        <div className="bg-white rounded-[14px] md:bg-black/[0.025] p-1">
          {items.map(it => (
            <div key={it.table + it.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-black/[0.05] last:border-0">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-[#1D1D1F] truncate">{it.title}</div>
                <div className="text-[11.5px] text-[#86868B]">{it.sub} · xoá {fmtWhen(it.deleted_at)}{it.updated_by ? ` · ${it.updated_by}` : ''}</div>
              </div>
              <button type="button" onClick={() => void back(it)} className={`${BTN_SECONDARY} h-8 px-3 text-[12.5px]`}><ArchiveRestore size={13} /> Khôi phục</button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
