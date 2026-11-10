// Ảnh CHỮ KÝ / CON DẤU cho 1 giấy tờ (báo giá PDF, báo giá Excel mẫu, danh sách vào cổng).
//   • Admin: ảnh có sẵn trong danh sách pháp nhân — dùng ngay (như trước).
//   • Nhân viên (migration 219): vẫn dùng được, nhưng lần đầu bật phải xác nhận; ảnh lấy qua quote_entity_stamp →
//     server ghi nhật ký + app của admin hiện popup NGAY. Mỗi lần xuất PDF / Excel / In ghi thêm vào đúng dòng đó.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStamp, markStamp, type StampAction, type StampPurpose } from '../../../lib/costPlan/api';
import type { QuoteEntity } from '../../../lib/costPlan/entity';
import { pingStampAlert } from '../../../lib/stampAlerts';

type Part = 'signature' | 'seal';
interface Got { signature: string | null; seal: string | null; alertId: number | null }

export function useStampImages(a: {
  token: string | null;
  entity: QuoteEntity | null;
  canSign: boolean;
  canStamp: boolean;
  wantSig: boolean;
  wantSeal: boolean;
  purpose: StampPurpose;
  /** Giấy tờ gì, cho ai — hiện trong popup của admin */
  context: string;
}) {
  const { token, entity, canSign, canStamp, wantSig, wantSeal, purpose, context } = a;
  const [got, setGot] = useState<Record<string, Got>>({});           // theo stamp_id
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ctxRef = useRef(context);
  ctxRef.current = context;
  const stampId = entity?.stamp_id ?? null;
  const cur = stampId ? got[stampId] : undefined;

  const missing: Part[] = !canSign && canStamp && stampId && entity ? [
    ...(wantSig && entity.has_signature && !cur?.signature ? ['signature' as const] : []),
    ...(wantSeal && entity.has_seal && !cur?.seal ? ['seal' as const] : []),
  ] : [];
  const need = missing.join(',');

  useEffect(() => {
    if (!need || !token || !stampId) return;
    let dead = false;
    setBusy(true); setErr(null);
    fetchStamp(token, stampId, need.split(',') as Part[], purpose, ctxRef.current)
      .then(r => {
        if (dead) return;
        setGot(g => ({ ...g, [stampId]: { signature: r.signature ?? g[stampId]?.signature ?? null, seal: r.seal ?? g[stampId]?.seal ?? null, alertId: r.alertId } }));
        void pingStampAlert();
      })
      .catch(e => { if (!dead) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!dead) setBusy(false); });
    return () => { dead = true; };
  }, [need, token, stampId, purpose]);

  const signature = !wantSig || !entity ? null : canSign ? entity.signature : cur?.signature ?? null;
  const seal = !wantSeal || !entity ? null : canSign ? entity.seal : cur?.seal ?? null;

  /** Ghi "đã xuất …" vào nhật ký (chỉ nhân viên — admin đã có audit_logs như cũ). */
  const mark = useCallback((action: StampAction) => {
    if (canSign || !token || !cur?.alertId || !(signature || seal)) return;
    void markStamp(token, cur.alertId, action);
  }, [canSign, token, cur?.alertId, signature, seal]);

  return { signature, seal, busy, err, mark, usable: canSign || canStamp };
}

/** Xác nhận 1 lần (mỗi hộp thoại) trước khi nhân viên bật chữ ký / con dấu. Admin không cần hỏi. */
export function useStampConsent(canSign: boolean) {
  const ok = useRef(false);
  return useCallback((what: string, entityLabel: string): boolean => {
    if (canSign || ok.current) return true;
    ok.current = window.confirm(
      `Chữ ký và con dấu là dữ liệu nhạy cảm.\n\nBạn vẫn dùng được để làm ${what}, nhưng QUẢN TRỊ VIÊN sẽ nhận thông báo ngay `
      + `(tên bạn, pháp nhân ${entityLabel}, giấy tờ, và mỗi lần tải PDF / Excel / In).\n\nTiếp tục?`,
    );
    return ok.current;
  }, [canSign]);
}
