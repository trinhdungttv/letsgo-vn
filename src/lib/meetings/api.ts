// Đi họp — MỌI thao tác đi qua 1 hàm DB meeting_rpc(p_token, p_action, p_args) (migration 217):
// bảng meeting_* khoá với anon key vì chứa số CCCD; hàm kiểm phiên đăng nhập + quyền module 'Đi họp'.
import { supabase } from '../supabase';
import { getStoredSessionToken } from '../sessionToken';
import {
  normalizeMeeting, normalizeMember,
  type GateOptions, type Meeting, type MeetingBootstrap, type MeetingDraft, type MeetingMember, type MemberDraft,
} from './types';

export const MEETING_MIGRATION_HINT =
  'Chưa chạy migration 217 (Đi họp) trên Supabase — chạy file supabase/migrations/20261110100000_217_meetings.sql rồi tải lại trang.';

export class MeetingError extends Error {
  /** true = DB chưa có hàm meeting_rpc (chưa chạy migration 217) */
  readonly missingMigration: boolean;
  constructor(message: string, missingMigration = false) {
    super(message);
    this.missingMigration = missingMigration;
  }
}

async function rpc<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc('meeting_rpc', { p_token: getStoredSessionToken(), p_action: action, p_args: args });
  if (error) {
    const msg = error.message ?? 'Lỗi không xác định';
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|schema cache/i.test(msg)) {
      throw new MeetingError(MEETING_MIGRATION_HINT, true);
    }
    throw new MeetingError(msg);
  }
  return data as T;
}

export async function loadMeetings(): Promise<MeetingBootstrap> {
  const r = await rpc<{ me: MeetingBootstrap['me']; members: unknown[]; meetings: unknown[] }>('bootstrap');
  return {
    me: { name: r.me?.name ?? '', role: r.me?.role ?? '', level: r.me?.level === 'full' ? 'full' : 'view' },
    members: (r.members ?? []).map(normalizeMember),
    meetings: (r.meetings ?? []).map(normalizeMeeting),
  };
}

/** Ngày cấp: null → "" (DB hiểu là để trống); không có khoá → không đổi. */
const encDate = <T extends { id_issued_on?: string | null }>(d: T): T =>
  ('id_issued_on' in d ? { ...d, id_issued_on: d.id_issued_on || '' } : d);

export const saveMember = async (id: string | null, d: Partial<MemberDraft>): Promise<MeetingMember> =>
  normalizeMember(await rpc('member.save', { ...encDate(d), id: id ?? '' }));

export const deleteMember = (id: string) => rpc<{ ok: boolean }>('member.delete', { id });

export const reorderMembers = (ids: string[]) => rpc<{ ok: boolean }>('member.reorder', { ids });

export const importMembers = (rows: Partial<MemberDraft>[]) =>
  rpc<{ inserted: number; updated: number }>('member.import', { rows: rows.map(encDate) });

export const saveMeeting = async (id: string | null, d: Partial<MeetingDraft> & { gate?: GateOptions }): Promise<Meeting> =>
  normalizeMeeting(await rpc('meeting.save', { ...d, id: id ?? '' }));

export const deleteMeeting = (id: string) => rpc<{ ok: boolean }>('meeting.delete', { id });
