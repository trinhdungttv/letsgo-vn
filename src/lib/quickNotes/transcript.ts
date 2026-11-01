// Chép lời + tóm tắt bản ghi âm bằng Gemini — phần dùng chung cho server (api/quick-notes-transcribe.ts) và giao diện:
// câu lệnh gửi Gemini, tách kết quả thành Tóm tắt / Lời thoại, đọc mốc [mm:ss] để bấm nghe lại đúng đoạn.
import { BOX_OPEN } from './noteText';

export const SUMMARY_HEAD = '## TÓM TẮT';
export const ACTIONS_HEAD = '## QUYẾT ĐỊNH & VIỆC CẦN LÀM';
export const TRANSCRIPT_HEAD = '## LỜI THOẠI';

/** Câu lệnh cho Gemini. `context` = nội dung ghi chú đi kèm (tên người, công ty…) để nghe đúng tên riêng. */
export function transcribePrompt(context: string): string {
  const ctx = context.trim().slice(0, 2000);
  return [
    'Bạn là thư ký cuộc họp của Let\'s Go — công ty cung ứng lao động ở Việt Nam. Đây là bản ghi âm một cuộc trò chuyện / cuộc họp.',
    'Trả lời bằng tiếng Việt, ĐÚNG định dạng dưới đây, không thêm lời dẫn hay lời kết:',
    '',
    SUMMARY_HEAD,
    '- 3 đến 8 gạch đầu dòng: ý chính, con số, giá cả, ngày tháng, tên người / công ty được nhắc tới.',
    '',
    ACTIONS_HEAD,
    `- ${BOX_OPEN} Việc cần làm — người phụ trách (nếu nghe được) — hạn (nếu có). Quyết định đã chốt thì ghi "Đã chốt: …". Không có thì ghi "- Không có".`,
    '',
    TRANSCRIPT_HEAD,
    '[mm:ss] Người nói: lời nói',
    '',
    'Quy tắc:',
    '- Lời thoại chép NGUYÊN VĂN theo đúng thứ tự, không tóm lược, không thêm ý; chỗ nghe không rõ ghi (không rõ).',
    '- Mỗi lượt nói 1 dòng, mở đầu bằng mốc thời gian tính từ đầu bản ghi: [mm:ss], quá 1 giờ thì [h:mm:ss].',
    '- Người nói: dùng tên nếu nghe họ xưng / được gọi tên, không thì "Người 1", "Người 2"…',
    '- Số lượng, tiền, ngày tháng viết bằng chữ số (120 lao động, 25.000đ/giờ, 15/11).',
    `- Bản ghi không có lời nói rõ ràng thì chỉ trả về:\n${SUMMARY_HEAD}\n- Bản ghi không có lời nói rõ ràng.`,
    ...(ctx ? ['', 'Ghi chú người dùng viết kèm bản ghi (chỉ để nghe đúng tên người, tên công ty — KHÔNG chép vào lời thoại):', ctx] : []),
  ].join('\n');
}

/** Tách kết quả Gemini: phần trước "## LỜI THOẠI" là tóm tắt (kèm việc cần làm), phần sau là lời thoại. */
export function splitTranscript(full: string): { summary: string; transcript: string } {
  const text = full.replace(/\r\n/g, '\n').trim();
  const at = text.indexOf(TRANSCRIPT_HEAD);
  if (at === -1) return { summary: text, transcript: '' };
  return {
    summary: text.slice(0, at).trim(),
    transcript: text.slice(at + TRANSCRIPT_HEAD.length).trim(),
  };
}

export interface TranscriptLine {
  /** Giây tính từ đầu bản ghi; null = dòng không có mốc */
  at: number | null;
  stamp: string;
  speaker: string;
  text: string;
}

const LINE_RE = /^\s*\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]\s*(?:([^:\n]{1,40}):\s*)?(.*)$/;

/** "[01:05] Anh Hùng: Bên em…" → { at: 65, stamp: '01:05', speaker: 'Anh Hùng', text: 'Bên em…' } */
export function parseTranscript(transcript: string): TranscriptLine[] {
  return transcript.split('\n').map(l => l.trimEnd()).filter(l => l.trim()).map(line => {
    const m = line.match(LINE_RE);
    if (!m) return { at: null, stamp: '', speaker: '', text: line.trim() };
    const [, h, mm, ss, speaker, text] = m;
    const at = Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
    const stamp = `${h ? `${h}:` : ''}${mm}:${ss}`;
    return { at, stamp, speaker: (speaker ?? '').trim(), text: text.trim() };
  });
}

/** Tóm tắt để chèn vào cuối ghi chú: bỏ dấu "##", "- ☐ việc" thành dòng checklist "☐ việc" bấm tích được. */
export function summaryForNote(summary: string, recordingName: string): string {
  const lines = summary.replace(/\r\n/g, '\n').split('\n').map(l => {
    const t = l.trim();
    if (!t) return '';
    if (t.startsWith('## ')) return t.slice(3).trim().replace(/^./, c => c.toUpperCase());
    const box = t.match(/^[-*•]\s*([☐☑])\s*(.*)$/);
    if (box) return `${BOX_OPEN} ${box[2]}`;
    return t.replace(/^[*•]\s+/, '- ');
  });
  return [`— Tóm tắt ${recordingName} —`, ...lines].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Sự kiện server gửi về (mỗi dòng 1 JSON — application/x-ndjson). */
export type TranscribeEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'ping' }
  | { type: 'done'; summary: string; transcript: string; truncated: boolean }
  | { type: 'error'; error: string };
