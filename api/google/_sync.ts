// Engine reconcile 2 chieu work_tasks <-> Google Calendar event (KHONG dung Google Tasks).
// Web thay doi (tao/sua/xoa) -> day len event tren lich user chon. Calendar doi ngay/gio/tieu de/ghi chu
// -> keo ve web. Xoa event tren Calendar KHONG anh huong web — lan sync sau se tu tao lai (mirror tu healing).
// Event duoc danh dau extendedProperties.private.letsgo=1 khi tao, va CHI reconcile cac event co dau nay
// (xem listMirroredEvents trong _shared.ts) — khong dung toi event ca nhan khac cua user tren cung lich.
// File bat dau bang "_" nen KHONG duoc deploy thanh endpoint.

import {
  GoogleConnection, GoogleEventBody, GoogleCalendarEventFull,
  decryptText, refreshAccessToken, listMirroredEvents,
  insertCalendarEvent, patchCalendarEvent, deleteCalendarEvent,
  sbSelect, sbInsert, sbUpdate, sbDelete,
} from './_shared';

interface WorkTaskRow {
  id: string;
  user_id: string;
  title: string;
  due_date: string;
  notes: string | null;
  status: 'pending' | 'in_progress' | 'done' | 'ngung_hd';
  completed_at: string | null;
  updated_at: string;
}

interface LinkRow {
  id: string;
  work_task_id: string;
  google_event_id: string | null;
  web_updated_at: string | null;
  google_updated_at: string | null;
}

export interface SyncSummary {
  pushedCreated: number;   // web -> Calendar: event moi (bao gom tao lai event bi xoa tay tren Calendar)
  pushedUpdated: number;   // web -> Calendar: cap nhat
  pushedDeleted: number;   // web xoa -> xoa event ben Calendar
  pulledUpdated: number;   // Calendar -> web: cap nhat ngay/tieu de/ghi chu
  calendarError?: string;  // loi Calendar (vd: thieu quyen -> can ket noi lai)
}

const DONE_STATUSES = new Set(['done', 'ngung_hd']);
// Chi day len Calendar: task chua xong, hoac xong trong 14 ngay gan day (tranh do ca lich su cu len).
const PUSH_DONE_WINDOW_MS = 14 * 24 * 3600 * 1000;

// Danh dau task den tu web app (LetsGo) de phan biet voi viec ca nhan khac cua user tren Google.
const ORIGIN_ICON = '🎯 ';
function stripOriginIcon(s: string): string {
  return s.replace(/^🎯\s*/, '').replace(/^✅\s*/, '').trim();
}

function shouldPushNew(t: WorkTaskRow): boolean {
  if (!DONE_STATUSES.has(t.status)) return true;
  const doneAt = t.completed_at || t.updated_at;
  return !!doneAt && Date.now() - new Date(doneAt).getTime() < PUSH_DONE_WINDOW_MS;
}

function nextDayStr(day: string): string {
  const dt = new Date(`${day}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

// Event ca ngay (all-day): end.date la exclusive nen = ngay hom sau.
function toEventBody(t: WorkTaskRow): GoogleEventBody {
  const day = t.due_date || new Date().toISOString().slice(0, 10);
  return {
    summary: `${ORIGIN_ICON}${DONE_STATUSES.has(t.status) ? '✅ ' : ''}${t.title || '(Không tiêu đề)'}`,
    description: t.notes || '',
    start: { date: day },
    end: { date: nextDayStr(day) },
    extendedProperties: { private: { letsgo: '1' } },
  };
}

// Calendar -> web: chi keo ve tieu de/ghi chu/ngay — khong co khai niem hoan thanh tren Calendar event.
function toWebPatchFromEvent(ev: GoogleCalendarEventFull, current: WorkTaskRow): Partial<WorkTaskRow> & { updated_at: string } {
  const now = new Date().toISOString();
  const patch: Partial<WorkTaskRow> & { updated_at: string } = { updated_at: now };
  const evTitle = stripOriginIcon(ev.summary || '');
  if (evTitle && evTitle !== current.title) patch.title = evTitle;
  const evNotes = (ev.description || '').trim() || null;
  if (evNotes !== (current.notes || null)) patch.notes = evNotes;
  const d = ev.start?.date;
  if (d && d !== current.due_date) patch.due_date = d;
  return patch;
}

export async function reconcile(conn: GoogleConnection): Promise<SyncSummary> {
  const summary: SyncSummary = { pushedCreated: 0, pushedUpdated: 0, pushedDeleted: 0, pulledUpdated: 0 };

  if (!conn.calendar_id) {
    // Chua chon lich -> khong co gi de dong bo, chi cap nhat moc thoi gian.
    await sbUpdate('google_connections', `id=eq.${conn.id}`, {
      last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return summary;
  }

  const accessToken = await refreshAccessToken(await decryptText(conn.refresh_token_enc));
  const calId = conn.calendar_id;

  let events: GoogleCalendarEventFull[];
  try {
    events = await listMirroredEvents(accessToken, calId);
  } catch (e) {
    summary.calendarError = e instanceof Error ? e.message : String(e);
    return summary;
  }

  const [webTasks, links] = await Promise.all([
    sbSelect<WorkTaskRow>('work_tasks', `user_id=eq.${conn.user_id}&select=id,user_id,title,due_date,notes,status,completed_at,updated_at`),
    sbSelect<LinkRow>('google_task_links', `user_id=eq.${conn.user_id}&select=id,work_task_id,google_event_id,web_updated_at,google_updated_at`),
  ]);

  const webById = new Map(webTasks.map(t => [t.id, t]));
  const evById = new Map(events.map(e => [e.id, e]));
  const linkedWebIds = new Set(links.map(l => l.work_task_id));

  const fail = (e: unknown) => { summary.calendarError = e instanceof Error ? e.message : String(e); };

  // ── 1. Cac cap da lien ket ──
  for (const link of links) {
    const web = webById.get(link.work_task_id);
    const ev = link.google_event_id ? evById.get(link.google_event_id) : undefined;
    const evAlive = !!ev && ev.status !== 'cancelled';

    if (!web) {
      // Web xoa -> xoa event (neu con) + xoa link.
      if (evAlive) {
        try {
          await deleteCalendarEvent(accessToken, calId, link.google_event_id!);
          summary.pushedDeleted++;
        } catch (e) { fail(e); }
      }
      await sbDelete('google_task_links', `id=eq.${link.id}`);
      continue;
    }

    if (!evAlive) {
      // Event bi xoa/mat tren Calendar -> KHONG dung toi web, tu tao lai (mirror tu healing).
      if (shouldPushNew(web)) {
        try {
          const created = await insertCalendarEvent(accessToken, calId, toEventBody(web));
          await sbUpdate('google_task_links', `id=eq.${link.id}`, {
            google_event_id: created.id, web_updated_at: web.updated_at,
            google_updated_at: new Date().toISOString(),
          });
          summary.pushedCreated++;
        } catch (e) { fail(e); }
      }
      continue;
    }

    // Ca 2 con song: xet ben nao doi so voi lan sync truoc.
    const webChanged = !link.web_updated_at || new Date(web.updated_at) > new Date(link.web_updated_at);
    const gChanged = !link.google_updated_at || new Date(ev!.updated || 0) > new Date(link.google_updated_at);
    if (!webChanged && !gChanged) continue;

    const webWins = webChanged && (!gChanged || new Date(web.updated_at) >= new Date(ev!.updated || 0));
    if (webWins) {
      try {
        await patchCalendarEvent(accessToken, calId, link.google_event_id!, toEventBody(web));
        summary.pushedUpdated++;
        await sbUpdate('google_task_links', `id=eq.${link.id}`, {
          web_updated_at: web.updated_at, google_updated_at: new Date().toISOString(),
        });
      } catch (e) { fail(e); }
    } else {
      const patch = toWebPatchFromEvent(ev!, web);
      if (Object.keys(patch).length > 1) {
        await sbUpdate('work_tasks', `id=eq.${web.id}`, patch);
        summary.pulledUpdated++;
        await sbUpdate('google_task_links', `id=eq.${link.id}`, {
          web_updated_at: patch.updated_at, google_updated_at: ev!.updated || new Date().toISOString(),
        });
      } else {
        await sbUpdate('google_task_links', `id=eq.${link.id}`, {
          web_updated_at: web.updated_at, google_updated_at: ev!.updated || new Date().toISOString(),
        });
      }
    }
  }

  // ── 2. Task web chua co link -> tao event moi tren Calendar ──
  for (const t of webTasks) {
    if (linkedWebIds.has(t.id) || !shouldPushNew(t)) continue;
    try {
      const created = await insertCalendarEvent(accessToken, calId, toEventBody(t));
      summary.pushedCreated++;
      await sbInsert('google_task_links', {
        user_id: conn.user_id, work_task_id: t.id, google_event_id: created.id,
        web_updated_at: t.updated_at, google_updated_at: new Date().toISOString(),
      });
    } catch (e) { fail(e); }
  }

  await sbUpdate('google_connections', `id=eq.${conn.id}`, {
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  return summary;
}
