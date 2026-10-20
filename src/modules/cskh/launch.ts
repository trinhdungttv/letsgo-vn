// Bấm Gọi/Zalo/SMS: ghi lại "liên hệ đang chờ xác nhận" để khi quay về app thì
// QuickLogHost hỏi "Đã liên hệ với X?". Việc mở link do chính thẻ <a> lo.
import type { ContactActionChannel } from '../../lib/cskh/contactActions';
import { getPendingStorage, savePending } from '../../lib/cskh/pendingContact';

export function markContactLaunched(contactId: string, channel: ContactActionChannel): void {
  savePending(getPendingStorage(), { contactId, channel, startedAt: Date.now() });
}
