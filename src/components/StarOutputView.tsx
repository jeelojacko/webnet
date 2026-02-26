import React from 'react';

interface StarOutputViewProps {
  text: string;
}

const StarOutputView: React.FC<StarOutputViewProps> = ({ text }) => (
  <div className="h-full p-4 bg-slate-950 text-slate-100">
    <div className="h-full border border-slate-700 bg-slate-900 overflow-auto rounded">
      <pre className="text-xs leading-5 font-mono p-3 whitespace-pre-wrap">{text}</pre>
    </div>
  </div>
);

export default StarOutputView;

