// Xuất sơ đồ tư duy: ảnh PNG / SVG / PDF (chụp đúng lớp nội dung đang vẽ) và Markdown (dàn ý chữ).
import { downloadBlob } from '../../../lib/quickNotes/pendingAudio';
import { markerEmoji, sortMarkers } from '../../../lib/quickNotes/mindmap/themes';
import type { MindMapDoc, MindTopic } from '../../../lib/quickNotes/mindmap/types';

const PAD = 40;
const MAX_SIDE = 9000;

export const safeFileName = (s: string) => (s.replace(/[\\/:*?"<>|·\n]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'So do tu duy');

/** Lớp nội dung (thẻ <g data-layer="content">) → chuỗi SVG độc lập, nền theo chủ đề màu. */
export function svgString(content: SVGGElement, bounds: { x: number; y: number; w: number; h: number }, bg: string): { svg: string; w: number; h: number } {
  const w = Math.ceil(bounds.w + PAD * 2);
  const h = Math.ceil(bounds.h + PAD * 2);
  const clone = content.cloneNode(true) as SVGGElement;
  clone.querySelectorAll('[data-hit]').forEach(el => el.removeAttribute('data-hit'));
  const body = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bounds.x - PAD} ${bounds.y - PAD} ${w} ${h}">`
    + `<rect x="${bounds.x - PAD}" y="${bounds.y - PAD}" width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
  return { svg, w, h };
}

async function svgToCanvas(svg: string, w: number, h: number, scale: number): Promise<HTMLCanvasElement> {
  const s = Math.max(0.5, Math.min(scale, MAX_SIDE / Math.max(w, h)));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(h * s);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ vẽ ảnh');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function exportPng(content: SVGGElement, bounds: { x: number; y: number; w: number; h: number }, bg: string, name: string) {
  const { svg, w, h } = svgString(content, bounds, bg);
  const canvas = await svgToCanvas(svg, w, h, 2);
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Không tạo được ảnh');
  downloadBlob(blob, `${safeFileName(name)}.png`);
}

export function exportSvg(content: SVGGElement, bounds: { x: number; y: number; w: number; h: number }, bg: string, name: string) {
  const { svg } = svgString(content, bounds, bg);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeFileName(name)}.svg`);
}

export async function exportPdf(content: SVGGElement, bounds: { x: number; y: number; w: number; h: number }, bg: string, name: string) {
  const { svg, w, h } = svgString(content, bounds, bg);
  const [canvas, { jsPDF }] = await Promise.all([svgToCanvas(svg, w, h, 2), import('jspdf')]);
  const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], hotfixes: ['px_scaling'] });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
  pdf.save(`${safeFileName(name)}.pdf`);
}

/** Sơ đồ → Markdown: chủ đề trung tâm = #, chủ đề chính = ##, nhánh sâu hơn = danh sách thụt lề; ghi chú = trích dẫn. */
export function docToMarkdown(doc: MindMapDoc): string {
  const out: string[] = [];
  const head = (t: MindTopic) => {
    const marks = sortMarkers(t.markers ?? []).map(markerEmoji).filter(Boolean).join(' ');
    const text = t.text.replace(/\s*\n\s*/g, ' ').trim();
    const link = t.link ? ` ([liên kết](${t.link}))` : '';
    const labels = t.labels?.length ? ` \`${t.labels.join('` `')}\`` : '';
    return `${marks ? `${marks} ` : ''}${text}${link}${labels}`;
  };
  const note = (t: MindTopic, indent = '') => {
    if (!t.note?.trim()) return;
    for (const l of t.note.trim().split('\n')) out.push(`${indent}> ${l}`);
  };
  const list = (t: MindTopic, depth: number) => {
    const ind = '  '.repeat(depth);
    out.push(`${ind}- ${head(t)}`);
    note(t, `${ind}  `);
    t.children.forEach(c => list(c, depth + 1));
  };
  out.push(`# ${head(doc.root)}`);
  note(doc.root);
  for (const m of doc.root.children) {
    out.push('', `## ${head(m)}`);
    note(m);
    if (m.children.length) out.push('');
    m.children.forEach(c => list(c, 0));
  }
  if (doc.floating.length) {
    out.push('', '## Chủ đề tự do');
    doc.floating.forEach(f => list(f, 0));
  }
  return `${out.join('\n')}\n`;
}

export function exportMarkdown(doc: MindMapDoc, name: string) {
  downloadBlob(new Blob([docToMarkdown(doc)], { type: 'text/markdown;charset=utf-8' }), `${safeFileName(name)}.md`);
}
