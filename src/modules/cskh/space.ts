// Khu vực đang mở của module CSKH: khách hàng (trang CSKH) hay Mạng lưới Sale (trang Sale).
// Khung module (index.tsx) đặt giá trị; mọi tab / hộp thoại đọc nhãn hạng, tên gọi qua useSpace().
// Nằm ngoài khung module (VD khối CSKH trong hồ sơ Khách hàng) → mặc định khách hàng.
import { createContext, useContext } from 'react';
import { SPACE_INFO, type CskhSpace, type SpaceInfo } from '../../lib/cskh/space';

export const SpaceContext = createContext<CskhSpace>('client');

export function useSpace(): SpaceInfo {
  return SPACE_INFO[useContext(SpaceContext)];
}
