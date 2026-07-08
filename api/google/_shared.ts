// Helper dung chung cho cac Vercel Edge Function /api/google/* (dong bo work_tasks <-> Google Calendar event).
// File bat dau bang "_" nen KHONG duoc deploy thanh endpoint.
//
// Env bat buoc (Vercel > Settings > Environment Variables, KHONG tien to VITE_):
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  — OAuth client (Web application)
//   GOOGLE_TOKEN_ENC_KEY                     — 32 byte base64 (tao: openssl rand -base64 32) de ma hoa refresh token
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — goi REST voi service role (bang google_* da chan anon)
//   GOOGLE_REDIRECT_URI (tuy chon)           — mac dinh suy ra tu request: https://<host>/api/google/callback

// ── Tien ich chung ──────────────────────────────────────────────────────────

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Server chua cau hinh ${name}`);
  return v;
}

export function redirectUri(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || url.host;
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}/api/google/callback`;
}

// ── Ma hoa AES-GCM (refresh token + state OAuth) ────────────────────────────

async function encKey(): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(requiredEnv('GOOGLE_TOKEN_ENC_KEY')), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptText(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await encKey(), new TextEncoder().encode(plain),
  ));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decryptText(encoded: string): Promise<string> {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf.slice(0, 12) }, await encKey(), buf.slice(12),
  );
  return new TextDecoder().decode(plain);
}

// ── Supabase REST (service role) ────────────────────────────────────────────

function sbHeaders(): Record<string, string> {
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

export async function sbSelect<T>(table: string, query: string): Promise<T[]> {
  const res = await fetch(`${requiredEnv('SUPABASE_URL')}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase select ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function sbInsert<T>(table: string, rows: unknown, onConflict?: string): Promise<T[]> {
  const url = `${requiredEnv('SUPABASE_URL')}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
  const headers = sbHeaders();
  if (onConflict) headers.Prefer = 'return=representation,resolution=merge-duplicates';
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`Supabase insert ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function sbUpdate(table: string, filter: string, patch: unknown): Promise<void> {
  const res = await fetch(`${requiredEnv('SUPABASE_URL')}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update ${table}: ${res.status} ${await res.text()}`);
}

export async function sbDelete(table: string, filter: string): Promise<void> {
  const res = await fetch(`${requiredEnv('SUPABASE_URL')}/rest/v1/${table}?${filter}`, {
    method: 'DELETE', headers: sbHeaders(),
  });
  if (!res.ok) throw new Error(`Supabase delete ${table}: ${res.status} ${await res.text()}`);
}

// Token phien letsgo (bang app_sessions) -> user_id, hoac null neu het han/khong hop le.
export async function validateSession(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const rows = await sbSelect<{ user_id: string; expires_at: string }>(
    'app_sessions', `token=eq.${encodeURIComponent(token)}&select=user_id,expires_at`,
  );
  const s = rows[0];
  if (!s || new Date(s.expires_at) <= new Date()) return null;
  return s.user_id;
}

// ── Google OAuth + Calendar API ─────────────────────────────────────────────

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',    // tao/sua/xoa event tren lich user chon
  'https://www.googleapis.com/auth/calendar.readonly',  // liet ke danh sach lich de user chon
  'openid', 'email',
].join(' ');
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

interface TokenResponse { access_token: string; refresh_token?: string; id_token?: string; error?: string; error_description?: string }

export async function exchangeCode(code: string, redirect: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requiredEnv('GOOGLE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  const data: TokenResponse = await res.json();
  if (!data.access_token) throw new Error(`Google refresh token loi: ${data.error || res.status} (co the user da thu hoi quyen — can ket noi lai)`);
  return data.access_token;
}

// Doc email tu id_token (JWT) — chi decode payload, khong can verify vi lay truc tiep tu Google qua HTTPS.
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch { return null; }
}

// ── Google Calendar API ─────────────────────────────────────────────────────

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
}

export interface GoogleEventBody {
  summary: string;
  description?: string;
  start: { date: string };   // event ca ngay (all-day)
  end: { date: string };     // exclusive: ngay hom sau cua due_date
  extendedProperties?: { private?: Record<string, string> };
}

// Event tra ve tu events.list — chi doc, dung de reconcile (Calendar -> web).
export interface GoogleCalendarEventFull {
  id: string;
  status?: string;           // 'confirmed' | 'cancelled' (bi xoa, chi con id+status khi showDeleted)
  summary?: string;
  description?: string;
  start?: { date?: string };
  end?: { date?: string };
  updated?: string;
}

async function calFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CAL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
}

// Liet ke cac lich user co quyen GHI (de do event vao).
export async function listCalendars(accessToken: string): Promise<GoogleCalendarInfo[]> {
  const out: GoogleCalendarInfo[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ minAccessRole: 'writer', maxResults: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await calFetch(accessToken, `/users/me/calendarList?${qs}`);
    if (!res.ok) throw new Error(`Google calendarList loi: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const c of data.items || []) {
      out.push({ id: c.id, summary: c.summaryOverride || c.summary, primary: c.primary, accessRole: c.accessRole });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

// Liet ke CHI cac event do chinh app nay tao (danh dau qua extendedProperties.private.letsgo=1),
// khong dung toi event ca nhan khac cua user tren cung lich. showDeleted=true de phat hien event
// bi xoa tay tren Calendar (status='cancelled') ma van con link trong DB.
export async function listMirroredEvents(accessToken: string, calendarId: string): Promise<GoogleCalendarEventFull[]> {
  const out: GoogleCalendarEventFull[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({
      maxResults: '250', singleEvents: 'true', showDeleted: 'true',
      privateExtendedProperty: 'letsgo=1',
    });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await calFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?${qs}`);
    if (!res.ok) throw new Error(`Google events.list loi: ${res.status} ${await res.text()}`);
    const data = await res.json();
    out.push(...(data.items || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

export async function insertCalendarEvent(accessToken: string, calendarId: string, body: GoogleEventBody): Promise<{ id: string }> {
  const res = await calFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST', body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google events.insert loi: ${res.status} ${await res.text()}`);
  return res.json();
}

// Tra ve false neu event khong con ton tai (404/410) — caller nen tao lai.
export async function patchCalendarEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<boolean> {
  const res = await calFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) throw new Error(`Google events.patch loi: ${res.status} ${await res.text()}`);
  return true;
}

export async function deleteCalendarEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const res = await calFetch(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
  // 404/410: event da bi xoa tu truoc — coi nhu thanh cong.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google events.delete loi: ${res.status} ${await res.text()}`);
  }
}

// ── Bang ket noi ────────────────────────────────────────────────────────────

export interface GoogleConnection {
  id: string;
  user_id: string;
  google_email: string | null;
  refresh_token_enc: string;
  calendar_id: string | null;       // lich Google user chon de mirror task (NULL = tat)
  calendar_summary: string | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
}

export async function getConnection(userId: string): Promise<GoogleConnection | null> {
  const rows = await sbSelect<GoogleConnection>('google_connections', `user_id=eq.${userId}&select=*`);
  return rows[0] || null;
}
