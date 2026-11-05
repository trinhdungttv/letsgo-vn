// Tab "Quy trình công việc" trong hồ sơ Khách hàng: chia theo XƯỞNG → CÔNG ĐOẠN, mỗi nơi dán link video (YouTube / Google Drive)
// hoặc ảnh để xem công việc thực tế ngay trong app. Tự lưu (bảng client_workflows, migration 205).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, ExternalLink, Factory, ImageIcon, Loader2, Pencil, Play, Plus, Trash2, Users, X,
} from 'lucide-react';
import type { Client } from '../../lib/types';
import { useAuth } from '../../lib/auth';
import { isMissingTableError } from '../../lib/clientMaps/orgChart';
import { parseDocLink } from '../../lib/legal/drive';
import { EmbedFrame, GoogleAccessHint } from '../legal/Embed';
import { uid } from '../../lib/quickNotes/mindmap/parse';
import {
  WORKFLOW_MIGRATION_HINT, loadWorkflow, mediaCount, mediaInfo, newStep, newWorkshop, parseMediaInput, saveWorkflow,
  type WfMedia, type WfStep, type WfWorkshop,
} from '../../lib/clientWorkflow/workflow';

const SAVE_DELAY_MS = 900;
type SaveState = { s: 'idle' } | { s: 'saving' } | { s: 'saved'; at: string } | { s: 'error'; msg: string };

export default function ClientWorkflow({ client }: { client: Client }) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.username || '';
  const clientId = client.id;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [workshops, setWorkshops] = useState<WfWorkshop[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ s: 'idle' });
  const [viewer, setViewer] = useState<{ list: WfMedia[]; index: number } | null>(null);

  const pending = useRef<WfWorkshop[] | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const r = await loadWorkflow(clientId);
      setWorkshops(r.workshops);
      setActiveId(r.workshops[0]?.id ?? null);
      setSave(r.updatedAt ? { s: 'saved', at: r.updatedAt } : { s: 'idle' });
      setPhase('ready');
    } catch (e) {
      if (isMissingTableError(e as { code?: string; message?: string })) setPhase('missing');
      else { setLoadError((e as Error).message ?? String(e)); setPhase('error'); }
    }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (busy.current) return;
    const data = pending.current;
    if (!data) return;
    busy.current = true;
    pending.current = null;
    setSave({ s: 'saving' });
    try {
      setSave({ s: 'saved', at: await saveWorkflow(clientId, data, userName) });
    } catch (e) {
      if (!pending.current) pending.current = data;
      const err = e as { code?: string; message?: string };
      if (isMissingTableError(err)) setPhase('missing');
      setSave({ s: 'error', msg: err.message ?? 'lỗi không rõ' });
    } finally { busy.current = false; }
    if (pending.current && !timer.current) timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [clientId, userName]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => { void flushRef.current(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); void flushRef.current(); };
  }, []);

  const commit = useCallback((next: WfWorkshop[], immediate = false) => {
    setWorkshops(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, immediate ? 0 : SAVE_DELAY_MS);
  }, [flush]);

  const active = useMemo(() => workshops.find(w => w.id === activeId) ?? workshops[0] ?? null, [workshops, activeId]);
  const patchWorkshop = (id: string, fn: (w: WfWorkshop) => WfWorkshop, immediate = false) =>
    commit(workshops.map(w => (w.id === id ? fn(w) : w)), immediate);

  if (phase === 'loading') return <div className="flex-1 flex items-center justify-center text-[12.5px] text-[#999] gap-2"><Loader2 size={16} className="animate-spin" /> Đang tải quy trình…</div>;
  if (phase === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[13px] text-[#666] p-6 text-center">
        <AlertTriangle size={22} className="text-amber-500" /> Không tải được: {loadError}
        <button onClick={() => void load()} className="px-3 py-1.5 rounded-lg border border-gray-300 text-[12.5px] hover:bg-gray-50">Thử lại</button>
      </div>
    );
  }
  const readOnly = phase === 'missing';
  const totalSteps = workshops.reduce((n, w) => n + w.steps.length, 0);
  const totalMedia = workshops.reduce((n, w) => n + mediaCount(w), 0);

  const addWorkshop = () => {
    const w = newWorkshop(`Xưởng ${workshops.length + 1}`);
    commit([...workshops, w], true);
    setActiveId(w.id);
  };
  const removeWorkshop = (w: WfWorkshop) => {
    if (!window.confirm(`Xoá "${w.name || 'xưởng này'}" cùng ${w.steps.length} công đoạn và ${mediaCount(w)} link video/ảnh trong đó? Không khôi phục được từ giao diện.`)) return;
    const rest = workshops.filter(x => x.id !== w.id);
    commit(rest, true);
    setActiveId(rest[0]?.id ?? null);
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-5">
      <div className="max-w-[1100px] mx-auto space-y-4">
        {readOnly && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
            <AlertTriangle size={14} className="shrink-0" /> {WORKFLOW_MIGRATION_HINT}. Trong lúc chờ chưa lưu được.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div>
            <div className="text-[15px] font-semibold text-[#111]">Quy trình công việc</div>
            <div className="text-[11.5px] text-[#999]">
              {workshops.length ? `${workshops.length} xưởng · ${totalSteps} công đoạn · ${totalMedia} video / ảnh` : 'Chia theo xưởng và công đoạn, gắn video / ảnh thực tế để xem công việc cụ thể'}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <SaveBadge save={save} readOnly={readOnly} onRetry={() => void flush()} />
            {!readOnly && (
              <button onClick={addWorkshop} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700">
                <Plus size={14} /> Thêm xưởng
              </button>
            )}
          </div>
        </div>

        {workshops.length === 0 ? (
          <div className="bg-white border border-dashed border-[#D8D6CE] rounded-[12px] px-6 py-12 text-center">
            <Factory size={28} className="mx-auto text-[#bbb]" />
            <div className="mt-2 text-[13.5px] font-medium text-[#333]">Chưa có xưởng nào</div>
            <div className="mt-1 text-[12px] text-[#999] max-w-md mx-auto">
              Bắt đầu bằng "Thêm xưởng" (vd: Xưởng may 1, Kho, Đóng gói), rồi thêm từng công đoạn và dán link video YouTube / Google Drive hoặc ảnh để xem công việc thực tế.
            </div>
            {!readOnly && <button onClick={addWorkshop} className="mt-4 inline-flex items-center gap-1 h-9 px-4 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700"><Plus size={14} /> Thêm xưởng đầu tiên</button>}
          </div>
        ) : (
          <>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {workshops.map(w => {
                const on = w.id === active?.id;
                return (
                  <button key={w.id} onClick={() => setActiveId(w.id)}
                    className={`shrink-0 inline-flex items-center gap-2 px-3.5 h-9 rounded-full text-[13px] border transition ${on ? 'bg-[#111] text-white border-[#111]' : 'bg-white text-[#555] border-[#E2E0D9] hover:border-[#999]'}`}>
                    <Factory size={13} /> {w.name || 'Chưa đặt tên'}
                    <span className={`text-[10.5px] px-1.5 rounded-full ${on ? 'bg-white/20' : 'bg-[#F1F0EB] text-[#777]'}`}>{w.steps.length}</span>
                  </button>
                );
              })}
            </div>
            {active && (
              <WorkshopView key={active.id} w={active} readOnly={readOnly}
                onPatch={(fn, imm) => patchWorkshop(active.id, fn, imm)}
                onRemove={() => removeWorkshop(active)}
                onOpen={(list, index) => setViewer({ list, index })} />
            )}
          </>
        )}
      </div>
      {viewer && <Lightbox list={viewer.list} index={viewer.index} onIndex={i => setViewer(v => (v ? { ...v, index: i } : v))} onClose={() => setViewer(null)} />}
    </div>
  );
}

function SaveBadge({ save, readOnly, onRetry }: { save: SaveState; readOnly: boolean; onRetry: () => void }) {
  if (readOnly) return <span className="text-[11.5px] text-amber-700">Chưa lưu được</span>;
  if (save.s === 'saving') return <span className="text-[11.5px] text-[#888] inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Đang lưu…</span>;
  if (save.s === 'error') return <button onClick={onRetry} title={save.msg} className="text-[11.5px] text-red-600 inline-flex items-center gap-1 hover:underline"><AlertTriangle size={12} /> Chưa lưu — thử lại</button>;
  if (save.s === 'saved') return <span className="text-[11.5px] text-[#888] inline-flex items-center gap-1"><Check size={12} className="text-emerald-600" /> Đã lưu {new Date(save.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>;
  return null;
}

/* ═══════════ 1 xưởng ═══════════ */
function WorkshopView({ w, readOnly, onPatch, onRemove, onOpen }: {
  w: WfWorkshop; readOnly: boolean; onPatch: (fn: (w: WfWorkshop) => WfWorkshop, immediate?: boolean) => void;
  onRemove: () => void; onOpen: (list: WfMedia[], index: number) => void;
}) {
  const [editHead, setEditHead] = useState(!w.name.trim());
  const [editStep, setEditStep] = useState<string | null>(null);

  const setStep = (id: string, fn: (s: WfStep) => WfStep, immediate = false) =>
    onPatch(x => ({ ...x, steps: x.steps.map(s => (s.id === id ? fn(s) : s)) }), immediate);
  const moveStep = (i: number, d: -1 | 1) => onPatch(x => {
    const steps = [...x.steps]; const j = i + d;
    if (j < 0 || j >= steps.length) return x;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...x, steps };
  }, true);
  const removeStep = (s: WfStep) => {
    if (!window.confirm(`Xoá công đoạn "${s.name || 'chưa đặt tên'}" và ${s.media.length} link video/ảnh của nó? Không khôi phục được từ giao diện.`)) return;
    onPatch(x => ({ ...x, steps: x.steps.filter(t => t.id !== s.id) }), true);
  };
  const addStep = () => {
    const s = newStep();
    onPatch(x => ({ ...x, steps: [...x.steps, s] }), true);
    setEditStep(s.id);
  };

  return (
    <div className="space-y-3">
      <section className="bg-white border border-[#E8E7E2] rounded-[12px] p-4">
        {editHead && !readOnly ? (
          <div className="space-y-2">
            <input autoFocus value={w.name} onChange={e => onPatch(x => ({ ...x, name: e.target.value }))} placeholder="Tên xưởng — vd: Xưởng may 1"
              className="w-full h-9 px-3 text-[14px] font-semibold border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
            <textarea value={w.note} onChange={e => onPatch(x => ({ ...x, note: e.target.value }))} rows={2}
              placeholder="Xưởng này làm gì? (sản phẩm, quy mô, số chuyền, ca làm…)"
              className="w-full text-[12.5px] px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-y" />
            <div className="flex justify-end"><button onClick={() => setEditHead(false)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700">Xong</button></div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Factory size={20} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-[#111]">{w.name || 'Chưa đặt tên'}</div>
              {w.note ? <div className="text-[12.5px] text-[#555] mt-0.5 whitespace-pre-wrap leading-relaxed">{w.note}</div>
                : !readOnly && <button onClick={() => setEditHead(true)} className="text-[12px] text-[#aaa] hover:text-blue-600">+ Mô tả xưởng này làm gì</button>}
            </div>
            {!readOnly && (
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditHead(true)} title="Sửa tên / mô tả" className="p-1.5 rounded-lg text-[#999] hover:bg-gray-100 hover:text-blue-600"><Pencil size={14} /></button>
                <button onClick={onRemove} title="Xoá xưởng" className="p-1.5 rounded-lg text-[#999] hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        )}
        {(w.media.length > 0 || !readOnly) && (
          <div className="mt-3 pt-3 border-t border-[#F0EFEA]">
            <div className="text-[11px] uppercase tracking-wide text-[#aaa] font-semibold mb-1.5">Video / ảnh tổng quan xưởng</div>
            <MediaBlock media={w.media} readOnly={readOnly} onOpen={onOpen}
              onChange={media => onPatch(x => ({ ...x, media }), true)} />
          </div>
        )}
      </section>

      <div className="space-y-0">
        {w.steps.map((s, i) => {
          const editing = editStep === s.id && !readOnly;
          return (
            <div key={s.id} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0 w-8">
                <div className="w-8 h-8 rounded-full bg-[#111] text-white text-[13px] font-semibold flex items-center justify-center">{i + 1}</div>
                {i < w.steps.length - 1 && <div className="flex-1 w-[2px] bg-[#E2E0D9] my-1" />}
              </div>
              <section className="flex-1 min-w-0 bg-white border border-[#E8E7E2] rounded-[12px] p-4 mb-3">
                {editing ? (
                  <div className="space-y-2">
                    <input autoFocus value={s.name} onChange={e => setStep(s.id, t => ({ ...t, name: e.target.value }))} placeholder="Tên công đoạn — vd: Cắt vải"
                      className="w-full h-9 px-3 text-[13.5px] font-semibold border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                    <input value={s.workers} onChange={e => setStep(s.id, t => ({ ...t, workers: e.target.value }))} placeholder="Nhân sự / ca làm (vd: 12 người · 2 ca)"
                      className="w-full h-9 px-3 text-[12.5px] border border-gray-300 rounded-lg outline-none focus:border-blue-500" />
                    <textarea value={s.desc} onChange={e => setStep(s.id, t => ({ ...t, desc: e.target.value }))} rows={3}
                      placeholder="Công việc cụ thể: làm gì, yêu cầu, lưu ý an toàn, định mức…"
                      className="w-full text-[12.5px] px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-y" />
                    <div className="flex justify-end"><button onClick={() => setEditStep(null)} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700">Xong</button></div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <div className="text-[14px] font-semibold text-[#111]">{s.name || 'Chưa đặt tên'}</div>
                        {s.workers && <span className="inline-flex items-center gap-1 text-[11.5px] text-[#777] bg-[#F5F4EF] px-2 py-0.5 rounded-full"><Users size={11} /> {s.workers}</span>}
                      </div>
                      {s.desc && <div className="mt-1 text-[12.5px] text-[#444] leading-relaxed whitespace-pre-wrap">{s.desc}</div>}
                    </div>
                    {!readOnly && (
                      <div className="flex gap-0.5 shrink-0">
                        <button onClick={() => moveStep(i, -1)} disabled={i === 0} title="Đưa lên" className="p-1.5 rounded-lg text-[#999] hover:bg-gray-100 disabled:opacity-25"><ArrowUp size={13} /></button>
                        <button onClick={() => moveStep(i, 1)} disabled={i === w.steps.length - 1} title="Đưa xuống" className="p-1.5 rounded-lg text-[#999] hover:bg-gray-100 disabled:opacity-25"><ArrowDown size={13} /></button>
                        <button onClick={() => setEditStep(s.id)} title="Sửa" className="p-1.5 rounded-lg text-[#999] hover:bg-gray-100 hover:text-blue-600"><Pencil size={13} /></button>
                        <button onClick={() => removeStep(s)} title="Xoá công đoạn" className="p-1.5 rounded-lg text-[#999] hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-3">
                  <MediaBlock media={s.media} readOnly={readOnly} onOpen={onOpen}
                    onChange={media => setStep(s.id, t => ({ ...t, media }), true)} />
                </div>
              </section>
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <button onClick={addStep}
          className="w-full h-11 rounded-[12px] border border-dashed border-[#CFCDC4] text-[13px] text-[#777] hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/40 inline-flex items-center justify-center gap-1.5 transition">
          <Plus size={15} /> Thêm công đoạn
        </button>
      )}
    </div>
  );
}

/* ═══════════ Lưới video / ảnh + ô dán link ═══════════ */
function MediaBlock({ media, readOnly, onChange, onOpen }: {
  media: WfMedia[]; readOnly: boolean; onChange: (m: WfMedia[]) => void; onOpen: (list: WfMedia[], index: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseMediaInput(text), [text]);
  const submit = () => {
    if (!parsed.length) return;
    onChange([...media, ...parsed.map(p => ({ id: uid(), url: p.url, title: p.title }))]);
    setText(''); setAdding(false);
  };
  const remove = (m: WfMedia) => {
    if (!window.confirm(`Gỡ link "${m.title || m.url}" khỏi mục này? (Video / ảnh gốc trên YouTube / Drive không bị xoá.)`)) return;
    onChange(media.filter(x => x.id !== m.id));
  };
  return (
    <div className="space-y-2">
      {media.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {media.map((m, i) => <MediaTile key={m.id} m={m} readOnly={readOnly} onOpen={() => onOpen(media, i)} onRemove={() => remove(m)} />)}
        </div>
      )}
      {!readOnly && (adding ? (
        <div className="space-y-1.5">
          <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={3}
            placeholder={'Dán link YouTube / Google Drive / ảnh — mỗi link một dòng\nMuốn đặt tên: Cắt vải bàn 1 | https://youtu.be/…'}
            className="w-full text-[12.5px] px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-y" />
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-[#999]">{text.trim() ? (parsed.length ? `Nhận ${parsed.length} link` : 'Chưa thấy link hợp lệ') : 'Drive: chia sẻ "Bất kỳ ai có đường liên kết" mới xem được trong app'}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setAdding(false); setText(''); }} className="px-3 py-1.5 rounded-lg text-[12px] text-[#666] hover:bg-gray-100">Huỷ</button>
              <button onClick={submit} disabled={!parsed.length} className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">Thêm</button>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-blue-600 hover:text-blue-700">
          <Play size={12} /> <ImageIcon size={12} /> Thêm video / ảnh
        </button>
      ))}
    </div>
  );
}

function MediaTile({ m, readOnly, onOpen, onRemove }: { m: WfMedia; readOnly: boolean; onOpen: () => void; onRemove: () => void }) {
  const info = mediaInfo(m.url);
  const [broken, setBroken] = useState(false);
  const showThumb = info.thumb && !broken;
  return (
    <div className="group relative">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="relative aspect-video rounded-lg overflow-hidden bg-[#F1F0EB] border border-[#E8E7E2]">
          {showThumb
            ? <img src={info.thumb!} alt={m.title} loading="lazy" onError={() => setBroken(true)} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-[#aaa]">{info.kind === 'image' ? <ImageIcon size={26} /> : <Play size={26} />}</div>}
          {info.kind !== 'image' && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center group-hover:bg-black/75"><Play size={16} className="ml-0.5" /></span>
            </span>
          )}
          <span className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">{info.label}</span>
        </div>
        <div className="mt-1 text-[11.5px] text-[#555] truncate">{m.title || parseDocLink(m.url).openUrl.replace(/^https?:\/\/(www\.)?/, '')}</div>
      </button>
      {!readOnly && (
        <button onClick={onRemove} title="Gỡ link" className="absolute top-1 right-1 p-1 rounded-full bg-white/90 text-[#777] opacity-0 group-hover:opacity-100 hover:text-red-600 shadow">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function Lightbox({ list, index, onIndex, onClose }: { list: WfMedia[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const m = list[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < list.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, list.length, onClose, onIndex]);
  if (!m) return null;
  const link = parseDocLink(m.url);
  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex flex-col p-3 md:p-6" onClick={onClose}>
      <div className="flex items-center gap-3 text-white pb-2" onClick={e => e.stopPropagation()}>
        <div className="min-w-0 flex-1 text-[13.5px] font-medium truncate">{m.title || mediaInfo(m.url).label}{list.length > 1 && <span className="ml-2 text-white/60 text-[12px]">{index + 1}/{list.length}</span>}</div>
        <a href={link.openUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25"><ExternalLink size={12} /> Mở link</a>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25"><X size={16} /></button>
      </div>
      <div className="flex-1 min-h-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <button onClick={() => onIndex(index - 1)} disabled={index === 0} className="hidden md:block px-2 py-6 rounded-lg bg-white/10 text-white disabled:opacity-20 hover:bg-white/20">‹</button>
        <EmbedFrame url={m.url} title={m.title || 'Video'} className="flex-1 h-full" />
        <button onClick={() => onIndex(index + 1)} disabled={index >= list.length - 1} className="hidden md:block px-2 py-6 rounded-lg bg-white/10 text-white disabled:opacity-20 hover:bg-white/20">›</button>
      </div>
      <div className="pt-2" onClick={e => e.stopPropagation()}><div className="text-white/70 [&_*]:!text-white/70"><GoogleAccessHint url={m.url} /></div></div>
    </div>
  );
}
