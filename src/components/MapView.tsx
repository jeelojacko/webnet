import React, { useMemo } from 'react'
import type { AdjustmentResult } from '../types'

const FT_PER_M = 3.280839895

interface MapViewProps {
  result: AdjustmentResult
  units: 'm' | 'ft'
}

const MapView: React.FC<MapViewProps> = ({ result, units }) => {
  const unitScale = units === 'ft' ? FT_PER_M : 1
  const { stations, observations } = result

  const { points, bbox } = useMemo(() => {
    const entries = Object.entries(stations)
    const xs = entries.map(([, s]) => s.x)
    const ys = entries.map(([, s]) => s.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1)
    const width = maxX - minX + pad * 2
    const height = maxY - minY + pad * 2
    const pts = entries.map(([id, s]) => ({
      id,
      x: s.x,
      y: s.y,
      h: s.h,
      fixed: s.fixed,
      ellipse: s.errorEllipse,
    }))
    return { points: pts, bbox: { minX: minX - pad, minY: minY - pad, width, height } }
  }, [stations])

  const viewW = 1000
  const viewH = 700

  const project = (x: number, y: number) => {
    const px = ((x - bbox.minX) / bbox.width) * viewW
    const py = viewH - ((y - bbox.minY) / bbox.height) * viewH
    return { x: px, y: py }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3 text-xs text-slate-400">
        <span>
          Map view (scaled) — coords & ellipses in {units} ({unitScale.toFixed(4)} factor)
        </span>
        <span className="text-slate-500">Obs lines shown for dist/gps for context</span>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded overflow-hidden">
        <svg viewBox={`0 0 ${viewW} ${viewH}`} className="w-full h-[480px]">
          <defs>
            <marker
              id="arrow"
              markerWidth="6"
              markerHeight="6"
              refX="3"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L6,3 z" fill="#64748b" />
            </marker>
          </defs>

          {observations
            .filter((o) => o.type === 'dist' || o.type === 'gps')
            .map((obs, idx) => {
              const from = stations[obs.type === 'dist' ? obs.from : obs.from]
              const to = stations[obs.type === 'dist' ? obs.to : obs.to]
              if (!from || !to) return null
              const p1 = project(from.x, from.y)
              const p2 = project(to.x, to.y)
              return (
                <line
                  key={`obs-${idx}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#475569"
                  strokeWidth={1}
                  markerEnd="url(#arrow)"
                  opacity={0.6}
                />
              )
            })}

          {points.map((p) => {
            const proj = project(p.x, p.y)
            const ellipse = p.ellipse
            const ellScale = units === 'ft' ? 0.0328084 : 1
            return (
              <g key={p.id}>
                {ellipse && (
                  <ellipse
                    cx={proj.x}
                    cy={proj.y}
                    rx={(ellipse.semiMajor * 100 * ellScale * viewW) / bbox.width}
                    ry={(ellipse.semiMinor * 100 * ellScale * viewH) / bbox.height}
                    transform={`rotate(${ellipse.theta}, ${proj.x}, ${proj.y})`}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={1}
                    opacity={0.6}
                  />
                )}
                <circle cx={proj.x} cy={proj.y} r={6} fill={p.fixed ? '#22c55e' : '#fbbf24'} />
                <text x={proj.x + 8} y={proj.y - 8} className="text-[10px]" fill="#e2e8f0">
                  {p.id}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

export default MapView
