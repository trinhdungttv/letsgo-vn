// Khoá chống xoá (migration 196) — phần thuần: kiểm mã 4 số, câu báo khi bị từ chối. Mã là RIÊNG từng người,
// chung cho mọi ghi chú & sơ đồ của người đó; DB chỉ lưu bản băm, sai 5 lần thì tạm khoá 15 phút (lần sau gấp đôi).

export const PIN_LEN = 4;

export type LockFailReason = 'wrong_pin' | 'wrong_password' | 'locked' | 'no_pin' | 'note_locked';
export interface LockFail {
  reason: LockFailReason;
  /** còn bao nhiêu lần thử trước khi bị tạm khoá */
  remaining?: number;
  /** bị tạm khoá: còn bao nhiêu giây */
  seconds?: number;
}

/** Chỉ giữ chữ số, tối đa 4 (dán "12 34" / gõ nhầm chữ cũng được). */
export const cleanPin = (s: string) => s.replace(/\D/g, '').slice(0, PIN_LEN);
export const isPin = (s: string) => /^\d{4}$/.test(s);

/** 45 giây · 15 phút · 1 giờ 30 phút */
export function waitText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s} giây`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} giờ ${rest} phút` : `${h} giờ`;
}

export function lockFailText(f: LockFail): string {
  const left = f.remaining !== undefined ? ` — còn ${f.remaining} lần thử` : '';
  switch (f.reason) {
    case 'wrong_pin': return `Sai mã${left}`;
    case 'wrong_password': return `Sai mật khẩu đăng nhập${left}`;
    case 'locked': return `Nhập sai quá 5 lần — thử lại sau ${waitText(f.seconds ?? 900)}`;
    case 'no_pin': return 'Chưa đặt mã khoá';
    case 'note_locked': return 'Mục này đang khoá chống xoá — cần nhập mã 4 số';
  }
}
