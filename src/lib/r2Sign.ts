// Ký link tải file thẳng lên Cloudflare R2 (chuẩn chữ ký AWS Signature V4 — R2 dùng chung chuẩn S3).
// Chạy ở máy chủ (/api/r2-upload) với khoá bí mật; điện thoại chỉ nhận 1 link có hạn vài phút để PUT đúng 1 file.
// Thuần Web Crypto (crypto.subtle) → chạy được cả trên Vercel Edge lẫn trong test.

const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

/** Mã hoá theo RFC 3986 (chuẩn AWS): giữ A–Z a–z 0–9 - _ . ~ ; `keepSlash` cho đường dẫn. */
export function awsEncode(s: string, keepSlash = false): string {
  return [...enc.encode(s)].map(b => {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === '/')) return c;
    return `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

/** "20261103T091500Z" */
export const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD';
  host: string;
  /** Đường dẫn CHƯA mã hoá, bắt đầu bằng "/" — VD "/bucket/kcn-survey/a b.jpg" */
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 dùng "auto" */
  region: string;
  /** Giây, tối đa 7 ngày */
  expires: number;
  now: Date;
  service?: string;
}

/** Link đã ký (query string auth) — ai có link thì PUT / GET được đúng file đó tới khi hết hạn. */
export async function presignUrl(o: PresignInput): Promise<string> {
  const service = o.service ?? 's3';
  const date = amzDate(o.now);
  const day = date.slice(0, 8);
  const scope = `${day}/${o.region}/${service}/aws4_request`;
  const params: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${o.accessKeyId}/${scope}`],
    ['X-Amz-Date', date],
    ['X-Amz-Expires', String(o.expires)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const query = params.map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`).sort().join('&');
  const canonicalPath = awsEncode(o.path, true);
  const canonicalRequest = [o.method, canonicalPath, query, `host:${o.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, await sha256Hex(canonicalRequest)].join('\n');
  let key: ArrayBuffer = await hmac(enc.encode(`AWS4${o.secretAccessKey}`), day);
  key = await hmac(key, o.region);
  key = await hmac(key, service);
  key = await hmac(key, 'aws4_request');
  const signature = toHex(await hmac(key, stringToSign));
  return `https://${o.host}${canonicalPath}?${query}&X-Amz-Signature=${signature}`;
}

/** Chỉ cho tải lên đúng các thư mục của app, tên file an toàn (không "..", không ký tự lạ). */
export function validR2Key(key: string): boolean {
  return /^(kcn-survey|voice|mirror|client-site|legal)\/[A-Za-z0-9._\-/]{1,200}$/.test(key) && !key.includes('..') && !key.includes('//');
}
