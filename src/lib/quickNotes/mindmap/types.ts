// Sơ đồ tư duy (kiểu XMind) trong Ghi chú nhanh — kiểu dữ liệu lưu ở cột quick_notes.mindmap (migration 189).
// Cả sơ đồ là 1 object JSON: chủ đề trung tâm + cây chủ đề con, chủ đề tự do, đường liên kết, cấu trúc, chủ đề màu.

/** map = toả 2 bên · right/left = sơ đồ logic 1 bên · org = tổ chức (xuống dưới) · tree = cây · timeline = dòng thời gian */
export const STRUCTURES = ['map', 'right', 'left', 'org', 'tree', 'timeline'] as const;
export type MindStructure = typeof STRUCTURES[number];

export const LINE_STYLES = ['curve', 'elbow', 'straight'] as const;
export type MindLineStyle = typeof LINE_STYLES[number];

export const TOPIC_SHAPES = ['rounded', 'rect', 'pill', 'ellipse', 'underline', 'none'] as const;
export type TopicShape = typeof TOPIC_SHAPES[number];

export const MAP_FONTS = ['sans', 'serif', 'mono'] as const;
export type MapFont = typeof MAP_FONTS[number];

/** Định dạng riêng của 1 chủ đề (đè lên chủ đề màu của sơ đồ). Bỏ trống = theo chủ đề màu. */
export interface TopicStyle {
  fill?: string;
  color?: string;
  /** màu viền + màu nhánh từ chủ đề này trở xuống */
  branch?: string;
  shape?: TopicShape;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
}

export interface MindSummary {
  id: string;
  /** mã chủ đề con đầu / cuối của đoạn được tóm tắt (cùng 1 cha) */
  from: string;
  to: string;
  text: string;
}

export interface MindTopic {
  id: string;
  text: string;
  children: MindTopic[];
  collapsed?: boolean;
  style?: TopicStyle;
  /** biểu tượng: 'priority-1', 'task-50', 'flag-red', 'star-yellow', 'smiley-smile', 'sym-check'… (mỗi nhóm 1 cái) */
  markers?: string[];
  note?: string;
  link?: string;
  labels?: string[];
  /** vùng bao quanh chủ đề + nhánh con */
  boundary?: { text: string };
  /** dấu ngoặc tóm tắt một đoạn chủ đề con */
  summaries?: MindSummary[];
  /** chỉ chủ đề tự do: vị trí tâm, so với tâm chủ đề trung tâm */
  pos?: { x: number; y: number };
}

export interface MindRelation {
  id: string;
  from: string;
  to: string;
  text: string;
}

export interface MindMapDoc {
  v: 1;
  root: MindTopic;
  /** chủ đề tự do (bấm đúp vào chỗ trống) — mỗi cái có thể có nhánh con */
  floating: MindTopic[];
  relations: MindRelation[];
  structure: MindStructure;
  theme: string;
  /** kiểu đường nhánh; bỏ trống = theo chủ đề màu */
  line?: MindLineStyle;
  font?: MapFont;
  /** nhánh nhiều màu (cầu vồng) hay 1 màu */
  rainbow?: boolean;
  /** sơ đồ gọn (khoảng cách hẹp) */
  compact?: boolean;
}
