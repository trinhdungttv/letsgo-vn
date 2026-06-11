import React, { useState } from 'react';
import { Edit2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { formatCurrency } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { CRMProduct, CRMDeal } from '../lib/types';

interface Props {
  products: CRMProduct[];
  deals: CRMDeal[];
  onProductCreate: (p: CRMProduct) => void;
  onProductUpdate: (p: CRMProduct) => void;
  toast: (m: string) => void;
}

const CATEGORIES = {
  recruitment: 'Recruitment',
  software: 'Software',
  training: 'Training',
  consulting: 'Consulting',
  outsourcing: 'Outsourcing',
} as const;

type CategoryKey = keyof typeof CATEGORIES;

const CRMProds: React.FC<Props> = ({ products, deals, onProductCreate, onProductUpdate, toast }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CRMProduct | null>(null);
  const [formData, setFormData] = useState({ name: '', price: 0, category: 'software', description: '' });

  const openAddModal = () => {
    setEditingProduct(null);
    setFormData({ name: '', price: 0, category: 'software', description: '' });
    setShowModal(true);
  };

  const openEditModal = (product: CRMProduct) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      price: product.price || 0,
      category: product.category || 'software',
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
        const { error } = await supabase
          .from('crm_products')
          .update({
            name: formData.name,
            price: formData.price,
            category: formData.category,
            description: formData.description,
          })
          .eq('id', editingProduct.id);

        if (error) throw error;
        onProductUpdate({ ...editingProduct, ...formData });
        toast('Cập nhật sản phẩm thành công');
      } else {
        const { data, error } = await supabase
          .from('crm_products')
          .insert([
            {
              name: formData.name,
              price: formData.price,
              category: formData.category,
              description: formData.description,
            },
          ])
          .select()
          .single();

        if (error) throw error;
        if (data) onProductCreate(data);
        toast('Thêm sản phẩm thành công');
      }

      setShowModal(false);
    } catch (error) {
      toast(`Lỗi: ${error instanceof Error ? error.message : 'Không xác định'}`);
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
        title="Sản phẩm"
        actions={
          <button onClick={openAddModal} className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition">
            + Thêm sản phẩm
          </button>
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
                  <button
                    onClick={() => openEditModal(product)}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0 ml-2"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4 text-gray-600" />
                  </button>
                </div>

                <div className="flex gap-2 mb-3 flex-wrap">
                  <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                    {CATEGORIES[product.category as CategoryKey] || product.category}
                  </span>
                </div>

                <div className="mb-3">
                  <div className="text-2xl font-bold text-gray-900">{formatCurrency(product.price || 0)}</div>
                </div>

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
      {showModal && (
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
                  Tên <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Tên sản phẩm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Giá</label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={e => setFormData({ ...formData, price: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Danh mục</label>
                <select
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.entries(CATEGORIES).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Mô tả</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Mô tả chi tiết về sản phẩm"
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
