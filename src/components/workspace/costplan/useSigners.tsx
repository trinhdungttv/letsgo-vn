// Chọn NGƯỜI KÝ từ kho chữ ký chung (Pháp lý → Chữ ký, migration 230) khi làm giấy tờ. Nhớ lựa chọn lần trước trên máy này.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listSigners, type SignerOption } from '../../../lib/legal/signatures';
import type { CompanyProfileData } from '../../../lib/costPlan/quoteDoc';

const KEY = 'lgvn_doc_signer';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export function useSigners(token: string | null) {
  const [signers, setSigners] = useState<SignerOption[]>([]);
  const [pick, setPick] = useState<string | null>(read);
  useEffect(() => { if (token) void listSigners(token).then(setSigners); }, [token]);
  // chưa chọn / người đã bị xoá khỏi kho → người đầu danh sách; kho trống → '' (dùng chữ ký lưu ở pháp nhân)
  const signerId = pick === '' ? null : signers.some(s => s.id === pick) ? pick : signers[0]?.id ?? null;
  const signer = signers.find(s => s.id === signerId) ?? null;
  const setSignerId = useCallback((id: string | null) => {
    setPick(id ?? '');
    try { localStorage.setItem(KEY, id ?? ''); } catch { /* chế độ riêng tư */ }
  }, []);
  /** Thông tin pháp nhân với người ký = người đã chọn (tên + chức danh in dưới chỗ ký). */
  const withSigner = useCallback(<T extends CompanyProfileData | null | undefined>(data: T): T => (
    data && signer ? { ...data, signerName: signer.owner_name || data.signerName, signerTitle: signer.title } : data
  ), [signer]);
  return useMemo(() => ({ signers, signerId, signer, setSignerId, withSigner }), [signers, signerId, signer, setSignerId, withSigner]);
}

/** Ô chọn người ký — chỉ hiện khi kho có chữ ký. `ownLabel` != null → có thêm lựa chọn "chữ ký lưu ở pháp nhân". */
export function SignerSelect({ s, ownLabel, className = '' }: { s: ReturnType<typeof useSigners>; ownLabel?: string | null; className?: string }) {
  if (!s.signers.length) return null;
  return (
    <label className={`flex items-center gap-2 text-[12.5px] text-[#6E6E73] ${className}`}>
      <span className="shrink-0">Người ký</span>
      <select value={s.signerId ?? ''} onChange={e => s.setSignerId(e.target.value || null)} className="min-w-0 flex-1 h-8 rounded-[8px] bg-[#F5F5F7] px-2 text-[13px] text-[#1D1D1F] outline-none">
        {ownLabel != null && <option value="">{ownLabel}</option>}
        {s.signers.map(x => <option key={x.id} value={x.id}>{x.owner_name || '(chưa đặt tên)'}{x.title ? ` — ${x.title}` : ''}</option>)}
      </select>
    </label>
  );
}
