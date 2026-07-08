// Client goi cac endpoint /api/google/* (Vercel Function) de dong bo work_tasks <-> Google Tasks.
// Luu y: /api chi ton tai khi deploy Vercel (giong gemini) — chay `vite dev` thuan se khong co,
// moi ham deu nuot loi mang de khong anh huong luong chinh.

export interface GoogleSyncStatus {
  connected: boolean;
  email: string | null;
  lastSyncedAt: string | null;
}

export interface GoogleSyncSummary {
  pushedCreated: number;
  pushedUpdated: number;
  pushedDeleted: number;
  pulledCreated: number;
  pulledUpdated: number;
  pulledDeleted: number;
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`/api/google/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getGoogleSyncStatus(token: string): Promise<GoogleSyncStatus | null> {
  return post<GoogleSyncStatus>('account', { token, action: 'status' });
}

export async function disconnectGoogle(token: string): Promise<boolean> {
  const res = await post<{ ok: boolean }>('account', { token, action: 'disconnect' });
  return !!res?.ok;
}

// Lay URL consent roi chuyen huong ca trang sang Google.
export async function startGoogleConnect(token: string): Promise<string | null> {
  const res = await post<{ url?: string; error?: string }>('auth-url', { token });
  if (res?.url) {
    window.location.href = res.url;
    return null;
  }
  return res?.error || 'Không gọi được máy chủ đồng bộ (chỉ hoạt động trên bản deploy Vercel)';
}

// Tong so thay doi keo VE web — neu > 0 thi nen reload danh sach task.
export function pulledChanges(s: GoogleSyncSummary | undefined | null): number {
  if (!s) return 0;
  return s.pulledCreated + s.pulledUpdated + s.pulledDeleted;
}

export async function syncGoogleNow(token: string): Promise<{ connected: boolean; summary?: GoogleSyncSummary } | null> {
  return post<{ connected: boolean; summary?: GoogleSyncSummary }>('sync', { token });
}

// Goi sau moi thao tac tao/sua/xoa task: gom nhieu lan goi trong 2.5s thanh 1 lan sync (fire-and-forget).
let queueTimer: ReturnType<typeof setTimeout> | null = null;
export function queueGoogleSync(token: string | null, onPulled?: (n: number) => void) {
  if (!token) return;
  if (queueTimer) clearTimeout(queueTimer);
  queueTimer = setTimeout(async () => {
    queueTimer = null;
    const res = await syncGoogleNow(token);
    const n = pulledChanges(res?.summary);
    if (n > 0 && onPulled) onPulled(n);
  }, 2500);
}
