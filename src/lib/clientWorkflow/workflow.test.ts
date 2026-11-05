import { describe, expect, it } from 'vitest';
import { mediaInfo, parseMediaInput, parseWorkshops } from './workflow';

describe('clientWorkflow', () => {
  it('nhận diện YouTube / Drive / ảnh', () => {
    expect(mediaInfo('https://youtu.be/dQw4w9WgXcQ').kind).toBe('video');
    expect(mediaInfo('https://youtu.be/dQw4w9WgXcQ').thumb).toContain('dQw4w9WgXcQ');
    expect(mediaInfo('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view').kind).toBe('drive');
    expect(mediaInfo('https://x.com/a.jpg').kind).toBe('image');
  });
  it('tách nhiều link, bỏ dòng rỗng và link sai', () => {
    const r = parseMediaInput('Cắt vải | https://youtu.be/dQw4w9WgXcQ\n\nhttps://x.com/a.jpg https://x.com/b.png\nkhông phải link');
    expect(r.map(m => m.url)).toEqual(['https://youtu.be/dQw4w9WgXcQ', 'https://x.com/a.jpg', 'https://x.com/b.png']);
    expect(r[0].title).toBe('Cắt vải');
  });
  it('đọc JSON hỏng không vỡ', () => {
    expect(parseWorkshops(null)).toEqual([]);
    expect(parseWorkshops([{ name: 'X', steps: [{ name: 'a' }] }])[0].steps[0].media).toEqual([]);
  });
});
