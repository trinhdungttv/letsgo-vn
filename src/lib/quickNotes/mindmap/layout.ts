// Sơ đồ tư duy — tính kích thước + vị trí từng chủ đề, đường nhánh, vùng bao, ngoặc tóm tắt, đường liên kết.
// Thuần tính toán (đo chữ qua hàm `measure` truyền vào) → dùng chung cho màn hình, xuất ảnh, và test.
// Toạ độ "bản đồ": tâm chủ đề trung tâm ở (0, 0); chủ đề tự do đặt theo pos (cũng so với tâm đó).
import type { MindMapDoc, MindTopic, TopicShape } from './types';
import { contrastText, softColor, sortMarkers, type LevelStyle, type MindTheme } from './themes';

export type Measure = (text: string, font: string) => number;

let measureCtx: CanvasRenderingContext2D | null = null;
const measureCache = new Map<string, number>();

/** Đo chữ bằng canvas (có nhớ đệm). */
export const canvasMeasure: Measure = (text, font) => {
  const key = `${font}\u0000${text}`;
  const hit = measureCache.get(key);
  if (hit !== undefined) return hit;
  if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
  let w = text.length * 8;
  if (measureCtx) {
    measureCtx.font = font;
    w = measureCtx.measureText(text).width;
  }
  if (measureCache.size > 30000) measureCache.clear();
  measureCache.set(key, w);
  return w;
};

export const fontString = (italic: boolean, weight: number, size: number, family: string) =>
  `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;

/** Ngắt dòng theo bề rộng tối đa (giữ xuống dòng có sẵn; từ quá dài thì cắt theo ký tự). */
export function wrapText(text: string, font: string, maxW: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const tok of para.split(/(\s+)/)) {
      if (!tok) continue;
      const cand = line + tok;
      if (measure(cand, font) <= maxW) { line = cand; continue; }
      if (line.trim()) { out.push(line.trimEnd()); line = tok.trimStart(); }
      else line = tok.trimStart();
      while (measure(line, font) > maxW && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut), font) > maxW) cut -= 1;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [''];
}

// ── Kiểu dữ liệu đầu ra ─────────────────────────────────────────────────────

export interface Pt { x: number; y: number }
/** h = nhánh ngang, d = sơ đồ tổ chức (xuống dưới), t = cây thụt lề, none = không vẽ đường nối */
export type LinkMode = 'h' | 'd' | 't' | 'none';
export type KidDir = 'r' | 'l' | 'd' | 't' | 'none';

export interface TopicBox {
  id: string;
  kind: 'topic' | 'summary';
  topic: MindTopic;
  depth: number;
  parentId: string | null;
  floating: boolean;
  /** khối gồm thân + hàng nhãn */
  x: number; y: number; w: number; h: number;
  /** thân chủ đề (hình nền / viền) */
  bx: number; by: number; bw: number; bh: number;
  lines: string[];
  textCx: number; textTop: number; textW: number; lineH: number;
  family: string; size: number; weight: number; italic: boolean; strike: boolean;
  fill: string | null; stroke: string | null; strokeW: number; textColor: string; shape: TopicShape;
  color: string;
  markers: { id: string; x: number; y: number; s: number }[];
  icons: { kind: 'note' | 'link'; x: number; y: number; s: number }[];
  labels: { text: string; x: number; y: number; w: number; h: number }[];
  link: LinkMode;
  kidDir: KidDir;
  side: 1 | -1;
  hasKids: boolean;
  /** số chủ đề con cháu đang bị thu gọn */
  hidden: number;
  toggle: Pt | null;
}

export interface Connector { id: string; d: string; color: string; width: number; filled: boolean }
export interface BoundaryShape { id: string; x: number; y: number; w: number; h: number; color: string; text: string }
export interface BraceShape { id: string; d: string; color: string }
export interface RelationShape {
  id: string; from: string; to: string; d: string; arrow: string; label: Pt; text: string;
  c1: Pt; c2: Pt; s: Pt; e: Pt;
}

export interface MapLayout {
  boxes: TopicBox[];
  byId: Map<string, TopicBox>;
  connectors: Connector[];
  boundaries: BoundaryShape[];
  braces: BraceShape[];
  relations: RelationShape[];
  axis: string | null;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface LayoutOptions {
  family: string;
  /** đang gõ chữ cho chủ đề này → đo theo chữ đang gõ để khung giãn theo */
  editId?: string | null;
  editText?: string;
}

// ── Đo 1 chủ đề ─────────────────────────────────────────────────────────────

interface Sized {
  w: number; h: number; bw: number; bh: number;
  lines: string[]; textW: number; lineH: number;
  textCx: number; textTop: number;
  markers: { id: string; x: number; y: number; s: number }[];
  icons: { kind: 'note' | 'link'; x: number; y: number; s: number }[];
  labels: { text: string; w: number; h: number }[];
  labelsW: number;
  size: number; weight: number; italic: boolean; strike: boolean;
  fill: string | null; stroke: string | null; strokeW: number; textColor: string; shape: TopicShape;
}

const LABEL_H = 18;
const LABEL_GAP = 4;
const BPAD = 10;
const BLABEL = 18;

function sizeTopic(topic: MindTopic, text: string, lv: LevelStyle, color: string, theme: MindTheme, family: string, measure: Measure): Sized {
  const st = topic.style ?? {};
  const shape = st.shape ?? lv.shape;
  const size = st.size ?? lv.size;
  const weight = st.bold === true ? 700 : st.bold === false ? 400 : lv.weight;
  const italic = !!st.italic;
  const font = fontString(italic, weight, size, family);
  const res = (v: string) => (v === 'branch' ? color : v === 'branch-soft' ? softColor(color, theme.dark) : v === 'none' ? null : v);

  let fill = st.fill ? st.fill : res(lv.fill);
  let stroke = res(lv.border);
  let strokeW = lv.borderW;
  if (shape === 'underline') { stroke = stroke ?? color; strokeW = strokeW || 2; }
  if (shape === 'none') { stroke = null; strokeW = 0; fill = st.fill ?? null; }
  if (shape !== 'underline' && shape !== 'none' && !fill && !stroke) { stroke = color; strokeW = 1.5; }
  const textColor = st.color
    ?? (st.fill ? contrastText(st.fill)
      : lv.text === 'auto' ? contrastText(fill && fill.startsWith('#') ? fill : theme.bg)
        : lv.text === 'branch' ? color : lv.text);

  const lineH = Math.round(size * 1.32);
  const maxW = Math.max(lv.maxW, size * 9);
  const lines = wrapText(text, font, maxW, measure);
  const textW = Math.max(size * 0.6, ...lines.map(l => measure(l, font)));
  const ms = Math.round(size * 1.15);
  const markerIds = sortMarkers(topic.markers ?? []);
  const markersW = markerIds.length ? markerIds.length * ms + (markerIds.length - 1) * 3 + 6 : 0;
  const iconKinds: ('note' | 'link')[] = [];
  if (topic.note?.trim()) iconKinds.push('note');
  if (topic.link?.trim()) iconKinds.push('link');
  const is = Math.round(size * 0.95);
  const iconsW = iconKinds.length ? 6 + iconKinds.length * is + (iconKinds.length - 1) * 4 : 0;

  let padX = lv.padX;
  let padY = lv.padY;
  if (st.shape && st.shape !== lv.shape && (lv.shape === 'underline' || lv.shape === 'none') && shape !== 'underline' && shape !== 'none') {
    padX = Math.max(padX, Math.round(size * 0.75));
    padY = Math.max(padY, Math.round(size * 0.4));
  }
  if (shape === 'ellipse') { padX += size * 0.9; padY += size * 0.45; }
  if (shape === 'pill') padX += size * 0.3;

  const textBlockH = lines.length * lineH;
  const bw = Math.round(markersW + textW + iconsW + 2 * padX);
  const bh = Math.round(Math.max(textBlockH, ms) + 2 * padY);
  const labelFont = fontString(false, 500, 11, family);
  const labels = (topic.labels ?? []).map(t => ({ text: t, w: Math.round(measure(t, labelFont) + 14), h: LABEL_H }));
  const labelsW = labels.reduce((s, l) => s + l.w, 0) + Math.max(0, labels.length - 1) * LABEL_GAP;

  return {
    w: Math.max(bw, labelsW),
    h: bh + (labels.length ? LABEL_GAP + LABEL_H : 0),
    bw,
    bh,
    lines,
    textW,
    lineH,
    textCx: padX + markersW + textW / 2,
    textTop: (bh - textBlockH) / 2,
    markers: markerIds.map((id, i) => ({ id, x: padX + i * (ms + 3), y: (bh - ms) / 2, s: ms })),
    icons: iconKinds.map((kind, i) => ({ kind, x: padX + markersW + textW + 6 + i * (is + 4), y: (bh - is) / 2, s: is })),
    labels,
    labelsW,
    size,
    weight,
    italic,
    strike: !!st.strike,
    fill,
    stroke,
    strokeW,
    textColor,
    shape,
  };
}

// ── Cây nút trung gian ──────────────────────────────────────────────────────

interface N {
  t: MindTopic;
  kind: 'topic' | 'summary';
  depth: number;
  parentId: string | null;
  floating: boolean;
  color: string;
  kids: N[];
  sz: Sized;
  hidden: number;
  x: number; y: number;
  blockH: number; blockW: number;
  above: number; kidsH: number; kidsW: number;
  padT: number; padL: number;
  side: 1 | -1;
  link: LinkMode;
  kidDir: KidDir;
  up: boolean;
  sums: N[];
}

function countDesc(t: MindTopic): number {
  return t.children.reduce((s, c) => s + 1 + countDesc(c), 0);
}

export function layoutMap(doc: MindMapDoc, theme: MindTheme, measure: Measure, opt: LayoutOptions): MapLayout {
  const compact = !!doc.compact;
  const G = compact
    ? { root: 40, main: 26, sub: 20, vMain: 14, vSub: 6, dLevel: 34, dMain: 14, dSub: 10, tIndent: 24, tGap: 8, col: 28 }
    : { root: 60, main: 38, sub: 28, vMain: 24, vSub: 11, dLevel: 46, dMain: 24, dSub: 14, tIndent: 30, tGap: 11, col: 40 };
  const hgap = (depth: number) => (depth === 0 ? G.root : depth === 1 ? G.main : G.sub);
  const vgap = (depth: number) => (depth === 0 ? G.vMain : G.vSub);
  const rainbow = doc.rainbow ?? theme.rainbow;
  const branchFor = (i: number) => (rainbow ? theme.branch[i % theme.branch.length] : theme.mono);
  const lineStyle = doc.line ?? theme.line;
  const family = opt.family;

  const levelOf = (depth: number, floating: boolean): LevelStyle =>
    depth === 0 ? theme.root : floating && depth === 1 ? theme.floating : depth === 1 ? theme.main : theme.sub;

  const mk = (t: MindTopic, kind: N['kind'], depth: number, parentId: string | null, floating: boolean, color: string, lv: LevelStyle): N => ({
    t, kind, depth, parentId, floating, color, kids: [],
    sz: sizeTopic(t, opt.editId === t.id && opt.editText !== undefined ? opt.editText : t.text, lv, color, theme, family, measure),
    hidden: 0, x: 0, y: 0, blockH: 0, blockW: 0, above: 0, kidsH: 0, kidsW: 0, padT: 0, padL: 0,
    side: 1, link: 'none', kidDir: 'none', up: false, sums: [],
  });

  const build = (t: MindTopic, depth: number, parentId: string | null, floating: boolean, color: string): N => {
    const c = t.style?.branch ?? color;
    const n = mk(t, 'topic', depth, parentId, floating, c, levelOf(depth, floating));
    if (t.collapsed) n.hidden = countDesc(t);
    else n.kids = t.children.map((k, i) => build(k, depth + 1, t.id, floating, depth === 0 && !floating ? branchFor(i) : c));
    return n;
  };

  const bpad = (n: N) => (n.t.boundary && n.depth > 0 ? { t: BPAD + (n.t.boundary.text ? BLABEL : 0), s: BPAD } : { t: 0, s: 0 });

  // ── ngang (sơ đồ logic / toả 2 bên) ──
  const measureH = (n: N) => {
    n.kids.forEach(measureH);
    n.kidsH = n.kids.length ? n.kids.reduce((s, k) => s + k.blockH, 0) + vgap(n.depth) * (n.kids.length - 1) : 0;
    const half = n.sz.bh / 2;
    const up = Math.max(half, n.kidsH / 2);
    const down = Math.max(n.sz.h - half, n.kidsH / 2);
    const p = bpad(n);
    n.above = up + p.t;
    n.blockH = up + down + p.t + p.s;
  };
  const placeH = (n: N, edge: number, top: number, side: 1 | -1) => {
    const cy = top + n.above;
    n.side = side;
    n.kidDir = side > 0 ? 'r' : 'l';
    n.x = side > 0 ? edge : edge - n.sz.w;
    n.y = cy - n.sz.bh / 2;
    let ky = cy - n.kidsH / 2;
    const kEdge = side > 0 ? n.x + n.sz.w + hgap(n.depth) : n.x - hgap(n.depth);
    for (const k of n.kids) {
      k.link = 'h';
      placeH(k, kEdge, ky, side);
      ky += k.blockH + vgap(n.depth);
    }
  };

  // ── xuống dưới (sơ đồ tổ chức) ──
  const measureD = (n: N) => {
    n.kids.forEach(measureD);
    const gap = n.depth === 0 ? G.dMain : G.dSub;
    n.kidsW = n.kids.length ? n.kids.reduce((s, k) => s + k.blockW, 0) + gap * (n.kids.length - 1) : 0;
    const p = bpad(n);
    n.padT = p.t;
    n.padL = p.s;
    n.blockW = Math.max(n.sz.w, n.kidsW) + 2 * p.s;
  };
  const placeD = (n: N, left: number, top: number) => {
    n.kidDir = 'd';
    const gap = n.depth === 0 ? G.dMain : G.dSub;
    const innerL = left + n.padL;
    const innerW = n.blockW - 2 * n.padL;
    n.x = innerL + (innerW - n.sz.w) / 2;
    n.y = top + n.padT;
    let kx = innerL + (innerW - n.kidsW) / 2;
    const ky = n.y + n.sz.h + G.dLevel;
    for (const k of n.kids) {
      k.link = 'd';
      placeD(k, kx, ky);
      kx += k.blockW + gap;
    }
  };

  // ── cây thụt lề ──
  const measureT = (n: N) => {
    n.kids.forEach(measureT);
    const p = bpad(n);
    let h = n.sz.h;
    let w = n.sz.w;
    for (const k of n.kids) { h += G.tGap + k.blockH; w = Math.max(w, G.tIndent + k.blockW); }
    n.padT = p.t;
    n.padL = p.s;
    n.blockH = h + p.t + p.s;
    n.blockW = w + 2 * p.s;
  };
  const placeT = (n: N, left: number, top: number) => {
    n.kidDir = 't';
    n.x = left + n.padL;
    n.y = top + n.padT;
    let cy = n.y + n.sz.h + G.tGap;
    for (const k of n.kids) {
      k.link = 't';
      placeT(k, n.x + G.tIndent, cy);
      cy += k.blockH + G.tGap;
    }
  };

  // ── Dựng + đặt cây chính ──
  const root = build(doc.root, 0, null, false, theme.mono);
  root.kidDir = 'none';
  const structure = doc.structure;
  let axis: string | null = null;

  if (structure === 'map' || structure === 'right' || structure === 'left') {
    root.x = -root.sz.w / 2;
    root.y = -root.sz.bh / 2;
    const n = root.kids.length;
    const split = structure === 'map' ? Math.ceil(n / 2) : structure === 'right' ? n : 0;
    const sides: [N[], 1 | -1][] = [[root.kids.slice(0, split), 1], [root.kids.slice(split).reverse(), -1]];
    for (const [kids, side] of sides) {
      if (!kids.length) continue;
      kids.forEach(measureH);
      const total = kids.reduce((s, k) => s + k.blockH, 0) + G.vMain * (kids.length - 1);
      let y = -total / 2;
      const edge = side > 0 ? root.x + root.sz.w + G.root : root.x - G.root;
      for (const k of kids) {
        k.link = 'h';
        placeH(k, edge, y, side);
        y += k.blockH + G.vMain;
      }
    }
    root.kidDir = structure === 'left' ? 'l' : structure === 'right' ? 'r' : 'none';
  } else if (structure === 'org') {
    measureD(root);
    placeD(root, 0, 0);
  } else if (structure === 'tree') {
    root.kidDir = 'd';
    root.x = -root.sz.w / 2;
    root.y = -root.sz.bh / 2;
    root.kids.forEach(measureT);
    const total = root.kids.reduce((s, k) => s + k.blockW, 0) + G.dMain * Math.max(0, root.kids.length - 1);
    let x = -total / 2;
    const y = root.y + root.sz.h + G.dLevel;
    for (const k of root.kids) {
      k.link = 'd';
      placeT(k, x, y);
      x += k.blockW + G.dMain;
    }
  } else {
    // dòng thời gian: chủ đề chính nằm trên trục ngang, nhánh con treo xen kẽ dưới / trên
    root.x = -root.sz.w / 2;
    root.y = -root.sz.bh / 2;
    let x = root.x + root.sz.w + G.col + 8;
    const drop = 26;
    root.kids.forEach((m, i) => {
      m.link = 'none';
      m.kidDir = 't';
      m.x = x;
      m.y = -m.sz.bh / 2;
      m.up = i % 2 === 1;
      m.kids.forEach(measureT);
      const kidsH = m.kids.reduce((s, k) => s + k.blockH, 0) + G.tGap * Math.max(0, m.kids.length - 1);
      let y = m.up ? m.y - drop - kidsH : m.y + m.sz.h + drop;
      let colW = m.sz.w;
      for (const k of m.kids) {
        k.link = 't';
        placeT(k, m.x + G.tIndent * 0.6, y);
        y += k.blockH + G.tGap;
        colW = Math.max(colW, G.tIndent * 0.6 + k.blockW);
      }
      x += colW + G.col;
    });
    axis = `M${root.x + root.sz.w},0H${Math.max(x - G.col + 24, root.x + root.sz.w + 60)}`;
  }

  // Đưa tâm chủ đề trung tâm về (0, 0)
  const all = (n: N, out: N[] = []) => { out.push(n); n.kids.forEach(k => all(k, out)); return out; };
  {
    const cx = root.x + root.sz.bw / 2 + (root.sz.w - root.sz.bw) / 2;
    const cy = root.y + root.sz.bh / 2;
    for (const n of all(root)) { n.x -= cx; n.y -= cy; }
  }

  // ── Tóm tắt (ngoặc }): đặt sau cùng, từ nhánh sâu lên ──
  const braces: BraceShape[] = [];
  type Ext = { x1: number; y1: number; x2: number; y2: number };
  const ext = (n: N): Ext => {
    let e: Ext = { x1: n.x, y1: n.y, x2: n.x + n.sz.w, y2: n.y + n.sz.h };
    const add = (o: Ext) => { e = { x1: Math.min(e.x1, o.x1), y1: Math.min(e.y1, o.y1), x2: Math.max(e.x2, o.x2), y2: Math.max(e.y2, o.y2) }; };
    n.kids.forEach(k => add(ext(k)));
    n.sums.forEach(s => add({ x1: s.x, y1: s.y, x2: s.x + s.sz.w, y2: s.y + s.sz.h }));
    if (n.t.boundary && n.depth > 0) {
      add({ x1: e.x1 - BPAD, y1: e.y1 - BPAD - (n.t.boundary.text ? BLABEL : 0), x2: e.x2 + BPAD, y2: e.y2 + BPAD });
    }
    return e;
  };
  const placeSummaries = (n: N) => {
    n.kids.forEach(placeSummaries);
    if (!n.t.summaries?.length || !n.kids.length) return;
    for (const s of n.t.summaries) {
      const a = n.kids.findIndex(k => k.t.id === s.from);
      const b = n.kids.findIndex(k => k.t.id === s.to);
      if (a < 0 || b < 0) continue;
      const covered = n.kids.slice(Math.min(a, b), Math.max(a, b) + 1);
      const link = covered[0].link;
      if (link === 'none' || covered.some(k => k.side !== covered[0].side)) continue;
      const e = covered.map(ext).reduce((p, q) => ({ x1: Math.min(p.x1, q.x1), y1: Math.min(p.y1, q.y1), x2: Math.max(p.x2, q.x2), y2: Math.max(p.y2, q.y2) }));
      const color = covered[0].color;
      const sn = mk({ id: s.id, text: s.text, children: [] }, 'summary', n.depth + 1, n.t.id, n.floating, color, theme.summary);
      const BW = 12;
      if (link === 'd') {
        const y0 = e.y2 + 6;
        const mid = (e.x1 + e.x2) / 2;
        braces.push({ id: s.id, d: braceV(e.x1, e.x2, y0, BW), color });
        sn.x = mid - sn.sz.w / 2;
        sn.y = y0 + BW + 8;
        sn.kidDir = 'd';
      } else {
        const side = link === 't' ? 1 : covered[0].side;
        const mid = (e.y1 + e.y2) / 2;
        const x0 = side > 0 ? e.x2 + 6 : e.x1 - 6;
        braces.push({ id: s.id, d: braceH(x0, e.y1, e.y2, BW * side), color });
        sn.x = side > 0 ? x0 + BW + 8 : x0 - BW - 8 - sn.sz.w;
        sn.y = mid - sn.sz.bh / 2;
        sn.side = side as 1 | -1;
        sn.kidDir = side > 0 ? 'r' : 'l';
      }
      n.sums.push(sn);
    }
  };
  placeSummaries(root);

  // ── Chủ đề tự do ──
  const floats: N[] = doc.floating.map((fl, i) => {
    const n = build(fl, 1, null, true, branchFor(i + doc.root.children.length));
    measureH(n);
    placeH(n, 0, 0, 1);
    const p = fl.pos ?? { x: 0, y: 200 };
    const dx = p.x - (n.x + n.sz.bw / 2);
    const dy = p.y - (n.y + n.sz.bh / 2);
    for (const m of all(n)) { m.x += dx; m.y += dy; }
    placeSummaries(n);
    return n;
  });

  // ── Chuyển thành TopicBox ──
  const boxes: TopicBox[] = [];
  const byId = new Map<string, TopicBox>();
  const anchorY = (b: TopicBox) => (b.shape === 'underline' ? b.by + b.bh : b.by + b.bh / 2);

  const toBox = (n: N): TopicBox => {
    const s = n.sz;
    const center = n.depth === 0 || n.link === 'd' || n.kidDir === 'd';
    const alignRight = !center && (n.kidDir === 'l' || (n.link === 'h' && n.side < 0) || (n.kind === 'summary' && n.side < 0));
    const offX = alignRight ? s.w - s.bw : center ? (s.w - s.bw) / 2 : 0;
    const bx = n.x + offX;
    const by = n.y;
    let lx = alignRight ? n.x + s.w - s.labelsW : center ? n.x + (s.w - s.labelsW) / 2 : n.x;
    const ly = by + s.bh + LABEL_GAP;
    const labels = s.labels.map(l => { const o = { text: l.text, x: lx, y: ly, w: l.w, h: l.h }; lx += l.w + LABEL_GAP; return o; });
    const b: TopicBox = {
      id: n.t.id, kind: n.kind, topic: n.t, depth: n.depth, parentId: n.parentId, floating: n.floating,
      x: n.x, y: n.y, w: s.w, h: s.h, bx, by, bw: s.bw, bh: s.bh,
      lines: s.lines, textCx: bx + s.textCx, textTop: by + s.textTop, textW: s.textW, lineH: s.lineH,
      family, size: s.size, weight: s.weight, italic: s.italic, strike: s.strike,
      fill: s.fill, stroke: s.stroke, strokeW: s.strokeW, textColor: s.textColor, shape: s.shape,
      color: n.color,
      markers: s.markers.map(m => ({ ...m, x: bx + m.x, y: by + m.y })),
      icons: s.icons.map(m => ({ ...m, x: bx + m.x, y: by + m.y })),
      labels,
      link: n.link, kidDir: n.kidDir, side: n.side,
      hasKids: n.t.children.length > 0 && n.kind === 'topic',
      hidden: n.hidden,
      toggle: null,
    };
    if (b.hasKids && n.depth > 0) {
      const ay = anchorY(b);
      const up = n.up;
      b.toggle = n.kidDir === 'r' ? { x: bx + b.bw + 10, y: ay }
        : n.kidDir === 'l' ? { x: bx - 10, y: ay }
          : n.kidDir === 'd' ? { x: bx + b.bw / 2, y: n.y + s.h + 10 }
            : n.kidDir === 't' ? { x: bx + Math.min(14, b.bw / 2), y: up ? by - 10 : n.y + s.h + 9 } : null;
    }
    return b;
  };

  const connectors: Connector[] = [];
  const lineW = theme.lineW;
  const widthFor = (depth: number) => (depth <= 1 ? lineW * 1.35 : depth === 2 ? lineW : Math.max(1, lineW * 0.8));

  const connect = (p: TopicBox, c: TopicBox, parentN: N) => {
    const color = theme.lineColor ?? c.color;
    const width = widthFor(c.depth);
    if (c.link === 'h') {
      const side = c.side;
      const fromRoot = p.depth === 0 && !p.floating;
      const sx = fromRoot && lineStyle === 'curve' ? p.bx + p.bw / 2 : side > 0 ? p.bx + p.bw : p.bx;
      const sy = fromRoot ? p.by + p.bh / 2 : anchorY(p);
      const ex = side > 0 ? c.bx : c.bx + c.bw;
      const ey = anchorY(c);
      if (fromRoot && theme.taper && lineStyle === 'curve') {
        connectors.push({ id: c.id, d: taperH(sx, sy, ex, ey, Math.max(5, lineW * 3.2), Math.max(1.5, lineW * 0.9)), color, width: 0, filled: true });
        return;
      }
      const d = lineStyle === 'curve' ? curveH(sx, sy, ex, ey) : lineStyle === 'elbow' ? elbowH(sx, sy, ex, ey) : `M${sx},${sy}L${ex},${ey}`;
      connectors.push({ id: c.id, d, color, width, filled: false });
    } else if (c.link === 'd') {
      const sx = p.bx + p.bw / 2;
      const sy = p.depth === 0 && !parentN.floating ? p.by + p.bh : p.y + p.h;
      const ex = c.bx + c.bw / 2;
      const ey = c.by;
      const d = lineStyle === 'curve' ? curveV(sx, sy, ex, ey) : lineStyle === 'elbow' ? elbowV(sx, sy, ex, ey) : `M${sx},${sy}L${ex},${ey}`;
      connectors.push({ id: c.id, d, color, width, filled: false });
    } else if (c.link === 't') {
      const above = c.by + c.bh / 2 < p.by;
      const sx = p.bx + Math.min(14, p.bw / 2);
      const sy = above ? p.by : p.by + p.bh;
      const ex = c.bx;
      const ey = anchorY(c);
      const d = lineStyle === 'curve' ? `M${sx},${sy}Q${sx},${ey} ${ex},${ey}` : lineStyle === 'straight' ? `M${sx},${sy}L${ex},${ey}` : elbowT(sx, sy, ex, ey);
      connectors.push({ id: c.id, d, color, width, filled: false });
    }
  };

  const emit = (n: N, parent: { box: TopicBox; n: N } | null) => {
    const b = toBox(n);
    boxes.push(b);
    byId.set(b.id, b);
    if (parent) connect(parent.box, b, parent.n);
    n.kids.forEach(k => emit(k, { box: b, n }));
    n.sums.forEach(s => { const sb = toBox(s); boxes.push(sb); byId.set(sb.id, sb); });
  };
  emit(root, null);
  floats.forEach(f => emit(f, null));

  // ── Vùng bao ──
  const boundaries: BoundaryShape[] = [];
  const boundaryOf = (n: N) => {
    n.kids.forEach(boundaryOf);
    if (n.kind !== 'topic' || !n.t.boundary || n.depth === 0) return;
    const e = ext({ ...n, t: { ...n.t, boundary: undefined } });
    const text = n.t.boundary.text;
    boundaries.push({
      id: n.t.id,
      x: e.x1 - BPAD + 2,
      y: e.y1 - BPAD + 2 - (text ? BLABEL - 2 : 0),
      w: e.x2 - e.x1 + 2 * BPAD - 4,
      h: e.y2 - e.y1 + 2 * BPAD - 4 + (text ? BLABEL - 2 : 0),
      color: n.color,
      text,
    });
  };
  boundaryOf(root);
  floats.forEach(boundaryOf);

  // ── Đường liên kết ──
  const relations: RelationShape[] = [];
  for (const r of doc.relations) {
    const a = byId.get(r.from);
    const b = byId.get(r.to);
    if (!a || !b) continue;
    relations.push(relationShape(r.id, r.from, r.to, r.text, a, b));
  }

  // ── Khung bao toàn sơ đồ ──
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  const grow = (ax: number, ay: number, bx: number, by: number) => {
    x1 = Math.min(x1, ax); y1 = Math.min(y1, ay); x2 = Math.max(x2, bx); y2 = Math.max(y2, by);
  };
  boxes.forEach(b => grow(b.x - 14, b.y - 4, b.x + b.w + 14, b.y + b.h + 14));
  boundaries.forEach(b => grow(b.x, b.y, b.x + b.w, b.y + b.h));
  relations.forEach(r => [r.s, r.e, r.c1, r.c2].forEach(p => grow(p.x, p.y, p.x, p.y)));
  if (axis) {
    const m = axis.match(/H(-?[\d.]+)/);
    if (m) grow(0, -4, Number(m[1]) + 12, 4);
  }
  if (!Number.isFinite(x1)) { x1 = -100; y1 = -50; x2 = 100; y2 = 50; }

  return { boxes, byId, connectors, boundaries, braces, relations, axis, bounds: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } };
}

// ── Hình học đường nối ──────────────────────────────────────────────────────

const f = (n: number) => Math.round(n * 10) / 10;

function curveH(sx: number, sy: number, ex: number, ey: number): string {
  const mx = sx + (ex - sx) / 2;
  return `M${f(sx)},${f(sy)}C${f(mx)},${f(sy)} ${f(mx)},${f(ey)} ${f(ex)},${f(ey)}`;
}

function curveV(sx: number, sy: number, ex: number, ey: number): string {
  const my = sy + (ey - sy) / 2;
  return `M${f(sx)},${f(sy)}C${f(sx)},${f(my)} ${f(ex)},${f(my)} ${f(ex)},${f(ey)}`;
}

function taperH(sx: number, sy: number, ex: number, ey: number, w0: number, w1: number): string {
  const mx = sx + (ex - sx) * 0.42;
  const a = w0 / 2;
  const b = w1 / 2;
  return `M${f(sx)},${f(sy - a)}C${f(mx)},${f(sy - a)} ${f(mx)},${f(ey - b)} ${f(ex)},${f(ey - b)}`
    + `L${f(ex)},${f(ey + b)}C${f(mx)},${f(ey + b)} ${f(mx)},${f(sy + a)} ${f(sx)},${f(sy + a)}Z`;
}

function elbowH(sx: number, sy: number, ex: number, ey: number): string {
  const dy = ey - sy;
  if (Math.abs(dy) < 1) return `M${f(sx)},${f(sy)}L${f(ex)},${f(ey)}`;
  const mx = sx + (ex - sx) / 2;
  const r = Math.min(8, Math.abs(dy) / 2, Math.abs(ex - sx) / 2);
  const hx = Math.sign(ex - sx) || 1;
  const vy = Math.sign(dy);
  return `M${f(sx)},${f(sy)}H${f(mx - hx * r)}Q${f(mx)},${f(sy)} ${f(mx)},${f(sy + vy * r)}V${f(ey - vy * r)}Q${f(mx)},${f(ey)} ${f(mx + hx * r)},${f(ey)}H${f(ex)}`;
}

function elbowV(sx: number, sy: number, ex: number, ey: number): string {
  const dx = ex - sx;
  if (Math.abs(dx) < 1) return `M${f(sx)},${f(sy)}L${f(ex)},${f(ey)}`;
  const my = sy + (ey - sy) / 2;
  const r = Math.min(8, Math.abs(dx) / 2, Math.abs(ey - sy) / 2);
  const vy = Math.sign(ey - sy) || 1;
  const hx = Math.sign(dx);
  return `M${f(sx)},${f(sy)}V${f(my - vy * r)}Q${f(sx)},${f(my)} ${f(sx + hx * r)},${f(my)}H${f(ex - hx * r)}Q${f(ex)},${f(my)} ${f(ex)},${f(my + vy * r)}V${f(ey)}`;
}

function elbowT(sx: number, sy: number, ex: number, ey: number): string {
  const vy = Math.sign(ey - sy) || 1;
  const r = Math.min(8, Math.abs(ey - sy), Math.abs(ex - sx));
  return `M${f(sx)},${f(sy)}V${f(ey - vy * r)}Q${f(sx)},${f(ey)} ${f(sx + r)},${f(ey)}H${f(ex)}`;
}

/** Ngoặc } dọc: x0 = sát nhánh, mũi nhọn hướng theo dấu của bw. */
function braceH(x0: number, y1: number, y2: number, bw: number): string {
  const xm = x0 + bw / 2;
  const x1 = x0 + bw;
  const mid = (y1 + y2) / 2;
  const r = Math.min(8, Math.max(1, (y2 - y1) / 4));
  return `M${f(x0)},${f(y1)}Q${f(xm)},${f(y1)} ${f(xm)},${f(y1 + r)}L${f(xm)},${f(mid - r)}Q${f(xm)},${f(mid)} ${f(x1)},${f(mid)}`
    + `Q${f(xm)},${f(mid)} ${f(xm)},${f(mid + r)}L${f(xm)},${f(y2 - r)}Q${f(xm)},${f(y2)} ${f(x0)},${f(y2)}`;
}

/** Ngoặc nằm ngang bên dưới (sơ đồ tổ chức). */
function braceV(x1: number, x2: number, y0: number, bh: number): string {
  const ym = y0 + bh / 2;
  const y1 = y0 + bh;
  const mid = (x1 + x2) / 2;
  const r = Math.min(8, Math.max(1, (x2 - x1) / 4));
  return `M${f(x1)},${f(y0)}Q${f(x1)},${f(ym)} ${f(x1 + r)},${f(ym)}L${f(mid - r)},${f(ym)}Q${f(mid)},${f(ym)} ${f(mid)},${f(y1)}`
    + `Q${f(mid)},${f(ym)} ${f(mid + r)},${f(ym)}L${f(x2 - r)},${f(ym)}Q${f(x2)},${f(ym)} ${f(x2)},${f(y0)}`;
}

/** Điểm trên viền hình chữ nhật b theo hướng từ tâm b tới p. */
function edgePoint(b: TopicBox, p: Pt): Pt {
  const cx = b.bx + b.bw / 2;
  const cy = b.by + b.bh / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? (b.bw / 2 + 3) / Math.abs(dx) : Infinity;
  const sy = dy ? (b.bh / 2 + 3) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function relationShape(id: string, from: string, to: string, text: string, a: TopicBox, b: TopicBox): RelationShape {
  const p1 = { x: a.bx + a.bw / 2, y: a.by + a.bh / 2 };
  const p2 = { x: b.bx + b.bw / 2, y: b.by + b.bh / 2 };
  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  const len = Math.hypot(vx, vy) || 1;
  const nx = -vy / len;
  const ny = vx / len;
  const off = Math.min(150, len * 0.32);
  const c1 = { x: p1.x + vx * 0.25 + nx * off, y: p1.y + vy * 0.25 + ny * off };
  const c2 = { x: p1.x + vx * 0.75 + nx * off, y: p1.y + vy * 0.75 + ny * off };
  const s = edgePoint(a, c1);
  const e = edgePoint(b, c2);
  const ax = e.x - c2.x;
  const ay = e.y - c2.y;
  const al = Math.hypot(ax, ay) || 1;
  const ux = ax / al;
  const uy = ay / al;
  const k = 9;
  const arrow = `M${f(e.x - ux * k - uy * k * 0.55)},${f(e.y - uy * k + ux * k * 0.55)}L${f(e.x)},${f(e.y)}L${f(e.x - ux * k + uy * k * 0.55)},${f(e.y - uy * k - ux * k * 0.55)}`;
  const t = 0.5;
  const mt = 1 - t;
  const label = {
    x: mt ** 3 * s.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * e.x,
    y: mt ** 3 * s.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * e.y,
  };
  return {
    id, from, to, text, arrow, label, c1, c2, s, e,
    d: `M${f(s.x)},${f(s.y)}C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(e.x)},${f(e.y)}`,
  };
}

// ── Tra cứu trên bố cục ─────────────────────────────────────────────────────

/** Chủ đề dưới điểm p (toạ độ bản đồ); trùng nhiều cái thì lấy cái nhỏ nhất. */
export function hitTest(layout: MapLayout, p: Pt, pad = 0, skip?: Set<string>): TopicBox | null {
  let best: TopicBox | null = null;
  for (const b of layout.boxes) {
    if (skip?.has(b.id)) continue;
    if (p.x < b.x - pad || p.x > b.x + b.w + pad || p.y < b.y - pad || p.y > b.y + b.h + pad) continue;
    if (!best || b.w * b.h < best.w * best.h) best = b;
  }
  return best;
}

/** Phím mũi tên: chọn chủ đề gần nhất theo hướng đó trên màn hình. */
export function navigate(layout: MapLayout, fromId: string, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): string | null {
  const a = layout.byId.get(fromId);
  if (!a) return null;
  const ax = a.bx + a.bw / 2;
  const ay = a.by + a.bh / 2;
  let best: { id: string; score: number } | null = null;
  for (const b of layout.boxes) {
    if (b.id === fromId) continue;
    const bx = b.bx + b.bw / 2;
    const by = b.by + b.bh / 2;
    let main: number;
    let cross: number;
    if (key === 'ArrowRight') { main = b.bx - (a.bx + a.bw); cross = Math.abs(by - ay); if (bx <= ax + 1) continue; }
    else if (key === 'ArrowLeft') { main = a.bx - (b.bx + b.bw); cross = Math.abs(by - ay); if (bx >= ax - 1) continue; }
    else if (key === 'ArrowDown') { main = b.by - (a.by + a.bh); cross = Math.abs(bx - ax); if (by <= ay + 1) continue; }
    else { main = a.by - (b.by + b.bh); cross = Math.abs(bx - ax); if (by >= ay - 1) continue; }
    // ưu tiên chủ đề cùng cha / cha-con khi đi theo hàng
    const related = b.parentId === a.parentId || b.parentId === a.id || a.parentId === b.id;
    const score = Math.max(0, main) + cross * 2.2 - (related ? 24 : 0);
    if (!best || score < best.score) best = { id: b.id, score };
  }
  return best?.id ?? null;
}
