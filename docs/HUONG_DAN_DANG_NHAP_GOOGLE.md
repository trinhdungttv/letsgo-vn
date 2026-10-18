# Hướng dẫn bật "Đăng nhập bằng Google" cho Let's Go VN

Dành cho quản trị viên (Tony). Làm lần lượt 6 bước dưới đây, tốt nhất làm trên **máy tính**
(trang Google Cloud và Supabase trên điện thoại rất khó bấm). Mất khoảng 20–30 phút.

**Cách hoạt động, nói ngắn gọn:** người dùng bấm nút Google → Google xác nhận "đây đúng là chủ
của email abc@gmail.com" → app tìm trong danh sách tài khoản (bảng `app_users`) xem có tài khoản
nào đang dùng email đó không. **Có** → vào app với đúng vai trò/quyền của tài khoản đó, y như
đăng nhập bằng mật khẩu. **Không có** → báo *"Tài khoản Google này chưa được cấp quyền"*.
App **không tự tạo tài khoản mới**. Đăng nhập bằng tên + mật khẩu vẫn dùng bình thường.

Thông tin cần dùng trong các bước:

| Mục | Giá trị |
|---|---|
| Địa chỉ app | `https://letsgo-vn.vercel.app` |
| Dự án Supabase | `bawtzxcnzcpzqsgmdcma` |
| Địa chỉ quay về của Supabase (Callback URL) | `https://bawtzxcnzcpzqsgmdcma.supabase.co/auth/v1/callback` |

---

## Bước 0 — Chạy SQL (migration 167) trong Supabase

1. Mở <https://supabase.com/dashboard/project/bawtzxcnzcpzqsgmdcma> → menu trái **SQL Editor** → **New query**.
2. Dán toàn bộ nội dung file `supabase/migrations/20261019110000_167_verify_google_login.sql`
   (Claude đã dán sẵn trong tin nhắn) → bấm **Run**. Thấy *Success. No rows returned* là được.
   Chạy lại lần nữa cũng không sao.
3. Kiểm tra (tuỳ chọn): dán câu sau → Run → phải ra **1 dòng**, cột `prosecdef` = `true`.

   ```sql
   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'verify_google_login';
   ```

## Bước 1 — Tạo "OAuth Client" trên Google Cloud Console

1. Vào <https://console.cloud.google.com>, đăng nhập bằng Gmail của Tony (tài khoản sẽ "sở hữu" cấu hình này).
2. Thanh trên cùng, bấm ô chọn dự án → **New Project** → Project name: `LetsGo VN Login` → **Create**.
   Đợi vài giây rồi chọn đúng dự án vừa tạo (tên hiện trên thanh trên cùng).
3. Ô tìm kiếm trên cùng gõ **OAuth consent screen** (hoặc menu ☰ → *APIs & Services* → *OAuth consent screen*;
   giao diện mới tên là **Google Auth Platform**) → bấm **Get started**:
   - *App name*: `Let's Go VN`
   - *User support email*: chọn email của Tony
   - *Audience*: chọn **External**
   - *Contact information*: email của Tony
   - Tích ô đồng ý chính sách → **Create**.
4. Menu trái **Clients** → **+ Create client**:
   - *Application type*: **Web application**
   - *Name*: `Let's Go VN Web`
   - *Authorized JavaScript origins* → **+ Add URI**, thêm lần lượt:
     - `https://letsgo-vn.vercel.app`
     - `http://localhost:5173`
   - *Authorized redirect URIs* → **+ Add URI**, thêm **đúng 1 dòng** (đây là địa chỉ của Supabase, không phải của app):
     - `https://bawtzxcnzcpzqsgmdcma.supabase.co/auth/v1/callback`
   - Bấm **Create**. Hộp thoại hiện **Client ID** và **Client secret** → bấm **Download JSON** để lưu lại
     (hoặc copy cả hai vào chỗ an toàn). **Không gửi Client secret cho ai, không dán lên nhóm chat.**
5. Menu trái **Audience** → mục *Publishing status* bấm **Publish app** → **Confirm**.
   - App chỉ xin email + tên + ảnh đại diện nên Google **không** bắt xét duyệt.
   - Nếu không Publish (để ở chế độ *Testing*), chỉ những Gmail được thêm vào mục *Test users* mới đăng nhập được.

## Bước 2 — Bật Google trong Supabase

1. Supabase Dashboard → **Authentication** → **Sign In / Providers** (bản cũ ghi là *Providers*) → tìm **Google** → bấm vào:
   - Bật **Enable Sign in with Google**
   - *Client IDs*: dán **Client ID** ở Bước 1.4
   - *Client Secret (for OAuth)*: dán **Client secret**
   - Ô *Callback URL (for OAuth)* Supabase hiển thị phải **trùng** dòng đã dán ở Bước 1.4.
   - Bấm **Save**.
2. Cũng trong trang **Sign In / Providers**, phần *User Signups*: để **BẬT** "Allow new users to sign up".
   (Supabase cần ghi nhận người dùng Google ở lần đầu. Việc **ai được vào app** vẫn do bảng `app_users` quyết định,
   không phải do mục này.)
3. **Authentication** → **URL Configuration**:
   - *Site URL*: `https://letsgo-vn.vercel.app` → **Save**
   - *Redirect URLs* → **Add URL**, thêm từng dòng:
     - `https://letsgo-vn.vercel.app/**`
     - `http://localhost:5173/**`
     - `http://localhost:5199/**`
   - ⚠️ **Không** thêm kiểu chung chung như `https://*.vercel.app/**` — như vậy trang lạ trên Vercel cũng nhận được
     mã đăng nhập Google của nhân viên. Chỉ thêm đúng tên miền của mình.

## Bước 3 — Gán email Google cho từng tài khoản

Mỗi người chỉ đăng nhập Google được khi tài khoản của họ trong app có **đúng email Google** họ dùng.

**Cách A — ngay trong app (dễ nhất, làm được trên điện thoại):**
đăng nhập admin bằng mật khẩu → menu **Phân quyền & Tài khoản** → tab **Quản lý tài khoản** → bấm sửa từng
người → ô **Email** điền đúng Gmail của họ → Lưu.

**Cách B — bằng SQL Editor:**

```sql
-- Xem danh sách: ai đang trống email
SELECT username, full_name, role, email, is_active FROM app_users ORDER BY username;

-- Gán email (sửa username + email cho đúng rồi Run, mỗi người 1 dòng)
UPDATE app_users SET email = 'ten.nguoi@gmail.com' WHERE username = 'ten_dang_nhap';

-- Kiểm tra email bị trùng giữa nhiều tài khoản (phải ra 0 dòng)
SELECT lower(btrim(email)) AS email, count(*) AS so_tai_khoan, string_agg(username, ', ') AS cac_tai_khoan
FROM app_users
WHERE email IS NOT NULL AND btrim(email) <> ''
GROUP BY 1 HAVING count(*) > 1;
```

Ghi chú: không phân biệt chữ hoa/thường (`Tony@Gmail.com` = `tony@gmail.com`). Một email chỉ được gắn với **1** tài
khoản — nếu trùng, app sẽ từ chối và báo "đang gắn với nhiều tài khoản".

## Bước 4 — Đưa code lên

Code nằm ở nhánh **`feat/google-login`** (đã commit trên máy, chưa push).
Mở GitHub Desktop → chọn nhánh `feat/google-login` → **Push origin** → tạo Pull Request → Merge vào `main`.
Vercel tự deploy lên `https://letsgo-vn.vercel.app` sau vài phút.

(Muốn thử trước trên link xem thử của Vercel thì thêm **đúng** link đó vào *Redirect URLs* ở Bước 2.3, dạng
`https://<link-xem-thử>.vercel.app/**`, thử xong có thể xoá.)

## Bước 5 — Thử

1. Mở `https://letsgo-vn.vercel.app` (nếu đang đăng nhập thì Đăng xuất trước).
2. Bấm **Đăng nhập bằng Google** → chọn Gmail đã gán ở Bước 3 → vào thẳng app với đúng quyền.
3. Thử với một Gmail **chưa** gán → phải thấy *"Tài khoản Google này chưa được cấp quyền (email…)"*.

---

## Lỗi thường gặp

| Thấy gì | Nguyên nhân → cách sửa |
|---|---|
| "Đăng nhập Google chưa được bật trên hệ thống" | Chưa làm Bước 2.1 (bật Google + Save). |
| "Máy chủ chưa cài đăng nhập Google (… migration 167)" | Chưa chạy Bước 0. |
| Google báo **Error 400: redirect_uri_mismatch** | Ô *Authorized redirect URIs* ở Bước 1.4 sai/thiếu — phải đúng `https://bawtzxcnzcpzqsgmdcma.supabase.co/auth/v1/callback`. |
| Google báo **403 access_denied** / "app đang thử nghiệm" | Chưa **Publish app** (Bước 1.5), hoặc Gmail đó chưa có trong *Test users*. |
| Chọn Google xong lại bị đưa về `localhost:3000` hoặc trang lạ | Chưa đặt *Site URL* / *Redirect URLs* (Bước 2.3). |
| "Tài khoản Google này chưa được cấp quyền (x@gmail.com)" | Email đó chưa gán cho tài khoản nào → làm Bước 3 (hoặc gán nhầm email khác). |
| "Tài khoản gắn với email Google … đang bị khoá" | Tài khoản đang bị Khoá trong *Quản lý tài khoản* → Mở khoá nếu đúng người. |
| "… đang gắn với nhiều tài khoản" | Chạy câu kiểm tra trùng ở Bước 3, xoá email ở tài khoản thừa. |
| "Không xác minh được email Google …" | Hiếm gặp. Supabase → **Authentication → Users** → tìm email đó → xoá **người dùng Supabase** này rồi đăng nhập Google lại. (Chỉ xoá trong mục *Authentication → Users* của Supabase — **không** đụng tới tài khoản trong app/`app_users`, không mất dữ liệu.) |
| "Supabase đang chặn tạo người dùng mới" | Bật lại "Allow new users to sign up" (Bước 2.2). |
| "Không hoàn tất được đăng nhập Google … bấm lại nút Google" | Thường do mở app từ biểu tượng ngoài màn hình chính iPhone rồi Google mở sang Safari. Bấm lại; nếu vẫn lỗi, mở app bằng Safari để đăng nhập. |

## Cần biết thêm

- **Khoá tài khoản** (nút Khoá trong Quản lý tài khoản) chặn cả đăng nhập mật khẩu lẫn Google.
- **Đổi email** của một tài khoản = đổi người được vào bằng Google. Xoá email = tài khoản đó chỉ còn đăng nhập bằng mật khẩu.
- Người dùng Google **vẫn giữ mật khẩu cũ**. Một số thao tác xoá quan trọng trong app hỏi lại mật khẩu — vẫn nhập mật khẩu này.
- Ai bấm Google mà không được cấp quyền thì Supabase vẫn ghi một dòng trong *Authentication → Users*. Dòng đó **không có
  quyền gì trong app**; để đó cũng được.
- Phiên đăng nhập Google dùng chung cơ chế với đăng nhập mật khẩu (hạn 7 ngày, Đăng xuất là huỷ phiên), nên các phần
  dành cho admin như **Văn phòng Orient** chạy y như cũ.
