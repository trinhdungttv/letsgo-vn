// Pháp lý — "Thẻ ghi nhớ": Ôn tập (lật thẻ, Nhớ / Chưa nhớ theo hộp Leitner, phím tắt) + Danh sách thẻ (soạn, nhập nhanh).
// Tiến độ ôn lưu riêng từng máy (localStorage) — xem lib/legal/cards.ts.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Layers, ListPlus, Plus, RotateCcw, Shuffle, Trash2, X } from 'lucide-react';
import {
  boxCounts, CARD_COLORS, dueCards, loadProgress, masteredPct, newCard, review, saveProgress,
  type CardsDoc, type FlashCard, type Progress,
} from '../../lib/legal/cards';
import { BTN_PRIMARY, BTN_SECONDARY } from '../workspace/wsTheme';
import { RichText } from './LessonEditor';
import { shade } from './ui';

const BOX_COLORS = ['#C7C7CC', '#FF9500', '#FFCC00', '#34C759', '#30B0C7', '#0071E3'];
const BOX_LABELS = ['Chưa học', 'Hộp 1', 'Hộp 2', 'Hộp 3', 'Hộp 4', 'Đã thuộc'];

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

function Study({ docId, cards, onEdit }: { docId: string; cards: FlashCard[]; onEdit?: () => void }) {
  const [progress, setProgress] = useState<Progress>(() => loadProgress(docId));
  const [queue, setQueue] = useState<FlashCard[]>(() => dueCards(cards, loadProgress(docId)));
  const [flipped, setFlipped] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const valid = useMemo(() => cards.filter(c => c.front.trim() || c.back.trim()), [cards]);
  const current = queue[0];

  const answer = useCallback((ok: boolean) => {
    if (!current) return;
    const next = { ...progress, [current.id]: review(progress[current.id], ok) };
    setProgress(next);
    saveProgress(docId, next);
    setFlipped(false);
    setDoneCount(n => n + 1);
    // quên → đưa xuống cuối lượt để hỏi lại
    setQueue(q => (ok ? q.slice(1) : [...q.slice(1), q[0]]));
  }, [current, progress, docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped(f => !f); }
      else if (flipped && (e.key === 'ArrowRight' || e.key === '2')) answer(true);
      else if (flipped && (e.key === 'ArrowLeft' || e.key === '1')) answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, flipped]);

  const counts = boxCounts(valid, progress);
  const pct = masteredPct(valid, progress);

  if (!valid.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-8">
        <Layers size={30} className="text-[#C7C7CC]" />
        <div className="text-[15px] font-semibold text-[#1D1D1F]">Chưa có thẻ nào</div>
        {onEdit && <button type="button" onClick={onEdit} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={14} /> Soạn thẻ</button>}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-3 md:px-6 py-4 md:py-8">
        {/* tiến độ */}
        <div className="flex items-center gap-3 mb-4 md:mb-6">
          <div className="flex-1 flex h-2.5 rounded-full overflow-hidden bg-black/[0.05]">
            {counts.map((n, i) => n > 0 && <div key={i} title={`${BOX_LABELS[i]}: ${n}`} style={{ width: `${(n / valid.length) * 100}%`, background: BOX_COLORS[i] }} />)}
          </div>
          <span className="text-[12.5px] font-semibold text-[#1D1D1F] tabular-nums">{pct}% đã thuộc</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-5 text-[11.5px] text-[#86868B]">
          {counts.map((n, i) => (
            <span key={i} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: BOX_COLORS[i] }} />{BOX_LABELS[i]} {n}</span>
          ))}
        </div>

        {current ? (
          <>
            <div className="text-center text-[12px] text-[#86868B] mb-2">Còn {queue.length} thẻ trong lượt này{doneCount ? ` · đã ôn ${doneCount}` : ''}</div>
            <button type="button" onClick={() => setFlipped(f => !f)} className="block w-full [perspective:1600px] focus:outline-none" aria-label="Lật thẻ">
              {/* key = thẻ hiện tại: sang thẻ mới thì dựng lại ngay ở mặt trước (không lật ngược → không lộ đáp án thẻ sau) */}
              <div key={`${current.id}-${doneCount}`} className="relative w-full min-h-[300px] md:min-h-[340px] transition-transform duration-500 [transform-style:preserve-3d]" style={{ transform: flipped ? 'rotateY(180deg)' : undefined }}>
                <CardFace color={current.color} label="Câu hỏi">
                  <div className="text-[20px] md:text-[26px] font-semibold leading-snug tracking-[-0.015em] text-white text-center"><RichText text={current.front || '(trống)'} /></div>
                  <div className="absolute bottom-4 left-0 right-0 text-center text-[12px] text-white/70">Bấm hoặc nhấn Space để lật</div>
                </CardFace>
                <CardFace color={current.color} back label="Trả lời">
                  <div className="text-[15px] md:text-[17px] leading-[1.7] text-[#1D1D1F] text-left w-full max-w-[560px]"><RichText text={current.back || '(trống)'} /></div>
                </CardFace>
              </div>
            </button>
            <div className={`grid grid-cols-2 gap-3 mt-5 transition ${flipped ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <button type="button" onClick={() => answer(false)} className="h-12 rounded-[14px] bg-[#FF3B30]/10 text-[#D70015] text-[14px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#FF3B30]/[0.16] active:scale-[0.98]">
                <X size={17} /> Chưa nhớ <span className="hidden md:inline text-[11px] font-medium opacity-60">← / 1</span>
              </button>
              <button type="button" onClick={() => answer(true)} className="h-12 rounded-[14px] bg-[#34C759]/[0.14] text-[#1E7B34] text-[14px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#34C759]/[0.2] active:scale-[0.98]">
                <Check size={17} /> Đã nhớ <span className="hidden md:inline text-[11px] font-medium opacity-60">→ / 2</span>
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-[22px] bg-white p-8 text-center shadow-[0_0_0_0.5px_rgba(0,0,0,0.06)]">
            <div className="w-14 h-14 mx-auto rounded-full bg-[#34C759]/15 text-[#1E7B34] inline-flex items-center justify-center mb-3"><Check size={28} /></div>
            <div className="text-[17px] font-semibold text-[#1D1D1F]">Xong lượt ôn hôm nay</div>
            <div className="text-[13px] text-[#86868B] mt-1">Thẻ đã nhớ sẽ được hỏi lại sau 1, 3, 7, 14, 30 ngày — càng nhớ lâu càng ít hỏi.</div>
            <div className="flex flex-wrap gap-2 justify-center mt-5">
              <button type="button" onClick={() => { setQueue(shuffle(valid)); setDoneCount(0); }} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Shuffle size={14} /> Ôn lại tất cả (trộn)</button>
              <button type="button" onClick={() => { const p = {}; setProgress(p); saveProgress(docId, p); setQueue(dueCards(valid, p)); setDoneCount(0); }} className={`${BTN_SECONDARY} h-9 px-4 text-[13px]`}><RotateCcw size={14} /> Học lại từ đầu</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CardFace({ color, back = false, label, children }: { color: string; back?: boolean; label: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 rounded-[26px] [backface-visibility:hidden] flex flex-col items-center justify-center p-6 md:p-10 overflow-hidden"
      style={back
        ? { transform: 'rotateY(180deg)', background: '#FFFFFF', boxShadow: `0 0 0 2px ${color}, 0 24px 60px -24px rgba(0,0,0,0.35)` }
        : { background: `linear-gradient(145deg, ${shade(color, 0.15)} 0%, ${color} 55%, ${shade(color, -0.25)} 100%)`, boxShadow: '0 24px 60px -24px rgba(0,0,0,0.45)' }}>
      <span className={`absolute top-4 left-5 text-[11px] font-bold uppercase tracking-[0.1em] ${back ? '' : 'text-white/75'}`} style={back ? { color } : undefined}>{label}</span>
      {!back && <span className="absolute -right-10 -bottom-10 w-40 h-40 rounded-full bg-white/10" />}
      {children}
    </div>
  );
}

function EditList({ value, onChange }: { value: CardsDoc; onChange: (v: CardsDoc) => void }) {
  const [bulk, setBulk] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const cards = value.cards;
  const set = (next: FlashCard[]) => onChange({ ...value, cards: next });
  const addBulk = () => {
    const rows = bulk.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
      const [front, ...rest] = l.split(/\s*[|\t]\s*/);
      return { ...newCard(cards.length + i), front: front ?? '', back: rest.join(' | ') };
    });
    if (rows.length) set([...cards, ...rows]);
    setBulk('');
    setBulkOpen(false);
  };
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[980px] mx-auto px-3 md:px-6 py-4 md:py-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button type="button" onClick={() => set([...cards, newCard(cards.length)])} className={`${BTN_PRIMARY} h-9 px-4 text-[13px]`}><Plus size={14} /> Thêm thẻ</button>
          <button type="button" onClick={() => setBulkOpen(o => !o)} className={`${BTN_SECONDARY} h-9 px-4 text-[13px]`}><ListPlus size={14} /> Nhập nhanh nhiều thẻ</button>
          <span className="text-[12px] text-[#86868B] ml-auto">{cards.length} thẻ · tự lưu</span>
        </div>
        {bulkOpen && (
          <div className="rounded-[16px] bg-white p-3 mb-4 shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]">
            <div className="text-[12px] text-[#6E6E73] mb-1.5">Mỗi dòng 1 thẻ: <b>câu hỏi | câu trả lời</b> (dán được từ Excel — 2 cột)</div>
            <textarea value={bulk} onChange={e => setBulk(e.target.value)} rows={5} placeholder={'Vốn điều lệ tối thiểu cho thuê lại LĐ? | 2 tỷ đồng\nThời hạn GP cho thuê lại LĐ? | Tối đa 60 tháng'}
              className="w-full rounded-[10px] bg-black/[0.03] p-2.5 text-[13.5px] outline-none focus:bg-white focus:ring-2 focus:ring-[#0071E3]/30" />
            <div className="flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setBulkOpen(false)} className={`${BTN_SECONDARY} h-8 px-3.5 text-[12.5px]`}>Huỷ</button>
              <button type="button" onClick={addBulk} disabled={!bulk.trim()} className={`${BTN_PRIMARY} h-8 px-3.5 text-[12.5px]`}>Thêm vào bộ thẻ</button>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, i) => (
            <div key={c.id} className="group rounded-[18px] bg-white overflow-hidden shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_8px_20px_-14px_rgba(0,0,0,0.25)]">
              <div className="px-3 pt-2.5 pb-3 text-white" style={{ background: `linear-gradient(145deg, ${shade(c.color, 0.12)}, ${c.color})` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-white/75">Thẻ {i + 1}</span>
                  <div className="ml-auto flex gap-1">
                    {CARD_COLORS.map(col => (
                      <button key={col} type="button" aria-label="Đổi màu" onClick={() => set(cards.map(x => (x.id === c.id ? { ...x, color: col } : x)))}
                        className="w-3.5 h-3.5 rounded-full" style={{ background: col, boxShadow: col === c.color ? '0 0 0 1.5px #fff' : 'inset 0 0 0 1px rgba(255,255,255,0.4)' }} />
                    ))}
                    <button type="button" title="Xoá thẻ" onClick={() => set(cards.filter(x => x.id !== c.id))} className="ml-1 text-white/70 hover:text-white"><Trash2 size={13} /></button>
                  </div>
                </div>
                <textarea value={c.front} onChange={e => set(cards.map(x => (x.id === c.id ? { ...x, front: e.target.value } : x)))} rows={2} placeholder="Câu hỏi / từ khoá"
                  className="w-full bg-transparent outline-none resize-none text-[14.5px] font-semibold placeholder:text-white/60" />
              </div>
              <textarea value={c.back} onChange={e => set(cards.map(x => (x.id === c.id ? { ...x, back: e.target.value } : x)))} rows={4} placeholder="Câu trả lời (**đậm** ==tô vàng== !!đỏ!!)"
                className="w-full bg-transparent outline-none resize-y px-3 py-2.5 text-[13.5px] leading-relaxed text-[#1D1D1F] placeholder:text-[#AEAEB2]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CardsView({ docId, value, onChange, canEdit, toolbarExtra }: {
  docId: string; value: CardsDoc; onChange: (v: CardsDoc) => void; canEdit: boolean; toolbarExtra?: ReactNode;
}) {
  const [mode, setMode] = useState<'study' | 'edit'>(() => (canEdit && !value.cards.length ? 'edit' : 'study'));
  const [studyKey, setStudyKey] = useState(0);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 bg-[#F5F5F7]/85 backdrop-blur-xl border-b border-black/[0.05]">
        <div className="max-w-[980px] mx-auto px-3 md:px-6 h-12 flex items-center gap-2">
          <div className="inline-flex bg-[#767680]/[0.12] rounded-[9px] p-[2px]">
            {([['study', 'Ôn tập'], ...(canEdit ? [['edit', 'Danh sách thẻ']] : [])] as [typeof mode, string][]).map(([m, label]) => (
              <button key={m} type="button" onClick={() => { setMode(m); if (m === 'study') setStudyKey(k => k + 1); }}
                className={`h-7 px-3 rounded-[7px] text-[12.5px] font-medium transition ${mode === m ? 'bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)] text-[#1D1D1F]' : 'text-[#3A3A3C]'}`}>{label}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">{toolbarExtra}</div>
        </div>
      </div>
      {mode === 'study'
        ? <Study key={studyKey} docId={docId} cards={value.cards} onEdit={canEdit ? () => setMode('edit') : undefined} />
        : <EditList value={value} onChange={onChange} />}
    </div>
  );
}
