import { describe, expect, it } from 'vitest';
import { parseTranscript, splitTranscript, summaryForNote, transcribePrompt } from './transcript';

// Kết quả thật của Gemini 2.5 Flash với bản ghi mẫu (01/11/2026)
const SAMPLE = `## TÓM TẮT
- Let's Go có thể cung cấp 120 lao động ca đêm.
- Thời gian bắt đầu: từ ngày 15/11.
- Đơn giá thời vụ: 25.000đ/giờ.

## QUYẾT ĐỊNH & VIỆC CẦN LÀM
- ☐ Gửi báo giá — chị Lan — thứ 6
- Đã chốt: bắt đầu 15/11

## LỜI THOẠI
[00:00] Người 1: Chào anh Hùng, bên em có thể cung cấp 120 lao động ca đêm.
[01:05] Anh Hùng: Đơn giá thế nào em?
[1:02:03] Người 1: 25.000 một giờ.
(không rõ)`;

describe('chép lời Gemini', () => {
  it('tách tóm tắt (kèm việc cần làm) và lời thoại', () => {
    const { summary, transcript } = splitTranscript(SAMPLE);
    expect(summary.startsWith('## TÓM TẮT')).toBe(true);
    expect(summary).toContain('## QUYẾT ĐỊNH & VIỆC CẦN LÀM');
    expect(summary).not.toContain('LỜI THOẠI');
    expect(transcript.startsWith('[00:00] Người 1')).toBe(true);
  });

  it('không có phần lời thoại → tất cả là tóm tắt', () => {
    expect(splitTranscript('## TÓM TẮT\n- Bản ghi không có lời nói rõ ràng.')).toEqual({
      summary: '## TÓM TẮT\n- Bản ghi không có lời nói rõ ràng.', transcript: '',
    });
  });

  it('đọc mốc thời gian + người nói để bấm nghe lại', () => {
    const lines = parseTranscript(splitTranscript(SAMPLE).transcript);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toEqual({ at: 65, stamp: '01:05', speaker: 'Anh Hùng', text: 'Đơn giá thế nào em?' });
    expect(lines[2].at).toBe(3723);
    expect(lines[3]).toEqual({ at: null, stamp: '', speaker: '', text: '(không rõ)' });
  });

  it('tóm tắt chèn vào ghi chú: việc cần làm thành ô ☐ bấm được', () => {
    const out = summaryForNote(splitTranscript(SAMPLE).summary, 'Ghi âm 14:30 · 31/10');
    expect(out.split('\n')[0]).toBe('— Tóm tắt Ghi âm 14:30 · 31/10 —');
    expect(out).toContain('\n☐ Gửi báo giá — chị Lan — thứ 6');
    expect(out).toContain('\nTÓM TẮT\n- Let\'s Go');
    expect(out).not.toContain('##');
  });

  it('câu lệnh kèm ghi chú để nghe đúng tên riêng, giới hạn độ dài', () => {
    expect(transcribePrompt('Gặp Canon — anh Hùng')).toContain('Gặp Canon — anh Hùng');
    expect(transcribePrompt('')).not.toContain('Ghi chú người dùng viết kèm');
    expect(transcribePrompt('x'.repeat(5000)).length).toBeLessThan(4000);
  });
});
