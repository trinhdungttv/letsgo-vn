// GET tu Google sau khi user dong y: doi code lay refresh token, luu (ma hoa) vao google_connections,
// tao/tim tasklist "LetsGo", roi redirect ve trang chu voi ?google=connected|error.

import {
  json, validateSession, decryptText, encryptText, redirectUri,
  exchangeCode, emailFromIdToken, refreshAccessToken, ensureTasklist,
  sbInsert, getConnection, sbUpdate,
} from './_shared';

export const config = { runtime: 'edge' };

function backToApp(req: Request, result: string): Response {
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || url.host;
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return Response.redirect(`${proto}://${host}/?google=${result}`, 302);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error')) return backToApp(req, 'denied');
  if (!code || !state) return backToApp(req, 'error');

  try {
    // Giai ma state -> token phien letsgo; chan state qua cu (10 phut).
    const parsed = JSON.parse(await decryptText(state)) as { t: string; ts: number };
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return backToApp(req, 'expired');
    const userId = await validateSession(parsed.t);
    if (!userId) return backToApp(req, 'expired');

    const tokens = await exchangeCode(code, redirectUri(req));
    if (!tokens.refresh_token) {
      // Khong co refresh_token (hiem khi xay ra vi da prompt=consent) -> bao user thu lai.
      return backToApp(req, 'error');
    }

    const email = emailFromIdToken(tokens.id_token);
    const refreshEnc = await encryptText(tokens.refresh_token);
    const accessToken = tokens.access_token || await refreshAccessToken(tokens.refresh_token);
    const existing = await getConnection(userId);
    const tasklistId = await ensureTasklist(accessToken, existing?.tasklist_id || null);

    if (existing) {
      await sbUpdate('google_connections', `id=eq.${existing.id}`, {
        google_email: email, refresh_token_enc: refreshEnc, tasklist_id: tasklistId,
        sync_enabled: true, updated_at: new Date().toISOString(),
      });
    } else {
      await sbInsert('google_connections', {
        user_id: userId, google_email: email, refresh_token_enc: refreshEnc, tasklist_id: tasklistId,
      });
    }
    return backToApp(req, 'connected');
  } catch {
    return backToApp(req, 'error');
  }
}
