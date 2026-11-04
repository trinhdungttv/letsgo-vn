// Pháp lý — những thứ mọi màn hình con cần (dữ liệu, quyền, mở tài liệu / form) — truyền 1 object thay vì nhiều props.
import type { LegalDoc } from '../../lib/legal/types';
import type { DocPreset } from './DocForm';
import type { LegalStore } from './useLegal';

export interface LegalCtx {
  store: LegalStore;
  canEdit: boolean;
  userName: string;
  toast: (m: string) => void;
  mobile: boolean;
  openDoc: (id: string) => void;
  newDoc: (preset: DocPreset) => void;
  editDoc: (d: LegalDoc) => void;
}
