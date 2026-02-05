import React from 'react'
import { FileText } from 'lucide-react'

interface InputPaneProps {
  input: string
  onChange: (_value: string) => void
}

const InputPane: React.FC<InputPaneProps> = ({ input, onChange }) => {
  const lineCount = input.split('\n').length
  const lines = Array.from({ length: lineCount }, (_, i) => i + 1)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const numbersRef = React.useRef<HTMLDivElement>(null)

  const handleScroll = () => {
    if (textareaRef.current && numbersRef.current) {
      numbersRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  return (
    <div className="border-r border-slate-700 flex flex-col min-w-[260px] flex-none h-full">
      <div className="bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 flex justify-between items-center">
        <span>INPUT DATA (.dat)</span> <FileText size={14} />
      </div>
      <div className="flex-1 flex overflow-hidden relative">
        <div
          ref={numbersRef}
          className="bg-slate-950 text-slate-600 text-right pr-2 pt-4 font-mono text-xs select-none w-10 overflow-hidden"
          style={{ lineHeight: '1.625' }} // Match leading-relaxed of textarea (approx 1.625)
        >
          {lines.map(n => (
            <div key={n} className="leading-relaxed">{n}</div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          className="flex-1 bg-slate-900 text-slate-300 p-4 font-mono text-xs resize-none focus:outline-none leading-relaxed selection:bg-blue-500/30 whitespace-pre"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

export default InputPane
