# Hướng dẫn lưu ảnh / ghi âm khảo sát trên Cloudflare R2

Dành cho quản trị viên (Tony). Làm lần lượt 7 bước dưới đây, nên làm trên **máy tính**. Mất khoảng 20–30 phút.

**Cách hoạt động, nói ngắn gọn:** khi chụp ảnh chỉ tiêu / ghi âm khảo sát, điện thoại xin máy chủ của app (Vercel) một
link tải lên có hạn 10 phút → điện thoại gửi thẳng file lên Cloudflare R2 → hệ thống lưu link ảnh như bây giờ.
Khoá bí mật của Cloudflare **chỉ nằm trên Vercel**, không lộ ra điện thoại.

- **Chưa làm xong các bước** → app vẫn lưu Supabase như cũ, không có gì thay đổi.
- **Cloudflare lỗi / mất mạng giữa chừng** → app tự lưu Supabase thay, **không mất ảnh**.
- **Ảnh cũ** vẫn nằm ở Supabase, link không đổi, vẫn hiện bình thường. Muốn dồn ảnh cũ sang Cloudflare thì làm sau
  (xem cuối trang).

**Chi phí R2:** miễn phí 10 GB lưu trữ / tháng (≈ 30.000 ảnh khảo sát), miễn phí ~1 triệu lượt tải lên và 10 triệu lượt
xem / tháng, **không tính tiền băng thông xem ảnh**. Vượt 10 GB: khoảng 0,015 USD / GB / tháng. Cloudflare yêu cầu
khai báo thẻ / PayPal khi bật R2, nhưng dưới mức miễn phí thì không bị trừ tiền.

Thông tin cần dùng trong các bước:

| Mục | Giá trị |
|---|---|
| Địa chỉ app | `https://app.letsgo.vn` (và `https://letsgo-vn.vercel.app`) |
| Tên kho (bucket) đề xuất | `letsgo-files` |
| Tên miền ảnh đề xuất | `anh.letsgo.vn` |

---

## Bước 1 — Tạo tài khoản Cloudflare

1. Vào <https://dash.cloudflare.com/sign-up>, đăng ký bằng email công ty → xác nhận email.
2. Bật xác thực 2 lớp: góc phải trên → **My Profile** → **Authentication** → **Two-Factor Authentication**.

## Bước 2 — Bật R2

1. Menu trái → **R2 Object Storage** (có thể nằm trong mục *Storage & Databases*).
2. Bấm **Purchase R2 Plan / Add R2 subscription** → khai báo thẻ hoặc PayPal → xác nhận gói miễn phí (Free tier).

## Bước 3 — Tạo kho chứa file (bucket)

1. Trong R2 → **Create bucket**.
2. Bucket name: `letsgo-files` · Location: **Automatic** (hoặc gợi ý *Asia-Pacific*) · Default storage class: **Standard**.
3. Bấm **Create bucket**.
4. Ghi lại **Account ID**: ở trang tổng quan R2, cột bên phải (hoặc trong địa chỉ
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

## Bước 4 — Cho phép xem ảnh công khai (chọn 1 trong 2 cách)

Mở bucket `letsgo-files` → tab **Settings** → mục **Public access**.

- **Cách A — tên miền riêng (khuyên dùng):** chỉ làm được khi tên miền `letsgo.vn` đang quản lý DNS trên Cloudflare.
  **Custom Domains** → **Connect Domain** → gõ `anh.letsgo.vn` → **Continue** → **Connect Domain**. Đợi trạng thái
  **Active**. Địa chỉ ảnh: `https://anh.letsgo.vn`.
- **Cách B — địa chỉ có sẵn của Cloudflare:** **R2.dev subdomain** → **Allow Access** → gõ `allow` → xác nhận. Copy địa
  chỉ dạng `https://pub-xxxxxxxx.r2.dev`. Dùng được ngay nhưng Cloudflare giới hạn tốc độ — hợp khi ít người xem; sau này
  đổi sang cách A thì báo Claude đổi link trong hệ thống. **Đừng tắt R2.dev** khi ảnh còn dùng link này.

## Bước 5 — Cho điện thoại gửi file lên (CORS)

Vẫn ở tab **Settings** của bucket → mục **CORS Policy** → **Add CORS policy** (hoặc **Edit**) → xoá hết nội dung có sẵn,
dán đoạn dưới → **Save**:

```json
[
  {
    "AllowedOrigins": [
      "https://app.letsgo.vn",
      "https://letsgo-vn.vercel.app",
      "http://localhost:5173",
      "http://localhost:5199"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "cache-control"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

App chạy ở địa chỉ khác (VD bản xem trước `letsgo-vn-git-….vercel.app`) sẽ không gửi được lên R2 → tự lưu Supabase.

## Bước 6 — Tạo khoá cho máy chủ

1. Trang tổng quan R2 → **Manage R2 API Tokens** (hoặc *API* → *Manage API tokens*) → **Create API token**.
2. Token name: `letsgo-vercel-upload`.
3. Permissions: **Object Read & Write**.
4. Specify bucket(s): **Apply to specific buckets only** → chọn `letsgo-files`.
5. TTL: **Forever** → **Create API Token**.
6. Màn hình hiện **Access Key ID** và **Secret Access Key** — **Secret chỉ hiện 1 lần**, copy ngay vào chỗ an toàn
   (VD trình quản lý mật khẩu).

> ⚠️ Không gửi Secret Access Key qua chat / Zalo / email, kể cả cho Claude. Chỉ dán vào Vercel ở bước 7.
> Lỡ lộ thì vào lại trang API Tokens → xoá token đó → tạo token mới → cập nhật Vercel.

## Bước 7 — Khai báo trên Vercel

1. Trước tiên **commit + push** code mới (GitHub Desktop) để Vercel có file `api/r2-upload.ts`.
2. Vào <https://vercel.com> → dự án `letsgo-vn` → **Settings** → **Environment Variables**.
3. Thêm 5 biến, môi trường chọn **Production** (thêm *Preview* nếu muốn):

   | Tên biến | Giá trị |
   |---|---|
   | `R2_ACCOUNT_ID` | Account ID ở bước 3 |
   | `R2_ACCESS_KEY_ID` | Access Key ID ở bước 6 |
   | `R2_SECRET_ACCESS_KEY` | Secret Access Key ở bước 6 |
   | `R2_BUCKET` | `letsgo-files` |
   | `R2_PUBLIC_URL` | `https://anh.letsgo.vn` (cách A) hoặc `https://pub-xxxxxxxx.r2.dev` (cách B) — **không** có dấu `/` ở cuối |

4. **Deployments** → bản mới nhất → nút **⋯** → **Redeploy** (biến mới chỉ có hiệu lực sau khi deploy lại).

## Kiểm tra

1. Mở <https://app.letsgo.vn/api/r2-upload> trên trình duyệt → phải thấy
   `{"enabled":true,"publicUrl":"https://anh.letsgo.vn"}` (hoặc địa chỉ r2.dev của anh).
   Thấy `"enabled":false` → thiếu / sai tên biến ở bước 7, hoặc chưa Redeploy.
2. Mở app → Thị trường → Khảo sát KCN → chụp thử 1 ảnh chỉ tiêu → Lưu.
3. Mở ảnh vừa chụp → bấm **Ảnh gốc** → địa chỉ ảnh phải bắt đầu bằng `https://anh.letsgo.vn/kcn-survey/…`
   (hoặc `…r2.dev/kcn-survey/…`).
   - Vẫn là `…supabase.co/…` → app không gửi được lên R2 và đã lưu Supabase thay: kiểm tra lại CORS (bước 5) và tên miền
     công khai (bước 4).
4. Trên Cloudflare → bucket `letsgo-files` → **Objects** → thấy thư mục `kcn-survey/` có file mới là xong.

## Sau này: chuyển ảnh cũ sang Cloudflare (không bắt buộc)

Ảnh cũ vẫn ở Supabase và hiện bình thường. Khi muốn dồn sang R2, báo Claude làm công cụ chuyển theo thứ tự an toàn:
**chép** sang R2 → lưu bảng đối chiếu link cũ ↔ mới → **đổi link** trong hệ thống → kiểm tra ảnh hiện đủ → (tuỳ chọn,
có hỏi trước) xoá bản Supabase. Nên giữ bản Supabase một thời gian vì link đã gửi ra ngoài (PDF / Excel / Zalo) và
"cỗ máy thời gian" vẫn trỏ về link cũ.
