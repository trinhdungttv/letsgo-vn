// Engine reconcile 2 chieu work_tasks <-> Google Tasks cho 1 user + mirror sang Google Calendar.
// Nguyen tac Tasks: so updated_at (web) va .updated (Google) voi moc luu trong google_task_links;
// ben nao doi moi hon thi thang (last-write-wins). Xoa ben nay -> xoa ben kia.
// Calendar: MIRROR 1 chieu web -> lich user da chon (event ca ngay theo due_date, xong thi them ✅).
// File bat dau bang "_" nen KHONG duoc deploy thanh endpoint.

import {
  GoogleTask, GoogleConnection, GoogleEventBody,
  decryptText, refreshAccessToken, ensureTasklist, listGoogleTasks,
  insertGoogleTask, patchGoogleTask, deleteGoogleTask,
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
  google_task_id: string;
  google_event_id: string | null;
  web_updated_at: string | null;
  google_updated_at: string | null;
}

export interface SyncSummary {
  pushedCreated: number;   // web -> Google Tasks: task moi
  pushedUpdated: number;   // web -> Google Tasks: cap nhat
  pushedDeleted: number;   // web xoa -> xoa ben Google
  pulledCreated: number;   // Google -> web: task moi
  pulledUpdated: number;   // Google -> web: cap nhat
  pulledDeleted: number;   // Google xoa -> xoa ben web
  calendarUpserted: number; // event Calendar tao/cap nhat
  calendarDeleted: number;  // event Calendar xoa
  calendarError?: string;   // loi Calendar (vd: thieu quyen -> can ket noi lai); Tasks van chay binh thuong
}

const DONE_STATUSES = new Set(['done', 'ngung_hd']);
// Chi day len Google: task chua xong, hoac xong trong 14 ngay gan day (tranh do ca lich su cu len).
const PUSH_DONE_WINDOW_MS = 14 * 24 * 3600 * 1000;

function toGoogleBody(t: WorkTaskRow): Partial<GoogleTask> {
  return {
    title: t.title || '(Không tiêu đề)',
    notes: t.notes || '',
    due: t.due_date ? `${t.due_date}T00:00:00.000Z` : undefined,
    status: DONE_STATUSES.has(t.status) ? 'completed' : 'needsAction',
  };
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
    summary: `${DONE_STATUSES.has(t.status) ? '✅ ' : ''}${t.title || '(Không tiêu đề)'}`,
    description: t.notes || '',
    start: { date: day },
    end: { date: nextDayStr(day) },
  };
}

// Google -> web: patch cac truong Google quan ly; giu nguyen in_progress neu web dang lam do va Google chua xong.
function toWebPatch(g: GoogleTask, current: WorkTaskRow): Partial<WorkTaskRow> & { updated_at: string } {
  const now = new Date().toISOString();
  const patch: Partial<WorkTaskRow> & { updated_at: string } = { updated_at: now };
  const gTitle = (g.title || '').trim();
  if (gTitle && gTitle !== current.title) patch.title = gTitle;
  const gNotes = (g.notes || '').trim() || null;
  if (gNotes !== (current.notes || null)) patch.notes = gNotes;
  if (g.due) {
    const d = g.due.slice(0, 10);
    if (d !== current.due_date) patch.due_date = d;
  }
  if (g.status === 'completed' && !DONE_STATUSES.has(current.status)) {
    patch.status = 'done';
    patch.completed_at = g.completed || now;
  } else if (g.status === 'needsAction' && current.status === 'done') {
    // Bo tich ben Google -> mo lai tren web. Rieng ngung_hd la trang thai nghiep vu, khong tu mo lai.
    patch.status = 'pending';
    patch.completed_at = null;
  }
  return patch;
}

export async function reconcile(conn: GoogleConnection): Promise<SyncSummary> {
  const summary: SyncSummary = {
    pushedCreated: 0, pushedUpdated: 0, pushedDeleted: 0,
    pulledCreated: 0, pulledUpdated: 0, pulledDeleted: 0,
    calendarUpserted: 0, calendarDeleted: 0,
  };

  const accessToken = await refreshAccessToken(await decryptText(conn.refresh_token_enc));
  const tasklistId = await ensureTasklist(accessToken, conn.tasklist_id);
  if (tasklistId !== conn.tasklist_id) {
    await sbUpdate('google_connections', `id=eq.${conn.id}`, { tasklist_id: tasklistId, updated_at: new Date().toISOString() });
  }

  // ── Mirror Calendar: loi (vd thieu quyen vi ket noi truoc khi nang cap scope) chi tat phan Calendar,
  //    khong lam hong dong bo Tasks.
  const calId = conn.calendar_id;
  let calOk = !!calId;
  const calFail = (e: unknown) => {
    calOk = false;
    summary.calendarError = e instanceof Error ? e.message : String(e);
  };
  const calDelete = async (eventId: string | null) => {
    if (!calOk || !eventId) return;
    try {
      await deleteCalendarEvent(accessToken, calId!, eventId);
      summary.calendarDeleted++;
    } catch (e) { calFail(e); }
  };
  const calUpsert = async (linkId: string, eventId: string | null, t: WorkTaskRow) => {
    if (!calOk) return;
    try {
      const body = toEventBody(t);
      if (eventId && await patchCalendarEvent(accessToken, calId!, eventId, body)) {
        summary.calendarUpserted++;
        return;
      }
      // Chua co event (hoac bi xoa tay tren Calendar) -> tao moi
      const created = await insertCalendarEvent(accessToken, calId!, body);
      await sbUpdate('google_task_links', `id=eq.${linkId}`, { google_event_id: created.id });
      summary.calendarUpserted++;
    } catch (e) { calFail(e); }
  };

  const [webTasks, links, gTasks] = await Promise.all([
    sbSelect<WorkTaskRow>('work_tasks', `user_id=eq.${conn.user_id}&select=id,user_id,title,due_date,notes,status,completed_at,updated_at`),
    sbSelect<LinkRow>('google_task_links', `user_id=eq.${conn.user_id}&select=id,work_task_id,google_task_id,google_event_id,web_updated_at,google_updated_at`),
    listGoogleTasks(accessToken, tasklistId),
  ]);

  const webById = new Map(webTasks.map(t => [t.id, t]));
  const gById = new Map(gTasks.map(t => [t.id, t]));
  const linkedWebIds = new Set(links.map(l => l.work_task_id));
  const linkedGoogleIds = new Set(links.map(l => l.google_task_id));

  // ── 1. Cac cap da lien ket ──
  for (const link of links) {
    const web = webById.get(link.work_task_id);
    const g = gById.get(link.google_task_id);
    const gAlive = g && !g.deleted;

    if (!web && !gAlive) {                    // ca 2 ben deu mat -> don link + event
      await calDelete(link.google_event_id);
      await sbDelete('google_task_links', `id=eq.${link.id}`);
      continue;
    }
    if (!web && gAlive) {                     // web xoa -> xoa Google task + event
      await deleteGoogleTask(accessToken, tasklistId, link.google_task_id);
      await calDelete(link.google_event_id);
      await sbDelete('google_task_links', `id=eq.${link.id}`);
      summary.pushedDeleted++;
      continue;
    }
    if (web && !gAlive) {                     // Google xoa -> xoa web + event
      await sbDelete('work_tasks', `id=eq.${web.id}`);
      await calDelete(link.google_event_id);
      await sbDelete('google_task_links', `id=eq.${link.id}`);
      summary.pulledDeleted++;
      continue;
    }

    // Ca 2 con song: xet ben nao doi so voi lan sync truoc.
    const webChanged = !link.web_updated_at || new Date(web!.updated_at) > new Date(link.web_updated_at);
    const gChanged = !link.google_updated_at || new Date(g!.updated || 0) > new Date(link.google_updated_at);

    if (!webChanged && !gChanged) {
      // Khong doi gi — chi backfill event neu user vua chon lich (link cu chua co event).
      if (calId && !link.google_event_id && shouldPushNew(web!)) {
        await calUpsert(link.id, null, web!);
      }
      continue;
    }

    const webWins = webChanged && (!gChanged || new Date(web!.updated_at) >= new Date(g!.updated || 0));
    if (webWins) {
      const patched = await patchGoogleTask(accessToken, tasklistId, g!.id, toGoogleBody(web!));
      summary.pushedUpdated++;
      await sbUpdate('google_task_links', `id=eq.${link.id}`, {
        web_updated_at: web!.updated_at, google_updated_at: patched.updated || new Date().toISOString(),
      });
      await calUpsert(link.id, link.google_event_id, web!);
    } else {
      const patch = toWebPatch(g!, web!);
      if (Object.keys(patch).length > 1) {    // co thay doi thuc su (ngoai updated_at)
        await sbUpdate('work_tasks', `id=eq.${web!.id}`, patch);
        summary.pulledUpdated++;
        await sbUpdate('google_task_links', `id=eq.${link.id}`, {
          web_updated_at: patch.updated_at, google_updated_at: g!.updated || new Date().toISOString(),
        });
        await calUpsert(link.id, link.google_event_id, { ...web!, ...patch } as WorkTaskRow);
      } else {                                // khong doi gi dang ke, chi cap moc de khoi xet lai
        await sbUpdate('google_task_links', `id=eq.${link.id}`, {
          web_updated_at: web!.updated_at, google_updated_at: g!.updated || new Date().toISOString(),
        });
        if (calId && !link.google_event_id && shouldPushNew(web!)) {
          await calUpsert(link.id, null, web!);
        }
      }
    }
  }

  // ── 2. Task web chua co link -> tao ben Google (Tasks + event Calendar) ──
  for (const t of webTasks) {
    if (linkedWebIds.has(t.id) || !shouldPushNew(t)) continue;
    const created = await insertGoogleTask(accessToken, tasklistId, toGoogleBody(t));
    summary.pushedCreated++;
    const linkRows = await sbInsert<LinkRow>('google_task_links', {
      user_id: conn.user_id, work_task_id: t.id, google_task_id: created.id,
      web_updated_at: t.updated_at, google_updated_at: created.updated || new Date().toISOString(),
    });
    await calUpsert(linkRows[0].id, null, t);
  }

  // ── 3. Task Google chua co link (tao truc tiep trong Google Tasks) -> tao tren web ──
  for (const g of gTasks) {
    if (linkedGoogleIds.has(g.id) || g.deleted) continue;
    if (!(g.title || '').trim()) continue;    // Google hay de lai task rong khi go phim — bo qua
    const now = new Date().toISOString();
    const rows = await sbInsert<WorkTaskRow>('work_tasks', {
      user_id: conn.user_id,
      client_id: null,
      title: (g.title || '').trim(),
      task_type: 'Văn phòng',
      due_date: g.due ? g.due.slice(0, 10) : now.slice(0, 10),
      priority: 'medium',
      kcn: null,
      notes: (g.notes || '').trim() || null,
      status: g.status === 'completed' ? 'done' : 'pending',
      completed_at: g.status === 'completed' ? (g.completed || now) : null,
    });
    summary.pulledCreated++;
    const linkRows = await sbInsert<LinkRow>('google_task_links', {
      user_id: conn.user_id, work_task_id: rows[0].id, google_task_id: g.id,
      web_updated_at: rows[0].updated_at || now, google_updated_at: g.updated || now,
    });
    await calUpsert(linkRows[0].id, null, rows[0]);
  }

  await sbUpdate('google_connections', `id=eq.${conn.id}`, {
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  return summary;
}
