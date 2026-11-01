// Bảng 8 màu ghi chú (lấy cảm hứng từ MFinder): chấm chọn màu, thẻ trên dải, nền giấy, đầu thẻ, dải tiêu đề dọc, màu chữ.
import type { NoteColor } from './types';

export interface NotePalette {
  label: string;
  dot: string;
  tab: string;
  paper: string;
  header: string;
  strip: string;
  ink: string;
}

export const PALETTE: Record<NoteColor, NotePalette> = {
  yellow: { label: 'Vàng', dot: '#E3A600', tab: '#F6D774', paper: '#FFF7D1', header: '#FCEDB2', strip: '#F5DE8E', ink: '#5A4200' },
  orange: { label: 'Cam', dot: '#EA7A2B', tab: '#F8C190', paper: '#FFEBDA', header: '#FDDDC3', strip: '#F7CDA7', ink: '#6B3410' },
  pink: { label: 'Hồng', dot: '#E4487A', tab: '#F3A9C1', paper: '#FCE3EB', header: '#F8D0DD', strip: '#F1B9CB', ink: '#6E1F3A' },
  purple: { label: 'Tím', dot: '#8B5CF6', tab: '#C9B7F7', paper: '#ECE3FD', header: '#DECFFB', strip: '#CFBBF7', ink: '#3F2A80' },
  blue: { label: 'Xanh dương', dot: '#2F7EEB', tab: '#AACCF7', paper: '#E0EDFD', header: '#CEE1FB', strip: '#B7D3F7', ink: '#143E78' },
  green: { label: 'Xanh lá', dot: '#13A37A', tab: '#A1DEC3', paper: '#DDF4EA', header: '#C9ECDC', strip: '#AFE1CA', ink: '#0F4D3A' },
  slate: { label: 'Xám xanh', dot: '#5B6B83', tab: '#B9C3D1', paper: '#E8ECF1', header: '#D9DFE8', strip: '#C8D0DB', ink: '#273347' },
  gray: { label: 'Xám', dot: '#8E8E93', tab: '#D0D0D5', paper: '#F2F2F4', header: '#E5E5E9', strip: '#D8D8DD', ink: '#3A3A3C' },
};

export const FONT_FAMILY: Record<string, string> = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
  serif: '"New York", "Iowan Old Style", Georgia, "Times New Roman", serif',
  mono: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
};

export const FONT_LABEL: Record<string, string> = { sans: 'Chữ thường', serif: 'Chữ có chân', mono: 'Chữ đều' };

/** Các cỡ chữ cho nút A nhỏ / A lớn. */
export const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 22, 24] as const;

export function stepFontSize(current: number, dir: 1 | -1): number {
  const idx = FONT_SIZES.findIndex(s => s >= current);
  const at = idx === -1 ? FONT_SIZES.length - 1 : idx;
  const next = Math.min(FONT_SIZES.length - 1, Math.max(0, at + dir));
  return FONT_SIZES[next];
}
