import { Search, X } from 'lucide-react';
import type { RefObject } from 'react';

/**
 * Ô tìm kiếm dùng chung cho các tab Thị trường.
 * Hiện gợi ý phím tắt "/" khi chưa gõ gì; có nút × để xoá nhanh.
 * Ref lấy từ useSlashSearch() để phím "/" nhảy đúng vào ô này.
 */
export default function SearchBox({
  value, onChange, inputRef, placeholder = 'Tìm...', className = '', width = 'w-[210px]',
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef?: RefObject<HTMLInputElement>;
  placeholder?: string;
  className?: string;
  width?: string;
}) {
  return (
    <div className={`relative ${width} ${className}`}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#aaa] pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-[12px] pl-7 pr-7 py-1.5 border border-[#E8E7E2] rounded-lg outline-none focus:border-blue-500 bg-white"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Xoá tìm kiếm (Esc)"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[#aaa] hover:text-[#666] hover:bg-gray-100"
        >
          <X size={12} />
        </button>
      ) : (
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#bbb] border border-[#E8E7E2] rounded px-1 leading-[15px] pointer-events-none">/</kbd>
      )}
    </div>
  );
}
