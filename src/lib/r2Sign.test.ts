import { describe, expect, it } from 'vitest';
import { awsEncode, amzDate, presignUrl, validR2Key } from './r2Sign';

describe('ký link tải lên Cloudflare R2 (AWS Signature V4)', () => {
  it('khớp ví dụ chuẩn trong tài liệu AWS (presigned GET)', async () => {
    const url = await presignUrl({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1', expires: 86400, now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request');
    expect(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')).toBe(true);
  });
  it('mã hoá đường dẫn + ngày', () => {
    expect(awsEncode('kcn-survey/khac/2026-11-03/a b+c.webp', true)).toBe('kcn-survey/khac/2026-11-03/a%20b%2Bc.webp');
    expect(awsEncode('a/b')).toBe('a%2Fb');
    expect(amzDate(new Date('2026-11-03T09:15:00.123Z'))).toBe('20261103T091500Z');
  });
  it('chỉ cho tải vào thư mục của app, tên an toàn', () => {
    expect(validR2Key('kcn-survey/d747b3b4/2026-11-03/1b2c.webp')).toBe(true);
    expect(validR2Key('voice/khac/2026-11-03/x.webm')).toBe(true);
    expect(validR2Key('client-site/5f0c2a1e-1111-4222-8333-944445555666/mf3k2abcde.webp')).toBe(true);
    expect(validR2Key('kcn-survey/../secret')).toBe(false);
    expect(validR2Key('avatars/x.png')).toBe(false);
    expect(validR2Key('kcn-survey/a b.jpg')).toBe(false);
  });
});
