// POST { token } -> { url }: tao URL consent Google de user bam vao ket noi tai khoan.
// state = token phien letsgo MA HOA (AES-GCM) + timestamp, callback se giai ma de biet user nao.

import { json, validateSession, encryptText, redirectUri, requiredEnv, GOOGLE_SCOPES } from './_shared';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { token?: string };
  try { body = await req.json(); } catch { return json({ error: 'Body khong hop le' }, 400); }

  try {
    const userId = await validateSession(body.token);
    if (!userId) return json({ error: 'Phien dang nhap khong hop le' }, 401);

    const state = await encryptText(JSON.stringify({ t: body.token, ts: Date.now() }));
    const params = new URLSearchParams({
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      redirect_uri: redirectUri(req),
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',            // luon xin refresh token moi
      state,
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Loi khong xac dinh' }, 500);
  }
}
