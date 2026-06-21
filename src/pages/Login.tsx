import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { getAppLogoUrl } from '../lib/appSettings';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    getAppLogoUrl().then(setLogoUrl).catch(() => {});
  }, []);

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
                className="text-[13px] px-3 py-2 rounded-lg border border-gray-300 outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-blue-100 transition"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-[#555]">Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="text-[13px] px-3 py-2 rounded-lg border border-gray-300 outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-blue-100 transition"
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
        </form>

        <div className="mt-4 p-4 bg-white/60 border border-[#E8E7E2] rounded-xl text-[11.5px] text-[#888] text-center">
          Letsgo VN — He thong quan ly noi bo
        </div>
      </div>
    </div>
  );
}
