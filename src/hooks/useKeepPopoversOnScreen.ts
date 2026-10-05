import { useEffect } from 'react';

// Menu thả xuống (popover) trong app đều là khối `absolute bg-white shadow-*` neo theo nút
// bấm (thường `right-0`, rộng cố định 200–320px). Trên điện thoại nút nằm sát mép trái thì
// menu neo phải bị lòi ra ngoài màn hình (từng gặp ở Pipeline "Cột", mốc Timeline…).
// Theo dõi DOM: khối nổi nào vừa hiện ra mà vượt mép thì dịch ngang (thuộc tính `translate`,
// không đụng `transform` của Tailwind) và giới hạn bề rộng cho vừa màn hình.
const MARGIN = 8;
const SELECTOR = '.absolute.bg-white[class*="shadow"]';

function keepOnScreen(el: HTMLElement) {
  if (!el.matches(SELECTOR)) return;
  el.style.translate = '';
  const W = window.innerWidth;
  let r = el.getBoundingClientRect();
  if (!r.width || r.width < 120) return;
  if (r.width > W - MARGIN * 2) {
    el.style.maxWidth = `${W - MARGIN * 2}px`;
    r = el.getBoundingClientRect();
  }
  let dx = 0;
  if (r.left < MARGIN) dx = MARGIN - r.left;
  else if (r.right > W - MARGIN) dx = W - MARGIN - r.right;
  if (dx) el.style.translate = `${Math.round(dx)}px 0`;
}

export function useKeepPopoversOnScreen() {
  useEffect(() => {
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        m.addedNodes.forEach(n => {
          if (!(n instanceof HTMLElement)) return;
          keepOnScreen(n);
          n.querySelectorAll<HTMLElement>(SELECTOR).forEach(keepOnScreen);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
}
