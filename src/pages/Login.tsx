import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { getAppLogoUrl } from '../lib/appSettings';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function Login() {
  const { login, loginWithGoogle, googleError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    getAppLogoUrl().then(setLogoUrl).catch(() => {});
  }, []);

  // Vừa quay về từ Google mà không vào được (vd email chưa được cấp quyền) → hiện lý do
  useEffect(() => {
    if (googleError) setError(googleError);
  }, [googleError]);

  // Bấm Back từ trang Google: trình duyệt (nhất là Safari) khôi phục trang cũ → bỏ trạng thái "Đang chuyển..."
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setGoogleLoading(false); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    const err = await loginWithGoogle();
    // Không lỗi → trình duyệt đang chuyển sang trang Google, giữ nguyên trạng thái chờ
    if (err) { setError(err); setGoogleLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) { setError('Vui lòng nhập đầy đủ thông tin'); return; }
    setLoading(true);
    setError('');
    const err = await login(username, password);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <div className="min-h-screen bg-[#F5F4EF] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#0c2340] mb-4 shadow-lg overflow-hidden">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-white font-bold text-xl">LG</span>
            )}
          </div>
          <h1 className="text-[20px] font-bold text-[#111]">P. Kinh Doanh</h1>
          <p className="text-[13px] text-[#888] mt-1">Hệ thống quản lý nội bộ</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-[#E8E7E2] rounded-2xl p-7 shadow-sm">
          <h2 className="text-[15px] font-semibold text-[#111] mb-5">Đăng nhập</h2>

          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-[#555]">Tên đăng nhập</label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin · ketoan · kinhdoanh · bdh"
                className="text-[16px] sm:text-[13px] px-3 py-2 rounded-lg border border-gray-300 outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-blue-100 transition"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-[#555]">Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="text-[16px] sm:text-[13px] px-3 py-2 rounded-lg border border-gray-300 outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-blue-100 transition"
              />
            </div>
          </div>

          {error && (
            <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-5 px-4 py-2.5 bg-[#1D4ED8] text-white rounded-lg text-[13px] font-semibold hover:bg-[#1E40AF] transition disabled:opacity-60"
          >
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="h-px flex-1 bg-[#E8E7E2]" />
            <span className="text-[11.5px] text-[#999]">hoặc</span>
            <div className="h-px flex-1 bg-[#E8E7E2]" />
          </div>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || loading}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-white border border-gray-300 text-[#333] rounded-lg text-[13px] font-semibold hover:bg-gray-50 transition disabled:opacity-60"
          >
            <GoogleIcon />
            {googleLoading ? 'Đang chuyển sang Google...' : 'Đăng nhập bằng Google'}
          </button>
        </form>

        <div className="mt-4 p-4 bg-white/60 border border-[#E8E7E2] rounded-xl text-[11.5px] text-[#888] text-center">
          Letsgo VN — He thong quan ly noi bo
        </div>
      </div>
    </div>
  );
}
