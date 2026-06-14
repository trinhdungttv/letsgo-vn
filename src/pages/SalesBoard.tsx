import { ListChecks } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SalesTaskBoard from '../components/SalesTaskBoard';

interface SalesBoardProps {
  toast: (msg: string) => void;
}

export default function SalesBoard({ toast }: SalesBoardProps) {
  return (
    <div className="space-y-4">
      <PageHeader title="Bảng làm việc Kinh Doanh" subtitle="Danh sách công việc và deadline" icon={<ListChecks size={18} />} />
      <SalesTaskBoard toast={toast} />
    </div>
  );
}
