// Danh sách trang của module — file nhỏ, được App/Sidebar import trực tiếp (không kéo theo bundle module).
import { Building, Car, DoorOpen, MonitorSmartphone, Receipt, Settings2, TrendingUp, Wrench, type LucideIcon } from 'lucide-react';

export const OFFICE_PAGES = [
  'office', 'office-pl', 'office-rooms', 'office-billing', 'office-parking', 'office-tickets', 'office-assets', 'office-settings',
] as const;

export type OfficePage = (typeof OFFICE_PAGES)[number];

export function isOfficePage(p: string): p is OfficePage {
  return (OFFICE_PAGES as readonly string[]).includes(p);
}

/** Tên module trong bảng role_permissions (migration 164). */
export const OFFICE_PERMISSION_MODULE = 'Văn phòng Orient';

export const OFFICE_NAV: { page: OfficePage; label: string; short: string }[] = [
  { page: 'office', label: 'Tổng quan', short: 'VP Orient' },
  { page: 'office-pl', label: 'Lời / Lỗ', short: 'Lời/Lỗ VP' },
  { page: 'office-rooms', label: 'Phòng & Hợp đồng', short: 'Phòng VP' },
  { page: 'office-billing', label: 'Hoá đơn & Điện', short: 'Hoá đơn VP' },
  { page: 'office-parking', label: 'Bãi xe', short: 'Bãi xe' },
  { page: 'office-tickets', label: 'Sự cố & Bảo trì', short: 'Sự cố VP' },
  { page: 'office-assets', label: 'Tài sản', short: 'Tài sản VP' },
  { page: 'office-settings', label: 'Cài đặt & Dữ liệu', short: 'Cài đặt VP' },
];

export const OFFICE_ICON: Record<OfficePage, LucideIcon> = {
  office: Building,
  'office-pl': TrendingUp,
  'office-rooms': DoorOpen,
  'office-billing': Receipt,
  'office-parking': Car,
  'office-tickets': Wrench,
  'office-assets': MonitorSmartphone,
  'office-settings': Settings2,
};
