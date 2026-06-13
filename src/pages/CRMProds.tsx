import React, { useState } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { formatCurrency } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { logActivity } from '../lib/audit';
import type { CRMProduct, CRMDeal } from '../lib/types';

interface Props {
  products: CRMProduct[];
  deals: CRMDeal[];
  onProductCreate: (p: CRMProduct) => void;
  onProductUpdate: (p: CRMProduct) => void;
  onProductDelete: (id: string) => void;
  toast: (m: string) => void;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

// Các loại dịch vụ thực tế của công ty. Admin có thể nhập danh mục khác (qua datalist) khi cần.
const PRESET_CATEGORIES = ['Cho thuê lao động (thời vụ)', 'Giới thiệu việc làm'];

const CATEGORY_COLORS: Record<string, string> = {
  'Cho thuê lao động (thời vụ)': 'bg-blue-100 text-blue-700',
  'Giới thiệu việc làm': 'bg-emerald-100 text-emerald-700',
};

const PRICE_HINTS: Record<string, string> = {
  'Cho thuê lao động (thời vụ)': 'VNĐ / ngày công thực tế của lao động',
  'Giới thiệu việc làm': 'VNĐ / lần (thu 1 lần khi giới thiệu thành công)',
};

const emptyForm = { name: '', price: 0, category: PRESET_CATEGORIES[0], industry: '', description: '' };

const CRMProds: React.FC<Props> = ({ products, deals, onProductCreate, onProductUpdate, onProductDelete, toast }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CRMProduct | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const categoryOptions = Array.from(new Set([...PRESET_CATEGORIES, ...products.map(p => p.category).filter((c): c is string => !!c)]));
  const industryOptions = Array.from(new Set(products.map(p => p.industry).filter((c): c is string => !!c)));

  const openAddModal = () => {
    setEditingProduct(null);
    setFormData(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (product: CRMProduct) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      price: product.price || 0,
      category: product.category || PRESET_CATEGORIES[0],
      industry: product.industry || '',
      description: product.description || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast('Vui lòng nhập tên sản phẩm');
      return;
    }

    try {
      if (editingProduct) {
        const { data, error } = await supabase
          .from('crm_products')
          .update({
            name: formData.name,
            price: formData.price,
            category: formData.category,
            industry: formData.industry || null,
            description: formData.description,
          })
          .eq('id', editingProduct.id)
          .select()
          .single();

        if (error) throw error;
        onProductUpdate(data as CRMProduct);
        toast('Cập nhật sản phẩm thành công');
        await logActivity({
          user, action: 'update', table: 'crm_products', recordId: editingProduct.id,
          description: `Cập nhật sản phẩm "${formData.name}"`,
          oldData: editingProduct, newData: data,
        });
      } else {
        const { data, error } = await supabase
          .from('crm_products')
          .insert([
            {
              name: formData.name,
              price: formData.price,
              category: formData.category,
              industry: formData.industry || null,
              description: formData.description,
            },
          ])
          .select()
          .single();

        if (error) throw error;
        if (data) onProductCreate(data);
        toast('Thêm sản phẩm thành công');
        if (data) {
          await logActivity({
            user, action: 'insert', table: 'crm_products', recordId: data.id,
            description: `Thêm sản phẩm "${formData.name}"`,
            newData: data,
          });
        }
      }

      setShowModal(false);
    } catch (error) {
      toast(`Lỗi: ${errMsg(error)}`);
    }
  };

  const handleDelete = async (product: CRMProduct) => {
    const usedIn = dealCount(product.id);
    const confirmMsg = usedIn > 0
      ? `Sản phẩm "${product.name}" đang được dùng trong ${usedIn} thương vụ. Vẫn xóa?`
      : `Xóa sản phẩm "${product.name}"?`;
    if (!confirm(confirmMsg)) return;

    try {
      const { error } = await supabase.from('crm_products').delete().eq('id', product.id);
      if (error) throw error;
      onProductDelete(product.id);
      toast('Đã xóa sản phẩm');
      await logActivity({
        user, action: 'delete', table: 'crm_products', recordId: product.id,
        description: `Xóa sản phẩm "${product.name}"`,
        oldData: product,
      });
    } catch (error) {
      toast(`Lỗi: ${errMsg(error)}`);
    }
  };

  const dealCount = (productId: string) => {
    return deals.filter(d => d.product_id === productId).length;
  };

  const truncate = (text: string, len: number) => {
    if (!text || text.length <= len) return text;
    return text.substring(0, len) + '...';
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sản phẩm / Dịch vụ"
        actions={
          isAdmin ? (
            <button onClick={openAddModal} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
              + Thêm sản phẩm
            </button>
          ) : undefined
        }
      />

      {/* Product Grid */}
      <div className="grid grid-cols-3 gap-4">
        {products.length > 0 ? (
          products.map(product => (
            <div key={product.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900 flex-1">{product.name}</h3>
                  {isAdmin && (
                    <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                      <button
                        onClick={() => openEditModal(product)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Sửa"
                      >
                        <Edit2 className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        onClick={() => handleDelete(product)}
                        className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xóa"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mb-3 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${CATEGORY_COLORS[product.category || ''] || 'bg-gray-100 text-gray-600'}`}>
                    {product.category || 'Khác'}
                  </span>
                  {product.industry && (
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                      {product.industry}
                    </span>
                  )}
                </div>

                <div className="mb-1">
                  <div className="text-2xl font-bold text-gray-900">{formatCurrency(product.price || 0)}</div>
                </div>
                {PRICE_HINTS[product.category || ''] && (
                  <div className="text-[11px] text-gray-500 mb-2">{PRICE_HINTS[product.category || '']}</div>
                )}

                {product.description && (
                  <p className="text-xs text-gray-600 mb-3 line-clamp-2">{truncate(product.description, 100)}</p>
                )}

                <div className="pt-3 border-t border-gray-100">
                  <div className="text-xs text-gray-600">
                    Dùng trong <span className="font-semibold text-gray-900">{dealCount(product.id)}</span> thương vụ
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-3 bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 text-sm">Không có sản phẩm nào</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && isAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">
                {editingProduct ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm'}
              </h2>
            </div>

            <div className="px-6 py-4 space-y-4 max-h-96 overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Khu vực báo giá <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ví dụ: Bình Dương, Đồng Nai..."
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Danh mục dịch vụ</label>
                <input
                  type="text"
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  list="category-options"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Chọn hoặc nhập danh mục mới"
                />
                <datalist id="category-options">
                  {categoryOptions.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Ngành nghề</label>
                <input
                  type="text"
                  value={formData.industry}
                  onChange={e => setFormData({ ...formData, industry: e.target.value })}
                  list="industry-options"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ví dụ: May mặc, Điện tử... (để trống nếu áp dụng chung)"
                />
                <datalist id="industry-options">
                  {industryOptions.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Đơn giá (VNĐ)</label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={e => setFormData({ ...formData, price: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
                {PRICE_HINTS[formData.category] && (
                  <div className="text-[11px] text-gray-500 mt-1">{PRICE_HINTS[formData.category]}</div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Mô tả</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Mô tả chi tiết về sản phẩm / dịch vụ"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-2 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CRMProds;
