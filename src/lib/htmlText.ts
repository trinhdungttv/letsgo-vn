// Chuyển HTML (từ RichTextEditor — src/pages/market/RichTextEditor.tsx) sang text thường,
// dùng cho các chỗ hiển thị dạng preview/snippet không render HTML (line-clamp trên card…).
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

// Chuyển HTML sang Markdown đơn giản (đậm/nghiêng/gạch đầu dòng/đánh số/xuống dòng) — dùng
// khi xuất file .md để không lẫn thẻ HTML thô vào tài liệu xuất ra.
export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const inner = [...el.childNodes].map(walk).join('');
    switch (el.tagName) {
      case 'B': case 'STRONG': return `**${inner}**`;
      case 'I': case 'EM': return `*${inner}*`;
      case 'BR': return '\n';
      case 'LI': return `- ${inner.trim()}\n`;
      case 'UL': case 'OL': return `\n${inner}`;
      case 'P': case 'DIV': return `${inner}\n`;
      default: return inner;
    }
  };

  return [...div.childNodes].map(walk).join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
