// Dòng "ngày quan trọng" trên form hồ sơ (OccasionEditor) — uid ổn định để xoá dòng giữa
// không làm lệch ô nhập.
import { blankDraft, type OccasionDraft } from '../../../lib/cskh/occasions';
import type { OccasionType } from '../../../lib/cskh/types';

export interface OccasionRow extends OccasionDraft {
  uid: number;
  /** Chỉ để hiện (sửa ở tab Sự kiện & Quà tặng): "của con gái". */
  relatedPerson?: string;
}

let occUid = 0;
export const newOccasionRow = (type: OccasionType = 'birthday'): OccasionRow => ({ ...blankDraft(type), uid: ++occUid });
export const toOccasionRow = (d: OccasionDraft, relatedPerson = ''): OccasionRow => ({ ...d, uid: ++occUid, relatedPerson });
