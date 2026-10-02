import { mapLinkStatus, MAP_LINK_STATUS_TEXT } from '../lib/geo';

/** Dòng báo trạng thái dưới ô nhập link Google Maps: đọc được toạ độ / link rút gọn / link lỗi.
 * Ô trống thì không hiện gì. Cùng quy tắc với bảng nhập hàng loạt (mapLinkStatus). */
export default function MapLinkHint({ value, className = '' }: { value: string | null | undefined; className?: string }) {
  const st = mapLinkStatus(value);
  if (!st) return null;
  const { cls, text } = MAP_LINK_STATUS_TEXT[st];
  return <div className={`text-[11px] ${cls} ${className}`}>{text}</div>;
}
