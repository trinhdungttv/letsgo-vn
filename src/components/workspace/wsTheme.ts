// src/components/workspace/wsTheme.ts — giao diện Workspace theo phong cách Apple.
// Nền #F5F5F7 · thẻ trắng bo 18px + bóng mảnh · chữ #1D1D1F / #6E6E73 / #86868B ·
// màu nhấn #0071E3 · nhãn = viên nang tô nhạt KHÔNG viền · icon đặt trong ô bo kiểu iOS.
// Viết đủ chữ từng class (không ghép chuỗi động) để Tailwind sinh đúng CSS.

/** Thẻ (card) chuẩn: trắng, bo 18px, viền-bóng 0.5px + bóng rất nhẹ. */
export const CARD = 'bg-white rounded-[18px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)]'

/** Lớp phủ nổi (menu, popover). */
export const POPOVER = 'bg-white/95 backdrop-blur-xl rounded-[14px] shadow-[0_0_0_0.5px_rgba(0,0,0,0.08),0_12px_32px_-6px_rgba(0,0,0,0.18)]'

export const BTN_PRIMARY = 'inline-flex items-center justify-center gap-1.5 rounded-full bg-[#0071E3] text-white font-medium hover:bg-[#0077ED] active:scale-[0.97] transition disabled:opacity-40 disabled:pointer-events-none'
export const BTN_SECONDARY = 'inline-flex items-center justify-center gap-1.5 rounded-full bg-black/[0.05] text-[#1D1D1F] font-medium hover:bg-black/[0.08] active:scale-[0.97] transition disabled:opacity-40 disabled:pointer-events-none'
export const BTN_TINTED = 'inline-flex items-center justify-center gap-1 rounded-full bg-[#0071E3]/10 text-[#0066CC] font-medium hover:bg-[#0071E3]/[0.16] active:scale-[0.97] transition disabled:opacity-40 disabled:pointer-events-none'
export const BTN_ICON = 'inline-flex items-center justify-center w-7 h-7 rounded-full text-[#86868B] hover:bg-black/[0.05] hover:text-[#1D1D1F] transition'

/** Chip lọc: chọn = nền đen chữ trắng (kiểu Apple Store), chưa chọn = xám nhạt. */
export const FILTER_ON = 'bg-[#1D1D1F] text-white'
export const FILTER_OFF = 'bg-black/[0.05] text-[#1D1D1F] hover:bg-black/[0.08]'

/** Ô nhập kiểu iOS: nền xám nhạt, không viền, viền xanh khi gõ. */
export const FIELD = 'bg-black/[0.04] rounded-[10px] border border-transparent focus-within:bg-white focus-within:border-[#0071E3] focus-within:ring-4 focus-within:ring-[#0071E3]/15 transition'
export const INPUT = 'bg-white border border-black/[0.12] rounded-[10px] text-[#1D1D1F] placeholder:text-[#AEAEB2] focus:outline-none focus:border-[#0071E3] focus:ring-4 focus:ring-[#0071E3]/15 transition'

/** Viên nang màu hệ thống Apple: nền pha nhạt, chữ bản đậm để đủ tương phản. */
export const TINT = {
  blue:   'bg-[#0071E3]/10 text-[#0066CC]',
  red:    'bg-[#FF3B30]/10 text-[#D70015]',
  orange: 'bg-[#FF9500]/[0.14] text-[#B25000]',
  yellow: 'bg-[#FFCC00]/[0.22] text-[#8A5A00]',
  green:  'bg-[#34C759]/[0.14] text-[#1E7B34]',
  teal:   'bg-[#30B0C7]/[0.14] text-[#00708F]',
  indigo: 'bg-[#5856D6]/[0.12] text-[#3634A3]',
  purple: 'bg-[#AF52DE]/[0.12] text-[#8944AB]',
  pink:   'bg-[#FF2D55]/10 text-[#C4103E]',
  gray:   'bg-black/[0.05] text-[#6E6E73]',
} as const
export type Tint = keyof typeof TINT

/** Ô icon kiểu iOS: tô chuyển sắc + icon trắng. */
export const ICON_TILE = {
  blue:   'bg-gradient-to-b from-[#4BA3FF] to-[#0071E3]',
  red:    'bg-gradient-to-b from-[#FF6961] to-[#FF3B30]',
  orange: 'bg-gradient-to-b from-[#FFB340] to-[#FF9500]',
  green:  'bg-gradient-to-b from-[#5BD67A] to-[#28B04A]',
  teal:   'bg-gradient-to-b from-[#5AC8DC] to-[#1FA2BA]',
  indigo: 'bg-gradient-to-b from-[#7D7BE8] to-[#5856D6]',
  purple: 'bg-gradient-to-b from-[#C77DEB] to-[#AF52DE]',
  gray:   'bg-gradient-to-b from-[#A1A1A6] to-[#8E8E93]',
} as const

/** Chấm trạng thái. */
export const DOT = {
  red: 'bg-[#FF3B30]',
  orange: 'bg-[#FF9500]',
  green: 'bg-[#34C759]',
  blue: 'bg-[#0071E3]',
  gray: 'bg-[#C7C7CC]',
} as const
