// Sơ đồ tư duy — bộ chủ đề màu (kiểu "Skin" của XMind) + danh sách biểu tượng (marker).
import type { NotePalette } from '../colors';
import type { MindLineStyle, TopicShape } from './types';

/** fill / border: mã màu, 'branch' = màu nhánh, 'branch-soft' = màu nhánh nhạt, 'none' = không có. text: 'auto' = tự chọn đen / trắng. */
export interface LevelStyle {
  fill: string;
  text: string;
  border: string;
  borderW: number;
  shape: TopicShape;
  size: number;
  weight: number;
  padX: number;
  padY: number;
  maxW: number;
}

export interface MindTheme {
  id: string;
  label: string;
  bg: string;
  dark: boolean;
  root: LevelStyle;
  main: LevelStyle;
  sub: LevelStyle;
  floating: LevelStyle;
  summary: LevelStyle;
  line: MindLineStyle;
  lineW: number;
  /** đường nhánh cùng 1 màu (bỏ trống = theo màu nhánh) */
  lineColor?: string;
  /** nhánh từ chủ đề trung tâm thon dần như XMind */
  taper: boolean;
  rainbow: boolean;
  branch: string[];
  mono: string;
  relation: string;
  labelBg: string;
  labelText: string;
  muted: string;
}

const L = (o: Partial<LevelStyle> & Pick<LevelStyle, 'size'>): LevelStyle => ({
  fill: 'none', text: 'auto', border: 'none', borderW: 0, shape: 'rounded', weight: 400, padX: 10, padY: 6, maxW: 240, ...o,
});

function base(id: string, label: string, o: Partial<MindTheme>): MindTheme {
  return {
    id,
    label,
    bg: '#FFFFFF',
    dark: false,
    root: L({ size: 22, weight: 700, padX: 24, padY: 14, maxW: 300, shape: 'rounded' }),
    main: L({ size: 16, weight: 600, padX: 16, padY: 9, maxW: 240 }),
    sub: L({ size: 14, padX: 6, padY: 5, maxW: 230, shape: 'underline', border: 'branch', borderW: 2 }),
    floating: L({ size: 15, weight: 600, padX: 14, padY: 8, fill: '#FFFFFF', border: 'branch', borderW: 2 }),
    summary: L({ size: 14, weight: 600, padX: 12, padY: 7, border: 'branch', borderW: 1.5, fill: 'none' }),
    line: 'curve',
    lineW: 2,
    taper: true,
    rainbow: true,
    branch: ['#F45B69', '#F6A13A', '#E9C232', '#3CC48D', '#2D9CDB', '#7B61FF', '#D45CE8', '#00B8A9'],
    mono: '#3A4A6B',
    relation: '#8A94A6',
    labelBg: '#EEF0F4',
    labelText: '#3A3A3C',
    muted: '#8E8E93',
    ...o,
  };
}

function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Màu chữ đọc rõ trên nền `bg` (#RRGGBB). */
export function contrastText(bg: string, dark = '#1D1D1F', light = '#FFFFFF'): string {
  const h = bg.replace('#', '');
  if (h.length !== 6) return dark;
  const n = parseInt(h, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? dark : light;
}

export const softColor = (hex: string, dark: boolean) => alpha(hex, dark ? 0.28 : 0.16);

export function getTheme(id: string, paper: NotePalette): MindTheme {
  switch (id) {
    case 'classic':
      return base('classic', 'Cổ điển', {
        root: L({ size: 22, weight: 700, padX: 24, padY: 14, maxW: 300, fill: '#E9F0FF', border: '#2F6BE0', borderW: 2.5, text: '#173D8F' }),
        main: L({ size: 16, weight: 600, padX: 16, padY: 9, maxW: 240, fill: '#FFFFFF', border: 'branch', borderW: 2, text: '#1D1D1F' }),
        sub: L({ size: 14, padX: 8, padY: 5, maxW: 230, shape: 'none', text: '#2C2C2E' }),
        line: 'elbow',
        taper: false,
        branch: ['#2F6BE0', '#1E9E6A', '#E2A400', '#E5484D', '#8E4EC6', '#0E9AB3'],
      });
    case 'dark':
      return base('dark', 'Ban đêm', {
        bg: '#1B1D24',
        dark: true,
        root: L({ size: 22, weight: 700, padX: 24, padY: 14, maxW: 300, fill: '#F5F5F7', text: '#1B1D24' }),
        main: L({ size: 16, weight: 600, padX: 16, padY: 9, maxW: 240, fill: 'branch-soft', border: 'branch', borderW: 1.5, text: '#FFFFFF' }),
        sub: L({ size: 14, padX: 6, padY: 5, maxW: 230, shape: 'underline', border: 'branch', borderW: 2, text: '#E5E5EA' }),
        floating: L({ size: 15, weight: 600, padX: 14, padY: 8, fill: '#2A2D37', border: 'branch', borderW: 1.5, text: '#FFFFFF' }),
        summary: L({ size: 14, weight: 600, padX: 12, padY: 7, border: 'branch', borderW: 1.5, text: '#FFFFFF' }),
        branch: ['#FF6B8B', '#FFB547', '#FFE066', '#4DE8B5', '#4DB8FF', '#B38CFF', '#FF8AE2', '#5EF0E0'],
        mono: '#C9CDD8',
        relation: '#9AA3B5',
        labelBg: '#2F3340',
        labelText: '#E5E5EA',
        muted: '#8E93A3',
      });
    case 'paper':
      return base('paper', 'Giấy ghi chú', {
        bg: paper.paper,
        root: L({ size: 22, weight: 700, padX: 24, padY: 14, maxW: 300, fill: paper.ink, text: paper.paper }),
        main: L({ size: 16, weight: 600, padX: 16, padY: 9, maxW: 240, fill: paper.strip, text: paper.ink }),
        sub: L({ size: 14, padX: 6, padY: 5, maxW: 230, shape: 'underline', border: 'branch', borderW: 1.5, text: paper.ink }),
        floating: L({ size: 15, weight: 600, padX: 14, padY: 8, fill: paper.header, border: 'branch', borderW: 1.5, text: paper.ink }),
        summary: L({ size: 14, weight: 600, padX: 12, padY: 7, border: 'branch', borderW: 1.5, text: paper.ink }),
        rainbow: false,
        mono: paper.ink,
        lineColor: alpha(paper.ink.length === 7 ? paper.ink : '#5A4200', 0.55),
        taper: false,
        relation: paper.dot,
        labelBg: paper.header,
        labelText: paper.ink,
      });
    case 'minimal':
      return base('minimal', 'Tối giản', {
        root: L({ size: 22, weight: 700, padX: 22, padY: 12, maxW: 300, shape: 'pill', border: '#1D1D1F', borderW: 2, text: '#1D1D1F' }),
        main: L({ size: 16, weight: 600, padX: 6, padY: 6, maxW: 240, shape: 'underline', border: '#1D1D1F', borderW: 2, text: '#1D1D1F' }),
        sub: L({ size: 14, padX: 6, padY: 5, maxW: 230, shape: 'underline', border: '#8E8E93', borderW: 1, text: '#3A3A3C' }),
        line: 'straight',
        lineW: 1.5,
        lineColor: '#3A3A3C',
        taper: false,
        rainbow: false,
        mono: '#1D1D1F',
      });
    case 'business':
      return base('business', 'Doanh nghiệp', {
        bg: '#F6F8FC',
        root: L({ size: 22, weight: 700, padX: 26, padY: 14, maxW: 300, shape: 'rect', fill: '#0B3D91', text: '#FFFFFF' }),
        main: L({ size: 16, weight: 600, padX: 16, padY: 9, maxW: 240, shape: 'rect', fill: '#DCE8FA', text: '#0B3D91' }),
        sub: L({ size: 14, padX: 8, padY: 5, maxW: 230, shape: 'none', text: '#334155' }),
        floating: L({ size: 15, weight: 600, padX: 14, padY: 8, shape: 'rect', fill: '#FFFFFF', border: '#0B3D91', borderW: 1.5, text: '#0B3D91' }),
        line: 'elbow',
        lineW: 1.5,
        lineColor: '#7A8CA8',
        taper: false,
        rainbow: false,
        mono: '#0B3D91',
        relation: '#E5484D',
      });
    case 'pastel':
      return base('pastel', 'Kẹo ngọt', {
        bg: '#FFFDF8',
        root: L({ size: 22, weight: 700, padX: 26, padY: 14, maxW: 300, shape: 'pill', fill: '#FFD6E0', text: '#5A2A3A' }),
        main: L({ size: 16, weight: 600, padX: 18, padY: 9, maxW: 240, shape: 'pill', fill: 'branch-soft', text: '#3A3A3C' }),
        sub: L({ size: 14, padX: 6, padY: 5, maxW: 230, shape: 'underline', border: 'branch', borderW: 2, text: '#48484A' }),
        lineW: 2.5,
        branch: ['#F28DA6', '#F5B971', '#E9CF5A', '#8FD3A7', '#7FB5F5', '#B79CF2'],
      });
    case 'ocean':
      return base('ocean', 'Biển xanh', {
        bg: '#F2F8FB',
        root: L({ size: 22, weight: 700, padX: 24, padY: 14, maxW: 300, shape: 'ellipse', fill: '#0F5C7A', text: '#FFFFFF' }),
        main: L({ size: 16, weight: 600, padX: 16, padY: 9, maxW: 240, fill: 'branch', text: 'auto' }),
        sub: L({ size: 14, padX: 10, padY: 5, maxW: 230, shape: 'rounded', fill: '#FFFFFF', border: 'branch', borderW: 1, text: '#1F3A4A' }),
        branch: ['#0F8BB0', '#1BA8A0', '#3D7DD8', '#5A67D8', '#0E9F6E', '#2C7A9B'],
        taper: true,
      });
    default:
      return base('rainbow', 'Cầu vồng', {
        root: L({ size: 22, weight: 700, padX: 24, padY: 14, maxW: 300, fill: '#1F2A44', text: '#FFFFFF' }),
        main: L({ size: 16, weight: 600, padX: 16, padY: 9, maxW: 240, fill: 'branch', text: 'auto' }),
      });
  }
}

export const THEME_IDS = ['rainbow', 'classic', 'ocean', 'pastel', 'business', 'minimal', 'paper', 'dark'] as const;

// ── Biểu tượng (marker) ────────────────────────────────────────────────────

export const PRIORITY_COLORS = ['#E5484D', '#F76B15', '#E2A400', '#30A46C', '#0090FF', '#8E4EC6'];
export const MARKER_COLORS: Record<string, string> = {
  red: '#E5484D', orange: '#F76B15', yellow: '#F5B400', green: '#30A46C', blue: '#0090FF', purple: '#8E4EC6', gray: '#8E8E93',
};

export interface MarkerGroup {
  id: string;
  label: string;
  items: { id: string; label: string }[];
}

const colorName: Record<string, string> = { red: 'đỏ', orange: 'cam', yellow: 'vàng', green: 'xanh lá', blue: 'xanh dương', purple: 'tím', gray: 'xám' };

export const MARKER_GROUPS: MarkerGroup[] = [
  { id: 'priority', label: 'Ưu tiên', items: [1, 2, 3, 4, 5, 6].map(n => ({ id: `priority-${n}`, label: `Ưu tiên ${n}` })) },
  { id: 'task', label: 'Tiến độ', items: [0, 25, 50, 75, 100].map(n => ({ id: `task-${n}`, label: n === 100 ? 'Xong' : `${n}%` })) },
  { id: 'flag', label: 'Cờ', items: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].map(c => ({ id: `flag-${c}`, label: `Cờ ${colorName[c]}` })) },
  { id: 'star', label: 'Ngôi sao', items: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].map(c => ({ id: `star-${c}`, label: `Sao ${colorName[c]}` })) },
  {
    id: 'smiley', label: 'Cảm xúc', items: [
      { id: 'smiley-smile', label: 'Vui' }, { id: 'smiley-laugh', label: 'Cười' }, { id: 'smiley-love', label: 'Thích' },
      { id: 'smiley-surprise', label: 'Ngạc nhiên' }, { id: 'smiley-sad', label: 'Buồn' }, { id: 'smiley-angry', label: 'Tức giận' },
    ],
  },
  {
    id: 'sym', label: 'Ký hiệu', items: [
      { id: 'sym-check', label: 'Đồng ý' }, { id: 'sym-cross', label: 'Không' }, { id: 'sym-question', label: 'Câu hỏi' },
      { id: 'sym-exclaim', label: 'Quan trọng' }, { id: 'sym-info', label: 'Thông tin' }, { id: 'sym-idea', label: 'Ý tưởng' },
    ],
  },
  {
    id: 'arrow', label: 'Mũi tên', items: [
      { id: 'arrow-up', label: 'Lên' }, { id: 'arrow-down', label: 'Xuống' }, { id: 'arrow-left', label: 'Trái' },
      { id: 'arrow-right', label: 'Phải' }, { id: 'arrow-refresh', label: 'Lặp lại' },
    ],
  },
  {
    id: 'people', label: 'Người', items: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].map(c => ({ id: `people-${c}`, label: `Người ${colorName[c]}` })),
  },
];

export const markerLabel = (id: string) => MARKER_GROUPS.flatMap(g => g.items).find(i => i.id === id)?.label ?? id;

/** Thứ tự hiện biểu tượng trên chủ đề: theo thứ tự nhóm (ưu tiên trước, tiến độ sau…). */
export function sortMarkers(ids: string[]): string[] {
  const order = MARKER_GROUPS.map(g => g.id);
  return [...ids].sort((a, b) => order.indexOf(a.split('-')[0]) - order.indexOf(b.split('-')[0]));
}

const EMOJI: Record<string, string> = {
  'task-0': '☐', 'task-25': '◔', 'task-50': '◑', 'task-75': '◕', 'task-100': '✅',
  'smiley-smile': '🙂', 'smiley-laugh': '😄', 'smiley-love': '😍', 'smiley-surprise': '😮', 'smiley-sad': '🙁', 'smiley-angry': '😠',
  'sym-check': '✔️', 'sym-cross': '❌', 'sym-question': '❓', 'sym-exclaim': '❗', 'sym-info': 'ℹ️', 'sym-idea': '💡',
  'arrow-up': '⬆️', 'arrow-down': '⬇️', 'arrow-left': '⬅️', 'arrow-right': '➡️', 'arrow-refresh': '🔄',
};

/** Biểu tượng dạng emoji khi xuất Markdown. */
export function markerEmoji(id: string): string {
  if (EMOJI[id]) return EMOJI[id];
  const [g, v] = id.split('-');
  if (g === 'priority') return `(${v})`;
  if (g === 'flag') return '🚩';
  if (g === 'star') return '⭐';
  if (g === 'people') return '👤';
  return '';
}
