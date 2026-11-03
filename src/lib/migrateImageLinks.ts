// Chuyển MỘT LẦN các link ảnh ngoài đang có trong hệ thống (Facebook, website…) về kho Cloudflare R2.
// Quét các bảng có cột ảnh → tải từng ảnh về R2 (qua /api/r2-import) → thay link trong đúng dòng đó.
// KHÔNG xoá gì: link gốc được ghi vào Nhật ký hoạt động (old_data) và trả về trong báo cáo để hoàn tác từng ảnh.
import { supabase } from './supabase';
import { logActivity } from './audit';
import { IMAGE_COLUMNS, isExternalImageUrl, isOwnHosted, mirrorImageUrl, withoutMirroring } from './mirrorImages';
import { r2Status } from './r2Upload';
import type { AppUser } from './types';

/** Bảng + cột ảnh (đúng tên cột trong DB). Bảng / cột chưa tồn tại thì bỏ qua. */
export const IMAGE_TABLES: { table: string; cols: readonly string[] }[] = [
  { table: 'clients', cols: ['cover_image_url', 'recruit_image_urls'] },
  { table: 'market_zones', cols: ['image_url'] },
  { table: 'competitors', cols: ['image_url'] },
  { table: 'market_leads', cols: ['cover_image_url', 'recruit_image_urls'] },
  { table: 'branches', cols: ['image_url', 'cover_image_url', 'manager_avatar_url'] },
  { table: 'branch_zones', cols: ['image_url'] },
  { table: 'contacts', cols: ['avatar_url'] },
];

export interface ImageLinkItem {
  id: string;
  table: string;
  col: string;
  label: string;
  url: string;
}

export interface ImageLinkResult extends ImageLinkItem {
  status: 'ok' | 'fail';
  to?: string;
  error?: string;
}

const labelOf = (r: Record<string, unknown>) => String(r.company_name ?? r.name ?? r.full_name ?? r.id ?? '');

/** Mọi link ảnh ngoài đang có (chưa nằm trong kho của app). */
export async function scanExternalImages(): Promise<{ items: ImageLinkItem[]; skipped: string[] }> {
  const st = await r2Status();
  const items: ImageLinkItem[] = [];
  const skipped: string[] = [];
  for (const { table, cols } of IMAGE_TABLES) {
    for (const col of cols) {
      if (!(IMAGE_COLUMNS as readonly string[]).includes(col)) continue;
      const { data, error } = await supabase.from(table).select(`id, ${col}`).not(col, 'is', null).limit(5000);
      if (error) { skipped.push(`${table}.${col}`); continue; }
      for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
        const v = r[col];
        const urls = Array.isArray(v) ? v : [v];
        for (const u of urls) {
          if (isExternalImageUrl(u) && !isOwnHosted(u, st.publicUrl)) items.push({ id: String(r.id), table, col, label: '', url: u });
        }
      }
    }
  }
  // Tên hiển thị: đọc 1 lần theo từng bảng
  const byTable = new Map<string, Set<string>>();
  for (const it of items) { const s = byTable.get(it.table) ?? new Set(); s.add(it.id); byTable.set(it.table, s); }
  for (const [table, ids] of byTable) {
    const { data } = await supabase.from(table).select('*').in('id', [...ids]);
    const names = new Map(((data ?? []) as Record<string, unknown>[]).map(r => [String(r.id), labelOf(r)]));
    items.filter(i => i.table === table).forEach(i => { i.label = names.get(i.id) ?? i.id; });
  }
  return { items, skipped };
}

/** Tải 1 ảnh về R2 rồi thay link trong đúng dòng (đọc lại dòng ngay trước khi ghi để không đè dữ liệu vừa sửa). */
export async function migrateOne(it: ImageLinkItem, user: AppUser | null): Promise<ImageLinkResult> {
  const to = await mirrorImageUrl(it.url);
  if (to === it.url) return { ...it, status: 'fail', error: 'Không tải được (link hết hạn, nguồn chặn, hoặc chưa cài R2)' };
  const { data: row, error } = await supabase.from(it.table).select(`id, ${it.col}`).eq('id', it.id).maybeSingle();
  if (error || !row) return { ...it, status: 'fail', error: error?.message ?? 'Không đọc được dòng dữ liệu' };
  const cur = (row as unknown as Record<string, unknown>)[it.col];
  const next = Array.isArray(cur) ? cur.map(u => (u === it.url ? to : u)) : cur === it.url ? to : cur;
  if (JSON.stringify(next) === JSON.stringify(cur)) return { ...it, status: 'fail', error: 'Dòng đã được sửa, link này không còn ở đó' };
  const { error: upErr } = await supabase.from(it.table).update({ [it.col]: next }).eq('id', it.id);
  if (upErr) return { ...it, status: 'fail', error: upErr.message };
  await logActivity({
    user, action: 'update', table: it.table, recordId: it.id,
    description: `Chuyển ảnh ngoài về Cloudflare (${it.col}) — "${it.label}"`, oldData: { [it.col]: cur }, newData: { [it.col]: next },
  });
  return { ...it, status: 'ok', to };
}

/** Hoàn tác 1 ảnh: ghi lại link gốc vào đúng chỗ. */
export async function revertOne(r: ImageLinkResult, user: AppUser | null): Promise<string | null> {
  if (!r.to) return 'Không có link để hoàn tác';
  const { data: row, error } = await supabase.from(r.table).select(`id, ${r.col}`).eq('id', r.id).maybeSingle();
  if (error || !row) return error?.message ?? 'Không đọc được dòng dữ liệu';
  const cur = (row as unknown as Record<string, unknown>)[r.col];
  const next = Array.isArray(cur) ? cur.map(u => (u === r.to ? r.url : u)) : cur === r.to ? r.url : cur;
  if (JSON.stringify(next) === JSON.stringify(cur)) return 'Dòng đã đổi, không hoàn tác được';
  // Ghi link gốc thẳng (không qua bộ đổi link) để không bị tải về lại ngay
  const { error: upErr } = await withoutMirroring(async () => supabase.from(r.table).update({ [r.col]: next }).eq('id', r.id));
  if (upErr) return upErr.message;
  await logActivity({ user, action: 'update', table: r.table, recordId: r.id, description: `Hoàn tác chuyển ảnh về Cloudflare (${r.col}) — "${r.label}"`, oldData: { [r.col]: cur }, newData: { [r.col]: next } });
  return null;
}
