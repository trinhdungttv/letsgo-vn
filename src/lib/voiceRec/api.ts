// Ghi âm trong CRM (ghé chi nhánh / gọi chăm sóc / ghi chú công ty) — bảng crm_voice_recordings + bucket 'crm-voice' (migration 206).
// Chỉ ghi âm + lưu file để nghe lại (chưa chép lời tự động). Xoá = xoá mềm.
import { supabase } from '../supabase';

export const VOICE_BUCKET = 'crm-voice';
export const VOICE_MIGRATION_HINT = 'Cần chạy migration 206 (Ghi âm CRM) trong Supabase → SQL Editor';

export type VoiceSubject = 'branch_visit' | 'contact_call' | 'company_note';

export interface VoiceRecording {
  id: string;
  subject_type: VoiceSubject;
  subject_id: string;
  related_date: string | null;
  title: string;
  duration_s: number;
  size_bytes: number;
  mime_type: string;
  storage_path: string;
  url: string;
  user_name: string;
  recorded_at: string;
}

const COLS = 'id, subject_type, subject_id, related_date, title, duration_s, size_bytes, mime_type, storage_path, url, user_name, recorded_at';

export function isMissingVoiceSetup(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || /crm_voice|crm-voice|bucket not found|schema cache|does not exist/i.test(e.message ?? '');
}

const norm = (r: VoiceRecording): VoiceRecording => ({ ...r, duration_s: Number(r.duration_s) || 0, size_bytes: Number(r.size_bytes) || 0 });

export async function listVoice(type: VoiceSubject, subjectId: string): Promise<VoiceRecording[]> {
  const { data, error } = await supabase.from('crm_voice_recordings').select(COLS)
    .eq('subject_type', type).eq('subject_id', subjectId).is('deleted_at', null)
    .order('recorded_at', { ascending: false }).limit(300);
  if (error) throw error;
  return ((data ?? []) as VoiceRecording[]).map(norm);
}

export interface VoiceUploadInput {
  /** mã dòng — truyền vào để tải lại không tạo trùng (bản lưu tạm trên máy dùng lại mã cũ) */
  id?: string;
  type: VoiceSubject;
  subjectId: string;
  relatedDate?: string | null;
  title?: string;
  blob: Blob;
  mime: string;
  ext: string;
  durationSec: number;
  recordedAt?: Date;
  userId: string;
  userName: string;
}

/** Tải file lên bucket rồi ghi 1 dòng. Lỗi bucket / bảng chưa có → ném lỗi (isMissingVoiceSetup). */
export async function uploadVoice(inp: VoiceUploadInput): Promise<VoiceRecording> {
  const rowId = inp.id ?? crypto.randomUUID();
  const month = new Date().toISOString().slice(0, 7);
  const path = `${inp.type}/${month}/${rowId}.${inp.ext}`;
  const bucket = supabase.storage.from(VOICE_BUCKET);
  const { error: upErr } = await bucket.upload(path, inp.blob, { upsert: false, contentType: inp.mime || inp.blob.type || 'audio/webm', cacheControl: '31536000' });
  // Tải lại bản đã lên rồi (cùng mã) → coi như xong, chỉ ghi nốt dòng dữ liệu
  if (upErr && !/already exists|duplicate/i.test(upErr.message ?? '')) throw upErr;
  const row = {
    id: rowId, subject_type: inp.type, subject_id: inp.subjectId, related_date: inp.relatedDate ?? null,
    title: inp.title ?? '', duration_s: Math.round(inp.durationSec * 10) / 10, size_bytes: inp.blob.size,
    mime_type: inp.mime, storage_path: path, url: bucket.getPublicUrl(path).data.publicUrl,
    user_id: inp.userId, user_name: inp.userName, recorded_at: (inp.recordedAt ?? new Date()).toISOString(),
  };
  const { data, error } = await supabase.from('crm_voice_recordings').upsert(row, { onConflict: 'id' }).select(COLS).single();
  if (error) throw error;
  return norm(data as VoiceRecording);
}

export async function renameVoice(id: string, title: string): Promise<void> {
  const { error } = await supabase.from('crm_voice_recordings').update({ title }).eq('id', id);
  if (error) throw error;
}

/** Xoá mềm — file vẫn trong Storage. */
export async function deleteVoice(id: string): Promise<void> {
  const { error } = await supabase.from('crm_voice_recordings').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Mọi bản ghi của 1 loại (mới nhất trước) — để hiện cạnh dòng nhật ký tương ứng. */
export async function listVoiceByType(type: VoiceSubject, limit = 500): Promise<VoiceRecording[]> {
  const { data, error } = await supabase.from('crm_voice_recordings').select(COLS)
    .eq('subject_type', type).is('deleted_at', null).order('recorded_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return ((data ?? []) as VoiceRecording[]).map(norm);
}
