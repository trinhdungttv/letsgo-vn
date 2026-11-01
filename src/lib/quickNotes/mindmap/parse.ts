// Sơ đồ tư duy — đọc dữ liệu cột quick_notes.mindmap (phòng dữ liệu hỏng / phiên bản cũ). Tách riêng khỏi model.ts
// vì file này nằm trong gói chính của app (api.ts dùng khi tải ghi chú), còn trình vẽ sơ đồ chỉ tải khi mở.
import {
  LINE_STYLES, MAP_FONTS, STRUCTURES, TOPIC_SHAPES, type MindMapDoc, type MindTopic, type TopicStyle,
} from './types';

export const DEFAULT_THEME = 'rainbow';

export function uid(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

const walkAll = (doc: MindMapDoc, fn: (t: MindTopic) => void) => {
  const go = (t: MindTopic) => { fn(t); t.children.forEach(go); };
  go(doc.root);
  doc.floating.forEach(go);
};

const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');

function parseTopic(raw: unknown, seen: Set<string>, depth = 0): MindTopic | null {
  if (!raw || typeof raw !== 'object' || depth > 60) return null;
  const r = raw as Record<string, unknown>;
  let id = str(r.id, 64) || uid();
  if (seen.has(id)) id = uid();
  seen.add(id);
  const t: MindTopic = {
    id,
    text: str(r.text),
    children: Array.isArray(r.children)
      ? r.children.map(c => parseTopic(c, seen, depth + 1)).filter((x): x is MindTopic => !!x) : [],
  };
  if (r.collapsed === true) t.collapsed = true;
  if (r.style && typeof r.style === 'object') {
    const s = r.style as Record<string, unknown>;
    const st: TopicStyle = {};
    if (str(s.fill, 40)) st.fill = str(s.fill, 40);
    if (str(s.color, 40)) st.color = str(s.color, 40);
    if (str(s.branch, 40)) st.branch = str(s.branch, 40);
    if (TOPIC_SHAPES.includes(s.shape as never)) st.shape = s.shape as TopicStyle['shape'];
    if (typeof s.size === 'number' && s.size >= 9 && s.size <= 72) st.size = s.size;
    if (s.bold === true || s.bold === false) st.bold = s.bold;
    if (s.italic === true) st.italic = true;
    if (s.strike === true) st.strike = true;
    if (Object.keys(st).length) t.style = st;
  }
  if (Array.isArray(r.markers)) {
    const m = r.markers.filter((x): x is string => typeof x === 'string').slice(0, 12);
    if (m.length) t.markers = m;
  }
  if (str(r.note, 20000)) t.note = str(r.note, 20000);
  if (str(r.link, 2000)) t.link = str(r.link, 2000);
  if (Array.isArray(r.labels)) {
    const l = r.labels.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.slice(0, 60)).slice(0, 10);
    if (l.length) t.labels = l;
  }
  if (r.boundary && typeof r.boundary === 'object') t.boundary = { text: str((r.boundary as Record<string, unknown>).text, 200) };
  if (Array.isArray(r.summaries)) {
    const kids = new Set(t.children.map(c => c.id));
    const s = r.summaries.flatMap(x => {
      const o = (x ?? {}) as Record<string, unknown>;
      const from = str(o.from, 64);
      const to = str(o.to, 64);
      return kids.has(from) && kids.has(to) ? [{ id: str(o.id, 64) || uid(), from, to, text: str(o.text, 500) }] : [];
    });
    if (s.length) t.summaries = s;
  }
  if (r.pos && typeof r.pos === 'object') {
    const p = r.pos as Record<string, unknown>;
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) t.pos = { x: Number(p.x), y: Number(p.y) };
  }
  return t;
}

export function parseDoc(raw: unknown): MindMapDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const root = parseTopic(r.root, seen);
  if (!root) return null;
  delete root.pos;
  const floating = Array.isArray(r.floating)
    ? r.floating.map(f => parseTopic(f, seen)).filter((x): x is MindTopic => !!x).map(f => ({ ...f, pos: f.pos ?? { x: 0, y: 200 } }))
    : [];
  const doc: MindMapDoc = {
    v: 1,
    root,
    floating,
    relations: [],
    structure: STRUCTURES.includes(r.structure as never) ? (r.structure as MindMapDoc['structure']) : 'map',
    theme: str(r.theme, 40) || DEFAULT_THEME,
  };
  if (LINE_STYLES.includes(r.line as never)) doc.line = r.line as MindMapDoc['line'];
  if (MAP_FONTS.includes(r.font as never)) doc.font = r.font as MindMapDoc['font'];
  if (r.rainbow === true || r.rainbow === false) doc.rainbow = r.rainbow;
  if (r.compact === true) doc.compact = true;
  const ids = new Set<string>();
  walkAll(doc, t => { ids.add(t.id); });
  if (Array.isArray(r.relations)) {
    doc.relations = r.relations.flatMap(x => {
      const o = (x ?? {}) as Record<string, unknown>;
      const from = str(o.from, 64);
      const to = str(o.to, 64);
      return ids.has(from) && ids.has(to) && from !== to ? [{ id: str(o.id, 64) || uid(), from, to, text: str(o.text, 500) }] : [];
    });
  }
  return doc;
}
