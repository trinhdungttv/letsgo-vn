import { useState } from 'react'
import { Sun, Trophy, Map } from 'lucide-react'
import { MorningPrioritySection } from './MorningPrioritySection'
import { WinLossSection } from './WinLossSection'
import { KCNGridSection } from './KCNGridSection'
import type { Client } from '../../lib/types'

type ModuleKey = 'morning' | 'winloss' | 'kcn'

const TABS: { key: ModuleKey; label: string; icon: typeof Sun }[] = [
  { key: 'morning', label: 'Morning Priority', icon: Sun },
  { key: 'winloss', label: 'Win/Loss Tracker', icon: Trophy },
  { key: 'kcn', label: 'KCN Grid', icon: Map },
]

interface Props {
  clients: Client[]
  onClientUpdate: (client: Client) => void
  toast: (msg: string) => void
  onTabChange?: (tab: ModuleKey) => void
  onTaskDone?: (taskId: string) => void
  hiddenSections?: string[]
}

export function WorkspaceModulesTabs({ clients, onClientUpdate, toast, onTabChange, onTaskDone, hiddenSections }: Props) {
  const [activeTab, setActiveTab] = useState<ModuleKey>('morning')

  function handleTabChange(key: ModuleKey) {
    setActiveTab(key)
    onTabChange?.(key)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={[
              'flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border',
              'text-[12.5px] font-medium transition-colors',
              activeTab === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-[#333] border-[#E8E7E2] hover:border-blue-300',
            ].join(' ')}
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'morning' && <MorningPrioritySection clients={clients} onClientUpdate={onClientUpdate} onTaskDone={onTaskDone} hiddenSections={hiddenSections} />}
      {activeTab === 'winloss' && <WinLossSection clients={clients} />}
      {activeTab === 'kcn' && <KCNGridSection toast={toast} />}
    </div>
  )
}
