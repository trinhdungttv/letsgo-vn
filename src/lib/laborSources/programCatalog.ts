// ============================================================================
// Danh mục NGÀNH ĐÀO TẠO chuẩn của Nguồn Lao Động (10/11).
//
// Vì sao: trước đây "Tên ngành" là ô gõ tự do → mỗi trường một kiểu ("Điện tử CN", "Điện tử công nghiệp",
// "dien tu") nên không lọc được trường theo ngành. Giờ mỗi ngành có MỘT tên chuẩn + MỘT khoá ổn định (key);
// form chỉ cho CHỌN từ danh sách, danh sách gồm:
//   (a) bộ ngành chuẩn dựng sẵn trong file này (nhóm công nghiệp / sản xuất mà công ty trong CRM cần),
//   (b) ngành người dùng thêm vào danh mục chung (bảng labor_program_catalog, migration 215),
//   (c) tên đã nhập tay ở các trường từ trước mà chưa khớp ngành chuẩn nào (hiện ở nhóm "Đã nhập tay từ trước").
// Tên nhập tay cũ được NHẬN RA qua danh sách tên gọi khác (aliases) + bỏ dấu + bỏ tiền tố "Công nghệ kỹ thuật" /
// "Kỹ thuật" / "CN"… → đổi sang tên chuẩn bằng nút "Chuẩn hoá", không mất dữ liệu.
//
// Khoá (key):  ngành chuẩn = slug viết tay cố định (VD 'dien-cong-nghiep'), KHÔNG đổi khi sửa tên hiển thị;
//              ngành thêm sau / nhập tay cũ = 'x-' + khoá rút gọn của tên (mọi cách viết giống nhau cùng 1 khoá).
// Cột labor_source_programs.program_key (migration 215) lưu khoá; chưa chạy migration thì khoá được suy ra từ tên
// (tên đã là tên chuẩn) nên lọc vẫn đúng.
// File này là logic thuần (không gọi mạng) — có bài kiểm tra ở programCatalog.test.ts.
// ============================================================================
import { foldVn } from '../companyMatch';

export interface ProgramGroup {
  key: string;
  label: string;
  /** Cụm từ (đã bỏ dấu) để gợi ý "ngành công ty" trong Thị trường → Ngành Nghề cho mọi ngành của nhóm. */
  hints: readonly string[];
}

export const PROGRAM_GROUPS: readonly ProgramGroup[] = [
  { key: 'dien-dien-tu', label: 'Điện – Điện tử', hints: ['dien tu', 'linh kien', 'dien'] },
  { key: 'co-khi', label: 'Cơ khí – Chế tạo', hints: ['co khi', 'che tao', 'kim loai', 'khuon'] },
  { key: 'tu-dong-hoa', label: 'Tự động hoá – Cơ điện tử', hints: ['co dien tu', 'tu dong', 'dien tu', 'co khi'] },
  { key: 'o-to', label: 'Ô tô – Nhiệt lạnh', hints: ['o to', 'phu tung', 'xe may', 'dieu hoa', 'nhiet'] },
  { key: 'cntt', label: 'Công nghệ thông tin', hints: ['cong nghe thong tin', 'phan mem', 'cntt', 'it'] },
  { key: 'det-may', label: 'Dệt may – Da giày', hints: ['det may', 'may mac', 'det', 'da giay', 'giay dep', 'thoi trang'] },
  { key: 'hoa-vat-lieu', label: 'Hoá – Vật liệu – Môi trường', hints: ['hoa chat', 'hoa', 'nhua', 'cao su', 'vat lieu', 'moi truong', 'son', 'bao bi'] },
  { key: 'thuc-pham', label: 'Thực phẩm – Nông nghiệp', hints: ['thuc pham', 'do uong', 'nong san', 'thuy san', 'thuc an', 'nong nghiep'] },
  { key: 'go-noi-that', label: 'Gỗ – Nội thất', hints: ['go', 'noi that', 'do go'] },
  { key: 'xay-dung', label: 'Xây dựng – Kiến trúc', hints: ['xay dung', 'kien truc', 'ha tang'] },
  { key: 'logistics', label: 'Logistics – Kinh doanh', hints: ['logistics', 'van tai', 'kho van', 'thuong mai', 'xuat nhap khau', 'phan phoi', 'ban le'] },
  { key: 'ke-toan', label: 'Kế toán – Tài chính', hints: [] },
  { key: 'quan-tri', label: 'Quản trị – Nhân sự – Hành chính', hints: [] },
  { key: 'san-xuat', label: 'Sản xuất – Chất lượng – An toàn', hints: [] },
  { key: 'ngoai-ngu', label: 'Ngoại ngữ', hints: [] },
  { key: 'khac', label: 'Khác – Dịch vụ', hints: [] },
];

/** Nhóm cuối: tên nhập tay từ trước chưa khớp ngành chuẩn nào. */
export const LEGACY_GROUP: ProgramGroup = { key: 'cu', label: 'Đã nhập tay từ trước (chưa có trong danh mục chuẩn)', hints: [] };

const GROUP_BY_KEY = new Map<string, ProgramGroup>([...PROGRAM_GROUPS, LEGACY_GROUP].map(g => [g.key, g]));
export const groupOf = (key: string): ProgramGroup => GROUP_BY_KEY.get(key) ?? GROUP_BY_KEY.get('khac')!;
export const isProgramGroupKey = (key: string) => PROGRAM_GROUPS.some(g => g.key === key);

export type ProgramOrigin = 'standard' | 'custom' | 'legacy';
export interface ProgramOption {
  /** Khoá ổn định — dùng để lọc trường theo ngành. */
  key: string;
  /** Tên chuẩn hiển thị / lưu vào labor_source_programs.name. */
  name: string;
  group: string;
  origin: ProgramOrigin;
  /** Tên gọi khác (để tìm và để nhận ra tên nhập tay cũ). */
  aliases: readonly string[];
  /** Cụm từ riêng gợi ý ngành công ty (trống → theo nhóm). */
  hints: readonly string[];
}

// ── Bộ ngành chuẩn ──────────────────────────────────────────────────────────
// p(nhóm, khoá, tên chuẩn, [tên gọi khác], [gợi ý ngành công ty riêng])
const p = (group: string, key: string, name: string, aliases: readonly string[] = [], hints: readonly string[] = []): ProgramOption =>
  ({ key, name, group, origin: 'standard', aliases, hints });

export const STANDARD_PROGRAMS: readonly ProgramOption[] = [
  // Điện – Điện tử
  p('dien-dien-tu', 'dien-cong-nghiep', 'Điện công nghiệp', ['Điện công nghiệp và dân dụng', 'Điện dân dụng', 'Điện công trình', 'Lắp đặt điện']),
  p('dien-dien-tu', 'dien-tu-cong-nghiep', 'Điện tử công nghiệp', ['Điện tử', 'Điện tử công nghiệp và dân dụng', 'Điện tử công nghiệp – dân dụng']),
  p('dien-dien-tu', 'dien-dien-tu', 'Công nghệ kỹ thuật điện, điện tử', ['Điện – Điện tử', 'Điện điện tử', 'Kỹ thuật điện – điện tử', 'Điện, điện tử', 'Kỹ thuật điện điện tử']),
  p('dien-dien-tu', 'dien-tu-vien-thong', 'Điện tử – Viễn thông', ['Công nghệ kỹ thuật điện tử viễn thông', 'Kỹ thuật điện tử viễn thông', 'Viễn thông']),
  p('dien-dien-tu', 'he-thong-dien', 'Hệ thống điện', ['Kỹ thuật hệ thống điện', 'Cung cấp điện', 'Hệ thống cung cấp điện', 'Điện nhà máy']),
  p('dien-dien-tu', 'dien-tu-dan-dung', 'Điện tử dân dụng', ['Sửa chữa điện tử dân dụng', 'Kỹ thuật sửa chữa điện tử dân dụng']),
  p('dien-dien-tu', 'ban-dan-vi-mach', 'Bán dẫn – Vi mạch', ['Kỹ thuật bán dẫn', 'Công nghệ vi mạch bán dẫn', 'Vi mạch', 'Bán dẫn', 'Thiết kế vi mạch']),
  p('dien-dien-tu', 'nang-luong-tai-tao', 'Năng lượng tái tạo', ['Điện mặt trời', 'Điện năng lượng mặt trời', 'Năng lượng mặt trời', 'Công nghệ năng lượng']),

  // Cơ khí – Chế tạo
  p('co-khi', 'cat-got-kim-loai', 'Cắt gọt kim loại', ['Cắt gọt', 'CNC', 'Tiện phay bào', 'Tiện – Phay', 'Gia công cắt gọt kim loại', 'Vận hành máy CNC', 'Gia công CNC', 'Tiện CNC']),
  p('co-khi', 'che-tao-may', 'Công nghệ chế tạo máy', ['Chế tạo máy', 'Cơ khí chế tạo', 'Kỹ thuật chế tạo máy']),
  p('co-khi', 'ky-thuat-co-khi', 'Công nghệ kỹ thuật cơ khí', ['Kỹ thuật cơ khí', 'Cơ khí', 'Cơ khí tổng hợp']),
  p('co-khi', 'han', 'Hàn', ['Công nghệ hàn', 'Kỹ thuật hàn', 'Hàn điện', 'Hàn TIG MIG', 'Hàn MIG MAG', 'Hàn công nghệ cao']),
  p('co-khi', 'khuon-mau', 'Công nghệ khuôn mẫu', ['Khuôn mẫu', 'Thiết kế khuôn mẫu', 'Chế tạo khuôn mẫu', 'Khuôn', 'Thiết kế và chế tạo khuôn']),
  p('co-khi', 'thiet-ke-co-khi', 'Thiết kế cơ khí CAD/CAM', ['CAD CAM', 'Thiết kế cơ khí', 'Kỹ thuật thiết kế cơ khí', 'Vẽ kỹ thuật cơ khí', 'Thiết kế CAD']),
  p('co-khi', 'bao-tri-thiet-bi', 'Bảo trì – Sửa chữa thiết bị công nghiệp', ['Bảo trì thiết bị', 'Bảo trì thiết bị công nghiệp', 'Sửa chữa thiết bị cơ khí', 'Bảo trì sửa chữa máy', 'Bảo trì và sửa chữa thiết bị']),
  p('co-khi', 'kim-loai-tam', 'Gò – Dập – Gia công kim loại tấm', ['Gò hàn', 'Gia công kim loại tấm', 'Dập tạo hình', 'Kỹ thuật dập']),

  // Tự động hoá – Cơ điện tử
  p('tu-dong-hoa', 'co-dien-tu', 'Cơ điện tử', ['Công nghệ kỹ thuật cơ điện tử', 'Kỹ thuật cơ điện tử', 'Mechatronics', 'Công nghệ cơ điện tử', 'Cơ – điện tử']),
  p('tu-dong-hoa', 'tu-dong-hoa', 'Tự động hoá công nghiệp', ['Tự động hóa', 'Công nghệ kỹ thuật điều khiển và tự động hoá', 'Kỹ thuật điều khiển và tự động hoá', 'Điều khiển tự động', 'Điện tự động hoá', 'Automation', 'Điều khiển và tự động hoá']),
  p('tu-dong-hoa', 'robot', 'Kỹ thuật Robot', ['Robot', 'Robotics', 'Robot công nghiệp', 'Công nghệ robot']),

  // Ô tô – Nhiệt lạnh
  p('o-to', 'o-to', 'Công nghệ ô tô', ['Công nghệ kỹ thuật ô tô', 'Ô tô', 'Kỹ thuật ô tô', 'Cơ khí ô tô', 'Sửa chữa ô tô', 'Bảo dưỡng sửa chữa ô tô', 'Công nghệ sửa chữa ô tô']),
  p('o-to', 'dien-lanh', 'Kỹ thuật máy lạnh và điều hoà không khí', ['Điện lạnh', 'Nhiệt lạnh', 'Điện lạnh dân dụng', 'Máy lạnh', 'Máy lạnh và điều hoà không khí', 'Điều hoà không khí', 'Công nghệ kỹ thuật nhiệt', 'Kỹ thuật nhiệt lạnh', 'Nhiệt – lạnh', 'Điện – lạnh', 'Công nghệ nhiệt lạnh', 'Kỹ thuật nhiệt']),
  p('o-to', 'xe-may-dong-co', 'Kỹ thuật xe máy – Động cơ', ['Sửa chữa xe máy', 'Kỹ thuật xe máy', 'Xe máy', 'Động cơ', 'Công nghệ động cơ']),

  // Công nghệ thông tin
  p('cntt', 'cntt', 'Công nghệ thông tin', ['CNTT', 'IT', 'Tin học', 'Tin học ứng dụng', 'Ứng dụng CNTT']),
  p('cntt', 'phan-mem', 'Kỹ thuật phần mềm', ['Lập trình', 'Lập trình phần mềm', 'Phát triển phần mềm', 'Software engineering', 'Lập trình máy tính', 'Công nghệ phần mềm', 'Lập trình ứng dụng']),
  p('cntt', 'mang-may-tinh', 'Quản trị mạng máy tính', ['Mạng máy tính', 'Quản trị mạng', 'Mạng máy tính và truyền thông dữ liệu', 'Truyền thông và mạng máy tính', 'Hệ thống mạng']),
  p('cntt', 'khoa-hoc-may-tinh', 'Khoa học máy tính', ['KHMT', 'Computer science']),
  p('cntt', 'ky-thuat-may-tinh', 'Kỹ thuật máy tính', ['Công nghệ kỹ thuật máy tính', 'Sửa chữa lắp ráp máy tính', 'Lắp ráp và sửa chữa máy tính', 'Kỹ thuật sửa chữa lắp ráp máy tính', 'Phần cứng máy tính']),
  p('cntt', 'an-toan-thong-tin', 'An toàn thông tin', ['An ninh mạng', 'Bảo mật thông tin', 'An toàn an ninh mạng']),
  p('cntt', 'he-thong-thong-tin', 'Hệ thống thông tin', ['HTTT', 'Hệ thống thông tin quản lý', 'Tin học quản lý']),
  p('cntt', 'ai-du-lieu', 'Trí tuệ nhân tạo – Khoa học dữ liệu', ['Trí tuệ nhân tạo', 'AI', 'Khoa học dữ liệu', 'Data science', 'Phân tích dữ liệu']),
  p('cntt', 'do-hoa', 'Thiết kế đồ hoạ', ['Đồ họa', 'Thiết kế đồ họa', 'Thiết kế đồ hoạ đa phương tiện', 'Đồ hoạ mỹ thuật đa phương tiện', 'Multimedia']),

  // Dệt may – Da giày
  p('det-may', 'may-thoi-trang', 'May thời trang', ['May mặc', 'May công nghiệp', 'Công nghệ may', 'Công nghệ may và thời trang', 'May và thiết kế thời trang', 'Kỹ thuật may', 'Công nghệ may mặc', 'May']),
  p('det-may', 'det-may', 'Công nghệ dệt, may', ['Dệt may', 'Công nghệ kỹ thuật dệt may', 'Công nghệ dệt', 'Kỹ thuật dệt', 'Dệt', 'Công nghệ sợi dệt', 'Công nghệ sợi', 'Công nghệ dệt may', 'Dệt – May']),
  p('det-may', 'thiet-ke-thoi-trang', 'Thiết kế thời trang', ['Thời trang', 'Thiết kế may', 'Design thời trang']),
  p('det-may', 'da-giay', 'Công nghệ da giày', ['Da giày', 'Da giầy', 'Công nghệ da giày và thời trang', 'Công nghệ da giầy', 'Kỹ thuật giày', 'Thiết kế giày', 'Giày da', 'Công nghệ giày', 'Công nghệ da']),

  // Hoá – Vật liệu – Môi trường
  p('hoa-vat-lieu', 'hoa-hoc', 'Công nghệ kỹ thuật hoá học', ['Kỹ thuật hoá học', 'Hoá học', 'Công nghệ hoá học', 'Hoá công nghiệp', 'Hoá dầu', 'Công nghệ hoá dầu', 'Hoá']),
  p('hoa-vat-lieu', 'phan-tich-kiem-nghiem', 'Phân tích – Kiểm nghiệm', ['Phân tích kiểm nghiệm', 'Kiểm nghiệm', 'Phân tích hoá học', 'Phân tích chất lượng', 'Hoá phân tích']),
  p('hoa-vat-lieu', 'vat-lieu', 'Công nghệ vật liệu', ['Vật liệu', 'Kỹ thuật vật liệu', 'Khoa học vật liệu']),
  p('hoa-vat-lieu', 'nhua-cao-su', 'Công nghệ nhựa – Cao su', ['Nhựa', 'Cao su', 'Công nghệ kỹ thuật polymer', 'Polymer', 'Kỹ thuật polymer', 'Công nghệ nhựa', 'Công nghệ cao su', 'Chế biến nhựa', 'Gia công nhựa']),
  p('hoa-vat-lieu', 'xu-ly-be-mat', 'Xử lý bề mặt – Sơn mạ', ['Sơn mạ', 'Xử lý bề mặt', 'Mạ điện', 'Công nghệ sơn', 'Công nghệ mạ', 'Sơn', 'Sơn tĩnh điện', 'Công nghệ xử lý bề mặt']),
  p('hoa-vat-lieu', 'moi-truong', 'Công nghệ kỹ thuật môi trường', ['Kỹ thuật môi trường', 'Môi trường', 'Quản lý tài nguyên và môi trường', 'Xử lý nước thải', 'Công nghệ môi trường', 'Quản lý môi trường', 'Công nghệ xử lý môi trường']),
  p('hoa-vat-lieu', 'in-bao-bi', 'Công nghệ in – Bao bì', ['Công nghệ in', 'In', 'Bao bì', 'Công nghệ kỹ thuật in', 'Kỹ thuật in', 'In ấn']),

  // Thực phẩm – Nông nghiệp
  p('thuc-pham', 'thuc-pham', 'Công nghệ thực phẩm', ['Thực phẩm', 'Công nghệ kỹ thuật thực phẩm', 'Chế biến thực phẩm', 'Kỹ thuật thực phẩm', 'Công nghệ chế biến thực phẩm']),
  p('thuc-pham', 'sinh-hoc', 'Công nghệ sinh học', ['Sinh học', 'Công nghệ kỹ thuật sinh học', 'Kỹ thuật sinh học', 'Vi sinh']),
  p('thuc-pham', 'thuy-san', 'Chế biến thuỷ sản', ['Công nghệ chế biến thuỷ sản', 'Thuỷ sản']),
  p('thuc-pham', 'chan-nuoi-thu-y', 'Chăn nuôi – Thú y', ['Chăn nuôi', 'Thú y', 'Chăn nuôi thú y', 'Dược thú y']),
  p('thuc-pham', 'nong-nghiep', 'Nông nghiệp – Trồng trọt', ['Nông nghiệp', 'Khoa học cây trồng', 'Trồng trọt', 'Bảo vệ thực vật', 'Nông nghiệp công nghệ cao', 'Nông học']),

  // Gỗ – Nội thất
  p('go-noi-that', 'che-bien-go', 'Công nghệ chế biến gỗ', ['Chế biến gỗ', 'Gỗ', 'Công nghệ gỗ', 'Chế biến lâm sản', 'Công nghệ chế biến lâm sản', 'Mộc', 'Mộc dân dụng', 'Mộc công nghiệp', 'Kỹ thuật gỗ']),
  p('go-noi-that', 'noi-that', 'Thiết kế nội thất', ['Nội thất', 'Kỹ thuật nội thất', 'Thiết kế và thi công nội thất']),

  // Xây dựng – Kiến trúc
  p('xay-dung', 'xay-dung', 'Công nghệ kỹ thuật xây dựng', ['Xây dựng', 'Kỹ thuật xây dựng', 'Xây dựng dân dụng và công nghiệp', 'Xây dựng dân dụng', 'Công nghệ xây dựng', 'Kỹ thuật xây dựng công trình', 'Xây dựng công nghiệp']),
  p('xay-dung', 'cau-duong', 'Xây dựng cầu đường', ['Cầu đường', 'Kỹ thuật xây dựng công trình giao thông', 'Xây dựng công trình giao thông']),
  p('xay-dung', 'kien-truc', 'Kiến trúc', ['Thiết kế kiến trúc', 'Công nghệ kỹ thuật kiến trúc', 'Kiến trúc công trình']),
  p('xay-dung', 'quan-ly-xay-dung', 'Quản lý xây dựng', ['Quản lý dự án xây dựng', 'Quản lý công trình', 'Kinh tế xây dựng', 'Dự toán xây dựng']),

  // Logistics – Kinh doanh
  p('logistics', 'logistics', 'Logistics và quản lý chuỗi cung ứng', ['Logistics', 'Logistic', 'Quản lý chuỗi cung ứng', 'Supply chain', 'Chuỗi cung ứng', 'Kỹ thuật logistics', 'Quản trị logistics', 'Dịch vụ logistics', 'Vận tải logistics']),
  p('logistics', 'kho-van', 'Quản lý kho – Vận tải', ['Quản lý kho', 'Kho vận', 'Quản trị kho', 'Vận tải', 'Quản lý kho vận', 'Khai thác vận tải', 'Kinh tế vận tải']),
  p('logistics', 'quan-tri-kinh-doanh', 'Quản trị kinh doanh', ['QTKD', 'Quản trị doanh nghiệp', 'Kinh doanh', 'Quản trị']),
  p('logistics', 'marketing', 'Marketing', ['Tiếp thị', 'Marketing thương mại', 'Digital marketing', 'Marketing số', 'Quản trị marketing']),
  p('logistics', 'kinh-doanh-thuong-mai', 'Kinh doanh thương mại', ['Thương mại', 'Quản trị kinh doanh thương mại', 'Bán hàng', 'Kinh doanh bán hàng', 'Kinh doanh bán lẻ']),
  p('logistics', 'xuat-nhap-khau', 'Kinh doanh quốc tế – Xuất nhập khẩu', ['Xuất nhập khẩu', 'Ngoại thương', 'Kinh tế đối ngoại', 'Kinh doanh quốc tế', 'Thương mại quốc tế', 'Kinh doanh xuất nhập khẩu']),
  p('logistics', 'thuong-mai-dien-tu', 'Thương mại điện tử', ['TMĐT', 'Kinh doanh thương mại điện tử', 'E-commerce']),

  // Kế toán – Tài chính
  p('ke-toan', 'ke-toan', 'Kế toán', ['Kế toán doanh nghiệp', 'Kế toán tổng hợp', 'Kế toán – Kiểm toán', 'Kế toán công nợ', 'Kế toán tài chính']),
  p('ke-toan', 'tai-chinh-ngan-hang', 'Tài chính – Ngân hàng', ['Tài chính ngân hàng', 'Tài chính doanh nghiệp', 'Ngân hàng', 'Tài chính', 'Tài chính – Tín dụng', 'Tài chính tín dụng']),
  p('ke-toan', 'kiem-toan', 'Kiểm toán', ['Kiểm toán nội bộ']),
  p('ke-toan', 'kinh-te', 'Kinh tế', ['Kinh tế học', 'Kinh tế đầu tư', 'Kinh tế phát triển']),

  // Quản trị – Nhân sự – Hành chính
  p('quan-tri', 'nhan-su', 'Quản trị nhân lực', ['Quản trị nhân sự', 'Nhân sự', 'Quản lý nhân sự', 'Quản trị nguồn nhân lực', 'Quản lý nguồn nhân lực', 'HRM', 'Nguồn nhân lực', 'Quản trị lao động']),
  p('quan-tri', 'hanh-chinh-van-phong', 'Hành chính – Văn phòng', ['Hành chính', 'Quản trị văn phòng', 'Hành chính văn phòng', 'Văn thư lưu trữ', 'Thư ký văn phòng', 'Nghiệp vụ văn phòng', 'Văn thư – Lưu trữ']),
  p('quan-tri', 'luat', 'Luật – Luật kinh tế', ['Luật', 'Luật kinh tế', 'Luật học', 'Pháp lý', 'Luật doanh nghiệp', 'Luật thương mại']),

  // Sản xuất – Chất lượng – An toàn
  p('san-xuat', 'quan-ly-cong-nghiep', 'Quản lý công nghiệp', ['Quản lý sản xuất', 'Quản trị sản xuất', 'Kỹ thuật công nghiệp', 'Kỹ thuật hệ thống công nghiệp', 'Quản lý vận hành sản xuất', 'Vận hành sản xuất', 'Industrial engineering']),
  p('san-xuat', 'quan-ly-chat-luong', 'Quản lý chất lượng', ['QA QC', 'QC', 'QA', 'Kiểm soát chất lượng', 'Đảm bảo chất lượng', 'Kiểm tra chất lượng sản phẩm', 'Quản lý và kiểm soát chất lượng', 'Kiểm tra chất lượng', 'Công nghệ quản lý chất lượng']),
  p('san-xuat', 'an-toan-lao-dong', 'An toàn – Bảo hộ lao động', ['An toàn lao động', 'Bảo hộ lao động', 'An toàn vệ sinh lao động', 'ATVSLĐ', 'An toàn sức khoẻ môi trường', 'EHS', 'HSE', 'Kỹ thuật an toàn lao động', 'An toàn và sức khoẻ nghề nghiệp']),

  // Ngoại ngữ
  p('ngoai-ngu', 'ngon-ngu-anh', 'Ngôn ngữ Anh', ['Tiếng Anh', 'Tiếng Anh thương mại', 'Anh văn', 'Tiếng Anh kinh doanh', 'Tiếng Anh du lịch', 'Sư phạm tiếng Anh', 'Ngôn ngữ Anh thương mại']),
  p('ngoai-ngu', 'ngon-ngu-nhat', 'Ngôn ngữ Nhật', ['Tiếng Nhật', 'Nhật ngữ', 'Ngôn ngữ Nhật Bản', 'Nhật Bản học', 'Tiếng Nhật thương mại']),
  p('ngoai-ngu', 'ngon-ngu-han', 'Ngôn ngữ Hàn Quốc', ['Tiếng Hàn', 'Hàn Quốc học', 'Hàn ngữ', 'Ngôn ngữ Hàn', 'Tiếng Hàn Quốc', 'Hàn Quốc', 'Tiếng Hàn thương mại']),
  p('ngoai-ngu', 'ngon-ngu-trung', 'Ngôn ngữ Trung Quốc', ['Tiếng Trung', 'Hoa ngữ', 'Tiếng Hoa', 'Ngôn ngữ Trung', 'Trung Quốc học', 'Tiếng Trung thương mại', 'Tiếng Trung Quốc']),

  // Khác – Dịch vụ
  p('khac', 'du-lich-khach-san', 'Du lịch – Nhà hàng – Khách sạn', ['Quản trị khách sạn', 'Quản trị nhà hàng', 'Du lịch lữ hành', 'Nhà hàng khách sạn', 'Du lịch', 'Nghiệp vụ nhà hàng khách sạn', 'Kỹ thuật chế biến món ăn', 'Quản trị dịch vụ du lịch và lữ hành', 'Nấu ăn']),
  p('khac', 'dieu-duong', 'Điều dưỡng – Y tế', ['Điều dưỡng', 'Y tế', 'Y sĩ', 'Dược', 'Dược sĩ', 'Hộ sinh']),
];

// ── Chuẩn hoá chuỗi để so khớp ──────────────────────────────────────────────
/** Bỏ dấu, chữ thường, bỏ phần trong ngoặc, ký tự lạ → khoảng trắng. */
export function normProgramText(s: string | null | undefined): string {
  return foldVn(s).replace(/\(.*?\)/g, ' ').replace(/&/g, ' va ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const LEVEL_TAIL = /( he)? (cao dang|trung cap|dai hoc|so cap)$/;
const LEAD_NOISE = /^(nganh|chuyen nganh|khoa|bo mon|nghe) /;
const LEAD_TECH = /^(cong nghe ky thuat|ky thuat|cong nghe) /;

/**
 * Khoá so khớp của 1 tên ngành: bỏ dấu + bỏ tiền tố "Ngành / Khoa / Công nghệ kỹ thuật / Kỹ thuật / Công nghệ"
 * + bỏ hậu tố trình độ ("… cao đẳng") + bỏ chữ "và". "CN" đứng đầu = công nghệ, đứng cuối = công nghiệp.
 * VD "CN kỹ thuật điện điện tử" và "Công nghệ kỹ thuật điện, điện tử" cùng ra 'dien dien tu'.
 */
export function programCore(s: string | null | undefined): string {
  const n = normProgramText(s);
  if (!n) return '';
  const t = n.split(' ');
  if (t[0] === 'cn') t.splice(0, 1, 'cong', 'nghe');
  else if (t[0] === 'cnkt') t.splice(0, 1, 'cong', 'nghe', 'ky', 'thuat');
  else if (t.length > 1 && t[t.length - 1] === 'cn') t.splice(t.length - 1, 1, 'cong', 'nghiep');
  let core = t.join(' ').replace(LEVEL_TAIL, '');
  for (let i = 0; i < 4; i += 1) {
    const next = core.replace(LEAD_NOISE, '').replace(LEAD_TECH, '');
    if (next === core) break;
    core = next;
  }
  core = core.split(' ').filter(w => w && w !== 'va').join(' ');
  return core || n;
}

/** Khoá cho ngành ngoài bộ chuẩn: mọi cách viết cùng nghĩa → cùng 1 khoá. */
export const slugKey = (name: string): string => `x-${programCore(name).replace(/ /g, '-').slice(0, 80) || 'khong-ten'}`;

/** Viết hoa chữ đầu, gọn khoảng trắng — để tên ngành thêm vào danh mục trông thống nhất. */
export const tidyProgramName = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toLocaleUpperCase('vi') + t.slice(1) : '';
};

// ── Chỉ mục & nhận ra tên cũ ────────────────────────────────────────────────
type Index = Map<string, ProgramOption>;
const indexCache = new WeakMap<readonly ProgramOption[], Index>();

function indexOf(options: readonly ProgramOption[]): Index {
  const hit = indexCache.get(options);
  if (hit) return hit;
  const idx: Index = new Map();
  // Ngành chuẩn / danh mục chung được ưu tiên hơn ngành nhập tay cũ khi trùng khoá so khớp
  const ordered = [...options].sort((a, b) => (a.origin === 'legacy' ? 1 : 0) - (b.origin === 'legacy' ? 1 : 0));
  for (const o of ordered) {
    for (const form of [o.name, ...o.aliases]) {
      const k = programCore(form);
      if (k && !idx.has(k)) idx.set(k, o);
    }
  }
  indexCache.set(options, idx);
  return idx;
}

/** Tìm ngành trong danh sách theo tên (khớp đúng sau chuẩn hoá — không đoán mờ). */
export function resolveProgram(name: string | null | undefined, options: readonly ProgramOption[]): ProgramOption | null {
  const k = programCore(name);
  return k ? indexOf(options).get(k) ?? null : null;
}

export interface CatalogEntryLike { key: string; name: string; group_key: string }

/**
 * Danh sách chọn = bộ chuẩn + ngành đã thêm vào danh mục chung + tên nhập tay cũ chưa khớp ngành nào
 * (gộp các cách viết giống nhau thành 1 mục). Thứ tự: theo nhóm.
 */
export function buildProgramOptions(custom: readonly CatalogEntryLike[], usedNames: readonly string[]): ProgramOption[] {
  const base: ProgramOption[] = [...STANDARD_PROGRAMS];
  const baseIdx = indexOf(base);
  const keys = new Set(base.map(o => o.key));
  for (const c of custom) {
    const name = c.name.trim();
    if (!name || keys.has(c.key) || baseIdx.has(programCore(name))) continue; // trùng ngành chuẩn → bỏ
    keys.add(c.key);
    base.push({ key: c.key, name, group: isProgramGroupKey(c.group_key) ? c.group_key : 'khac', origin: 'custom', aliases: [], hints: [] });
  }
  const idx = indexOf(base);
  // Tên nhập tay cũ chưa khớp: gộp theo khoá so khớp, lấy cách viết xuất hiện nhiều nhất làm tên hiển thị
  const legacy = new Map<string, Map<string, number>>();
  for (const raw of usedNames) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const core = programCore(name);
    if (!name || !core || idx.has(core)) continue;
    const spell = legacy.get(core) ?? new Map<string, number>();
    spell.set(name, (spell.get(name) ?? 0) + 1);
    legacy.set(core, spell);
  }
  const legacyOpts: ProgramOption[] = [...legacy.values()].map(spell => {
    const best = [...spell.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'))[0][0];
    return { key: slugKey(best), name: best, group: LEGACY_GROUP.key, origin: 'legacy' as const, aliases: [...spell.keys()].filter(n => n !== best), hints: [] };
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return [...base, ...legacyOpts];
}

// ── Nhóm hiển thị ───────────────────────────────────────────────────────────
export function groupOptions(options: readonly ProgramOption[]): { group: ProgramGroup; items: ProgramOption[] }[] {
  const out: { group: ProgramGroup; items: ProgramOption[] }[] = [];
  for (const g of [...PROGRAM_GROUPS, LEGACY_GROUP]) {
    const items = options.filter(o => (GROUP_BY_KEY.has(o.group) ? o.group : 'khac') === g.key);
    if (items.length) out.push({ group: g, items });
  }
  return out;
}

// ── Tìm kiếm trong ô chọn ───────────────────────────────────────────────────
/** Kết quả tìm: ngành + lý do khớp (tên gọi khác nào khớp, để hiện "còn gọi là …"). */
export interface ProgramHit { option: ProgramOption; via: string | null }

/**
 * Lọc danh sách theo ô gõ: bỏ dấu, không phân biệt hoa thường; "dien tu" ra Điện tử công nghiệp, Điện tử – Viễn thông…
 * Xếp: tên bắt đầu bằng chữ gõ → tên chứa → tên gọi khác chứa → đủ các từ (tên + gọi khác + nhóm). Trống = giữ nguyên thứ tự.
 */
export function searchPrograms(query: string, options: readonly ProgramOption[]): ProgramHit[] {
  const q = normProgramText(query);
  if (!q) return options.map(option => ({ option, via: null }));
  const words = q.split(' ');
  const scored: { hit: ProgramHit; rank: number; i: number }[] = [];
  options.forEach((option, i) => {
    const name = normProgramText(option.name);
    if (name.startsWith(q) || programCore(option.name) === programCore(query)) { scored.push({ hit: { option, via: null }, rank: 0, i }); return; }
    if (name.includes(q)) { scored.push({ hit: { option, via: null }, rank: 1, i }); return; }
    const alias = option.aliases.find(a => normProgramText(a).includes(q));
    if (alias) { scored.push({ hit: { option, via: alias }, rank: 2, i }); return; }
    const hay = [name, ...option.aliases.map(normProgramText), normProgramText(groupOf(option.group).label)].join(' | ');
    if (words.every(w => hay.includes(w))) scored.push({ hit: { option, via: null }, rank: 3, i });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.i - b.i).map(s => s.hit);
}

const tokens = (s: string) => new Set(programCore(s).split(' ').filter(Boolean));

/** Gợi ý ngành chuẩn gần giống 1 tên nhập tay (không tự áp dụng — để người dùng bấm chọn). */
export function suggestPrograms(name: string, options: readonly ProgramOption[], limit = 3): ProgramOption[] {
  const a = tokens(name);
  const core = programCore(name);
  if (!a.size) return [];
  const scored: { o: ProgramOption; score: number }[] = [];
  for (const o of options) {
    if (o.origin === 'legacy') continue;
    let best = 0;
    for (const form of [o.name, ...o.aliases]) {
      const b = tokens(form);
      if (!b.size) continue;
      let inter = 0;
      for (const w of a) if (b.has(w)) inter += 1;
      let score = (2 * inter) / (a.size + b.size);
      const fc = programCore(form);
      if (fc.length >= 4 && (core.includes(fc) || fc.includes(core)) && core.length >= 4) score = Math.max(score, 0.6);
      best = Math.max(best, score);
    }
    if (best >= 0.5) scored.push({ o, score: best });
  }
  return scored.sort((x, y) => y.score - x.score).slice(0, limit).map(s => s.o);
}

// ── Ngành đã lưu ↔ danh mục ─────────────────────────────────────────────────
export interface ProgramLike { name: string; program_key?: string | null }
/** 'ok' = đã đúng tên chuẩn · 'rename' = nhận ra được, chỉ cần đổi sang tên chuẩn · 'unknown' = chưa có trong danh mục. */
export type ProgramState = 'ok' | 'rename' | 'unknown';

/** Ngành trong danh mục ứng với 1 dòng đã lưu: ưu tiên khoá đã lưu, rồi đến nhận ra theo tên. null = chưa có. */
export function programMatch(p: ProgramLike, options: readonly ProgramOption[]): ProgramOption | null {
  const stored = p.program_key ? options.find(o => o.key === p.program_key && o.origin !== 'legacy') : undefined;
  const o = stored ?? resolveProgram(p.name, options);
  return o && o.origin !== 'legacy' ? o : null;
}

export function programState(p: ProgramLike, options: readonly ProgramOption[]): ProgramState {
  const o = programMatch(p, options);
  if (!o) return 'unknown';
  return p.name.trim() === o.name ? 'ok' : 'rename';
}

/** Khoá ổn định của 1 dòng đã lưu (để lọc trường theo ngành): khoá đã lưu → ngành nhận ra theo tên → khoá từ tên. */
export function programKeyOf(p: ProgramLike, options: readonly ProgramOption[]): string {
  const o = programMatch(p, options);
  if (o) return o.key;
  return p.program_key || slugKey(p.name);
}

/** Mục đang chọn khi mở form sửa 1 ngành đã lưu; chưa có trong danh mục → mục "nhập tay cũ" dựng tạm (form không vỡ). */
export function programOptionOf(p: ProgramLike, options: readonly ProgramOption[]): ProgramOption {
  const o = programMatch(p, options);
  if (o) return o;
  const key = slugKey(p.name);
  return options.find(x => x.key === key) ?? { key, name: p.name.trim(), group: LEGACY_GROUP.key, origin: 'legacy', aliases: [], hints: [] };
}

export interface NormalizeItem<T> { program: T; option: ProgramOption; from: string; /** true = trường đã có ngành này rồi → đổi tên sẽ thành trùng, bỏ qua. */ duplicate: boolean }

/** Các dòng nhận ra được nhưng còn tên cũ (cần đổi sang tên chuẩn). Không đụng dòng 'unknown'. */
export function planNormalize<T extends ProgramLike & { id: string; source_id: string }>(programs: readonly T[], options: readonly ProgramOption[]): NormalizeItem<T>[] {
  const taken = new Set<string>();
  for (const p of programs) if (programState(p, options) === 'ok') taken.add(`${p.source_id}|${programKeyOf(p, options)}`);
  const out: NormalizeItem<T>[] = [];
  for (const p of programs) {
    if (programState(p, options) !== 'rename') continue;
    const option = programMatch(p, options)!;
    const k = `${p.source_id}|${option.key}`;
    const duplicate = taken.has(k);
    if (!duplicate) taken.add(k);
    out.push({ program: p, option, from: p.name.trim(), duplicate });
  }
  return out;
}

/** Mã các đơn vị có ít nhất 1 ngành thuộc khoá / nhóm đã chọn — nền cho bộ lọc "trường theo ngành". */
export function sourceIdsWithProgram<T extends ProgramLike & { source_id: string }>(
  programs: readonly T[], options: readonly ProgramOption[], filter: { key?: string; group?: string },
): Set<string> {
  const ids = new Set<string>();
  for (const p of programs) {
    const k = programKeyOf(p, options);
    const o = options.find(x => x.key === k);
    if ((filter.key && k === filter.key) || (filter.group && o && o.group === filter.group)) ids.add(p.source_id);
  }
  return ids;
}

// ── Gợi ý "ngành công ty" (Thị trường → Ngành Nghề) theo ngành đào tạo ───────
/**
 * Ngành công ty hợp với 1 ngành đào tạo: khớp theo CỤM TỪ nguyên (không khớp giữa từ) với tên ngành trong
 * Thị trường → Ngành Nghề. VD nhóm Dệt may có cụm "det may" → ngành "Dệt may". Trả tối đa 4 mã.
 */
export function suggestIndustryIds(option: ProgramOption, industries: readonly { id: string; name: string }[]): string[] {
  const hints = option.hints.length ? option.hints : groupOf(option.group).hints;
  if (!hints.length) return [];
  const out: string[] = [];
  for (const ind of industries) {
    const hay = ` ${normProgramText(ind.name)} `;
    if (hints.some(h => hay.includes(` ${h} `))) out.push(ind.id);
    if (out.length >= 4) break;
  }
  return out;
}
