// ============================================================================
// Release notes — tên các chức năng mới, hiện trong popup "Có phiên bản mới".
// ----------------------------------------------------------------------------
// QUY ƯỚC: mỗi lần hoàn thành 1 chức năng mới (trước khi Tony commit/push) → THÊM 1 mục Ở ĐẦU danh sách
// (mới nhất trước). Không sửa / xoá mục cũ. Xem docs/RELEASE_NOTES.md.
//
//   id        duy nhất, dạng 'YYYY-MM-DD-ten-ngan' (mục đầu danh sách = "bản mới nhất" của app)
//   date      'YYYY-MM-DD'
//   title     (tuỳ chọn) nhóm chức năng, vd 'CSKH'
//   features  tên chức năng NGẮN bằng tiếng Việt — người dùng đọc trong popup, đừng viết tên file / tên hàm
//
// File này CHỈ được đọc lúc build (vite.config.ts ghi vào dist/version.json). Bản app đang mở trên trình duyệt
// lấy danh sách từ version.json của server, nên popup của bản cũ vẫn thấy tên chức năng của bản mới.
// ============================================================================
import type { ReleaseNote } from './releaseUpdate';

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: '2026-10-27-cskh-agenda-avatar',
    date: '2026-10-27',
    title: 'CSKH',
    features: [
      'CSKH Tổng quan: avatar người liên hệ ở Việc đã hứa và Gần đây',
    ],
  },
  {
    id: '2026-10-27-cskh-log-collapse',
    date: '2026-10-27',
    title: 'CSKH',
    features: [
      'Nhật ký CSKH: nội dung dài tự thu gọn, bấm "Xem thêm" để mở đủ',
    ],
  },
  {
    id: '2026-10-27-cskh-task-check',
    date: '2026-10-27',
    title: 'CSKH',
    features: [
      'CSKH: việc chưa xong có ô tròn để tích xong (kiểu TickTick)',
      'CSKH: bấm "Xem thêm" để đọc đủ nội dung cuộc trao đổi gần đây',
    ],
  },
  {
    id: '2026-10-27-mobile-back',
    date: '2026-10-27',
    title: 'Điện thoại',
    features: [
      'Điện thoại: bấm CRM mở thẳng Leads (Tổng quan CRM là mục riêng bên cạnh)',
      'Điện thoại: nút "Quay lại" ở đầu mọi hộp thoại CSKH (hồ sơ, nhật ký, quà tặng…)',
      'Điện thoại: thanh "Quay lại" khi mở trang từ liên kết (Dashboard → Chi nhánh…)',
    ],
  },
  {
    id: '2026-10-26-kcn-survey-wage-sync',
    date: '2026-10-26',
    title: 'Báo cáo khảo sát KCN',
    features: [
      'Báo cáo khảo sát KCN: ghi lương vào Lương TT của đúng KCN + ngành',
      'Lương TT: thêm cột Lương cơ bản 8h (đồng/ngày)',
    ],
  },
  {
    id: '2026-10-26-kcn-survey-base-wage',
    date: '2026-10-26',
    title: 'Báo cáo khảo sát KCN',
    features: [
      'Khảo sát KCN: thêm lương cơ bản 8h, bỏ lương phổ thông',
    ],
  },
  {
    id: '2026-10-26-kcn-survey-industry',
    date: '2026-10-26',
    title: 'Báo cáo khảo sát KCN',
    features: [
      'Báo cáo khảo sát KCN: chọn ngành từ Thị trường, tự lấy Lương TT đúng KCN + ngành',
    ],
  },
  {
    id: '2026-10-26-release-popup',
    date: '2026-10-26',
    title: 'Hệ thống',
    features: [
      'Thông báo “Có phiên bản mới” kèm tên chức năng mới (bấm Cập nhật ngay khi sẵn sàng)',
    ],
  },
  {
    id: '2026-10-26-kcn-survey',
    date: '2026-10-26',
    title: 'Báo cáo khảo sát KCN',
    features: [
      'Báo cáo khảo sát KCN tự điền đối thủ trong khu',
      'Báo cáo khảo sát KCN ghi lại Lương TT theo từng báo cáo',
    ],
  },
  {
    id: '2026-10-26-branch-rail',
    date: '2026-10-26',
    title: 'Workspace',
    features: [
      'Ẩn / hiện chi nhánh ở khung Cập nhật chi nhánh (bánh răng)',
      'Avatar chi nhánh trên từng dòng chi nhánh',
    ],
  },
  {
    id: '2026-10-26-cskh-gift-log',
    date: '2026-10-26',
    title: 'CSKH',
    features: [
      'Ghi quà tặng từ Nhật ký → tự vào Lịch sử quà',
      'Ghi quà ở Sự kiện & Quà tặng → tự có dòng Nhật ký (hai chiều)',
    ],
  },
  {
    id: '2026-10-25-cskh-multi-followup',
    date: '2026-10-25',
    title: 'CSKH',
    features: ['Nhiều việc tiếp theo trong 1 dòng Nhật ký'],
  },
  {
    id: '2026-10-24-cskh-upgrade',
    date: '2026-10-24',
    title: 'CSKH',
    features: [
      'Giới tính (gợi ý theo tên), tuổi âm và mệnh trong hồ sơ người liên hệ',
      'Ngày sinh & ngày quan trọng, nhắc trước N ngày và đúng ngày',
      'Địa chỉ nhà có ghim bản đồ, quê quán 63 tỉnh, học vấn',
      'Bản đồ CSKH 3 lớp, đo khoảng cách, vị trí của tôi',
      'Ghi tương tác cho cả nhóm, sửa / xoá cả đợt',
    ],
  },
];
