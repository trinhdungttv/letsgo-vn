// Cảnh báo "dữ liệu lương tối thiểu vùng có thể đã lỗi thời" — dùng CHUNG cho mọi nơi tra mức
// lương tối thiểu (Khu vực, Lương TT, Công ty/Dự án, Tính bảng lương).
//
// VÌ SAO CẦN: bảng mức lương tối thiểu không tự cập nhật khi Chính phủ ban hành nghị định mới.
// Im lặng dùng số cũ như thể còn hiệu lực là cách âm thầm nhất để để lọt một mức lương vi phạm
// luật. Thà hiện cảnh báo còn hơn cho ra một con số tưởng là đúng.
//
// Một component dùng chung thay vì mỗi trang tự viết một câu — để cả app nói y hệt một thông điệp.
import { AlertTriangle } from 'lucide-react';
import { isMinWageStale, minWageStaleNotice, type MinWageBatch } from '../lib/minWage';

interface Props {
  /** Batch đọc từ region_wage_batches — truyền vào để DB thắng hardcode. */
  dbBatches?: MinWageBatch[];
  /** Ngày cần tra; mặc định hôm nay. */
  atDate?: string | Date;
  className?: string;
}

export default function MinWageStaleBanner({ dbBatches = [], atDate, className = '' }: Props) {
  if (!isMinWageStale(atDate, dbBatches)) return null;
  const notice = minWageStaleNotice(atDate, dbBatches);
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 border bg-amber-50 border-amber-200 ${className}`}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
      <div className="text-[11.5px] text-amber-800">
        {notice}
        <div className="text-[10.5px] text-amber-700/80 mt-0.5">
          Cập nhật ở tab <b>Lương TT</b> → "Lần nhập lương", hoặc chạy migration
          <code className="mx-1 px-1 bg-amber-100 rounded">region_wage_batch.sql</code>
          sau khi đã đối chiếu công báo.
        </div>
      </div>
    </div>
  );
}
