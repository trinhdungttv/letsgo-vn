// Ngữ cảnh dùng chung cho mọi tab CSKH: dữ liệu tải 1 lần ở khung module (index.tsx)
// + các hộp thoại dùng chung (Hồ sơ, Ghi tương tác, Chọn người chăm sóc, Nhóm).
import { createContext, useContext } from 'react';
import type { Client } from '../../lib/types';
import type { CskhData } from './data/api';

export type CskhTabKey = 'dashboard' | 'matrix' | 'map' | 'cadence' | 'log' | 'events';

export interface CskhContextValue {
  data: CskhData | null;
  loading: boolean;
  clients: Client[];
  toast: (msg: string) => void;
  /** Mở hồ sơ người liên hệ. */
  openProfile: (contactId: string) => void;
  /** Mở hồ sơ trống để thêm liên hệ mới (cùng form với hồ sơ). */
  openNewContact: () => void;
  /** Mở form Ghi tương tác (chọn sẵn người nếu có). */
  openLog: (contactId?: string) => void;
  openPicker: () => void;
  openGroups: () => void;
  /** Mở "Ghi cho nhóm" (chọn sẵn người nếu mở từ Ma trận). */
  openGroupLog: (contactIds?: readonly string[]) => void;
  goTab: (tab: CskhTabKey) => void;
  openWorkspace: () => void;
  /** Mở hồ sơ công ty bên Khách hàng. */
  openClient: (clientId: string) => void;
}

export const CskhContext = createContext<CskhContextValue | null>(null);

export function useCskh(): CskhContextValue {
  const ctx = useContext(CskhContext);
  if (!ctx) throw new Error('useCskh phải nằm trong khung module CSKH');
  return ctx;
}
