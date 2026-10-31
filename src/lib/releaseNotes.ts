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
    id: '2026-10-31-company-occasions',
    date: '2026-10-31',
    title: 'Khách hàng & CSKH',
    features: [
      'Khách hàng → "Ngày lễ KH": nhập nhanh ngày thành lập, kỷ niệm, ngày lễ riêng của từng công ty',
      'Chọn quốc gia người đứng đầu → tự nhắc ngày lễ lớn của nước đó (Seollal, Chuseok, Obon, Tết Xuân…)',
      'CSKH Sự kiện & Dashboard hiện ngày của công ty; sửa danh mục ngày lễ theo quốc gia',
      'Popup chúc sinh nhật / ngày đặc biệt: nhắc trước 2 ngày + đúng ngày, cho mọi người liên hệ của khách',
    ],
  },
  {
    id: '2026-10-31-service-mode-market',
    date: '2026-10-31',
    title: 'Thị trường',
    features: [
      'Báo giá: chọn Cho thuê lao động (thời vụ) hoặc Giới thiệu lao động (chính thức), in điều khoản GT',
      'Đối thủ: ghi hình thức cho thuê / giới thiệu / cả hai, phí giới thiệu mỗi người, ngày bảo hành',
      'Leads ghi khách cần thời vụ hay chính thức; Ngành Nghề thêm phí giới thiệu từ – đến',
      'CRM: bảng báo giá chọn Cho thuê / Giới thiệu / Cả hai; Hợp tác tạo khách đúng loại dịch vụ',
      'Tuyển dụng: lấy phí từ Phương án giá, gợi ý Lương TT; tab Thời vụ đổi tên thành Đang cho thuê',
    ],
  },
  {
    id: '2026-10-31-cskh-log-draft',
    date: '2026-10-31',
    title: 'CSKH',
    features: [
      'Ghi tương tác: nội dung đang nhập dở được tự lưu nháp — lỡ tay đóng form, mở lại vẫn còn',
    ],
  },
  {
    id: '2026-10-31-recruit-workforce',
    date: '2026-10-31',
    title: 'Tuyển dụng',
    features: [
      'Tab Thời vụ: lao động thời vụ của từng khách quản lý tới từng người (nhập Excel danh sách đang làm)',
      'Cảnh báo người làm thời vụ từ tháng thứ 10 và đủ 12 tháng (giới hạn cho thuê lại lao động)',
      'Chuyển chính thức cho khách 1 chạm, ghi được phí chuyển đổi để đối soát',
      'Đối chiếu số người theo danh sách với số lao động theo tuần đang nhập ở Khách hàng',
    ],
  },
  {
    id: '2026-10-31-recruit-insights',
    date: '2026-10-31',
    title: 'Tuyển dụng',
    features: [
      'Tab Phân tích: dự báo từng tháng cần bao nhiêu hồ sơ, hạn gom hồ sơ, đủ / sát / thiếu nguồn',
      'Phễu tuyển theo nhóm KTV / LĐPT, tỷ lệ nghỉ trong 30 ngày đầu',
      'Hiệu quả từng kênh tuyển + nhập chi phí → chi phí cho mỗi người đi làm',
      'Bản đồ nguồn lao động theo xã/phường quanh nhà máy; báo cáo tuần Excel gửi khách',
    ],
  },
  {
    id: '2026-10-31-recruit-onboarding-fees',
    date: '2026-10-31',
    title: 'Tuyển dụng',
    features: [
      'Đợt nhận việc: xếp người, điểm danh Đến / Không đến, xuất danh sách Excel gửi nhân sự khách',
      'Tự chốt phí giới thiệu khi đủ ngày; nhắc người nghỉ trong bảo hành cần người thay (miễn phí)',
      'Đối soát phí theo tháng → xuất Excel gửi khách → ghi doanh thu "Giới thiệu lao động" vào P&L Dự án',
      'Hoa hồng CTV tự tính, theo dõi đã trả; form ứng tuyển công khai có link + mã QR riêng từng CTV',
    ],
  },
  {
    id: '2026-10-31-recruit-core',
    date: '2026-10-31',
    title: 'Tuyển dụng',
    features: [
      'Mục mới Tuyển dụng: dự án tuyển theo khách (VD Co-Herent), nhà máy gắn chi nhánh, JD nhóm A-B-C',
      'Bảng chỉ tiêu nhà máy × tháng: dán thẳng bảng khách gửi (PDF / Excel), xem Kế hoạch vs Thực tế',
      'Kho ứng viên dùng chung, chống trùng SĐT / CCCD, nhập Excel; hồ sơ đi từ Mới → Đã nhận việc',
      'Tin tuyển dụng tự dựng từ JD để đăng Facebook / Zalo; việc cần làm hôm nay (hẹn PV, hồ sơ chưa gọi)',
    ],
  },
  {
    id: '2026-10-31-sale-zone-industry-pick',
    date: '2026-10-31',
    title: 'CRM',
    features: [
      'Hồ sơ Sale: KCN mạnh và ngành quen chọn từ danh mục Thị trường, lọc được ở Danh sách Sale',
    ],
  },
  {
    id: '2026-10-31-crm-sale-network',
    date: '2026-10-31',
    title: 'CRM',
    features: [
      'Mạng lưới Sale: mục riêng trong CRM chăm sóc Sale / CTV, tách hẳn khỏi khách hàng (chỉ admin)',
      'Hồ sơ Sale: nơi đang làm (chọn đối thủ), khu vực mạnh, ngành quen, tiến độ chiêu mộ',
      'Sale có hạng và nhịp nhắc riêng (thưa hơn khách), nhật ký, sự kiện, quà không cần công ty',
      'BD Pipeline: chọn tên Sale làm nguồn → hồ sơ Sale thấy các công ty họ đã giới thiệu',
    ],
  },
  {
    id: '2026-10-30-cskh-scope-visible-mobile',
    date: '2026-10-30',
    title: 'CSKH',
    features: [
      'CSKH trên điện thoại: luôn thấy bộ lọc đang bật, báo số mục bị ẩn ở "Sắp tới" và bỏ lọc 1 chạm',
    ],
  },
  {
    id: '2026-10-27-cskh-new-contact-one-form',
    date: '2026-10-27',
    title: 'CSKH',
    features: [
      'Thêm liên hệ ở Ma trận: dùng luôn hồ sơ CSKH, lưu 1 lần (có Ghi chú chi tiết)',
    ],
  },
  {
    id: '2026-10-27-contact-social-links',
    date: '2026-10-27',
    title: 'CSKH',
    features: [
      'Hồ sơ liên hệ: thêm link Facebook và LinkedIn kèm logo',
    ],
  },
  {
    id: '2026-10-27-cskh-backdated-due',
    date: '2026-10-27',
    title: 'CSKH',
    features: [
      'Ghi tương tác bù: hạn việc tiếp theo chọn được từ ngày tương tác',
    ],
  },
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
