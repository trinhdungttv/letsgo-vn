// ============================================================================
// Gắn MỘT lần ở trang CSKH (mọi tab): bấm Gọi/Zalo/SMS → lưu "liên hệ đang chờ
// xác nhận"; app hiện lại (visibilitychange / pageshow / focus) mà còn bản ghi →
// mở bottom sheet "Đã liên hệ với X qua Zalo?". Cũng mở sheet khi có yêu cầu thủ
// công (nút "Đã liên hệ" trên hàng đợi / tóm tắt).
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { useBranchLookup } from '../../../hooks/useBranchLookup';
import { todayVN } from '../../../lib/cskh/dates';
import type { ContactActionChannel } from '../../../lib/cskh/contactActions';
import { emitCskhDataChanged, onQuickLogRequest } from '../../../lib/cskh/events';
import { clearPending, getPendingStorage, isPendingReady, loadPending } from '../../../lib/cskh/pendingContact';
import type { CskhContact } from '../../../lib/cskh/types';
import type { Client } from '../../../lib/types';
import { addInteraction, defaultClientIdOf, loadContact, logToast } from '../data/api';
import { QuickLogSheet, type QuickLogInput } from './QuickLogSheet';

interface Active {
  contactId: string;
  channel: ContactActionChannel | null;
}

export default function QuickLogHost({ clients, toast }: { clients: readonly Client[]; toast: (msg: string) => void }) {
  const { user } = useAuth();
  const { branches } = useBranchLookup();
  const [active, setActive] = useState<Active | null>(null);
  const [contact, setContact] = useState<CskhContact | null>(null);
  const storage = getPendingStorage();
  // toast của App đổi danh tính mỗi lần hiện thông báo → giữ qua ref
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const checkPending = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    const pending = loadPending(storage, now);
    if (!pending || !isPendingReady(pending, now)) return;
    setActive(prev => prev ?? { contactId: pending.contactId, channel: pending.channel });
  }, [storage]);

  useEffect(() => {
    // iOS có thể đã nạp lại trang khi app ở nền — kiểm tra ở tick sau
    const first = window.setTimeout(checkPending, 0);
    document.addEventListener('visibilitychange', checkPending);
    window.addEventListener('pageshow', checkPending);
    window.addEventListener('focus', checkPending);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener('visibilitychange', checkPending);
      window.removeEventListener('pageshow', checkPending);
      window.removeEventListener('focus', checkPending);
    };
  }, [checkPending]);

  useEffect(() => onQuickLogRequest(req => setActive({ contactId: req.contactId, channel: req.channel })), []);

  // Nạp người liên hệ đang hỏi; đã bị xoá / đã nghỉ → bỏ chờ, không hỏi nữa
  useEffect(() => {
    if (!active) { setContact(null); return; }
    let alive = true;
    loadContact(active.contactId).then(c => {
      if (!alive) return;
      if (!c || c.isArchived) { clearPending(storage); setActive(null); return; }
      setContact(c);
    }).catch(e => { if (alive) toastRef.current('Lỗi tải người liên hệ: ' + (e as Error).message); });
    return () => { alive = false; };
  }, [active, storage]);

  const close = useCallback(() => {
    clearPending(storage);
    setActive(null);
  }, [storage]);

  const handleSave = useCallback(async (input: QuickLogInput): Promise<string | null> => {
    if (!contact) return 'Không tìm thấy người liên hệ';
    try {
      await addInteraction({
        contact,
        clientId: defaultClientIdOf(contact),
        type: input.type,
        channel: input.channel,
        initiatedBy: input.initiatedBy,
        occurredAt: todayVN(),
        content: input.content,
        followUpAction: input.followUpAction,
        followUpDue: input.followUpDue,
        gift: input.gift,
      }, { user, clients, branches });
    } catch (e) {
      return (e as Error).message;
    }
    clearPending(storage);
    setActive(null);
    emitCskhDataChanged(); // các tab đang mở tự tải lại: rời hàng đợi, cập nhật điểm
    toastRef.current(input.type === 'gift' || input.followUpAction ? logToast(input) : 'Đã ghi nhận');
    return null;
  }, [contact, user, clients, branches, storage]);

  if (!active || !contact || contact.id !== active.contactId) return null;
  return (
    <QuickLogSheet
      key={`${contact.id}:${active.channel ?? 'manual'}`}
      contact={contact}
      channel={active.channel}
      today={todayVN()}
      onSave={handleSave}
      onSkip={close}
    />
  );
}
