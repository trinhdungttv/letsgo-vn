import { useEffect, useRef } from 'react';

/**
 * Phím tắt "/" để nhảy vào ô tìm kiếm (giống Khách hàng), "Esc" để xoá và thoát.
 *
 * Chỉ bắt phím khi con trỏ KHÔNG nằm trong ô nhập liệu — tránh cướp dấu "/" lúc
 * người dùng đang gõ đường dẫn, ghi chú… Hook tự gỡ listener khi tab bị đóng nên
 * mỗi lúc chỉ có đúng tab đang mở phản hồi phím tắt.
 *
 * Dùng: const searchRef = useSlashSearch(() => setSearch(''));
 *       <input ref={searchRef} ... />
 */
export function useSlashSearch(onEscape?: () => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const escRef = useRef(onEscape);
  escRef.current = onEscape;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const typing = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag || ''));

      if (typing) {
        // Đang gõ trong chính ô tìm kiếm: Esc = xoá nội dung rồi nhả focus.
        if (e.key === 'Escape' && el === inputRef.current) {
          escRef.current?.();
          inputRef.current?.blur();
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return inputRef;
}

/** Bỏ dấu tiếng Việt + về chữ thường, để "bien hoa" khớp được "Biên Hoà". */
export function normalizeVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Khớp không dấu, không phân biệt hoa thường, trên nhiều trường cùng lúc. */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalizeVi(query);
  if (!q) return true;
  return fields.some(f => f && normalizeVi(f).includes(q));
}
