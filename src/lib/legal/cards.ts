// Pháp lý — "Thẻ ghi nhớ" (flashcard): mặt trước câu hỏi, mặt sau câu trả lời; ôn theo HỘP NHỚ Leitner
// (nhớ → lên hộp, lâu mới hỏi lại; quên → về hộp 1). Nội dung thẻ lưu ở legal_docs.content (kind = 'cards'),
// tiến độ ôn lưu riêng từng máy (localStorage) — mỗi người tự ôn, không ghi đè nhau. Thuần, có test (cards.test.ts).
import type { MindMapDoc, MindTopic } from '../quickNotes/mindmap/types';
import { CALLOUT_TONES, type LessonDoc } from './lesson';
import { rid } from './types';

export interface FlashCard { id: string; front: string; back: string; color: string }
export interface CardsDoc { v: 1; cards: FlashCard[] }

export const CARD_COLORS = ['#0071E3', '#AF52DE', '#FF9500', '#34C759', '#FF2D55', '#30B0C7', '#5856D6', '#A2845E'] as const;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function parseCards(raw: unknown): CardsDoc {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cards = (Array.isArray(r.cards) ? r.cards : [])
    .filter(c => c && typeof c === 'object')
    .map((c, i) => {
      const o = c as Record<string, unknown>;
      return { id: str(o.id) || rid(), front: str(o.front), back: str(o.back), color: /^#[0-9a-f]{6}$/i.test(str(o.color)) ? str(o.color) : CARD_COLORS[i % CARD_COLORS.length] };
    });
  return { v: 1, cards };
}

export function newCard(index: number): FlashCard {
  return { id: rid(), front: '', back: '', color: CARD_COLORS[index % CARD_COLORS.length] };
}

// ── Tạo thẻ tự động ────────────────────────────────────────────────────────

/**
 * Từ sơ đồ tư duy: mỗi chủ đề có nhánh con → 1 thẻ. Mặt trước = đường dẫn ("Thành lập › Hồ sơ cần có"),
 * mặt sau = các nhánh con (gạch đầu dòng, kèm cấp cháu thụt vào). Màu thẻ theo nhánh chính.
 */
export function cardsFromMindmap(doc: MindMapDoc, maxCards = 80): FlashCard[] {
  const out: FlashCard[] = [];
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const lines = (t: MindTopic, depth: number): string[] =>
    t.children.flatMap(c => [`${'  '.repeat(depth)}• ${clean(c.text)}`, ...(depth < 1 ? lines(c, depth + 1) : [])]);
  const visit = (t: MindTopic, path: string[], color: string) => {
    if (out.length >= maxCards) return;
    const here = [...path, clean(t.text)].filter(Boolean);
    if (t.children.length) {
      out.push({ id: rid(), front: here.length > 2 ? `${here[0]} › … › ${here[here.length - 1]}` : here.join(' › '), back: lines(t, 0).join('\n'), color });
    }
    t.children.forEach(c => visit(c, here, color));
  };
  const root = doc.root;
  if (root.children.length) out.push({ id: rid(), front: clean(root.text), back: lines(root, 0).join('\n'), color: CARD_COLORS[0] });
  root.children.forEach((c, i) => visit(c, [clean(root.text)], c.style?.branch || CARD_COLORS[(i + 1) % CARD_COLORS.length]));
  doc.floating.forEach((f, i) => visit(f, [], CARD_COLORS[(i + 3) % CARD_COLORS.length]));
  return out.slice(0, maxCards);
}

/** Từ bài học: mỗi khối màu có tiêu đề → 1 thẻ; mỗi khối "Các bước" → 1 thẻ "Các bước: …". */
export function cardsFromLesson(doc: LessonDoc, title: string): FlashCard[] {
  const out: FlashCard[] = [];
  let section = title.trim();
  for (const b of doc.blocks) {
    if (b.t === 'h' && b.text.trim()) section = b.text.trim();
    if (b.t === 'callout' && b.text.trim()) {
      const tone = CALLOUT_TONES[b.tone];
      out.push({ id: rid(), front: `${b.title.trim() || tone.label}${section ? ` — ${section}` : ''}`, back: b.text.trim(), color: tone.color });
    }
    if (b.t === 'steps' && b.items.some(i => i.title.trim() || i.text.trim())) {
      out.push({
        id: rid(), front: `Các bước${section ? `: ${section}` : ''}`,
        back: b.items.map((i, n) => `${n + 1}. ${[i.title.trim(), i.text.trim()].filter(Boolean).join(' — ')}`).join('\n'), color: '#0071E3',
      });
    }
    if (b.t === 'check' && b.items.some(i => i.text.trim())) {
      out.push({ id: rid(), front: `Cần chuẩn bị gì${section ? ` — ${section}` : ''}?`, back: b.items.filter(i => i.text.trim()).map(i => `• ${i.text.trim()}`).join('\n'), color: '#34C759' });
    }
  }
  return out;
}

// ── Ôn tập theo hộp nhớ (Leitner) ─────────────────────────────────────────

/** Hộp 1..5 → hỏi lại sau bấy nhiêu ngày khi nhớ. */
export const BOX_DAYS = [0, 1, 3, 7, 14, 30] as const;
export const MAX_BOX = 5;

export interface CardProgress { box: number; due: number; seen: number; ok: number }
export type Progress = Record<string, CardProgress>;

const DAY = 86_400_000;

export function review(p: CardProgress | undefined, remembered: boolean, now = Date.now()): CardProgress {
  const cur = p ?? { box: 0, due: 0, seen: 0, ok: 0 };
  const box = remembered ? Math.min(MAX_BOX, Math.max(1, cur.box + 1)) : 1;
  // quên → hỏi lại ngay trong lượt (10 phút), nhớ → theo hộp
  const due = remembered ? now + BOX_DAYS[box] * DAY : now + 10 * 60_000;
  return { box, due, seen: cur.seen + 1, ok: cur.ok + (remembered ? 1 : 0) };
}

/** Thẻ cần ôn bây giờ: thẻ mới + thẻ đến hạn; đến hạn lâu nhất / hộp thấp trước. */
export function dueCards(cards: FlashCard[], progress: Progress, now = Date.now()): FlashCard[] {
  return cards
    .filter(c => (c.front.trim() || c.back.trim()) && (!progress[c.id] || progress[c.id].due <= now))
    .sort((a, b) => {
      const pa = progress[a.id], pb = progress[b.id];
      if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
      return pa.box - pb.box || pa.due - pb.due;
    });
}

/** Đếm số thẻ ở từng hộp (0 = chưa học). */
export function boxCounts(cards: FlashCard[], progress: Progress): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const c of cards) counts[progress[c.id]?.box ?? 0] += 1;
  return counts;
}

/** % đã thuộc: thẻ từ hộp 3 trở lên. */
export function masteredPct(cards: FlashCard[], progress: Progress): number {
  if (!cards.length) return 0;
  return Math.round((cards.filter(c => (progress[c.id]?.box ?? 0) >= 3).length / cards.length) * 100);
}

const key = (docId: string) => `legal-cards:${docId}`;
export function loadProgress(docId: string): Progress {
  try {
    const raw = localStorage.getItem(key(docId));
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === 'object' ? p as Progress : {};
  } catch {
    return {};
  }
}
export function saveProgress(docId: string, p: Progress): void {
  try { localStorage.setItem(key(docId), JSON.stringify(p)); } catch { /* chế độ riêng tư */ }
}
