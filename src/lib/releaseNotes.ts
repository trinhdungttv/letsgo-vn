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
    id: '2026-11-09-profit-split-presets',
    date: '2026-11-09',
    title: 'Phương án giá',
    features: [
      'Chia lợi nhuận: nút chọn nhanh còn 30/70, 40/60, 50/50 (bỏ 100/0 và 0/100)',
    ],
  },
  {
    id: '2026-11-09-referral-commission-per-day',
    date: '2026-11-09',
    title: 'Phương án giá',
    features: [
      'Hoa hồng người giới thiệu / CTV chọn được tính theo số tiền / 1 ngày công (ngoài % phí thu được và đ / người)',
    ],
  },
  {
    id: '2026-11-09-recruit-image-tags',
    date: '2026-11-09',
    title: 'CRM Pipeline',
    features: [
      'Ảnh tuyển dụng hiện đủ cả ảnh (thu nhỏ vừa khung, không còn bị cắt)',
      'Bấm vào ảnh tuyển dụng mở popup xem ngay trong app (← → đổi ảnh, Esc đóng, bấm ảnh để phóng to)',
      'Gắn thẻ nhà cung ứng (đối thủ) cho từng ảnh tuyển dụng, có bộ lọc ảnh theo nhà cung ứng',
    ],
  },
  {
    id: '2026-11-09-labor-sources-province',
    date: '2026-11-09',
    title: 'Nguồn Lao Động',
    features: [
      'Chọn Tỉnh / thành cho từng trường theo 34 tỉnh sau sáp nhập (có ghi rõ tỉnh cũ đã gộp)',
      'Bản đồ: trường chưa ghi tỉnh không còn biến mất khi đang lọc theo tỉnh; có thêm nút Google Maps trong thẻ trường',
      'Bộ lọc Tỉnh/TP trên Bản đồ có thêm tỉnh của các trường (VD Cần Thơ, Đồng Tháp)',
    ],
  },
  {
    id: '2026-11-09-labor-sources-fullmap',
    date: '2026-11-09',
    title: 'Nguồn Lao Động',
    features: [
      'Hồ sơ trường: bản đồ toàn màn hình, giờ xe khách tới KCN / khách hàng / công ty / chi nhánh',
      'Lọc theo loại điểm và giới hạn giờ đi (≤ 30′ / 60′ / 90′ / 120′); nút ◎ đưa trường về giữa bản đồ',
      'Sửa: trường không hiện trên Bản đồ Thị trường khi đang lọc theo tỉnh',
      'Lịch thực tập hằng năm chỉ cần chọn tháng (VD T3 – T5) hoặc ngày + tháng, không cần năm',
    ],
  },
  {
    id: '2026-11-09-cskh-reschedule',
    date: '2026-11-09',
    title: 'CSKH',
    features: [
      'Việc đã hứa: nút "Hẹn lại" khi tới ngày mà đổi lịch / huỷ — chọn ngày mới nhanh hoặc "Để dịp khác"',
      '"Để dịp khác": hết nhắc mỗi ngày, việc vẫn ở "Việc đang mở" để hẹn lại sau',
      'Nút Hẹn lại có ở Hôm nay cần liên hệ, thẻ tóm tắt, Việc đã hứa và Nhật ký',
    ],
  },
  {
    id: '2026-11-09-labor-sources-tags',
    date: '2026-11-09',
    title: 'Nguồn Lao Động',
    features: [
      'Gắn đối thủ đã làm với trường — cảnh báo đỏ ở mọi danh sách, xem được trong hồ sơ Đối thủ',
      'Nhãn "Ưu tiên triển khai" / "Để liên hệ sau" (hẹn ngày, tới ngày tự tạo việc Workspace)',
      'Nhập nhanh danh sách trường kèm người phụ trách — dán thẳng từ Excel, tự bỏ trường trùng',
      'Tổng quan có khối "Cần liên hệ"; Ghép công ty tự ẩn trường đối thủ đã làm',
    ],
  },
  {
    id: '2026-11-09-cskh-group-avatars',
    date: '2026-11-09',
    title: 'CSKH',
    features: ['Dòng "Ghi cho nhóm" ở Tổng quan hiện avatar những người trong đợt (VD Gặp mặt · 3 người)'],
  },
  {
    id: '2026-11-09-labor-sources',
    date: '2026-11-09',
    title: 'Nguồn Lao Động',
    features: [
      'Tab mới "Nguồn LĐ" trong Thị trường (thay Báo giá): hồ sơ trường, trung tâm, địa phương',
      'Ngành đào tạo gắn ngành công ty, lịch thực tập lặp hằng năm, đợt gửi SV ghi số đi / số đạt',
      'Tính đường xe khách 16–45 chỗ từ trường tới KCN / công ty, vẽ tuyến trên bản đồ',
      'Gợi ý trường hợp công ty theo ngành, đường xe, tỷ lệ đạt đợt trước, đúng mùa thực tập',
      'Trước mùa thực tập tự tạo việc "Liên hệ trường" trong Workspace',
      'Trường hiện trên Bản đồ, Khảo sát KCN (nguồn LĐ gần KCN) và hồ sơ Khách hàng',
      'Người liên hệ của trường quản lý ở CSKH tệp Sale / CTV (ô "Đại diện đơn vị nguồn")',
    ],
  },
  {
    id: '2026-11-09-survey-photo-viewer',
    date: '2026-11-09',
    title: 'Khảo sát KCN',
    features: ['Xem ảnh chỉ tiêu: Esc để đóng, phím ← → để chuyển ảnh', 'Ghi nhanh công ty, ngành nghề, số lượng và chọn khoảng lương ngay khi xem ảnh'],
  },
  {
    id: '2026-11-09-map-pipeline-sites',
    date: '2026-11-09',
    title: 'Bản đồ Thị trường',
    features: ['Nhà máy theo KCN của công ty trong CRM Pipeline hiện lên bản đồ Thị trường'],
  },
  {
    id: '2026-11-09-market-map-live',
    date: '2026-11-09',
    title: 'Bản đồ Thị trường',
    features: ['Bản đồ mở toàn màn hình được trên iPhone', 'Định vị trực tiếp kiểu Google Maps: mũi tên theo hướng đi, tự bám vị trí, tự zoom theo tốc độ'],
  },
  {
    id: '2026-11-09-survey-position-star',
    date: '2026-11-09',
    title: 'Khảo sát KCN',
    features: ['Chọn vị trí / tay nghề tuyển bằng thẻ (thợ may, thợ hàn…) để lọc về sau', 'Gắn sao công ty ngay trong form ảnh online và ở ảnh xem nhanh trên bản đồ', 'Ảnh khảo sát online: không bắt buộc tên công ty, tự ghim theo vị trí chụp trong ảnh, chọn số lượng theo khoảng', 'Mục riêng "Ảnh online" trong Khảo sát KCN — chọn nhiều ảnh để xoá'],
  },
  {
    id: '2026-11-06-workflow-all-view',
    date: '2026-11-06',
    title: 'Quy trình công việc',
    features: ['Xem tất cả xưởng trên 1 trang, chọn 1 / 2 / 3 cột; vẫn đổi được về xem từng xưởng'],
  },
  {
    id: '2026-11-06-survey-trip-delete-pin',
    date: '2026-11-06',
    title: 'Khảo sát KCN',
    features: ['Xoá chuyến khảo sát phải nhập mã 4 số (chung mã với khoá Ghi chú)'],
  },
  {
    id: '2026-11-06-survey-share-map',
    date: '2026-11-06',
    title: 'Khảo sát KCN',
    features: ['Link chia sẻ khảo sát có bản đồ lộ trình: zoom, xem KCN, công ty và đường đã đi'],
  },
  {
    id: '2026-11-06-survey-online',
    date: '2026-11-06',
    title: 'Khảo sát KCN',
    features: ['Khảo sát online: thêm ảnh tuyển dụng trên mạng + vị trí Google Maps, tag "Chưa xác thực"'],
  },
  {
    id: '2026-11-06-survey-share',
    date: '2026-11-06',
    title: 'Khảo sát KCN',
    features: ['Chia sẻ khảo sát cho người ngoài bằng link + mã 4 số, kèm tin nhắn Zalo soạn sẵn'],
  },
  {
    id: '2026-11-06-notes-tags',
    date: '2026-11-06',
    title: 'Ghi chú nhanh',
    features: ['Thẻ (tag) cho ghi chú & sơ đồ tư duy: gắn thẻ, lọc theo thẻ, gõ #thẻ để tìm'],
  },
  {
    id: '2026-11-06-notes-lock-readonly',
    date: '2026-11-06',
    title: 'Ghi chú nhanh',
    features: ['Khoá ghi chú / sơ đồ = chỉ xem: muốn sửa, thêm hay xoá đều phải nhập mã 4 số'],
  },
  {
    id: '2026-11-06-legal-topic-order-timeline',
    date: '2026-11-06',
    title: 'Pháp lý',
    features: [
      'Sắp xếp thứ tự Topic bằng kéo thả (hoặc ⋯ → Chuyển lên / xuống)',
      'Sơ đồ Dòng thời gian cho từng Topic: 3 kiểu (trục chấm tròn, dải mũi tên, uốn lượn), tải ảnh',
      'Sơ đồ tư duy: nút Dòng thời gian xem các nhánh theo 3 kiểu',
    ],
  },
  {
    id: '2026-11-05-holidays-ch-uk-dk',
    date: '2026-11-05',
    title: 'CSKH',
    features: ['Thêm ngày lễ Thụy Sĩ, Anh Quốc, Đan Mạch'],
  },
  {
    id: '2026-11-05-company-dates-autosave',
    date: '2026-11-05',
    title: 'Khách hàng',
    features: ['Nhập nhanh ngày lễ & lĩnh vực tự động lưu, khung không đổi cỡ giữa các tab'],
  },
  {
    id: '2026-11-05-bulk-industry',
    date: '2026-11-05',
    title: 'Khách hàng',
    features: ['Nhập hàng loạt lĩnh vực hoạt động của công ty'],
  },
  {
    id: '2026-11-05-founding-year-only',
    date: '2026-11-05',
    title: 'Khách hàng',
    features: ['Ngày thành lập chỉ biết năm vẫn nhập được (gõ 1998 hoặc 10/1996)'],
  },
  {
    id: '2026-11-05-voice-keep-recording',
    date: '2026-11-05',
    title: 'Ghi âm CRM',
    features: [
      'Đang ghi âm vẫn chuyển qua lại các tab của công ty / chi nhánh; sang trang khác thì tự dừng và lưu',
      'Quên tắt ghi âm: nhắc khi im lặng lâu rồi tự dừng, chỉ giữ tới đoạn còn tiếng',
      'Danh sách ghi âm gọn, có trình nghe tua / đổi tốc độ; tắt trang đột ngột vẫn khôi phục phần đã ghi',
    ],
  },
  {
    id: '2026-11-05-timeline-year-only',
    date: '2026-11-05',
    title: 'Hồ sơ chăm sóc → Dòng thời gian',
    features: [
      'Mốc không nhớ ngày thì chỉ cần nhập năm (hoặc tháng + năm), dòng thời gian hiện đúng như đã nhập',
    ],
  },
  {
    id: '2026-11-05-workflow-site-link',
    date: '2026-11-05',
    title: 'Khách hàng → Quy trình & Mặt bằng',
    features: [
      'Gắn mỗi xưởng trong Quy trình công việc với khu vực đã vẽ ở tab Mặt bằng',
      'Bấm qua lại: từ xưởng mở khu vực trên bản đồ, từ chú thích Mặt bằng mở quy trình và video của xưởng',
    ],
  },
  {
    id: '2026-11-05-crm-voice-recording',
    date: '2026-11-05',
    title: 'Ghi âm trong CRM',
    features: [
      'Nhật ký ghé thăm chi nhánh: nút Ghi âm để ghi nhanh trao đổi, nghe lại ngay dưới dòng nhật ký',
      'CSKH: ghi âm cuộc gọi; nút "Khách chưa nghe máy" bỏ bản ghi, xếp người đó xuống cuối hôm nay',
      'Ghi chú công ty khách hàng: ghi âm nhanh thông tin về công ty để nghe lại sau',
    ],
  },
  {
    id: '2026-11-05-client-workflow-videos',
    date: '2026-11-05',
    title: 'Khách hàng → Quy trình công việc',
    features: [
      'Tab mới "Quy trình công việc": chia theo xưởng và công đoạn, mô tả từng việc, nhân sự, ca làm',
      'Gắn link video YouTube / Google Drive và ảnh vào từng xưởng, công đoạn để xem việc thực tế',
    ],
  },
  {
    id: '2026-11-05-profile-timeline-notes',
    date: '2026-11-05',
    title: 'Khách hàng → Hồ sơ chăm sóc',
    features: [
      'Dòng thời gian các mốc quan trọng của công ty (khởi đầu, hợp đồng, gặp gỡ, rủi ro…) ngay đầu hồ sơ',
      'Ghi chú công ty: viết văn bản có định dạng hoặc vẽ sơ đồ tư duy, phóng to toàn màn hình',
      'Các khối bên dưới (Hồ sơ, Lịch sử, Người liên hệ, Quà tặng…) đổi thành tab ngang',
    ],
  },
  {
    id: '2026-11-05-client-multi-contracts',
    date: '2026-11-05',
    title: 'Khách hàng → Hợp đồng',
    features: [
      'Một công ty có nhiều hợp đồng (theo công đoạn): thêm, sửa, thanh lý từng hợp đồng riêng',
      'Nút "Ký lại" cho hợp đồng đã thanh lý / hết hạn; ngày hết hạn của công ty tự tính theo các hợp đồng còn hiệu lực',
    ],
  },
  {
    id: '2026-11-05-bulk-labor-carry-delete',
    date: '2026-11-05',
    title: 'Workspace → Nhập nhanh số lao động',
    features: [
      'Nhập nhanh LĐ: số mờ gợi ý là số tuần gần nhất đã nhập (tuần không nhập thì giữ số cũ), không còn lệch sang số khác',
      'Nhập nhanh LĐ: xoá trống ô rồi Lưu thì xoá số đã ghi của tuần đó (có hỏi xác nhận), không cần gõ số 0',
    ],
  },
  {
    id: '2026-11-04-site-map-lock-expand',
    date: '2026-11-04',
    title: 'Khách hàng → Mặt bằng',
    features: [
      'Bản đồ vệ tinh: nút Khoá hướng — giữ nguyên hướng, ẩn thanh xoay, không xoay nhầm',
      'Bản đồ vệ tinh: nút mở rộng toàn màn hình để xem; gợi ý thao tác tự ẩn khi xem, có nút tắt',
    ],
  },
  {
    id: '2026-11-04-site-satellite-map',
    date: '2026-11-04',
    title: 'Khách hàng → Mặt bằng',
    features: [
      'Mặt bằng: bản đồ vệ tinh mở đúng vị trí nhà máy đã ghim, khoanh từng khối nhà xưởng',
      'Ghi tên xưởng + công năng (B3, B5 Gia vị, Kho…) lên từng khối ngay trên bản đồ',
      'Xoay bản đồ cho nhà xưởng nằm thẳng: thanh xoay, căn thẳng theo cạnh nhà',
    ],
  },
  {
    id: '2026-11-04-legal-hub',
    date: '2026-11-04',
    title: 'Pháp lý',
    features: [
      'Workspace: nút "Tạo báo giá" đổi thành "Pháp lý" — mở rộng / toàn màn hình',
      'Pháp nhân: hồ sơ từng công ty + dòng thời gian thay đổi lần 1, 2, 3… kèm file Drive',
      'Thư viện ngành: Topic → chủ đề con, xem PDF / Excel / PowerPoint Google Drive ngay trong app',
      'Tự soạn tài liệu học: sơ đồ tư duy theo mẫu, bài học khối màu, thẻ ghi nhớ lật thẻ ôn tập',
      'Nhắc giấy phép sắp hết hạn, tìm kiếm không dấu (⌘K), Thùng rác khôi phục được',
    ],
  },
  {
    id: '2026-11-04-cskh-overview-work',
    date: '2026-11-04',
    title: 'CSKH',
    features: [
      'Tổng quan CSKH → Sắp tới: tab "Workspace" liệt kê việc còn mở có gắn người liên hệ',
      'Việc Workspace đến hạn / trễ hạn được nhắc ở dòng "Hôm nay" đầu trang Tổng quan',
      'Việc "Ngưng HĐ" không còn tính là đang mở ở Nhật ký và thẻ người liên hệ',
    ],
  },
  {
    id: '2026-11-04-cskh-work-tasks',
    date: '2026-11-04',
    title: 'CSKH',
    features: [
      'Nhật ký CSKH hiện cả việc Workspace có gắn người liên hệ (lọc riêng: loại "Việc Workspace")',
      'Hồ sơ & thẻ tóm tắt người liên hệ: khối "Việc Workspace" ngay đầu, có kết quả việc đã xong',
      'Ô lọc người ở Nhật ký: người trùng tên hiện kèm tên công ty (VD Mr Tuấn · Coherent Vietnam)',
    ],
  },
  {
    id: '2026-11-04-work-task-links',
    date: '2026-11-04',
    title: 'Workspace',
    features: [
      'Thêm công việc: ô Khách hàng chọn được cả công ty đang ở BD Pipeline (chưa ký HĐ)',
      'Gắn nhiều người liên hệ bên khách vào 1 việc; mở việc đã có cũng gắn thêm được',
      'Loại việc gộp còn 5: Hợp đồng (HĐ mới / Tái ký / Phụ lục), Báo giá, Gặp khách, Phát sinh, Nội bộ',
      'Hồ sơ công ty Pipeline hiện các việc đã gắn, kèm người liên hệ và người phụ trách',
      'Hồ sơ người liên hệ (CSKH): khối "Công việc đã trao đổi", gồm cả việc đã xong',
      'Bắt đầu hợp tác: các việc đã gắn công ty Pipeline tự theo sang hồ sơ Khách hàng',
    ],
  },
  {
    id: '2026-11-04-competitor-multi-kcn',
    date: '2026-11-04',
    title: 'Đối thủ',
    features: [
      'KH đang phục vụ: công ty có nhiều KCN thì chọn đúng KCN đối thủ phục vụ, không tự lấy KCN đầu',
      'KH đang phục vụ: đọc đủ các KCN chọn ở thẻ BD Pipeline, có nút "KCN khác…" để đổi',
      'Thêm NCC ở Công ty/Dự án nhiều KCN: để trống KCN bên hồ sơ đối thủ thay vì ghi nhầm',
    ],
  },
  {
    id: '2026-11-04-client-org-site-maps',
    date: '2026-11-04',
    title: 'Khách hàng',
    features: [
      'Hồ sơ khách: tab "Sơ đồ tổ chức" — vẽ các cấp nhân sự bên khách kiểu sơ đồ tư duy',
      'Sơ đồ tổ chức: nút "Người liên hệ" chèn nhanh người của công ty vào sơ đồ',
      'Hồ sơ khách: tab "Mặt bằng" — tải ảnh sơ đồ nhà xưởng, đặt nhãn từng khu (B3, B5…)',
      'Mặt bằng: khoanh vùng, đổi màu / cỡ chữ, bảng chú thích ghi khu đó làm gì',
      'Mặt bằng: thêm ảnh bằng kéo thả hoặc dán ảnh chụp màn hình, nhiều ảnh mỗi khách',
    ],
  },
  {
    id: '2026-11-04-clients-avatars',
    date: '2026-11-04',
    title: 'Khách hàng',
    features: [
      'Bảng Khách hàng: cột Chi nhánh và Quản lý hiện ảnh đại diện (ảnh Trưởng chi nhánh đã cài)',
      'Quản lý chưa có ảnh vẫn hiện chữ cái đầu như cũ',
    ],
  },
  {
    id: '2026-11-04-edit-done-history',
    date: '2026-11-04',
    title: 'Workspace',
    features: [
      'Lịch sử hoàn thành: nút Sửa ở từng việc — sửa tên, kết quả, ngày hoàn thành',
      'Tái ký HĐ: sửa ngày bắt đầu / hạn hợp đồng mới, hồ sơ Khách hàng cập nhật theo',
      'Nút "Mở lại việc" đưa việc đã hoàn thành về danh sách đang làm',
      'Hoàn thành Tái ký HĐ: nhập thêm được ngày bắt đầu hợp đồng mới',
    ],
  },
  {
    id: '2026-11-04-move-contact-to-pipeline-company',
    date: '2026-11-04',
    title: 'Người liên hệ',
    features: [
      '"Chuyển công ty": chọn được cả công ty đang ở BD Pipeline (tìm hiểu, chờ, đàm phán ký mới)',
      'Công ty Pipeline được gắn qua hồ sơ KH tiềm năng cùng tên — có nhãn giai đoạn trong ô chọn',
      'Bấm "Bắt đầu hợp tác" ở Pipeline: hồ sơ thành khách đang hợp tác, người liên hệ giữ nguyên',
      'Hồ sơ CSKH → "Gắn công ty": chọn được cả công ty đang ở BD Pipeline (có nhãn giai đoạn)',
      'Thẻ BD Pipeline chưa có người liên hệ thì tự điền người vừa gắn',
      'CSKH: người của công ty KH tiềm năng hiện đúng tên công ty, lọc "Tiềm năng" ở Danh bạ ra đủ',
    ],
  },
  {
    id: '2026-11-04-client-star-rating',
    date: '2026-11-04',
    title: 'Khách hàng · CSKH',
    features: [
      'Xếp sao công ty khách hàng: ★★★ Quan trọng · ★★ Bình thường · ★ Dự án nhỏ (có thể thay thế)',
      'Bấm sao ngay trên danh sách Khách hàng (bảng, thẻ) hoặc đầu hồ sơ công ty; bấm lại để bỏ sao',
      'Khách hàng: lọc theo sao kèm số công ty mỗi mức; file CSV có thêm cột Sao',
      'CSKH: lọc theo sao công ty ở Danh bạ, Tổng quan, Nhịp độ, Sự kiện, Bản đồ',
      'Người liên hệ lấy sao cao nhất trong các công ty họ gắn — đổi sao bên Khách hàng là CSKH đổi theo',
      'Danh bạ CSKH: sắp xếp "Sao công ty: quan trọng trước" (cùng sao thì ai gấp hạn lên trước)',
    ],
  },
  {
    id: '2026-11-04-contact-birthday-career',
    date: '2026-11-04',
    title: 'Người liên hệ',
    features: [
      'Ngày sinh chỉ cần ngày + tháng: không rõ năm vẫn lưu và nhắc sinh nhật, chỉ không tính tuổi',
      'Hồ sơ CSKH: dòng Sinh nhật chọn "Chính người này" (= ô Ngày sinh form đầy đủ) hay "Người thân"',
      'Nút "Chuyển công ty": khách nghỉ công ty cũ sang công ty mới (có sẵn hoặc tạo mới)',
      'Quá trình công tác trong hồ sơ: từng làm ở đâu, từ khi nào tới khi nào, chức vụ cũ',
      'Hồ sơ công ty cũ ghi "đã chuyển sang X"; hạng CSKH, nhật ký, quà, ngày quan trọng giữ nguyên',
    ],
  },
  {
    id: '2026-11-04-kcn-survey-stars-archive',
    date: '2026-11-04',
    title: 'Khảo sát KCN',
    features: [
      'Lưu ảnh chỉ tiêu: gắn ★ sao công ty cần chú trọng — hiện trên bản đồ khảo sát, lưới ảnh và PDF',
      'Tab Chuyến đi gọn: gom theo ngày, mỗi chuyến 1 dòng; nút "Xem n ảnh" mở tab Ảnh lọc sẵn theo chuyến',
      'Nhớ tab và bộ lọc đang xem — lần sau mở Khảo sát KCN hiện đúng mục lần trước',
      'Lọc theo tỉnh / thành để so sánh các KCN; tab Theo KCN có cột tỉnh và số công ty gắn sao',
      'Xuất PDF từng KCN (chữ thật, kèm ảnh bảng tuyển) để đưa Gemini / ChatGPT phân tích lương, tuyển dụng',
      'PDF riêng từng chuyến khảo sát: mở chuyến ở tab Chuyến đi → "PDF chuyến này"',
      'Nút Toàn màn hình cho điện thoại + phóng bản đồ kín màn hình',
      'Xoá chuyến / ảnh / ghi âm → vào Lưu trữ 30 ngày, khôi phục được; quá 30 ngày mới tự xoá hẳn',
    ],
  },
  {
    id: '2026-11-04-quick-notes-lock',
    date: '2026-11-04',
    title: 'Ghi chú nhanh',
    features: [
      'Khoá chống xoá: bấm 🔒 trong ghi chú / sơ đồ quan trọng, muốn xoá hay mở khoá phải nhập mã 4 số',
      'Mục đang khoá có ổ khoá trên dải thẻ, thẻ xem nhanh và danh sách; khoá giữ nguyên khi đổi máy',
      'Nút 🔑 trong cửa sổ danh sách: đặt / đổi mã; quên mã thì đặt lại bằng mật khẩu đăng nhập',
      'Tải lại trang hoặc vào lại: mở đúng ghi chú / sơ đồ, khu, nhóm (Tất cả / Lưu trữ / Đã xoá) lần trước',
      'Sơ đồ tư duy nhớ Sơ đồ / Dàn ý, tab khung bên phải, chỗ đang xem và chủ đề đang chọn',
    ],
  },
  {
    id: '2026-11-04-kcn-survey-smooth-nav',
    date: '2026-11-04',
    title: 'Khảo sát KCN',
    features: [
      'Mũi tên vị trí và bản đồ chạy mượt như Google Maps; rẽ thì bản đồ xoay dần, không còn giật',
      'Dẫn đường "Đi 1 lượt hết đường": 1 lộ trình qua mọi đường chưa đi trong KCN, hạn chế đi lặp',
      'Lộ trình: 600 m sắp đi tô đậm, phần sau mờ; đường 1 chiều đi đúng chiều; cuối ngõ cụt báo quay đầu',
      'Đang xoay theo hướng đi mà kéo / zoom / căn giữa bản đồ thì vẫn giữ kiểu xoay, không tự quay về Bắc',
      'Xoay ngang điện thoại: giao diện gọn, bản đồ gần kín màn hình, chức năng gom vào 1 nút nổi',
      'Cài đặt chọn nút luôn hiện ở mép phải; nút nổi kéo tới chỗ tiện tay, tự dính mép trái / phải',
    ],
  },
  {
    id: '2026-11-04-image-links-r2',
    date: '2026-11-04',
    title: 'Lưu trữ ảnh',
    features: [
      'Link ảnh dán từ Facebook / website tự tải về lưu Cloudflare khi bấm Lưu, link không còn hỏng',
      'Áp dụng cho ảnh bìa, ảnh tuyển dụng, ảnh KCN, đối thủ, chi nhánh, đại diện liên hệ',
      'Admin → Ảnh & lưu trữ: chuyển một lần ảnh đang dùng link ngoài về Cloudflare, hoàn tác từng ảnh',
    ],
  },
  {
    id: '2026-11-03-kcn-files-r2',
    date: '2026-11-03',
    title: 'Khảo sát KCN',
    features: [
      'Ảnh / ghi âm khảo sát lưu được trên Cloudflare R2 khi quản trị cài đặt; lỗi thì tự lưu Supabase',
    ],
  },
  {
    id: '2026-11-03-kcn-photo-compress',
    date: '2026-11-03',
    title: 'Khảo sát KCN',
    features: [
      'Ảnh chỉ tiêu nén gọn hơn (~300 KB thay vì ~600 KB), chữ trên bảng tuyển vẫn đọc rõ',
    ],
  },
  {
    id: '2026-11-03-kcn-scan-overture',
    date: '2026-11-03',
    title: 'Khảo sát KCN',
    features: [
      'Tải thông tin KCN dùng Overture Maps (miễn phí, không cần khoá): nhiều công ty, có SĐT / Facebook',
      'Nhận ra trang "… Tuyển dụng" của nhà máy (đang tuyển người) và nhà cung ứng lao động quanh KCN',
      'Kết quả quét có nút gọi điện, mở Facebook, mở Google Maps; thêm vào Đối thủ kèm SĐT, Facebook',
    ],
  },
  {
    id: '2026-11-03-kcn-survey-heading-scan',
    date: '2026-11-03',
    title: 'Khảo sát KCN',
    features: [
      'Bản đồ khảo sát xoay theo hướng đi như Google Maps, mũi tên luôn hướng lên, nằm dưới để nhìn xa',
      'Tự zoom khi chạy: nhanh nhìn xa, chậm nhìn gần, sắp tới chỗ rẽ thì canh vừa chỗ rẽ',
      'Xoay ngang / dọc điện thoại không còn mất dấu mũi tên; nút ◎ đổi "xoay theo hướng" ↔ "Bắc ở trên"',
      'Ghi âm khảo sát lọc tạp âm: tách giọng của máy, cắt tiếng gió / máy xe, giọng đều và rõ hơn',
      'Tải thông tin KCN trước khi đi: quét công ty trong KCN + nhà cung ứng lao động quanh KCN',
      'Đối chiếu kết quả quét với khách hàng / Pipeline / Đối thủ, thêm nhanh chỗ mới vào Thị trường',
    ],
  },
  {
    id: '2026-11-03-kcn-survey-areas-sound',
    date: '2026-11-03',
    title: 'Khảo sát KCN',
    features: [
      'Thêm nhanh KCN / vùng chưa có: tìm theo tên hoặc dán link Google Maps, xem khoanh vùng trên bản đồ',
      'KCN chưa có ranh giới thì tự chấm vùng trên bản đồ; vùng được lưu, lần sau khảo sát dùng lại',
      'Khảo sát chỉ tô đường trong vùng đã khoanh; đứng trong vùng là tự nhận đúng KCN',
      'Âm thanh dẫn đường 3 chế độ: tắt hẳn, chỉ tiếng bíp báo chỗ rẽ, hoặc giọng đọc',
      'Tự chọn màu cho đường cần đi và đường đã đi qua',
    ],
  },
  {
    id: '2026-11-03-kcn-survey-nav-voice-markup',
    date: '2026-11-03',
    title: 'Khảo sát KCN',
    features: [
      'Tab "Khảo sát KCN" riêng cạnh Bản đồ: chuyến đi, ảnh chỉ tiêu, ghi âm, tổng hợp theo KCN',
      'Mũi tên vị trí xoay theo la bàn điện thoại; đang chạy xe thì chỉ theo hướng đi',
      'Nút Dẫn đường: chỉ rẽ tới đoạn đường chưa đi tiếp theo (ưu tiên có nhà máy), đọc to chỗ rẽ',
      'Dẫn đường tới công ty chưa đi ngang ngay trong app, đi lệch thì tự tính lại đường',
      'Ghi chú lên ảnh chỉ tiêu: khoanh, mũi tên, bút, ghi chữ — ảnh gốc vẫn giữ nguyên',
      'Ghi âm nhanh khi khảo sát: lưu kèm chỗ ghi + công ty gần đó, nghe lại trên bản đồ',
      'Tải danh sách ảnh chỉ tiêu ra file CSV (mở bằng Excel)',
    ],
  },
  {
    id: '2026-11-02-kcn-survey-zone-title-factories',
    date: '2026-11-02',
    title: 'Khảo sát KCN',
    features: [
      'Tự đặt tên chuyến "KCN … – Khảo sát ngày …" (đi lại trong ngày: "lần 2"), sửa được tên',
      'Nhận KCN theo ranh giới trên bản đồ; cụm KCN sát nhau (Nhơn Trạch…) thì hỏi lại trước khi bắt đầu',
      'Tô khối nhà xưởng theo màu khách hàng / Pipeline; đường trục vẽ đậm hơn đường nhánh',
      'Đường chưa đi có nhà máy hai bên tô cam đậm (nên đi trước), đường trống tô nhạt',
      'Danh sách công ty trong KCN chưa đi ngang (khách hàng, Pipeline trước), bấm để bản đồ chỉ tới',
    ],
  },
  {
    id: '2026-11-02-kcn-survey-gps',
    date: '2026-11-02',
    title: 'Thị trường · Bản đồ',
    features: [
      'Khảo sát KCN bằng GPS (nút trên Bản đồ): vẽ đường đã đi, kèm vết các lần khảo sát trước',
      'Tô cam các đường trong KCN chưa đi + % đã phủ, biết rẽ hướng nào cho đủ 1 vòng',
      'Đi ngang công ty nào hiện tên; khách hợp tác / Pipeline hiện luôn thẻ tổng quan',
      'Chụp bảng chỉ tiêu tuyển dụng: lưu ảnh kèm chỗ chụp, công ty, vị trí tuyển, số lượng, lương',
      'Lịch sử khảo sát: xem lại từng chuyến trên bản đồ, thư viện ảnh chỉ tiêu và chỗ chụp',
      'Cài đặt: thu phóng nhanh, tự zoom theo tốc độ, bán kính nhận diện, giữ màn hình sáng',
    ],
  },
  {
    id: '2026-11-02-current-workers-latest-week',
    date: '2026-11-02',
    title: 'Dashboard',
    features: [
      'Số lao động hiện tại lấy theo tuần mới nhất đã nhập — nhập bù số tuần cũ không còn đè số mới',
      'Xu hướng lao động các tháng trước giữ đủ số của khách hàng đã ngưng (tính tới hết tháng ngưng)',
      'Điểm sức khoẻ & cảnh báo rủi ro mất khách dùng đúng 6 tuần gần nhất (trước đây T10 xếp trước T9)',
    ],
  },
  {
    id: '2026-11-01-labor-report-export',
    date: '2026-11-01',
    title: 'Báo cáo',
    features: [
      'Nút "Báo cáo LĐ" (Dashboard, Báo cáo): 1 cú bấm ra file PDF hoặc Markdown tổng quan lao động',
      'Biểu đồ tăng/giảm theo tuần, tháng, cầu biến động; so sánh chi nhánh, khu vực, KCN, khách hàng',
      'Xem trước từng trang; chọn phạm vi (toàn hệ thống / chi nhánh / khu vực), tuần chốt, số tuần, tháng',
      'Ghi rõ số nào là số gần nhất (KH chưa nhập tuần đó) và liệt kê KH lâu chưa cập nhật số lao động',
    ],
  },
  {
    id: '2026-11-01-branch-bulk-edit',
    date: '2026-11-01',
    title: 'Chi nhánh',
    features: [
      'Nút "Nhập nhanh" ở trang Chi nhánh: sửa ảnh đại diện và Thông tin & Liên hệ của mọi chi nhánh trong 1 cửa sổ, tự lưu khi gõ xong',
      'Đặt ảnh nhanh: bấm vào ảnh, kéo-thả ảnh vào dòng, hoặc copy ảnh rồi dán (⌘V / Ctrl+V) vào dòng của chi nhánh đó',
    ],
  },
  {
    id: '2026-11-01-quick-notes-same-size',
    date: '2026-11-01',
    title: 'Ghi chú nhanh',
    features: [
      'Chuyển qua lại giữa Ghi chú và Sơ đồ tư duy giữ nguyên cỡ đang chọn (cửa sổ hoặc toàn màn hình), không tự phóng / thu',
      'Ô việc cần làm thành vòng tròn to như Lời nhắc iPhone: bấm vào vòng tròn (hoặc lề trái) là đánh dấu xong',
    ],
  },
  {
    id: '2026-11-01-quick-notes-mindmap-split',
    date: '2026-11-01',
    title: 'Ghi chú nhanh',
    features: [
      'Ghi chú và Sơ đồ tư duy tách thành 2 loại riêng: dải mép phải có nút ⧉ tạo sơ đồ mới ngay dưới nút ＋',
      'Cửa sổ danh sách chia 2 khu Ghi chú / Sơ đồ tư duy, mỗi khu có Tất cả / Lưu trữ / Đã xoá và ô tìm riêng',
      'Từ ghi chú tạo nhanh 1 sơ đồ mới (ghi chú giữ nguyên); từ sơ đồ tạo 1 ghi chú chứa dàn ý',
    ],
  },
  {
    id: '2026-11-01-quick-notes-mindmap',
    date: '2026-11-01',
    title: 'Ghi chú nhanh',
    features: [
      'Sơ đồ tư duy kiểu XMind ngay trong ghi chú: bấm nút Sơ đồ, nội dung đang nháp tự thành nhánh',
      'Phím như XMind: Tab thêm nhánh con, Enter thêm cùng cấp, chọn rồi gõ luôn để sửa; kéo thả đổi chỗ, thu gọn nhánh',
      '6 kiểu sơ đồ (toả 2 bên, logic, tổ chức, cây, dòng thời gian) và 8 chủ đề màu',
      'Biểu tượng ưu tiên / tiến độ / cờ, ghi chú, nhãn, đường liên kết, vùng bao, tóm tắt, chế độ Dàn ý',
      'Xuất ảnh PNG, PDF, SVG, Markdown; nút Phóng to và kéo góc để đổi cỡ thẻ ghi chú',
    ],
  },
  {
    id: '2026-11-01-quick-notes-gemini',
    date: '2026-11-01',
    title: 'Ghi chú nhanh',
    features: [
      'Ghi âm xong, Gemini tự chép lời theo từng người nói — bấm mốc [mm:ss] để nghe lại đúng đoạn',
      'Tóm tắt ý chính + việc cần làm; bấm "Chèn vào ghi chú" để thành các ô ☐',
      'Tìm ghi chú theo cả câu đã nói trong bản ghi âm',
    ],
  },
  {
    id: '2026-10-31-quick-notes',
    date: '2026-10-31',
    title: 'Ghi chú nhanh',
    features: [
      'Dải ghi chú dính mép phải mọi trang: rê chuột xem nhanh, bấm để soạn, tự lưu',
      'Ghi chú có checklist ☐, cỡ chữ, ghim, 8 màu và tìm trong ghi chú',
      'Ghi âm cuộc họp ngay trong ghi chú, chèn mốc thời gian; nghe lại tua được, đổi tốc độ',
      'Cửa sổ Tất cả / Lưu trữ / Đã xoá có ô tìm; xoá có hỏi lại, khôi phục được trong 30 ngày',
      'Điện thoại: chạm tay nắm ở mép phải để mở; ghi chú riêng từng người, dùng chung mọi máy',
    ],
  },
  {
    id: '2026-10-31-crm-factory-sites',
    date: '2026-10-31',
    title: 'CRM Pipeline',
    features: [
      'Hình thức cần đi theo sản phẩm: chọn Giới thiệu lao động thì không còn hiện Thời vụ',
      'Bản đồ hồ sơ công ty: ghim vị trí nhà máy riêng cho từng KCN, có số thứ tự và Xem tất cả',
    ],
  },
  {
    id: '2026-10-31-crm-quick-contact',
    date: '2026-10-31',
    title: 'CRM Pipeline',
    features: [
      'Form Thêm công ty: tạo nhanh người liên hệ mới ngay tại ô Người liên hệ',
      'Nhắc bổ sung chức vụ, SĐT, email, ngày sinh còn thiếu — có nút Bổ sung ngay',
      'Sửa lỗi form Thêm công ty dài không cuộn tới nút Thêm (nút luôn hiện ở đáy)',
    ],
  },
  {
    id: '2026-10-31-crm-pipeline-multi-kcn',
    date: '2026-10-31',
    title: 'CRM Pipeline',
    features: [
      'Một công ty chọn được nhiều KCN khi thêm mới và trong hồ sơ công ty',
      'Nhà cung ứng khác gợi ý theo từng KCN đã chọn',
      'Thẻ Pipeline hiện đủ các KCN; thêm bộ lọc KCN (khớp khi công ty có KCN đó)',
    ],
  },
  {
    id: '2026-10-31-cskh-sale-merge',
    date: '2026-10-31',
    title: 'CSKH',
    features: [
      'Gộp Mạng lưới Sale vào CSKH: nút chuyển tệp Khách hàng / Sale – CTV, mỗi lúc chỉ hiện 1 tệp',
      'Nút chuyển tệp báo số người cần liên hệ hôm nay của tệp bên kia',
      'Bánh răng chọn tệp hiển thị trên máy: cả hai, chỉ Khách hàng hoặc chỉ Sale – CTV',
    ],
  },
  {
    id: '2026-10-31-crm-worker-need',
    date: '2026-10-31',
    title: 'CRM Pipeline',
    features: [
      'Hồ sơ công ty: hiện và sửa số LĐ khách yêu cầu + hình thức cần (thời vụ / chính thức / cả hai)',
    ],
  },
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
