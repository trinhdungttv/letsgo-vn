export const REGIONS = ['Tất cả', 'Biên Hòa', 'VSIP', 'Bình Dương', 'Đồng Nai', 'Bàu Bàng'];

export const MANAGERS = [
  'Ms. Lan',
  'Ms. Trang',
  'Mr. Hùng',
  'Anh Minh',
];

export const CRM_STAGES = [
  { id: 'tiem-nang', label: 'Tiềm năng', color: 'bg-blue-50 text-blue-800 border-blue-200', headerBg: 'bg-blue-50', headerText: 'text-blue-700', dot: 'bg-blue-400' },
  { id: 'dang-lh', label: 'Đang liên hệ', color: 'bg-amber-50 text-amber-800 border-amber-200', headerBg: 'bg-amber-50', headerText: 'text-amber-700', dot: 'bg-amber-400' },
  { id: 'quan-tam', label: 'Quan tâm/Chờ', color: 'bg-emerald-50 text-emerald-800 border-emerald-200', headerBg: 'bg-emerald-50', headerText: 'text-emerald-700', dot: 'bg-emerald-400' },
  { id: 'dam-phan', label: 'Đàm phán HĐ', color: 'bg-violet-50 text-violet-800 border-violet-200', headerBg: 'bg-violet-50', headerText: 'text-violet-700', dot: 'bg-violet-400' },
  { id: 'hop-tac', label: 'Đang HT', color: 'bg-teal-50 text-teal-800 border-teal-200', headerBg: 'bg-teal-50', headerText: 'text-teal-700', dot: 'bg-teal-400' },
];

export const CONTACT_TYPES: Record<string, { label: string; color: string }> = {
  call: { label: 'Điện thoại', color: 'bg-blue-50 text-blue-700' },
  meeting: { label: 'Gặp mặt', color: 'bg-emerald-50 text-emerald-700' },
  zalo: { label: 'Zalo', color: 'bg-amber-50 text-amber-700' },
  email: { label: 'Email', color: 'bg-gray-100 text-gray-600' },
};

export const LABOR_AVAILABILITY: Record<string, { label: string; color: string }> = {
  'Dồi dào': { label: 'Dồi dào', color: 'text-emerald-600' },
  'Trung bình': { label: 'Trung bình', color: 'text-amber-600' },
  'Khan hiếm': { label: 'Khan hiếm', color: 'text-red-600' },
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Quản trị viên',
  ketoan: 'Kế Toán',
  kinhdoanh: 'Kinh Doanh BD',
  bdh: 'Ban Điều Hành',
};

export const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  ketoan: 'bg-blue-100 text-blue-700',
  kinhdoanh: 'bg-emerald-100 text-emerald-700',
  bdh: 'bg-violet-100 text-violet-700',
};
