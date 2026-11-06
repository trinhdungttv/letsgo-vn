// Hộp nhập mã 4 số trước khi xoá chuyến khảo sát (mã phụ của hệ thống — dùng chung mã với khoá Ghi chú / Sơ đồ tư duy).
// Dùng lại PinDialog của Ghi chú (đặt mã lần đầu, quên mã…). Vẽ qua portal với z-index cao hơn mọi lớp khảo sát
// (toàn màn hình 300, màn khảo sát ~1300) để không bị che.
import { createPortal } from 'react-dom';
import PinDialog, { type PinRequest } from '../../../components/quickNotes/PinDialog';

export default function SurveyPinGate({ req, onClose, onDone }: { req: Extract<PinRequest, { kind: 'verify' }>; onClose: () => void; onDone: (msg?: string) => void }) {
  return createPortal(
    <div style={{ position: 'relative', zIndex: 3000 }}>
      <PinDialog req={req} onClose={onClose} onDone={onDone} />
    </div>,
    document.body,
  );
}
