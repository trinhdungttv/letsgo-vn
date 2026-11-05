// Dòng thời gian mốc quan trọng + ghi chú tổng hợp của 1 công ty (đầu tab "Hồ sơ chăm sóc") — bảng client_profile_briefs, migration 204.
import { supabase } from '../supabase';
import { newTopic } from '../quickNotes/mindmap/model';
import { DEFAULT_THEME, parseDoc, uid } from '../quickNotes/mindmap/parse';
import type { MindMapDoc } from '../quickNotes/mindmap/types';

export const BRIEF_MIGRATION_HINT = 'Cần chạy migration 204 (Dòng thời gian & Ghi chú hồ sơ công ty) trong Supabase → SQL Editor';

export type MilestoneKind = 'start' | 'contract' | 'meeting' | 'key' | 'risk' | 'plan';

export const MILESTONE_KINDS: { key: MilestoneKind; label: string; color: string }[] = [
  { key: 'start',    label: 'Khởi đầu',     color: '#2563EB' },
  { key: 'contract', label: 'Hợp đồng',     color: '#059669' },
  { key: 'meeting',  label: 'Gặp gỡ',       color: '#7C3AED' },
  { key: 'key',      label: 'Quan trọng',   color: '#D97706' },
  { key: 'risk',     label: 'Rủi ro',       color: '#DC2626' },
  { key: 'plan',     label: 'Kế hoạch',     color: '#6B7280' },
];

export interface Milestone {
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  title: string;
  note: string;
  kind: MilestoneKind;
}

export type NotesMode = 'text' | 'mindmap';

export interface BriefRow {
  milestones: Milestone[];
  notesText: string;
  notesMindmap: MindMapDoc | null;
  notesMode: NotesMode;
  updatedAt: string | null;
  updatedBy: string;
}

export const kindOf = (k: string) => MILESTONE_KINDS.find(x => x.key === k) ?? MILESTONE_KINDS[3];

export const sortMilestones = (list: Milestone[]) =>
  [...list].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.title.localeCompare(b.title, 'vi'));

export const newMilestone = (): Milestone => ({
  id: uid(), date: new Date().toISOString().slice(0, 10), title: '', note: '', kind: 'key',
});

function parseMilestones(raw: unknown): Milestone[] {
  if (!Array.isArray(raw)) return [];
  const out: Milestone[] = [];
  for (const m of raw as Record<string, unknown>[]) {
    if (!m || typeof m !== 'object') continue;
    const kind = MILESTONE_KINDS.some(k => k.key === m.kind) ? (m.kind as MilestoneKind) : 'key';
    out.push({
      id: typeof m.id === 'string' && m.id ? m.id : uid(),
      date: typeof m.date === 'string' ? m.date : '',
      title: typeof m.title === 'string' ? m.title : '',
      note: typeof m.note === 'string' ? m.note : '',
      kind,
    });
  }
  return out;
}

/** Sơ đồ mới: tên công ty ở giữa, vài nhánh gợi ý — đổi / xoá thoải mái. */
export function defaultNotesMap(companyName: string): MindMapDoc {
  return {
    v: 1,
    root: { id: uid(), text: companyName.trim() || 'Công ty', children: ['Tổng quan', 'Nhu cầu', 'Đầu mối chính', 'Lưu ý quan trọng'].map(t => newTopic(t)) },
    floating: [],
    relations: [],
    structure: 'map',
    theme: DEFAULT_THEME,
  };
}

export const EMPTY_BRIEF: BriefRow = { milestones: [], notesText: '', notesMindmap: null, notesMode: 'text', updatedAt: null, updatedBy: '' };

export async function loadBrief(subjectId: string): Promise<BriefRow> {
  const { data, error } = await supabase.from('client_profile_briefs')
    .select('milestones, notes_text, notes_mindmap, notes_mode, updated_at, updated_by').eq('client_id', subjectId).maybeSingle();
  if (error) throw error;
  if (!data) return EMPTY_BRIEF;
  return {
    milestones: parseMilestones(data.milestones),
    notesText: data.notes_text ?? '',
    notesMindmap: data.notes_mindmap ? parseDoc(data.notes_mindmap) : null,
    notesMode: data.notes_mode === 'mindmap' ? 'mindmap' : 'text',
    updatedAt: data.updated_at ?? null,
    updatedBy: data.updated_by ?? '',
  };
}

export interface BriefPatch {
  milestones?: Milestone[];
  notesText?: string;
  notesMindmap?: MindMapDoc;
  notesMode?: NotesMode;
}

/** Chỉ ghi các cột có trong patch (mốc và ghi chú lưu độc lập, không đè nhau). */
export async function saveBrief(subjectId: string, patch: BriefPatch, userName: string): Promise<string> {
  const row: Record<string, unknown> = { client_id: subjectId, updated_by: userName };
  if (patch.milestones !== undefined) row.milestones = patch.milestones;
  if (patch.notesText !== undefined) row.notes_text = patch.notesText;
  if (patch.notesMindmap !== undefined) row.notes_mindmap = patch.notesMindmap;
  if (patch.notesMode !== undefined) row.notes_mode = patch.notesMode;
  const { data, error } = await supabase.from('client_profile_briefs')
    .upsert(row, { onConflict: 'client_id' }).select('updated_at').single();
  if (error) throw error;
  return data?.updated_at ?? new Date().toISOString();
}
