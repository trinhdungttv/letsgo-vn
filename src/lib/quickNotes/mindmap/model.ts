// Sơ đồ tư duy — các phép biến đổi thuần (không đụng React) trên MindMapDoc: thêm / xoá / di chuyển chủ đề, thu gọn,
// liên kết, vùng bao, tóm tắt, sao chép – dán, chuyển dàn ý chữ ⇄ sơ đồ. Mọi hàm trả về doc MỚI (không sửa doc cũ)
// để hoàn tác / làm lại chỉ cần giữ các bản cũ.
import { DEFAULT_THEME, uid } from './parse';
import type { MindMapDoc, MindRelation, MindSummary, MindTopic, TopicStyle } from './types';

export { parseDoc, uid } from './parse';

export const ROOT_DEFAULT = 'Chủ đề trung tâm';
export const MAIN_DEFAULT = 'Chủ đề chính';
export const SUB_DEFAULT = 'Chủ đề con';
export const FLOAT_DEFAULT = 'Chủ đề tự do';
export const PARENT_DEFAULT = 'Chủ đề';
export const SUMMARY_DEFAULT = 'Tóm tắt';

export const newTopic = (text: string, extra: Partial<MindTopic> = {}): MindTopic => ({ id: uid(), text, children: [], ...extra });

/** Sơ đồ trống giống XMind: chủ đề trung tâm + 4 chủ đề chính. */
export function defaultDoc(title = ROOT_DEFAULT): MindMapDoc {
  return {
    v: 1,
    root: { id: uid(), text: title, children: [1, 2, 3, 4].map(i => newTopic(`${MAIN_DEFAULT} ${i}`)) },
    floating: [],
    relations: [],
    structure: 'map',
    theme: DEFAULT_THEME,
  };
}

const clone = <T>(v: T): T => structuredClone(v);

/** Sửa trên bản sao rồi trả bản sao. */
export function edit(doc: MindMapDoc, fn: (d: MindMapDoc) => void): MindMapDoc {
  const d = clone(doc);
  fn(d);
  return d;
}

// ── Tìm kiếm trong cây ──────────────────────────────────────────────────────

export interface TopicRef {
  topic: MindTopic;
  /** null = chủ đề trung tâm hoặc chủ đề tự do cấp đầu */
  parent: MindTopic | null;
  index: number;
  depth: number;
  /** thuộc 1 cây chủ đề tự do */
  floating: boolean;
}

export function walk(doc: MindMapDoc, fn: (r: TopicRef) => void): void {
  const go = (t: MindTopic, parent: MindTopic | null, index: number, depth: number, floating: boolean) => {
    fn({ topic: t, parent, index, depth, floating });
    t.children.forEach((c, i) => go(c, t, i, depth + 1, floating));
  };
  go(doc.root, null, 0, 0, false);
  doc.floating.forEach((f, i) => go(f, null, i, 1, true));
}

export function findTopic(doc: MindMapDoc, id: string): TopicRef | null {
  let hit: TopicRef | null = null;
  walk(doc, r => { if (!hit && r.topic.id === id) hit = r; });
  return hit;
}

export function findSummary(doc: MindMapDoc, id: string): { parent: MindTopic; summary: MindSummary } | null {
  let hit: { parent: MindTopic; summary: MindSummary } | null = null;
  walk(doc, r => {
    const s = r.topic.summaries?.find(x => x.id === id);
    if (s && !hit) hit = { parent: r.topic, summary: s };
  });
  return hit;
}

export function subtreeIds(t: MindTopic, out = new Set<string>()): Set<string> {
  out.add(t.id);
  t.children.forEach(c => subtreeIds(c, out));
  return out;
}

export const isRoot = (doc: MindMapDoc, id: string) => doc.root.id === id;

/** id có nằm trong nhánh của ancestorId (kể cả chính nó) */
export function isInSubtree(doc: MindMapDoc, ancestorId: string, id: string): boolean {
  const r = findTopic(doc, ancestorId);
  return !!r && subtreeIds(r.topic).has(id);
}

/** Bỏ các id nằm trong nhánh của 1 id khác cũng đang chọn (di chuyển / xoá cả nhánh cha là đủ). */
export function topLevelOnly(doc: MindMapDoc, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter(id => {
    let cur = findTopic(doc, id);
    while (cur?.parent) {
      if (set.has(cur.parent.id)) return false;
      cur = findTopic(doc, cur.parent.id);
    }
    return !!findTopic(doc, id);
  });
}

export function countTopics(doc: MindMapDoc): number {
  let n = 0;
  walk(doc, () => { n += 1; });
  return n;
}

function defaultChildText(parent: MindTopic, depth: number): string {
  return `${depth <= 1 ? MAIN_DEFAULT : SUB_DEFAULT} ${parent.children.length + 1}`;
}

// ── Thêm chủ đề ─────────────────────────────────────────────────────────────

export function addChild(doc: MindMapDoc, parentId: string, text?: string): { doc: MindMapDoc; id: string | null } {
  const id = uid();
  let ok = false;
  const next = edit(doc, d => {
    const r = findTopic(d, parentId);
    if (!r) return;
    r.topic.collapsed = false;
    r.topic.children.push({ id, text: text ?? defaultChildText(r.topic, r.depth + 1), children: [] });
    ok = true;
  });
  return ok ? { doc: next, id } : { doc, id: null };
}

/** Enter = chủ đề cùng cấp phía sau, Shift+Enter = phía trước. Chủ đề trung tâm → thêm chủ đề con. */
export function addSibling(doc: MindMapDoc, id: string, before = false): { doc: MindMapDoc; id: string | null } {
  const r = findTopic(doc, id);
  if (!r) return { doc, id: null };
  if (!r.parent && !r.floating) return addChild(doc, id);
  const nid = uid();
  const next = edit(doc, d => {
    const cur = findTopic(d, id)!;
    if (!cur.parent) {
      const p = cur.topic.pos ?? { x: 0, y: 0 };
      d.floating.splice(cur.index + (before ? 0 : 1), 0, { id: nid, text: FLOAT_DEFAULT, children: [], pos: { x: p.x, y: p.y + (before ? -70 : 70) } });
      return;
    }
    cur.parent.children.splice(cur.index + (before ? 0 : 1), 0, { id: nid, text: defaultChildText(cur.parent, cur.depth), children: [] });
  });
  return { doc: next, id: nid };
}

/** Chèn 1 chủ đề cha mới vào giữa chủ đề này và cha của nó (Ctrl/⌘ + Enter). */
export function insertParent(doc: MindMapDoc, id: string): { doc: MindMapDoc; id: string | null } {
  const r = findTopic(doc, id);
  if (!r || (!r.parent && !r.floating)) return { doc, id: null };
  const nid = uid();
  const next = edit(doc, d => {
    const cur = findTopic(d, id)!;
    const old = cur.topic;
    if (!cur.parent) {
      const wrap: MindTopic = { id: nid, text: PARENT_DEFAULT, children: [old], pos: old.pos };
      delete old.pos;
      d.floating[cur.index] = wrap;
      return;
    }
    cur.parent.children[cur.index] = { id: nid, text: PARENT_DEFAULT, children: [old] };
    for (const s of cur.parent.summaries ?? []) {
      if (s.from === id) s.from = nid;
      if (s.to === id) s.to = nid;
    }
  });
  return { doc: next, id: nid };
}

export function addFloating(doc: MindMapDoc, pos: { x: number; y: number }, text = FLOAT_DEFAULT): { doc: MindMapDoc; id: string } {
  const id = uid();
  return { doc: edit(doc, d => { d.floating.push({ id, text, children: [], pos: { x: Math.round(pos.x), y: Math.round(pos.y) } }); }), id };
}

// ── Gỡ / xoá / di chuyển ────────────────────────────────────────────────────

/** Gỡ 1 chủ đề khỏi chỗ cũ (đã là bản sao đang sửa), co giãn lại các tóm tắt của cha cũ. */
function detach(d: MindMapDoc, id: string): MindTopic | null {
  const r = findTopic(d, id);
  if (!r || (!r.parent && !r.floating)) return null;
  if (!r.parent) {
    d.floating.splice(r.index, 1);
    return r.topic;
  }
  const parent = r.parent;
  const before = parent.children.map(c => c.id);
  parent.children.splice(r.index, 1);
  if (parent.summaries?.length) {
    const left = new Set(parent.children.map(c => c.id));
    parent.summaries = parent.summaries.flatMap(s => {
      const a = before.indexOf(s.from);
      const b = before.indexOf(s.to);
      const inRange = before.slice(Math.min(a, b), Math.max(a, b) + 1).filter(x => left.has(x));
      return inRange.length ? [{ ...s, from: inRange[0], to: inRange[inRange.length - 1] }] : [];
    });
    if (!parent.summaries.length) delete parent.summaries;
  }
  return r.topic;
}

function dropDanglingRelations(d: MindMapDoc) {
  const alive = new Set<string>();
  walk(d, r => { alive.add(r.topic.id); });
  d.relations = d.relations.filter(x => alive.has(x.from) && alive.has(x.to));
}

/**
 * Xoá chủ đề (không xoá được chủ đề trung tâm) / tóm tắt. Trả về chủ đề nên chọn tiếp:
 * chủ đề cùng cấp phía sau, không có thì phía trước, không có nữa thì chủ đề cha (như XMind).
 */
export function removeTopics(doc: MindMapDoc, ids: string[]): { doc: MindMapDoc; next: string | null } {
  const summaryIds = ids.filter(id => findSummary(doc, id));
  const targets = topLevelOnly(doc, ids.filter(id => !isRoot(doc, id) && !summaryIds.includes(id)));
  if (!targets.length && !summaryIds.length) return { doc, next: null };

  let next: string | null = null;
  const first = targets[0] ? findTopic(doc, targets[0]) : null;
  if (first) {
    const sibs = first.parent ? first.parent.children : doc.floating;
    const gone = new Set(targets);
    next = sibs.slice(first.index + 1).find(s => !gone.has(s.id))?.id
      ?? sibs.slice(0, first.index).reverse().find(s => !gone.has(s.id))?.id
      ?? first.parent?.id ?? doc.root.id;
  } else if (summaryIds[0]) {
    next = findSummary(doc, summaryIds[0])?.parent.id ?? null;
  }

  const out = edit(doc, d => {
    for (const id of targets) detach(d, id);
    for (const sid of summaryIds) {
      const hit = findSummary(d, sid);
      if (!hit) continue;
      hit.parent.summaries = hit.parent.summaries!.filter(s => s.id !== sid);
      if (!hit.parent.summaries.length) delete hit.parent.summaries;
    }
    dropDanglingRelations(d);
  });
  return { doc: out, next };
}

/**
 * Đưa các chủ đề vào làm con của targetId tại vị trí index (tính theo danh sách con HIỆN TẠI của target).
 * Bỏ qua nếu thả vào chính nhánh của mình.
 */
export function moveTopics(doc: MindMapDoc, ids: string[], targetId: string, index?: number): MindMapDoc {
  const moving = topLevelOnly(doc, ids.filter(id => !isRoot(doc, id)));
  if (!moving.length) return doc;
  if (moving.some(id => isInSubtree(doc, id, targetId))) return doc;
  return edit(doc, d => {
    const target = findTopic(d, targetId);
    if (!target) return;
    const movingSet = new Set(moving);
    const kids = target.topic.children;
    const anchor = index === undefined ? null : kids.slice(index).find(c => !movingSet.has(c.id))?.id ?? null;
    const nodes = moving.map(id => detach(d, id)).filter((x): x is MindTopic => !!x);
    nodes.forEach(n => { delete n.pos; });
    const t = findTopic(d, targetId)!.topic;
    const at = anchor ? t.children.findIndex(c => c.id === anchor) : t.children.length;
    t.children.splice(at < 0 ? t.children.length : at, 0, ...nodes);
    t.collapsed = false;
  });
}

/** Kéo chủ đề ra chỗ trống → thành chủ đề tự do (như XMind). */
export function makeFloating(doc: MindMapDoc, ids: string[], pos: { x: number; y: number }): MindMapDoc {
  const moving = topLevelOnly(doc, ids.filter(id => !isRoot(doc, id)));
  if (!moving.length) return doc;
  return edit(doc, d => {
    moving.forEach((id, i) => {
      const r = findTopic(d, id);
      if (!r) return;
      const p = { x: Math.round(pos.x), y: Math.round(pos.y + i * 56) };
      if (!r.parent) { r.topic.pos = p; return; }
      const n = detach(d, id);
      if (n) d.floating.push({ ...n, pos: p });
    });
  });
}

export function setFloatingPos(doc: MindMapDoc, moves: { id: string; x: number; y: number }[]): MindMapDoc {
  return edit(doc, d => {
    for (const m of moves) {
      const f = d.floating.find(x => x.id === m.id);
      if (f) f.pos = { x: Math.round(m.x), y: Math.round(m.y) };
    }
  });
}

/** Đổi thứ tự với chủ đề cùng cấp (Alt + ↑/↓). */
export function reorder(doc: MindMapDoc, id: string, delta: -1 | 1): MindMapDoc {
  const r = findTopic(doc, id);
  if (!r?.parent) return doc;
  const to = r.index + delta;
  if (to < 0 || to >= r.parent.children.length) return doc;
  return edit(doc, d => {
    const p = findTopic(d, id)!.parent!;
    const [n] = p.children.splice(r.index, 1);
    p.children.splice(to, 0, n);
  });
}

// ── Sửa nội dung / định dạng ────────────────────────────────────────────────

export function updateTopics(doc: MindMapDoc, ids: string[], fn: (t: MindTopic) => void): MindMapDoc {
  const set = new Set(ids);
  return edit(doc, d => { walk(d, r => { if (set.has(r.topic.id)) fn(r.topic); }); });
}

/** Đặt chữ cho chủ đề hoặc tóm tắt. */
export function setText(doc: MindMapDoc, id: string, text: string): MindMapDoc {
  if (findSummary(doc, id)) {
    return edit(doc, d => { const h = findSummary(d, id); if (h) h.summary.text = text; });
  }
  return updateTopics(doc, [id], t => { t.text = text; });
}

export function setStyle(doc: MindMapDoc, ids: string[], patch: Partial<TopicStyle>): MindMapDoc {
  return updateTopics(doc, ids, t => {
    const s: TopicStyle = { ...(t.style ?? {}), ...patch };
    for (const k of Object.keys(s) as (keyof TopicStyle)[]) if (s[k] === undefined || s[k] === '') delete s[k];
    if (Object.keys(s).length) t.style = s;
    else delete t.style;
  });
}

/** Mỗi nhóm biểu tượng chỉ giữ 1 cái (như XMind): bấm lại đúng cái đang có → bỏ. */
export function toggleMarker(doc: MindMapDoc, ids: string[], marker: string): MindMapDoc {
  const group = marker.split('-')[0];
  const all = ids.map(id => findTopic(doc, id)?.topic).filter((t): t is MindTopic => !!t);
  const allHave = all.length > 0 && all.every(t => t.markers?.includes(marker));
  return updateTopics(doc, ids, t => {
    const rest = (t.markers ?? []).filter(m => m.split('-')[0] !== group);
    const next = allHave ? rest : [...rest, marker];
    if (next.length) t.markers = next;
    else delete t.markers;
  });
}

export function toggleCollapse(doc: MindMapDoc, ids: string[], value?: boolean): MindMapDoc {
  const withKids = ids.map(id => findTopic(doc, id)?.topic).filter((t): t is MindTopic => !!t && t.children.length > 0);
  if (!withKids.length) return doc;
  const v = value ?? !withKids.every(t => t.collapsed);
  return updateTopics(doc, withKids.map(t => t.id), t => { if (v) t.collapsed = true; else delete t.collapsed; });
}

/** Thu gọn tới cấp `level` (1 = chỉ còn chủ đề chính); level = Infinity → mở hết. */
export function collapseToLevel(doc: MindMapDoc, level: number): MindMapDoc {
  return edit(doc, d => {
    walk(d, r => {
      if (!r.topic.children.length) return;
      if (r.depth >= level) r.topic.collapsed = true;
      else delete r.topic.collapsed;
    });
  });
}

/** Mở các chủ đề cha đang thu gọn để thấy được chủ đề id. */
export function revealTopic(doc: MindMapDoc, id: string): MindMapDoc {
  const chain: string[] = [];
  let cur = findTopic(doc, id);
  while (cur?.parent) {
    if (cur.parent.collapsed) chain.push(cur.parent.id);
    cur = findTopic(doc, cur.parent.id);
  }
  return chain.length ? updateTopics(doc, chain, t => { delete t.collapsed; }) : doc;
}

// ── Liên kết / vùng bao / tóm tắt ───────────────────────────────────────────

export function addRelation(doc: MindMapDoc, from: string, to: string): { doc: MindMapDoc; id: string | null } {
  if (from === to || !findTopic(doc, from) || !findTopic(doc, to)) return { doc, id: null };
  const dup = doc.relations.find(r => (r.from === from && r.to === to) || (r.from === to && r.to === from));
  if (dup) return { doc, id: dup.id };
  const id = uid();
  return { doc: edit(doc, d => { d.relations.push({ id, from, to, text: '' }); }), id };
}

export function updateRelation(doc: MindMapDoc, id: string, patch: Partial<MindRelation>): MindMapDoc {
  return edit(doc, d => { const r = d.relations.find(x => x.id === id); if (r) Object.assign(r, patch); });
}

export function removeRelations(doc: MindMapDoc, ids: string[]): MindMapDoc {
  const set = new Set(ids);
  return edit(doc, d => { d.relations = d.relations.filter(r => !set.has(r.id)); });
}

export function toggleBoundary(doc: MindMapDoc, ids: string[]): MindMapDoc {
  const ok = ids.filter(id => !isRoot(doc, id));
  const all = ok.map(id => findTopic(doc, id)?.topic).filter((t): t is MindTopic => !!t);
  if (!all.length) return doc;
  const remove = all.every(t => t.boundary);
  return updateTopics(doc, ok, t => { if (remove) delete t.boundary; else t.boundary = t.boundary ?? { text: '' }; });
}

export function setBoundaryText(doc: MindMapDoc, id: string, text: string): MindMapDoc {
  return updateTopics(doc, [id], t => { if (t.boundary) t.boundary = { text }; });
}

/** Tóm tắt các chủ đề đang chọn (phải cùng 1 cha) — dấu ngoặc } bao từ chủ đề đầu tới cuối. */
export function addSummary(doc: MindMapDoc, ids: string[]): { doc: MindMapDoc; id: string | null } {
  const refs = ids.map(id => findTopic(doc, id)).filter((r): r is TopicRef => !!r?.parent);
  if (!refs.length) return { doc, id: null };
  const parentId = refs[0].parent!.id;
  const same = refs.filter(r => r.parent!.id === parentId).sort((a, b) => a.index - b.index);
  const id = uid();
  const next = edit(doc, d => {
    const p = findTopic(d, parentId)!.topic;
    p.summaries = [...(p.summaries ?? []), { id, from: same[0].topic.id, to: same[same.length - 1].topic.id, text: SUMMARY_DEFAULT }];
  });
  return { doc: next, id };
}

// ── Sao chép / dán ──────────────────────────────────────────────────────────

/** Gán mã mới cho cả nhánh (dán / nhân bản) — giữ đúng tóm tắt bên trong nhánh. */
function reid(t: MindTopic): MindTopic {
  const map = new Map<string, string>();
  const go = (x: MindTopic): MindTopic => {
    const nid = uid();
    map.set(x.id, nid);
    const kids = x.children.map(go);
    const out: MindTopic = { ...clone(x), id: nid, children: kids };
    delete out.pos;
    if (x.summaries) {
      out.summaries = x.summaries.map(s => ({ ...s, id: uid(), from: map.get(s.from) ?? s.from, to: map.get(s.to) ?? s.to }));
    }
    return out;
  };
  return go(t);
}

export function copyTopics(doc: MindMapDoc, ids: string[]): MindTopic[] {
  return topLevelOnly(doc, ids).map(id => clone(findTopic(doc, id)!.topic)).map(t => { delete t.pos; return t; });
}

export function pasteTopics(doc: MindMapDoc, parentId: string, topics: MindTopic[]): { doc: MindMapDoc; ids: string[] } {
  if (!topics.length || !findTopic(doc, parentId)) return { doc, ids: [] };
  const fresh = topics.map(reid);
  const next = edit(doc, d => {
    const p = findTopic(d, parentId)!.topic;
    p.children.push(...fresh);
    p.collapsed = false;
  });
  return { doc: next, ids: fresh.map(t => t.id) };
}

// ── Dàn ý chữ ⇄ sơ đồ ───────────────────────────────────────────────────────

const BULLET_RE = /^(?:[-*+•●○◦▪▫–—>]|\d{1,3}[.)]|\[[ xX]\])\s+/;
const BOX_RE = /^([☐☑])\s?/;
const HEADING_RE = /^(#{1,6})\s+/;

function cleanTail(text: string): string {
  return text.replace(/\s*[:：]\s*$/, '').trim();
}

/**
 * Chữ nhiều dòng → các chủ đề. Cấp được suy từ: tiêu đề Markdown (#, ##…), thụt đầu dòng (tab / dấu cách), và dòng
 * gạch đầu dòng / ô ☐ ngay sau 1 dòng thường thì thành con của dòng đó ("Việc cần làm:" + "☐ Gọi khách"…).
 * Ô ☐ / ☑ → biểu tượng tiến độ 0% / 100%.
 */
export function outlineToTopics(text: string): MindTopic[] {
  type Item = { key: number; topic: MindTopic };
  const out: MindTopic[] = [];
  const stack: Item[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const expanded = raw.replace(/\t/g, '    ');
    const indent = expanded.length - expanded.trimStart().length;
    let line = expanded.trim();
    let key: number;
    const h = line.match(HEADING_RE);
    let marker: string | null = null;
    if (h) {
      key = h[1].length * 1000;
      line = line.slice(h[0].length);
    } else {
      let bullet = false;
      const b = line.match(BOX_RE);
      if (b) { marker = b[1] === '☑' ? 'task-100' : 'task-0'; line = line.slice(b[0].length); bullet = true; }
      const m = line.match(BULLET_RE);
      if (m) {
        if (/^\[[xX]\]/.test(m[0])) marker = 'task-100';
        else if (m[0].startsWith('[')) marker = 'task-0';
        line = line.slice(m[0].length);
        bullet = true;
      }
      key = 10000 + indent * 10 + (bullet ? 1 : 0);
    }
    const topic = newTopic(line.trim());
    if (marker) topic.markers = [marker];
    while (stack.length && stack[stack.length - 1].key >= key) stack.pop();
    if (stack.length) stack[stack.length - 1].topic.children.push(topic);
    else out.push(topic);
    stack.push({ key, topic });
  }
  const tidy = (t: MindTopic) => {
    if (t.children.length) t.text = cleanTail(t.text) || t.text;
    t.children.forEach(tidy);
  };
  out.forEach(tidy);
  return out;
}

/** Tạo sơ đồ từ nội dung ghi chú: dòng đầu = chủ đề trung tâm, các dòng sau = nhánh. Trống → sơ đồ mẫu. */
export function docFromText(body: string): MindMapDoc {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex(l => l.trim());
  if (first === -1) return defaultDoc();
  const title = lines[first].trim().replace(HEADING_RE, '').replace(BOX_RE, '').replace(BULLET_RE, '');
  const rest = lines.slice(first + 1).join('\n');
  const doc = defaultDoc(cleanTail(title) || ROOT_DEFAULT);
  doc.root.children = outlineToTopics(rest);
  return doc;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

function taskBox(t: MindTopic): string | null {
  const m = t.markers?.find(x => x.startsWith('task-'));
  if (!m) return null;
  return m === 'task-100' ? '☑' : '☐';
}

/** Sơ đồ → dàn ý chữ (chèn lại vào ghi chú văn bản): dòng đầu là chủ đề trung tâm, nhánh thụt 2 dấu cách. */
export function docToOutline(doc: MindMapDoc): string {
  const lines: string[] = [oneLine(doc.root.text)];
  const go = (t: MindTopic, depth: number) => {
    const box = taskBox(t);
    lines.push(`${'  '.repeat(depth)}${box ? `${box} ` : '- '}${oneLine(t.text)}`);
    t.children.forEach(c => go(c, depth + 1));
  };
  doc.root.children.forEach(c => go(c, 0));
  doc.floating.forEach(f => go(f, 0));
  return lines.join('\n');
}

/** Văn bản thuần của 1 nhóm chủ đề (khi sao chép ra ngoài). */
export function topicsToText(topics: MindTopic[]): string {
  const lines: string[] = [];
  const go = (t: MindTopic, depth: number) => {
    lines.push(`${'\t'.repeat(depth)}${oneLine(t.text)}`);
    t.children.forEach(c => go(c, depth + 1));
  };
  topics.forEach(t => go(t, 0));
  return lines.join('\n');
}

/** Mọi chữ trong sơ đồ (chủ đề, ghi chú, nhãn, tóm tắt, liên kết) — cho ô tìm ghi chú. */
export function docText(doc: MindMapDoc): string {
  const parts: string[] = [];
  walk(doc, r => {
    parts.push(r.topic.text);
    if (r.topic.note) parts.push(r.topic.note);
    if (r.topic.labels?.length) parts.push(r.topic.labels.join(' '));
    if (r.topic.boundary?.text) parts.push(r.topic.boundary.text);
    r.topic.summaries?.forEach(s => parts.push(s.text));
  });
  doc.relations.forEach(r => { if (r.text) parts.push(r.text); });
  return parts.join('\n');
}
