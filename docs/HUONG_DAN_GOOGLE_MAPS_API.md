# Hướng dẫn cài khoá Google Maps (tìm công ty theo tên)

Dành cho quản trị viên (Tony). Làm lần lượt 6 bước dưới đây, nên làm trên **máy tính**. Mất khoảng 15–20 phút.

**Cài xong thì được gì:**
- **Kế hoạch ghé công ty:** gõ tên (VD "HKC") → ra đúng địa điểm như trên Google Maps (đúng tên, đúng ghim), có nhãn **Google Maps**.
  Không cần mở link chia sẻ nữa — link rút gọn `maps.app.goo.gl` Google không cho máy chủ đọc.
- **Tải thông tin KCN** (màn khảo sát GPS): ô "Google Maps" bật được, quét thêm công ty + nhà cung ứng quanh KCN.

**Cách hoạt động:** khoá chỉ nằm trên máy chủ Vercel (biến `GOOGLE_MAPS_API_KEY`, không có chữ `VITE_`) → không lộ ra
điện thoại / trình duyệt. App gọi qua `/api/places-search`, bắt buộc đã đăng nhập.

**Chưa cài** → app vẫn chạy như bây giờ (tìm trong hệ thống, bản đồ quanh KCN, OpenStreetMap).

**Chi phí** (bảng giá Google từ 03/2025 — kiểm tra lại ở <https://developers.google.com/maps/billing-and-pricing/pricing>):
app dùng **Text Search Pro** — miễn phí **5.000 lượt / tháng**, vượt thì khoảng **32 USD / 1.000 lượt**.

| Việc trong app | Số lượt gọi Google |
|---|---|
| Gõ 1 tên trong Kế hoạch ghé | 1 |
| Dán danh sách 10 tên (tên nào đã khớp trong hệ thống thì không gọi) | tối đa 10 |
| 1 lần "Tải thông tin KCN" có tick Google (app hiện số lượt trước khi quét) | khoảng 60–80 |

→ Dùng bình thường gần như nằm trong mức miễn phí. Bước 5 đặt giới hạn mỗi ngày để không bao giờ bị tính tiền bất ngờ.

---

## Bước 1 — Tạo dự án trên Google Cloud

1. Vào <https://console.cloud.google.com>, đăng nhập bằng tài khoản Google của công ty.
2. Thanh trên cùng → ô chọn dự án → **New Project** → tên `letsgo-vn` → **Create** → chọn dự án vừa tạo.

## Bước 2 — Gắn thanh toán (bắt buộc với Google Maps)

1. Menu ☰ → **Billing** → **Link a billing account** (hoặc **Create billing account**).
2. Khai báo thẻ Visa / Mastercard. Tài khoản mới thường được tặng tín dụng dùng thử — vẫn phải có thẻ.

## Bước 3 — Bật "Places API (New)"

1. Menu ☰ → **APIs & Services** → **Library**.
2. Tìm **Places API (New)** → **Enable**.
   ⚠ Phải là bản có chữ **(New)** — bản "Places API" cũ không dùng được với app.

## Bước 4 — Tạo khoá và khoá phạm vi

1. **APIs & Services** → **Credentials** → **Create credentials** → **API key** → copy khoá (dạng `AIza…`).
2. Bấm vào khoá vừa tạo → đặt tên `letsgo-vercel`.
3. **API restrictions** → **Restrict key** → chỉ tick **Places API (New)** → **Save**.
4. **Application restrictions**: để **None** (khoá chỉ dùng trên máy chủ Vercel, địa chỉ IP thay đổi liên tục nên không khoá theo IP được).

⚠ Không gửi khoá qua Zalo / email / chat. Lỡ lộ → vào lại khoá → **Regenerate key** rồi làm lại Bước 6.

## Bước 5 — Đặt giới hạn để không bị tính tiền bất ngờ

1. **APIs & Services** → **Places API (New)** → tab **Quotas & System Limits**.
2. Tìm dòng giới hạn **Text Search … per day** (tên có thể hơi khác) → **Edit** → đặt **300** → lưu.
   (300 / ngày × 30 ngày ≈ 9.000 — muốn chắc chắn miễn phí thì đặt **150**.)
3. Thêm cảnh báo: menu ☰ → **Billing** → **Budgets & alerts** → **Create budget** → số tiền `5 USD` → báo email ở 50%, 90%, 100%.
   Lưu ý: cảnh báo chỉ gửi email, **không tự dừng** — giới hạn ở mục 2 mới chặn thật.

## Bước 6 — Đưa khoá lên Vercel

1. Vào <https://vercel.com> → dự án **letsgo-vn** → **Settings** → **Environment Variables**.
2. **Key:** `GOOGLE_MAPS_API_KEY` · **Value:** dán khoá `AIza…` · **Environments:** tick **Production** và **Preview** → **Save**.
3. Biến mới chỉ có hiệu lực ở bản build MỚI: **Deployments** → bản mới nhất → **⋯** → **Redeploy**.

---

## Kiểm tra

1. Mở <https://letsgo-vn.vercel.app/api/places-search> (hoặc `https://app.letsgo.vn/api/places-search`) → phải thấy `{"enabled":true}`.
   Thấy `false` → chưa Redeploy, hoặc gõ sai tên biến.
2. Trong app: **Thị trường → Khảo sát KCN → Kế hoạch ghé** → chọn KCN → gõ `HKC` → kết quả có nhãn **Google Maps**,
   tên giống hệt trên Google Maps → **Thêm**.

| App báo | Cách sửa |
|---|---|
| "Khoá Google chưa bật Places API (New) hoặc chưa gắn thanh toán" | Làm lại Bước 2, Bước 3 |
| "Đã hết hạn mức gọi Google Maps hôm nay" | Đã chạm giới hạn ở Bước 5 — chờ sang ngày, hoặc nâng giới hạn |
| Không có kết quả "Google Maps" nào | Kiểm tra mục 1 phần Kiểm tra (`enabled`) |

**Muốn tắt:** xoá biến `GOOGLE_MAPS_API_KEY` trên Vercel → Redeploy. App quay về như cũ.
