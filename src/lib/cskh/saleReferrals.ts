// ============================================================================
// Mạng lưới Sale ↔ BD Pipeline: Sale nào đã giới thiệu công ty nào (migration 178).
// ----------------------------------------------------------------------------
// Nối chắc chắn: crm_pipeline.source_contact_id (trigger DB tự điền khi nguồn "Sale" / "Đối tác
// giới thiệu" gõ đúng tên 1 người trong Mạng lưới Sale — đổi tên Sale sau này vẫn giữ).
// Dự phòng: dòng chưa nối (ghi trước khi có Sale trong danh bạ / DB chưa chạy 178) mà tên nguồn
// trùng tên hoặc tên thân mật của Sale → vẫn tính cho người đó.
// File thuần, không gọi Supabase.
// ============================================================================
import { normSourceName } from '../pipelineSource';
import type { CskhContact } from './types';

export interface SaleReferral {
  id: string;
  companyName: string;
  /** Giai đoạn BD Pipeline: tiem-nang | dang-lh | quan-tam | dam-phan | hop-tac | khong-nhu-cau … */
  stage: string;
  sourceType: string | null;
  sourceName: string;
  sourceContactId: string | null;
  /** Đã thành khách hàng (gắn công ty khách). */
  clientId: string | null;
  createdAt: string;
}

/** Dòng crm_pipeline (select '*') — cột 178 có thể chưa có. */
export interface PipelineReferralRow {
  id: string;
  company_name: string | null;
  stage: string | null;
  source_type?: string | null;
  source_name?: string | null;
  source_contact_id?: string | null;
  client_id?: string | null;
  created_at: string;
}

export const REFERRAL_STAGE_LABEL: Readonly<Record<string, string>> = {
  'tiem-nang': 'Tiềm năng',
  'dang-lh': 'Đang liên hệ',
  'quan-tam': 'Quan tâm / chờ',
  'dam-phan': 'Đàm phán HĐ',
  'hop-tac': 'Đang hợp tác',
  'khong-nhu-cau': 'Không nhu cầu',
};

export const referralStageLabel = (stage: string): string => REFERRAL_STAGE_LABEL[stage] ?? stage;

/** Công ty đã hợp tác (đã ký) — tính là "giới thiệu thành công". */
export const isWonReferral = (r: Pick<SaleReferral, 'stage' | 'clientId'>): boolean => r.stage === 'hop-tac' || r.clientId !== null;

/** Chỉ giữ dòng có nguồn Sale / Đối tác giới thiệu (nơi Sale bên ngoài có thể được ghi). */
export function mapReferralRows(rows: readonly PipelineReferralRow[]): SaleReferral[] {
  return rows
    .filter(r => r.source_contact_id || r.source_type === 'sale' || r.source_type === 'partner')
    .map(r => ({
      id: r.id,
      companyName: (r.company_name ?? '').trim() || 'Công ty chưa đặt tên',
      stage: r.stage ?? '',
      sourceType: r.source_type ?? null,
      sourceName: (r.source_name ?? '').trim(),
      sourceContactId: r.source_contact_id ?? null,
      clientId: r.client_id ?? null,
      createdAt: r.created_at,
    }));
}

/**
 * Công ty mỗi Sale đã giới thiệu: nối chắc chắn trước, rồi khớp tên cho dòng chưa nối.
 * Tên trùng nhiều Sale → tính cho người đầu tiên theo thứ tự danh bạ (tránh đếm 2 lần).
 * Mới nhất trước.
 */
export function referralsByContact(
  contacts: readonly Pick<CskhContact, 'id' | 'fullName' | 'nickname'>[],
  referrals: readonly SaleReferral[],
): Map<string, SaleReferral[]> {
  const out = new Map<string, SaleReferral[]>();
  const ids = new Set(contacts.map(c => c.id));
  const byName = new Map<string, string>();
  for (const c of contacts) {
    for (const n of [c.fullName, c.nickname]) {
      const k = normSourceName(n);
      if (k && !byName.has(k)) byName.set(k, c.id);
    }
  }
  for (const r of referrals) {
    const id = r.sourceContactId
      ? (ids.has(r.sourceContactId) ? r.sourceContactId : null)
      : (r.sourceType === 'sale' || r.sourceType === 'partner') ? byName.get(normSourceName(r.sourceName)) ?? null : null;
    if (!id) continue;
    const list = out.get(id);
    if (list) list.push(r);
    else out.set(id, [r]);
  }
  for (const list of out.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}
