import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Bold, Italic, List, ListOrdered, Indent, Outdent, Highlighter, Type, ChevronUp, ChevronDown } from 'lucide-react';

// Editor rich text tối giản (contentEditable + execCommand) — dán nội dung có định dạng
// sẵn (đậm, màu, gạch đầu dòng, thụt lề…) từ nơi khác vào giữ nguyên định dạng đó, thay vì
// rơi hết về chữ thường như <textarea>. Lưu dưới dạng HTML đã lọc (DOMPurify) trong cột text.
const HIGHLIGHT_COLORS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA'];

// Nội dung dán vào thường mang theo font riêng của nguồn gốc (Google Sans, Arial…) qua
// style="font-family: …" hoặc thẻ <font face="…">. Bóc hết để toàn bộ nội dung luôn dùng
// đúng 1 font chuẩn của hệ thống (Inter) — vừa đẹp vừa dễ đọc, không lẫn font lạ giữa các đoạn.
function stripFontFamily(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll<HTMLElement>('[style]').forEach(el => { el.style.removeProperty('font-family'); });
  div.querySelectorAll('font[face]').forEach(el => el.removeAttribute('face'));
  return div.innerHTML;
}

export default function RichTextEditor({ value, onChange, placeholder, rows = 6 }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Số dòng hiển thị mặc định (giống <textarea rows>). Quá số dòng này thì cuộn trong ô,
   * ô KHÔNG tự cao thêm — người dùng kéo mép dưới để nới rộng nếu muốn. */
  rows?: number;
}) {
  // ~6 dòng: mỗi dòng 13px × leading-relaxed (1.625) ≈ 21px + padding trên/dưới (py-2.5 = 20px).
  const boxHeight = Math.round(rows * 13 * 1.625 + 20);
  const didInitHeight = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  // Khởi tạo khác `value` (kể cả rỗng) để lần render đầu LUÔN đổ nội dung đã lưu vào DOM —
  // trước đây khởi tạo bằng chính `value` nên effect dưới bỏ qua bước đổ ban đầu, khiến nội
  // dung đã lưu trong DB không hiện ra khi mở lại (tưởng nhầm là "mất khi F5").
  const lastValue = useRef<string | undefined>(undefined);
  const [showToolbar, setShowToolbar] = useState(false);

  useEffect(() => {
    const clean = stripFontFamily(DOMPurify.sanitize(value));
    if (ref.current && lastValue.current !== value && ref.current.innerHTML !== clean) {
      ref.current.innerHTML = clean;
      lastValue.current = value;
    }
  }, [value]);

  // Đặt chiều cao mặc định 1 LẦN khi mount (không qua React style) — để khi người dùng kéo
  // mép dưới nới rộng, chiều cao đó do trình duyệt quản lý và KHÔNG bị reset mỗi lần gõ phím.
  useEffect(() => {
    if (ref.current && !didInitHeight.current) {
      ref.current.style.height = boxHeight + 'px';
      didInitHeight.current = true;
    }
  }, [boxHeight]);

  const exec = (cmd: string, val?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    handleInput();
  };

  const handleInput = () => {
    const html = ref.current?.innerHTML || '';
    lastValue.current = html;
    onChange(html);
  };

  // Dán từ nơi khác (vd trợ lý AI, Word, trang web) — lấy đúng HTML đã copy (giữ đậm/màu/
  // gạch đầu dòng/thụt lề), lọc qua DOMPurify để chặn script/style độc hại rồi mới chèn vào.
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const clean = stripFontFamily(html ? DOMPurify.sanitize(html) : DOMPurify.sanitize(text.replace(/\n/g, '<br>')));
    document.execCommand('insertHTML', false, clean);
    handleInput();
  };

  const isEmpty = !value || value === '<br>';

  return (
    <div className="relative">
      <div className="flex items-center gap-0.5 px-2 py-1 bg-[#FBFBF9] border-b border-[#F0EEE9] flex-wrap">
        <button
          type="button"
          onClick={() => setShowToolbar(v => !v)}
          title={showToolbar ? 'Ẩn thanh định dạng' : 'Hiện thanh định dạng'}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium transition ${showToolbar ? 'bg-blue-100 text-blue-700' : 'text-[#888] hover:bg-gray-200'}`}
        >
          <Type size={11} /> Định dạng {showToolbar ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
        {showToolbar && (
          <>
            <span className="w-px h-4 bg-gray-300 mx-1" />
            <button type="button" onMouseDown={e => { e.preventDefault(); exec('bold'); }} title="Đậm" className="p-1 rounded hover:bg-gray-200 text-[#555]"><Bold size={12} /></button>
            <button type="button" onMouseDown={e => { e.preventDefault(); exec('italic'); }} title="Nghiêng" className="p-1 rounded hover:bg-gray-200 text-[#555]"><Italic size={12} /></button>
            <span className="w-px h-4 bg-gray-300 mx-1" />
            <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }} title="Gạch đầu dòng" className="p-1 rounded hover:bg-gray-200 text-[#555]"><List size={12} /></button>
            <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }} title="Đánh số" className="p-1 rounded hover:bg-gray-200 text-[#555]"><ListOrdered size={12} /></button>
            <button type="button" onMouseDown={e => { e.preventDefault(); exec('indent'); }} title="Thụt vào" className="p-1 rounded hover:bg-gray-200 text-[#555]"><Indent size={12} /></button>
            <button type="button" onMouseDown={e => { e.preventDefault(); exec('outdent'); }} title="Thụt ra" className="p-1 rounded hover:bg-gray-200 text-[#555]"><Outdent size={12} /></button>
            <span className="w-px h-4 bg-gray-300 mx-1" />
            <Highlighter size={11} className="text-[#999] mr-0.5" />
            {HIGHLIGHT_COLORS.map(c => (
              <button key={c} type="button" onMouseDown={e => { e.preventDefault(); exec('hiliteColor', c); }}
                title="Bôi đen" className="w-3.5 h-3.5 rounded-full border border-gray-300" style={{ backgroundColor: c }} />
            ))}
            <button type="button" onMouseDown={e => { e.preventDefault(); exec('hiliteColor', 'transparent'); }}
              title="Bỏ bôi đen" className="p-1 rounded hover:bg-gray-200 text-[10px] text-[#999]">✕</button>
          </>
        )}
      </div>
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="absolute top-2.5 left-4 text-[13px] text-[#aaa] pointer-events-none">{placeholder}</div>
        )}
        <div
          ref={ref}
          contentEditable
          onInput={handleInput}
          onPaste={handlePaste}
          suppressContentEditableWarning
          style={{ minHeight: 60, maxHeight: '70vh' }}
          className="w-full font-sans text-[13px] px-4 py-2.5 outline-none leading-relaxed overflow-y-auto resize-y [&_*]:!font-sans [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:border-gray-300"
        />
      </div>
    </div>
  );
}
