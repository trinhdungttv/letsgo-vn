// ============================================================================
// Xếp sao công ty khách hàng — mức ưu tiên chăm sóc (migration 198, cột clients.star_rating).
//   3 ★ Quan trọng · 2 ★ Bình thường · 1 ★ Dự án nhỏ (có thể thay thế) · null = chưa xếp sao
//
// NGUỒN DUY NHẤT là clients.star_rating. CSKH không lưu sao riêng: sao của 1 người liên hệ = sao
// CAO NHẤT trong các công ty người đó gắn (contactStarOf) → đổi sao ở Khách hàng là CSKH đổi theo.
// ============================================================================
import { supabase } from './supabase';
import { logActivity } from './audit';
import type { AppUser, Client } from './types';

export type ClientStar = 1 | 2 | 3;

/** Thứ tự hiển thị: quan trọng nhất trước. */
export const CLIENT_STARS: readonly ClientStar[] = [3, 2, 1];

export const CLIENT_STAR_LABEL: Readonly<Record<ClientStar, string>> = {
  3: 'Quan trọng',
  2: 'Bình thường',
  1: 'Dự án nhỏ',
};

export const CLIENT_STAR_HINT: Readonly<Record<ClientStar, string>> = {
  3: 'Khách quan trọng — ưu tiên chăm sóc trước',
  2: 'Khách bình thường',
  1: 'Dự án nhỏ — có thể thay thế',
};

/** Màu chữ sao theo mức (vàng đậm → vàng → xám). */
export const CLIENT_STAR_COLOR: Readonly<Record<ClientStar, string>> = {
  3: '#E8890C',
  2: '#F5B301',
  1: '#A1A1AA',
};

/** "★★★", "★★", "★" */
export const starGlyphs = (n: ClientStar): string => '★'.repeat(n);

/** Đọc sao của 1 công ty — chưa chạy migration / giá trị lạ đều coi là chưa xếp. */
export function clientStarOf(c: Pick<Client, 'star_rating'> | null | undefined): ClientStar | null {
  const v = Number(c?.star_rating);
  return v === 1 || v === 2 || v === 3 ? v : null;
}

/** Sao của người liên hệ = sao cao nhất trong các công ty họ gắn. */
export function contactStarOf(
  clientIds: readonly string[],
  clientById: ReadonlyMap<string, Pick<Client, 'star_rating'>>,
): ClientStar | null {
  let best: ClientStar | null = null;
  for (const id of clientIds) {
    const s = clientStarOf(clientById.get(id));
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

// ── Bộ lọc ─────────────────────────────────────────────────────────────────
/** 'all' | '3' | '2' | '1' | 'none' (chưa xếp sao) */
export type StarFilter = 'all' | '3' | '2' | '1' | 'none';
export const STAR_FILTERS: readonly StarFilter[] = ['all', '3', '2', '1', 'none'];

export function starFilterLabel(f: StarFilter): string {
  if (f === 'all') return 'Mọi mức sao';
  if (f === 'none') return 'Chưa xếp sao';
  const n = Number(f) as ClientStar;
  return `${starGlyphs(n)} ${CLIENT_STAR_LABEL[n]}`;
}

export function isStarFilter(v: unknown): v is StarFilter {
  return typeof v === 'string' && (STAR_FILTERS as readonly string[]).includes(v);
}

export function matchesStarFilter(star: ClientStar | null, f: StarFilter): boolean {
  if (f === 'all') return true;
  if (f === 'none') return star === null;
  return star === Number(f);
}

// ── Lưu ────────────────────────────────────────────────────────────────────
const isMissingColumn = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === '42703' || err.code === 'PGRST204' || /star_rating/.test(err.message ?? ''));

/**
 * Gán / bỏ sao cho 1 công ty. Trả về bản ghi công ty đã cập nhật (để đưa vào state của App →
 * CSKH đọc cùng mảng clients nên tự đổi theo). Ném lỗi tiếng Việt nếu chưa chạy migration 198.
 */
export async function saveClientStar(client: Client, star: ClientStar | null, user: AppUser | null): Promise<Client> {
  const updates = { star_rating: star, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('clients').update(updates).eq('id', client.id);
  if (error) {
    if (isMissingColumn(error)) throw new Error('Chưa chạy migration 198 (cột star_rating) — nhờ admin chạy trong Supabase');
    throw new Error(error.message);
  }
  const next: Client = { ...client, ...updates };
  const before = clientStarOf(client);
  const fmt = (s: ClientStar | null) => (s ? `${starGlyphs(s)} ${CLIENT_STAR_LABEL[s]}` : 'chưa xếp sao');
  await logActivity({
    user, action: 'update', table: 'clients', recordId: client.id,
    description: `Xếp sao "${client.name}": ${fmt(before)} → ${fmt(star)}`,
    oldData: { star_rating: client.star_rating ?? null }, newData: { star_rating: star },
  });
  return next;
}
