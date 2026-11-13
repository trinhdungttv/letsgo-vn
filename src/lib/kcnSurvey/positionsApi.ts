// Danh mục ngành nghề (migration 225 — bảng kcn_survey_positions) + đổi tên / chọn lại ngành trên ảnh chỉ tiêu.
// Chưa chạy 225 → dùng danh sách viết sẵn (POSITION_PRESETS), vẫn chọn ngành bình thường; chỉ sửa danh mục là báo cần chạy.
// Phần thuần ở positions.ts.
import { supabase } from '../supabase';
import { isMissingTableError } from '../clientMaps/orgChart';
import { POSITION_PRESETS, positionKey, type UsagePhoto } from './positions';
import { updatePhoto } from './api';

export const POSITIONS_MIGRATION_HINT = 'Cần chạy migration 225 (danh mục ngành nghề) trong Supabase → SQL Editor để lưu danh mục';
export class PositionsMissingTable extends Error {}

export interface PositionItem {
  /** null = danh sách viết sẵn (chưa có bảng) */
  id: string | null;
  name: string;
  sort: number;
}

const fail = (e: { code?: string; message?: string }): never => {
  if (isMissingTableError(e)) throw new PositionsMissingTable(POSITIONS_MIGRATION_HINT);
  if (e.code === '23505') throw new Error('Đã có ngành trùng tên này trong danh mục');
  throw new Error(e.message ?? String(e));
};

export const presetItems = (): PositionItem[] => POSITION_PRESETS.map((name, i) => ({ id: null, name, sort: (i + 1) * 10 }));

export async function listPositionCatalog(): Promise<{ items: PositionItem[]; missing: boolean }> {
  const { data, error } = await supabase.from('kcn_survey_positions').select('id, name, sort').is('deleted_at', null)
    .order('sort', { ascending: true }).order('name', { ascending: true }).limit(1000);
  if (error) {
    if (isMissingTableError(error)) return { items: presetItems(), missing: true };
    throw new Error(error.message);
  }
  return { items: ((data ?? []) as PositionItem[]).filter(r => r.name?.trim()), missing: false };
}

export async function addCatalogPosition(name: string, sort: number, userName: string): Promise<PositionItem> {
  const { data, error } = await supabase.from('kcn_survey_positions')
    .insert({ name: name.trim(), sort, created_by: userName, updated_by: userName }).select('id, name, sort').single();
  if (error) fail(error);
  return data as PositionItem;
}

export async function renameCatalogPosition(id: string, name: string, userName: string): Promise<void> {
  const { error } = await supabase.from('kcn_survey_positions').update({ name: name.trim(), updated_by: userName }).eq('id', id);
  if (error) fail(error);
}

/** Bỏ khỏi danh mục = xoá MỀM (deleted_at), dòng vẫn còn */
export async function removeCatalogPosition(id: string, userName: string): Promise<void> {
  const { error } = await supabase.from('kcn_survey_positions').update({ deleted_at: new Date().toISOString(), updated_by: userName }).eq('id', id);
  if (error) fail(error);
}

/** Mọi ảnh chỉ tiêu (chưa xoá) đang có ghi ngành — để đếm ngành theo công ty và đổi tên hàng loạt. */
export async function loadPositionUsagePhotos(): Promise<UsagePhoto[]> {
  const out: UsagePhoto[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await supabase.from('kcn_survey_photos').select('id, company_name, zone_name, positions, thumb_url, url')
      .is('deleted_at', null).neq('positions', '').order('taken_at', { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as UsagePhoto[];
    out.push(...rows.map(r => ({ ...r, company_name: r.company_name ?? '', zone_name: r.zone_name ?? '', positions: r.positions ?? '' })));
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Ghi chữ ngành mới lên từng ảnh (5 ảnh song song). Dừng ở lỗi đầu tiên; trả các ảnh ĐÃ ghi xong. */
export async function writePhotoPositions(changes: readonly { id: string; positions: string }[], onProgress?: (done: number) => void): Promise<{ done: { id: string; positions: string }[]; error: string | null }> {
  const done: { id: string; positions: string }[] = [];
  let error: string | null = null;
  let next = 0;
  const worker = async () => {
    while (!error && next < changes.length) {
      const c = changes[next++];
      try {
        await updatePhoto(c.id, { positions: c.positions });
        done.push(c);
        onProgress?.(done.length);
      } catch (e) { error = (e as Error).message; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, changes.length) }, worker));
  return { done, error };
}

/** Ngành đã có trong danh mục chưa (so bỏ dấu) */
export const findCatalogItem = (items: readonly PositionItem[], name: string) => items.find(i => positionKey(i.name) === positionKey(name)) ?? null;
