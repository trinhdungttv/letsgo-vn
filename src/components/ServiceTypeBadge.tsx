import type { ServiceType } from '../lib/types';

/**
 * Tag phân biệt loại hình dịch vụ — dùng chung cho Khách hàng và Tài chính để
 * hai chỗ luôn hiển thị giống hệt nhau:
 *   GT  (tím)  = Giới thiệu lao động
 *   HOH (cam)  = HOH
 *   Cho thuê lao động = không có tag (mặc định)
 */
export default function ServiceTypeBadge({
  type, onDoubleClick, editable = false, className = '',
}: {
  type: ServiceType | null | undefined;
  onDoubleClick?: (e: React.MouseEvent) => void;
  editable?: boolean;
  className?: string;
}) {
  if (type !== 'recruitment' && type !== 'hoh') return null;
  const isGT = type === 'recruitment';
  const base = 'text-[10px] px-1.5 py-0.5 rounded-full border font-medium select-none whitespace-nowrap';
  const color = isGT
    ? 'bg-purple-50 text-purple-600 border-purple-200'
    : 'bg-orange-50 text-orange-600 border-orange-200';
  const label = isGT ? 'Gioi thieu lao dong' : 'HOH';
  return (
    <span
      onDoubleClick={onDoubleClick}
      title={editable ? `${label} — nhan doi de doi loai hinh` : label}
      className={`${base} ${color} ${editable ? 'cursor-pointer' : ''} ${className}`}
    >
      {isGT ? 'GT' : 'HOH'}
    </span>
  );
}

/**
 * Hình thức của đối thủ / nhu cầu của khách (migration 184): giới thiệu = "GT" tím như ServiceTypeBadge,
 * làm cả hai = "Thuê + GT", chỉ cho thuê = không nhãn (mặc định).
 */
export function ServiceModeChip({ mode, className = '' }: { mode: 'leasing' | 'recruitment' | 'both' | 'direct' | null | undefined; className?: string }) {
  if (mode === 'recruitment' || mode === 'direct') return <ServiceTypeBadge type="recruitment" className={className} />;
  if (mode !== 'both') return null;
  return (
    <span title="Cả cho thuê lao động và giới thiệu lao động"
      className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium select-none whitespace-nowrap bg-purple-50 text-purple-600 border-purple-200 ${className}`}>
      Thuê + GT
    </span>
  );
}
