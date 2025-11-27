import React from 'react'
import { FileText } from 'lucide-react'

interface InputPaneProps {
  input: string
  onChange: (_value: string) => void
}

const InputPane: React.FC<InputPaneProps> = ({ input, onChange }) => {
  return (
    <div className="border-r border-slate-700 flex flex-col min-w-[260px] flex-none">
      <div className="bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 flex justify-between items-center">
        <span>INPUT DATA (.dat)</span> <FileText size={14} />
      </div>
      <textarea
        value={input}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-slate-900 text-slate-300 p-4 font-mono text-xs resize-none focus:outline-none leading-relaxed selection:bg-blue-500/30"
        spellCheck={false}
      />
    </div>
  )
}

export default InputPane
