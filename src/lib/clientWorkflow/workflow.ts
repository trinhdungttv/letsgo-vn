// Tab "Quy trình công việc" trong hồ sơ Khách hàng — xưởng → công đoạn, mỗi nơi gắn link video / ảnh thực tế.
// Bảng client_workflows (migration 205). Chỉ lưu LINK (YouTube, Google Drive, link ảnh), không lưu file.
import { supabase } from '../supabase';
import { parseDocLink } from '../legal/drive';
import { uid } from '../quickNotes/mindmap/parse';

export const WORKFLOW_MIGRATION_HINT = 'Cần chạy migration 205 (Quy trình công việc khách hàng) trong Supabase → SQL Editor';

export interface WfMedia { id: string; url: string; title: string }
export interface WfStep { id: string; name: string; desc: string; workers: string; media: WfMedia[] }
/** Khu vực đã vẽ ở tab Mặt bằng mà xưởng này nằm trong (label / mapTitle chỉ để hiện khi bản vẽ không còn). */
export interface WfZoneRef { mapId: string; zoneId: string; label: string; mapTitle: string }
export interface WfWorkshop { id: string; name: string; note: string; media: WfMedia[]; steps: WfStep[]; zones: WfZoneRef[] }

export const newStep = (): WfStep => ({ id: uid(), name: '', desc: '', workers: '', media: [] });
export const newWorkshop = (name = ''): WfWorkshop => ({ id: uid(), name, note: '', media: [], steps: [], zones: [] });

export interface MediaInfo {
  kind: 'video' | 'image' | 'drive' | 'web' | 'invalid';
  label: string;
  /** ảnh xem trước (nếu lấy được) */
  thumb: string | null;
}

/** Nhận diện link: YouTube (có ảnh bìa), ảnh trực tiếp, Google Drive (video / ảnh — Drive tự thumbnail nếu file được chia sẻ). */
export function mediaInfo(url: string): MediaInfo {
  const l = parseDocLink(url);
  if (l.source === 'youtube' && l.id) return { kind: 'video', label: 'YouTube', thumb: `https://img.youtube.com/vi/${l.id}/hqdefault.jpg` };
  if (l.source === 'image') return { kind: 'image', label: 'Ảnh', thumb: l.embedUrl };
  if (l.source === 'drive' && l.id) return { kind: 'drive', label: 'Google Drive', thumb: `https://drive.google.com/thumbnail?id=${l.id}&sz=w480` };
  if (l.source === 'invalid') return { kind: 'invalid', label: 'Link chưa đúng', thumb: null };
  return { kind: 'web', label: l.google ? 'Google' : 'Trang web', thumb: null };
}

/** Tách nhiều link dán một lượt (mỗi dòng / cách nhau bởi khoảng trắng); dòng "Tên | link" cũng được. */
export function parseMediaInput(text: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const bar = line.lastIndexOf('|');
    if (bar > -1) {
      const title = line.slice(0, bar).trim(), url = line.slice(bar + 1).trim();
      if (url) { out.push({ url, title }); continue; }
    }
    for (const part of line.split(/\s+/)) if (part) out.push({ url: part, title: '' });
  }
  return out.filter(m => mediaInfo(m.url).kind !== 'invalid');
}

export const mediaCount = (w: WfWorkshop) => w.media.length + w.steps.reduce((n, s) => n + s.media.length, 0);

const arr = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? (x as Record<string, unknown>[]).filter(v => v && typeof v === 'object') : []);
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const media = (x: unknown): WfMedia[] => arr(x).filter(m => str(m.url)).map(m => ({ id: str(m.id) || uid(), url: str(m.url), title: str(m.title) }));

export function parseWorkshops(raw: unknown): WfWorkshop[] {
  return arr(raw).map(w => ({
    id: str(w.id) || uid(), name: str(w.name), note: str(w.note), media: media(w.media),
    zones: arr(w.zones).filter(z => str(z.mapId) && str(z.zoneId)).map(z => ({ mapId: str(z.mapId), zoneId: str(z.zoneId), label: str(z.label), mapTitle: str(z.mapTitle) })),
    steps: arr(w.steps).map(s => ({ id: str(s.id) || uid(), name: str(s.name), desc: str(s.desc), workers: str(s.workers), media: media(s.media) })),
  }));
}

export async function loadWorkflow(clientId: string): Promise<{ workshops: WfWorkshop[]; updatedAt: string | null }> {
  const { data, error } = await supabase.from('client_workflows').select('workshops, updated_at').eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  return { workshops: parseWorkshops(data?.workshops), updatedAt: data?.updated_at ?? null };
}

export async function saveWorkflow(clientId: string, workshops: WfWorkshop[], userName: string): Promise<string> {
  const { data, error } = await supabase.from('client_workflows')
    .upsert({ client_id: clientId, workshops, updated_by: userName }, { onConflict: 'client_id' }).select('updated_at').single();
  if (error) throw error;
  return data?.updated_at ?? new Date().toISOString();
}
