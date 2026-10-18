// Module "Văn phòng Orient" (office_rental) — cho thuê lại văn phòng tại Orient Apartment.
// Tách biệt hoàn toàn với mảng cung ứng lao động: chỉ đọc/ghi bảng bds_*, chỉ admin.
// Được App.tsx nạp bằng React.lazy → nhân viên không phải admin không tải bundle này.
import { useAuth } from '../../lib/auth';
import { OfficeDataProvider } from './data/OfficeDataProvider';
import OfficeShell from './components/OfficeShell';
import type { OfficePage } from './pages';

export default function OfficeRentalModule({ page, toast }: { page: OfficePage; toast: (msg: string) => void }) {
  const { token } = useAuth();
  return (
    <OfficeDataProvider token={token} toast={toast}>
      <OfficeShell page={page} />
    </OfficeDataProvider>
  );
}
