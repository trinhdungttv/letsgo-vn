import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Quotes from '../../pages/Quotes'
import type { MarketSurvey, Competitor } from '../../lib/types'

interface Props {
  toast: (msg: string) => void
  onClose: () => void
}

export function QuoteModal({ toast, onClose }: Props) {
  const [marketSurveys, setMarketSurveys] = useState<MarketSurvey[]>([])
  const [competitors, setCompetitors] = useState<Competitor[]>([])

  useEffect(() => {
    supabase.from('market_surveys').select('*').then(({ data }) => { if (data) setMarketSurveys(data as MarketSurvey[]) })
    supabase.from('competitors').select('*').then(({ data }) => { if (data) setCompetitors(data as Competitor[]) })
  }, [])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E8E7E2] shrink-0">
          <h2 className="text-[14px] font-semibold text-[#111]">Tạo báo giá</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Quotes marketSurveys={marketSurveys} competitors={competitors} toast={toast} />
        </div>
      </div>
    </div>
  )
}
