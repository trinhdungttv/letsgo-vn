// POST { token, action: 'status' | 'disconnect' }
//   status:     tra ve trang thai ket noi Google cua user (email, lan sync cuoi)
//   disconnect: xoa ket noi + toan bo link anh xa (khong dung den du lieu task 2 ben)

import { json, validateSession, getConnection, sbDelete } from './_shared';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { token?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: 'Body khong hop le' }, 400); }

  try {
    const userId = await validateSession(body.token);
    if (!userId) return json({ error: 'Phien dang nhap khong hop le' }, 401);

    if (body.action === 'disconnect') {
      await sbDelete('google_task_links', `user_id=eq.${userId}`);
      await sbDelete('google_connections', `user_id=eq.${userId}`);
      return json({ ok: true });
    }

    const conn = await getConnection(userId);
    return json({
      connected: !!conn && conn.sync_enabled,
      email: conn?.google_email || null,
      lastSyncedAt: conn?.last_synced_at || null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Loi khong xac dinh' }, 500);
  }
}
