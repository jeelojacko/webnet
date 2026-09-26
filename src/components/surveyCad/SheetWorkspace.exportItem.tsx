import React from 'react';
import type { ExportItem } from '../../engine/cad/cadExportScene';

export const exportItemToSvg = (item: ExportItem, key: string, clipPrefix: string): React.ReactNode => {
  const clipPath = item.clipId ? `url(#${clipPrefix}-${item.clipId})` : undefined;
  const stroke = item.stroke ?? '#111111';
  const width = item.widthMm ?? 0.25;
  switch (item.kind) {
    case 'line':
      return <line key={key} x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke={stroke} strokeWidth={width} clipPath={clipPath} />;
    case 'polyline':
      return (
        <polyline
          key={key}
          points={item.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill={item.fill ?? 'none'}
          stroke={stroke}
          strokeWidth={width}
          clipPath={clipPath}
        />
      );
    case 'rect':
      return <rect key={key} x={item.x} y={item.y} width={item.width} height={item.height} fill={item.fill ?? 'none'} stroke={stroke} strokeWidth={width} clipPath={clipPath} />;
    case 'circle':
      return <circle key={key} cx={item.cx} cy={item.cy} r={item.r} fill={item.fill ?? 'none'} stroke={stroke} strokeWidth={width} clipPath={clipPath} />;
    case 'ellipse':
      return <ellipse key={key} cx={item.cx} cy={item.cy} rx={item.rx} ry={item.ry} transform={`rotate(${item.rotationDeg} ${item.cx} ${item.cy})`} fill={item.fill ?? 'none'} stroke={stroke} strokeWidth={width} clipPath={clipPath} />;
    case 'arc': {
      const toRad = (deg: number): number => (deg * Math.PI) / 180;
      const sx = item.cx + item.r * Math.cos(toRad(item.startDeg));
      const sy = item.cy + item.r * Math.sin(toRad(item.startDeg));
      const ex = item.cx + item.r * Math.cos(toRad(item.endDeg));
      const ey = item.cy + item.r * Math.sin(toRad(item.endDeg));
      const sweep = item.endDeg - item.startDeg > 180 || item.endDeg - item.startDeg < 0 ? 1 : 0;
      return <path key={key} d={`M ${sx} ${sy} A ${item.r} ${item.r} 0 ${sweep} 1 ${ex} ${ey}`} fill="none" stroke={stroke} strokeWidth={width} clipPath={clipPath} />;
    }
    case 'text':
      return (
        <text
          key={key}
          x={item.x}
          y={item.y}
          fontSize={item.heightMm}
          fill={stroke}
          textAnchor={item.anchor ?? 'start'}
          transform={item.rotationDeg ? `rotate(${item.rotationDeg} ${item.x} ${item.y})` : undefined}
          clipPath={clipPath}
        >
          {item.text}
        </text>
      );
    default:
      return null;
  }
};
