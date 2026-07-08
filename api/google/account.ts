// POST { token, action }
//   status:       trang thai ket noi Google cua user (email, lan sync cuoi, lich da chon)
//   calendars:    liet ke cac lich Google co quyen ghi (de user chon lich do viec vao)
//   set-calendar: { calendarId, calendarSummary } — chon/doi lich mirror; calendarId rong = tat mirror.
//                 Doi/tat lich se xoa cac event da tao o lich cu.
//   disconnect:   xoa ket noi + toan bo link anh xa (khong dung den du lieu task 2 ben)

import {
  json, validateSession, getConnection, sbDelete, sbSelect, sbUpdate,
  decryptText, refreshAccessToken, listCalendars, deleteCalendarEvent,
} from './_shared';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { token?: string; action?: string; calendarId?: string; calendarSummary?: string };
  try { body = await req.json(); } catch { return json({ error: 'Body khong hop le' }, 400); }

  try {
    const userId = await validateSession(body.token);
    if (!userId) return json({ error: 'Phien dang nhap khong hop le' }, 401);

    if (body.action === 'disconnect') {
      await sbDelete('google_task_links', `user_id=eq.${userId}`);
      await sbDelete('google_connections', `user_id=eq.${userId}`);
      return json({ ok: true });
    }

    if (body.action === 'calendars') {
      const conn = await getConnection(userId);
      if (!conn) return json({ error: 'Chưa kết nối Google' }, 400);
      const accessToken = await refreshAccessToken(await decryptText(conn.refresh_token_enc));
      const calendars = await listCalendars(accessToken);
      return json({ calendars });
    }

    if (body.action === 'set-calendar') {
      const conn = await getConnection(userId);
      if (!conn) return json({ error: 'Chưa kết nối Google' }, 400);
      const newCalId = (body.calendarId || '').trim() || null;

      // Doi/tat lich: don event da tao o lich cu roi go lien ket event.
      if (conn.calendar_id && conn.calendar_id !== newCalId) {
        const accessToken = await refreshAccessToken(await decryptText(conn.refresh_token_enc));
        const links = await sbSelect<{ id: string; google_event_id: string | null }>(
          'google_task_links', `user_id=eq.${userId}&google_event_id=not.is.null&select=id,google_event_id`,
        );
        for (const l of links) {
          try { await deleteCalendarEvent(accessToken, conn.calendar_id, l.google_event_id!); } catch { /* event co the da bi xoa tay */ }
        }
        await sbUpdate('google_task_links', `user_id=eq.${userId}&google_event_id=not.is.null`, { google_event_id: null });
      }

      await sbUpdate('google_connections', `id=eq.${conn.id}`, {
        calendar_id: newCalId,
        calendar_summary: newCalId ? (body.calendarSummary || null) : null,
        updated_at: new Date().toISOString(),
      });
      return json({ ok: true });
    }

    const conn = await getConnection(userId);
    return json({
      connected: !!conn && conn.sync_enabled,
      email: conn?.google_email || null,
      lastSyncedAt: conn?.last_synced_at || null,
      calendarId: conn?.calendar_id || null,
      calendarSummary: conn?.calendar_summary || null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Loi khong xac dinh' }, 500);
  }
}
