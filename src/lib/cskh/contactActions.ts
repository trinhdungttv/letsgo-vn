// ============================================================================
// CSKH — Liên kết hành động 1 chạm: Gọi / Zalo / SMS (port PRM contactActions.ts)
// ----------------------------------------------------------------------------
// Chuẩn hoá số: bỏ khoảng trắng / dấu chấm / ngoặc; "+84" / "84" / "0084" → "0"
// (số Việt Nam); số nước ngoài giữ dạng "+<mã nước><số>".
// Cùng quy tắc này là KHOÁ GHÉP NGƯỜI khi đồng bộ với Tony Study sau này.
// ============================================================================
import type { CskhContact } from './types';

export type ContactActionChannel = 'call' | 'zalo' | 'sms';

export interface ContactActionLink {
  channel: ContactActionChannel;
  /** URL để mở (tel:, sms:, https://zalo.me/...). */
  url: string;
  /** Số đã chuẩn hoá dùng cho link này. */
  phone: string;
}

/** Cột `contacts.phone` cho nhập nhiều số — tách theo dấu phẩy / chấm phẩy / gạch chéo / xuống dòng. */
export function splitPhones(raw: string | null | undefined): string[] {
  return (raw ?? '').split(/[,;/\n]+/).map(s => s.trim()).filter(Boolean);
}

/** Chuẩn hoá 1 số điện thoại; trả chuỗi rỗng nếu không có chữ số nào. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return '';

  const toLocal = (rest: string): string => (rest.startsWith('0') ? rest : `0${rest}`);

  // 0084912345678 (tiền tố quốc tế kiểu 00)
  if (!hasPlus && digits.startsWith('0084') && digits.length >= 13) return toLocal(digits.slice(4));
  // +84912345678 hoặc +84 (0) 912...
  if (hasPlus && digits.startsWith('84')) return toLocal(digits.slice(2));
  // 84912345678 không có dấu + (từ 11 chữ số; số nội địa VN luôn bắt đầu bằng 0)
  if (!hasPlus && digits.startsWith('84') && digits.length >= 11) return toLocal(digits.slice(2));
  // Số nước ngoài: +1..., +44...
  if (hasPlus) return `+${digits}`;
  return digits;
}

/** Số đầu tiên dùng được (đã chuẩn hoá), '' nếu không có. */
export function primaryPhone(contact: Pick<CskhContact, 'phones'>): string {
  for (const p of contact.phones) {
    const n = normalizePhone(p);
    if (n !== '') return n;
  }
  return '';
}

/** Số Zalo: ô "Zalo (nếu khác số chính)" nếu có, không thì số điện thoại chính. */
export function zaloPhoneOf(contact: Pick<CskhContact, 'phones' | 'zaloPhone'>): string {
  const own = normalizePhone(contact.zaloPhone ?? '');
  return own !== '' ? own : primaryPhone(contact);
}

export const telUrl = (phone: string): string => `tel:${phone}`;
export const smsUrl = (phone: string): string => `sms:${phone}`;
/** zalo.me nhận số dạng nội địa (0...) hoặc quốc tế không dấu +. Mở tab mới để app vẫn ở tab cũ. */
export const zaloUrl = (phone: string): string => `https://zalo.me/${phone.replace(/^\+/, '')}`;

/** Chỉ trả về nút có dữ liệu (không có số thì không có Gọi/SMS/Zalo). */
export function contactActionLinks(contact: Pick<CskhContact, 'phones' | 'zaloPhone'>): ContactActionLink[] {
  const links: ContactActionLink[] = [];
  const phone = primaryPhone(contact);
  if (phone !== '') links.push({ channel: 'call', url: telUrl(phone), phone });
  const zalo = zaloPhoneOf(contact);
  if (zalo !== '') links.push({ channel: 'zalo', url: zaloUrl(zalo), phone: zalo });
  if (phone !== '') links.push({ channel: 'sms', url: smsUrl(phone), phone });
  return links;
}

/** Kênh → loại tương tác lưu trong nhật ký (Zalo/SMS đều là "Tin nhắn"). */
export function interactionTypeOfChannel(channel: ContactActionChannel): 'call' | 'message' {
  return channel === 'call' ? 'call' : 'message';
}
