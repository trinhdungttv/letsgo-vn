// POST { token } -> chay reconcile 2 chieu work_tasks <-> Google Calendar event cho user cua phien nay.
// Tra ve tong ket so luong thay doi de client biet co can reload danh sach task khong.

import { json, validateSession, getConnection } from './_shared';
import { reconcile } from './_sync';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { token?: string };
  try { body = await req.json(); } catch { return json({ error: 'Body khong hop le' }, 400); }

  try {
    const userId = await validateSession(body.token);
    if (!userId) return json({ error: 'Phien dang nhap khong hop le' }, 401);

    const conn = await getConnection(userId);
    if (!conn || !conn.sync_enabled) return json({ connected: false });

    const summary = await reconcile(conn);
    return json({ connected: true, summary });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Loi khong xac dinh' }, 500);
  }
}
