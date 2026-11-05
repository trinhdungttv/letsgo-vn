// Đầu tab "Hồ sơ chăm sóc": DÒNG THỜI GIAN mốc quan trọng của công ty + GHI CHÚ chuyên nghiệp (văn bản có định dạng
// hoặc sơ đồ tư duy). Dữ liệu 1 dòng / công ty ở bảng client_profile_briefs (migration 204), tự lưu sau mỗi lần sửa.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, Bold, CheckSquare, Eye, FileText, Heading2, List, ListOrdered, Loader2, Maximize2, Minimize2,
  Minus, Network, Pencil, Plus, Quote, Check, Trash2, X,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useIsMobile } from '../../hooks/useIsMobile';
import { isMissingTableError } from '../../lib/clientMaps/orgChart';
import { RecorderControl, VoiceList, useVoiceCapture } from '../voice/VoiceUI';
import { isMissingVoiceSetup, listVoice, uploadVoice, VOICE_MIGRATION_HINT, type VoiceRecording } from '../../lib/voiceRec/api';
import type { NotePalette } from '../../lib/quickNotes/colors';
import type { MindMapDoc } from '../../lib/quickNotes/mindmap/types';
import {
  BRIEF_MIGRATION_HINT, EMPTY_BRIEF, MILESTONE_KINDS, composeMilestoneDate, defaultNotesMap, fmtMilestoneDate, kindOf, loadBrief, milestoneStart, splitMilestoneDate, newMilestone, saveBrief, sortMilestones,
  type BriefPatch, type BriefRow, type Milestone, type NotesMode,
} from '../../lib/clientBrief/brief';

const MindMapEditor = lazy(() => import('../quickNotes/mindmap/MindMapEditor'));

const PALETTE: NotePalette = {
  label: 'Trắng', dot: '#8E8E93', tab: '#D0D0D5', paper: '#FFFFFF', header: '#F5F5F7', strip: '#E5E5EA', ink: '#1D1D1F',
};
const SAVE_DELAY_MS = 1200;
type SaveState = { s: 'idle' } | { s: 'saving' } | { s: 'saved'; at: string } | { s: 'error'; msg: string };

const fmtDay = fmtMilestoneDate;
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ClientBriefModule({ subjectId, companyName }: { subjectId: string; companyName: string }) {
  const { user } = useAuth();
  const userName = user?.full_name || user?.username || '';
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [brief, setBrief] = useState<BriefRow>(EMPTY_BRIEF);
  const [save, setSave] = useState<SaveState>({ s: 'idle' });

  const pending = useRef<BriefPatch>({});
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    pending.current = {};
    try {
      const row = await loadBrief(subjectId);
      setBrief(row);
      setSave(row.updatedAt ? { s: 'saved', at: row.updatedAt } : { s: 'idle' });
      setPhase('ready');
    } catch (e) {
      if (isMissingTableError(e as { code?: string; message?: string })) { setBrief(EMPTY_BRIEF); setPhase('missing'); }
      else { setLoadError((e as Error).message ?? String(e)); setPhase('error'); }
    }
  }, [subjectId]);
  useEffect(() => { void load(); }, [load]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (busy.current) return;
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    busy.current = true;
    pending.current = {};
    setSave({ s: 'saving' });
    try {
      const at = await saveBrief(subjectId, patch, userName);
      setSave({ s: 'saved', at });
    } catch (e) {
      pending.current = { ...patch, ...pending.current }; // giữ phần chưa lưu được
      const err = e as { code?: string; message?: string };
      if (isMissingTableError(err)) setPhase('missing');
      setSave({ s: 'error', msg: err.message ?? 'lỗi không rõ' });
    } finally {
      busy.current = false;
    }
    if (Object.keys(pending.current).length && !busy.current && !timer.current) {
      timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
    }
  }, [subjectId, userName]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => { void flushRef.current(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      void flushRef.current();
    };
  }, []);

  /** Sửa tại chỗ rồi xếp hàng lưu (chữ gõ dồn 1.2s mới lưu; thao tác rời rạc như thêm/xoá mốc lưu ngay). */
  const change = useCallback((patch: BriefPatch, immediate = false) => {
    setBrief(b => ({
      ...b,
      ...(patch.milestones !== undefined ? { milestones: patch.milestones } : {}),
      ...(patch.notesText !== undefined ? { notesText: patch.notesText } : {}),
      ...(patch.notesMindmap !== undefined ? { notesMindmap: patch.notesMindmap } : {}),
      ...(patch.notesMode !== undefined ? { notesMode: patch.notesMode } : {}),
    }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, immediate ? 0 : SAVE_DELAY_MS);
  }, [flush]);

  if (phase === 'loading') {
    return <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-6 text-[12.5px] text-[#999] flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Đang tải dòng thời gian & ghi chú…</div>;
  }
  if (phase === 'error') {
    return (
      <div className="bg-white border border-[#E8E7E2] rounded-[10px] p-4 text-[12.5px] text-[#666] flex items-center gap-3">
        <AlertTriangle size={16} className="text-amber-500" /> Không tải được: {loadError}
        <button onClick={() => void load()} className="ml-auto px-3 py-1 rounded-lg border border-gray-300 hover:bg-gray-50">Thử lại</button>
      </div>
    );
  }
  const readOnly = phase === 'missing';

  return (
    <div className="space-y-3">
      {readOnly && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
          <AlertTriangle size={14} className="shrink-0" /> {BRIEF_MIGRATION_HINT}. Trong lúc chờ, khối này chưa lưu được.
        </div>
      )}
      <TimelineCard milestones={brief.milestones} readOnly={readOnly} save={save}
        onChange={list => change({ milestones: list }, true)} onRetry={() => void flush()} />
      <NotesCard subjectId={subjectId} brief={brief} companyName={companyName} readOnly={readOnly} save={save}
        onText={t => change({ notesText: t })}
        onMap={d => change({ notesMindmap: d })}
        onMode={m => change({ notesMode: m }, true)}
        onRetry={() => void flush()} />
    </div>
  );
}

function SaveBadge({ save, readOnly, onRetry }: { save: SaveState; readOnly: boolean; onRetry: () => void }) {
  if (readOnly) return <span className="text-[11px] text-amber-700">Chưa lưu được</span>;
  if (save.s === 'saving') return <span className="text-[11px] text-[#888] inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Đang lưu…</span>;
  if (save.s === 'error') return <button onClick={onRetry} title={save.msg} className="text-[11px] text-red-600 inline-flex items-center gap-1 hover:underline"><AlertTriangle size={11} /> Chưa lưu — thử lại</button>;
  if (save.s === 'saved') {
    const d = new Date(save.at);
    return <span className="text-[11px] text-[#888] inline-flex items-center gap-1"><Check size={11} className="text-emerald-600" /> Đã lưu {d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>;
  }
  return null;
}

function Card({ icon, title, hint, right, children }: { icon: ReactNode; title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-[#F0EFEA]">
        <div className="text-[13.5px] font-semibold text-[#111] flex items-center gap-1.5">{icon}{title}</div>
        {hint && <div className="text-[11px] text-[#aaa] hidden md:block">{hint}</div>}
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </header>
      {children}
    </section>
  );
}

/* ═══════════════ DÒNG THỜI GIAN ═══════════════ */
function TimelineCard({ milestones, readOnly, save, onChange, onRetry }: {
  milestones: Milestone[]; readOnly: boolean; save: SaveState;
  onChange: (list: Milestone[]) => void; onRetry: () => void;
}) {
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [isNew, setIsNew] = useState(false);
  const sorted = useMemo(() => sortMilestones(milestones), [milestones]);
  const today = todayIso();
  // chèn vạch "Hôm nay" trước mốc đầu tiên có ngày > hôm nay
  const todayIdx = sorted.findIndex(m => milestoneStart(m.date) > today);
  const scroller = useRef<HTMLDivElement>(null);

  // mở ra thì cuộn tới vùng gần hôm nay
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[data-today]');
    if (el && scroller.current) scroller.current.scrollLeft = Math.max(0, el.offsetLeft - scroller.current.clientWidth / 2);
  }, [sorted.length]);

  const submit = () => {
    if (!editing || !editing.title.trim()) return;
    const m = { ...editing, title: editing.title.trim() };
    onChange(isNew ? [...milestones, m] : milestones.map(x => (x.id === m.id ? m : x)));
    setEditing(null);
  };
  const remove = (m: Milestone) => {
    if (!window.confirm(`Xoá mốc "${m.title}" (${fmtDay(m.date)})? Không khôi phục được từ giao diện.`)) return;
    onChange(milestones.filter(x => x.id !== m.id));
    setEditing(null);
  };

  const nodes: ReactNode[] = [];
  sorted.forEach((m, i) => {
    if (i === todayIdx) nodes.push(<TodayMark key="today" />);
    nodes.push(<MilestoneNode key={m.id} m={m} past={!m.date || milestoneStart(m.date) <= today} readOnly={readOnly} onEdit={() => { setEditing(m); setIsNew(false); }} />);
  });
  if (todayIdx === -1 && sorted.length) nodes.push(<TodayMark key="today" />);

  return (
    <Card icon={<span>🧭</span>} title="Dòng thời gian" hint="Các mốc quan trọng của công ty này — theo thứ tự thời gian"
      right={<>
        <SaveBadge save={save} readOnly={readOnly} onRetry={onRetry} />
        {!readOnly && (
          <button onClick={() => { setEditing(newMilestone()); setIsNew(true); }}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-blue-600 text-white text-[12px] font-medium hover:bg-blue-700">
            <Plus size={13} /> Thêm mốc
          </button>
        )}
      </>}>
      {sorted.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12.5px] text-[#999]">
          Chưa có mốc nào. Ghi lại những cột mốc quan trọng: ngày bắt đầu hợp tác, ký / gia hạn hợp đồng, buổi gặp then chốt, sự cố, kế hoạch sắp tới…
        </div>
      ) : (
        <div ref={scroller} className="overflow-x-auto px-4 pt-4 pb-3">
          <div className="relative flex items-start gap-0 min-w-max">
            <div className="absolute left-0 right-0 top-[9px] h-[2px] bg-[#E5E7EB]" />
            {nodes}
          </div>
        </div>
      )}
      {editing && (
        <MilestoneForm m={editing} isNew={isNew} onChange={setEditing} onSubmit={submit} onCancel={() => setEditing(null)} onDelete={() => remove(editing)} />
      )}
    </Card>
  );
}

function TodayMark() {
  return (
    <div data-today className="relative w-[64px] shrink-0 flex flex-col items-center">
      <span className="relative z-10 w-[2px] h-[20px] bg-rose-500 rounded" />
      <span className="mt-1 text-[10px] font-semibold text-rose-600 uppercase tracking-wide">Hôm nay</span>
    </div>
  );
}

function MilestoneNode({ m, past, readOnly, onEdit }: { m: Milestone; past: boolean; readOnly: boolean; onEdit: () => void }) {
  const k = kindOf(m.kind);
  return (
    <button type="button" onClick={readOnly ? undefined : onEdit} title={readOnly ? undefined : 'Bấm để sửa'}
      className="relative w-[172px] shrink-0 pr-3 text-left group">
      <span className="relative z-10 block w-[20px] h-[20px] rounded-full border-[3px] bg-white" style={{ borderColor: k.color, background: past ? k.color : '#fff' }} />
      <span className="mt-1.5 block text-[11px] font-semibold" style={{ color: k.color }}>{fmtDay(m.date)}{!past && ' · dự kiến'}</span>
      <span className="block text-[12.5px] font-medium text-[#111] leading-snug group-hover:text-blue-700">{m.title}</span>
      <span className="inline-block mt-0.5 px-1.5 rounded text-[10px]" style={{ background: `${k.color}18`, color: k.color }}>{k.label}</span>
      {m.note && <span className="block mt-1 text-[11.5px] text-[#777] leading-snug line-clamp-3 whitespace-pre-wrap">{m.note}</span>}
    </button>
  );
}

/** Ngày / Tháng / Năm — chỉ năm là đủ; không nhớ ngày thì để trống Ngày (và Tháng). */
function DateFields({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [f, setF] = useState(() => splitMilestoneDate(value));
  const set = (k: 'day' | 'month' | 'year', v: string) => {
    const next = { ...f, [k]: v.replace(/\D/g, '') };
    setF(next);
    onChange(composeMilestoneDate(next.day, next.month, next.year));
  };
  const cls = 'h-9 px-2 text-[12.5px] text-center border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white';
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input inputMode="numeric" maxLength={2} value={f.day} onChange={e => set('day', e.target.value)} placeholder="Ngày" aria-label="Ngày" className={`${cls} w-[58px]`} />
        <span className="text-[#bbb]">/</span>
        <input inputMode="numeric" maxLength={2} value={f.month} onChange={e => set('month', e.target.value)} placeholder="Tháng" aria-label="Tháng" className={`${cls} w-[62px]`} />
        <span className="text-[#bbb]">/</span>
        <input inputMode="numeric" maxLength={4} value={f.year} onChange={e => set('year', e.target.value)} placeholder="Năm" aria-label="Năm" className={`${cls} w-[70px]`} />
      </div>
      <div className="mt-1 text-[11px] text-[#999]">Không nhớ ngày thì chỉ nhập năm (hoặc tháng + năm)</div>
    </div>
  );
}

function MilestoneForm({ m, isNew, onChange, onSubmit, onCancel, onDelete }: {
  m: Milestone; isNew: boolean; onChange: (m: Milestone) => void; onSubmit: () => void; onCancel: () => void; onDelete: () => void;
}) {
  return (
    <div className="border-t border-[#F0EFEA] bg-[#FAFAF8] px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-[#333]">{isNew ? 'Thêm mốc mới' : 'Sửa mốc'}</div>
        <button onClick={onCancel} className="p-1 rounded text-[#999] hover:bg-gray-100"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-2">
        <DateFields value={m.date} onChange={date => onChange({ ...m, date })} />
        <input autoFocus value={m.title} onChange={e => onChange({ ...m, title: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel(); }}
          placeholder="Tên mốc — vd: Ký hợp đồng khung 2026"
          className="h-9 px-3 text-[12.5px] border border-gray-300 rounded-lg outline-none focus:border-blue-500 bg-white" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MILESTONE_KINDS.map(k => (
          <button key={k.key} type="button" onClick={() => onChange({ ...m, kind: k.key })}
            className="px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition"
            style={m.kind === k.key ? { background: k.color, borderColor: k.color, color: '#fff' } : { borderColor: '#E2E0D9', color: '#555', background: '#fff' }}>
            {k.label}
          </button>
        ))}
      </div>
      <textarea value={m.note} onChange={e => onChange({ ...m, note: e.target.value })} rows={2}
        placeholder="Ghi chú ngắn về mốc này (không bắt buộc)"
        className="w-full text-[12.5px] px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-blue-500 resize-y bg-white" />
      <div className="flex items-center gap-2">
        {!isNew && (
          <button onClick={onDelete} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-red-600 hover:bg-red-50"><Trash2 size={12} /> Xoá mốc</button>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-[12px] text-[#666] hover:bg-gray-100">Huỷ</button>
          <button onClick={onSubmit} disabled={!m.title.trim()}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">{isNew ? 'Thêm' : 'Lưu'}</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ GHI CHÚ ═══════════════ */
function NotesCard({ subjectId, brief, companyName, readOnly, save, onText, onMap, onMode, onRetry }: {
  subjectId: string; brief: BriefRow; companyName: string; readOnly: boolean; save: SaveState;
  onText: (t: string) => void; onMap: (d: MindMapDoc) => void; onMode: (m: NotesMode) => void; onRetry: () => void;
}) {
  const mobile = useIsMobile();
  const { user } = useAuth();
  const mode = brief.notesMode;
  const [full, setFull] = useState(false);

  // ── Ghi âm nhanh thông tin về công ty (migration 206): dừng là tự lưu, nghe lại ở danh sách bên dưới ──
  const voice = useVoiceCapture();
  const [voices, setVoices] = useState<VoiceRecording[]>([]);
  const [voiceMsg, setVoiceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loadVoices = useCallback(async () => {
    try { setVoices(await listVoice('company_note', subjectId)); } catch (e) {
      if (isMissingVoiceSetup(e as { code?: string; message?: string })) setVoiceMsg({ ok: false, text: VOICE_MIGRATION_HINT });
    }
  }, [subjectId]);
  useEffect(() => { void loadVoices(); }, [loadVoices]);
  const pendingAudio = voice.pending;
  useEffect(() => {
    if (!pendingAudio) return;
    let alive = true;
    setVoiceMsg({ ok: true, text: 'Đang lưu bản ghi âm…' });
    uploadVoice({
      type: 'company_note', subjectId, title: '', blob: pendingAudio.blob, mime: pendingAudio.mime, ext: pendingAudio.ext,
      durationSec: pendingAudio.durationSec, recordedAt: pendingAudio.startedAt,
      userId: user?.id ?? '', userName: user?.full_name || user?.username || '',
    }).then(() => { if (alive) { voice.setPending(null); setVoiceMsg(null); void loadVoices(); } })
      .catch(e => { if (alive) setVoiceMsg({ ok: false, text: isMissingVoiceSetup(e as { code?: string; message?: string }) ? VOICE_MIGRATION_HINT : 'Không lưu được ghi âm: ' + (e as Error).message }); });
    return () => { alive = false; };
    // chỉ chạy khi có bản ghi mới
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAudio]);
  // sơ đồ mới dựng 1 lần theo tên công ty, chỉ lưu khi người dùng sửa
  const seed = useMemo(() => brief.notesMindmap ?? defaultNotesMap(companyName), [brief.notesMindmap, companyName]);

  const body = (
    <div className={full ? 'flex-1 min-h-0 flex flex-col' : ''}>
      {mode === 'text' ? (
        <TextNotes text={brief.notesText} readOnly={readOnly} full={full} onChange={onText} />
      ) : (
        <div className={`relative flex flex-col ${full ? 'flex-1 min-h-0' : 'h-[540px]'}`}>
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-[#999]"><Loader2 size={18} className="animate-spin" /></div>}>
            <MindMapEditor key="map" noteId={`client-brief:${companyName}`} doc={seed} seedText="" palette={PALETTE}
              title={`Ghi chú – ${companyName}`} readOnly={readOnly} mobile={mobile}
              saveError={save.s === 'error' ? save.msg : null} onChange={onMap} />
          </Suspense>
        </div>
      )}
      {(voices.length > 0 || voiceMsg) && (
        <div className={`border-t border-[#F0EFEA] bg-[#FAFAF8] px-4 py-3 space-y-2 ${full ? 'max-h-56 overflow-y-auto shrink-0' : ''}`}>
          <div className="text-[11px] uppercase tracking-wide text-[#aaa] font-semibold">🎙 Ghi âm về công ty{voices.length ? ` · ${voices.length}` : ''}</div>
          {voiceMsg && <div className={`text-[12px] rounded-md px-2.5 py-1.5 ${voiceMsg.ok ? 'text-[#666] bg-white border border-[#E8E7E2]' : 'text-amber-800 bg-amber-50 border border-amber-200'}`}>{voiceMsg.text}</div>}
          <VoiceList items={voices} onChanged={() => void loadVoices()} readOnly={readOnly} />
        </div>
      )}
    </div>
  );

  const header = {
    icon: <span>📒</span>,
    title: 'Ghi chú công ty',
    hint: 'Nơi tổng hợp thông tin quan trọng đã tiếp nhận — viết văn bản hoặc vẽ sơ đồ tư duy',
    right: (
      <>
        {!readOnly && <RecorderControl rec={voice.rec} onStart={() => { setVoiceMsg(null); void voice.start(); }} size="sm" />}
        <SaveBadge save={save} readOnly={readOnly} onRetry={onRetry} />
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-[12px]">
          {([['text', 'Văn bản', FileText], ['mindmap', 'Sơ đồ tư duy', Network]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => onMode(k)}
              className={`inline-flex items-center gap-1 px-2.5 h-7 font-medium transition ${mode === k ? 'bg-[#111] text-white' : 'bg-white text-[#555] hover:bg-gray-50'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <button onClick={() => setFull(f => !f)} title={full ? 'Thu nhỏ' : 'Phóng to toàn màn hình'}
          className="p-1.5 rounded-lg border border-gray-300 text-[#555] hover:bg-gray-50">
          {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </>
    ),
  };

  if (full) {
    return (
      <div className="fixed inset-0 z-[60] bg-[#F5F4EF] p-3 md:p-5 flex flex-col">
        <section className="flex-1 min-h-0 bg-white border border-[#E8E7E2] rounded-[10px] overflow-hidden flex flex-col">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-[#F0EFEA]">
            <div className="text-[13.5px] font-semibold text-[#111] flex items-center gap-1.5">{header.icon}{header.title} — {companyName}</div>
            <div className="ml-auto flex items-center gap-2">{header.right}</div>
          </header>
          {body}
        </section>
      </div>
    );
  }
  return <Card {...header}>{body}</Card>;
}

/** Văn bản có định dạng: ô gõ + thanh công cụ (Markdown đơn giản) và chế độ Xem đã dàn trang. */
function TextNotes({ text, readOnly, full, onChange }: { text: string; readOnly: boolean; full: boolean; onChange: (t: string) => void }) {
  const [view, setView] = useState(!!text.trim());
  const ta = useRef<HTMLTextAreaElement>(null);

  const wrapSel = (before: string, after = before) => {
    const el = ta.current; if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const next = value.slice(0, s) + before + (value.slice(s, e) || 'chữ') + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + (e > s ? e - s : 3)); });
  };
  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const el = ta.current; if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const start = value.lastIndexOf('\n', s - 1) + 1;
    let end = value.indexOf('\n', e); if (end === -1) end = value.length;
    const lines = value.slice(start, end).split('\n').map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l);
    onChange(value.slice(0, start) + lines.join('\n') + value.slice(end));
    requestAnimationFrame(() => el.focus());
  };
  const insertLine = (line: string) => {
    const el = ta.current; if (!el) return;
    const { selectionStart: s, value } = el;
    const pre = s > 0 && value[s - 1] !== '\n' ? '\n' : '';
    onChange(value.slice(0, s) + pre + line + '\n' + value.slice(s));
    requestAnimationFrame(() => el.focus());
  };

  const tools: [string, ReactNode, () => void][] = [
    ['Tiêu đề', <Heading2 size={14} key="h" />, () => prefixLines('## ')],
    ['Chữ đậm (⌘B)', <Bold size={14} key="b" />, () => wrapSel('**')],
    ['Gạch đầu dòng', <List size={14} key="l" />, () => prefixLines('- ')],
    ['Đánh số', <ListOrdered size={14} key="o" />, () => prefixLines(i => `${i + 1}. `)],
    ['Việc cần làm (tick được)', <CheckSquare size={14} key="c" />, () => prefixLines('- [ ] ')],
    ['Trích dẫn / lưu ý', <Quote size={14} key="q" />, () => prefixLines('> ')],
    ['Đường kẻ ngang', <Minus size={14} key="m" />, () => insertLine('---')],
  ];

  return (
    <div className={full ? 'flex-1 min-h-0 flex flex-col' : ''}>
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-[#F0EFEA] bg-[#FAFAF8]">
        {!readOnly && !view && tools.map(([title, icon, fn]) => (
          <button key={title} type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={fn}
            className="p-1.5 rounded-md text-[#555] hover:bg-white hover:text-blue-700">{icon}</button>
        ))}
        {view && <span className="text-[11px] text-[#aaa] px-1">Bấm ô vuông để tick việc cần làm</span>}
        <button type="button" onClick={() => setView(v => !v)} disabled={readOnly && !view}
          className="ml-auto inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[12px] font-medium text-[#555] hover:bg-white border border-transparent hover:border-gray-200">
          {view ? <><Pencil size={12} /> Sửa</> : <><Eye size={12} /> Xem</>}
        </button>
      </div>
      {view ? (
        <div className={`px-5 py-4 overflow-y-auto ${full ? 'flex-1 min-h-0' : 'max-h-[620px] min-h-[200px]'}`}
          onDoubleClick={() => { if (!readOnly) setView(false); }}>
          {text.trim()
            ? <NoteView text={text} onToggleLine={readOnly ? undefined : (i, done) => onChange(toggleCheck(text, i, done))} />
            : <div className="text-[12.5px] text-[#aaa] italic">Chưa có nội dung — bấm Sửa để bắt đầu viết.</div>}
        </div>
      ) : (
        <textarea ref={ta} value={text} readOnly={readOnly} onChange={e => onChange(e.target.value)} autoFocus={!!text.trim()}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSel('**'); } }}
          placeholder={'Ghi lại mọi thông tin quan trọng về công ty này…\n\n## Tổng quan\nNgành, quy mô, sản phẩm chính…\n\n## Nhu cầu & điểm đau\n- …\n\n## Người ra quyết định\n- …\n\n## Việc cần theo dõi\n- [ ] …'}
          className={`w-full block px-5 py-4 text-[13.5px] leading-[1.7] text-[#222] outline-none resize-y font-[inherit] ${full ? 'flex-1 min-h-0' : 'min-h-[320px]'}`} />
      )}
    </div>
  );
}

/* ── Hiển thị Markdown đơn giản (không dùng HTML thô → an toàn) ── */
function toggleCheck(text: string, lineIdx: number, done: boolean): string {
  const lines = text.split('\n');
  lines[lineIdx] = lines[lineIdx].replace(/^(\s*[-*]\s)\[( |x|X)\]/, `$1[${done ? 'x' : ' '}]`);
  return lines.join('\n');
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k++} className="px-1 rounded bg-[#F1F0EB] text-[12px]">{t.slice(1, -1)}</code>);
    else out.push(<a key={k++} href={t} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{t}</a>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function NoteView({ text, onToggleLine }: { text: string; onToggleLine?: (lineIdx: number, done: boolean) => void }) {
  const lines = text.split('\n');
  const els: ReactNode[] = [];
  lines.forEach((raw, i) => {
    const l = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!l.trim()) { els.push(<div key={i} className="h-2" />); return; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) {
      const cls = m[1].length === 1 ? 'text-[18px] font-bold mt-2' : m[1].length === 2 ? 'text-[15.5px] font-semibold mt-3 pb-1 border-b border-[#F0EFEA]' : 'text-[14px] font-semibold mt-2';
      els.push(<div key={i} className={`${cls} text-[#111]`}>{inline(m[2])}</div>); return;
    }
    if (/^-{3,}$/.test(l.trim())) { els.push(<hr key={i} className="my-3 border-[#E8E7E2]" />); return; }
    if ((m = l.match(/^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/))) {
      const done = m[2] !== ' ';
      els.push(
        <label key={i} className="flex items-start gap-2 text-[13.5px] leading-[1.7]" style={{ paddingLeft: m[1].length * 6 }}>
          <input type="checkbox" checked={done} disabled={!onToggleLine} onChange={() => onToggleLine?.(i, !done)} className="mt-[7px] accent-blue-600" />
          <span className={done ? 'line-through text-[#aaa]' : 'text-[#222]'}>{inline(m[3])}</span>
        </label>,
      ); return;
    }
    if ((m = l.match(/^(\s*)[-*]\s+(.*)$/))) {
      els.push(<div key={i} className="flex gap-2 text-[13.5px] leading-[1.7] text-[#222]" style={{ paddingLeft: m[1].length * 6 }}><span className="text-[#999]">•</span><span>{inline(m[2])}</span></div>); return;
    }
    if ((m = l.match(/^(\s*)(\d+)\.\s+(.*)$/))) {
      els.push(<div key={i} className="flex gap-2 text-[13.5px] leading-[1.7] text-[#222]" style={{ paddingLeft: m[1].length * 6 }}><span className="text-[#999] min-w-[1.2em]">{m[2]}.</span><span>{inline(m[3])}</span></div>); return;
    }
    if ((m = l.match(/^>\s?(.*)$/))) {
      els.push(<div key={i} className="border-l-[3px] border-amber-400 bg-amber-50/60 pl-3 py-0.5 text-[13.5px] leading-[1.7] text-[#444]">{inline(m[1])}</div>); return;
    }
    els.push(<div key={i} className="text-[13.5px] leading-[1.7] text-[#222]">{inline(l)}</div>);
  });
  return <div>{els}</div>;
}
