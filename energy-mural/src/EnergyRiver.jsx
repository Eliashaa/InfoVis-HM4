import { useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import * as d3 from 'd3'

const WIDTH = 1000
const HEIGHT = 666
const MILESTONES = [1965, 1990, 2000, 2010, 2020, 2024]
const SOURCES = [
  { key: 'coal_consumption', label: 'Coal', color: '#383b3b' },
  { key: 'oil_consumption', label: 'Oil', color: '#bf5544' },
  { key: 'gas_consumption', label: 'Gas', color: '#ed963b' },
  { key: 'nuclear_consumption', label: 'Nuclear', color: '#80658e' },
  { key: 'hydro_consumption', label: 'Hydro', color: '#4086a5' },
  { key: 'wind_consumption', label: 'Wind', color: '#37825e' },
  { key: 'solar_consumption', label: 'Solar', color: '#e7bd37' },
  { key: 'other_renewable_consumption', label: 'Other renewables', color: '#8caaa3' },
]

const formatEnergy = d3.format(',.0f')
const formatShare = d3.format('.1%')

export default function EnergyRiver() {
  const chartRef = useRef(null)
  const [rawData, setRawData] = useState([])
  const [loadError, setLoadError] = useState('')
  const [exportState, setExportState] = useState('idle')

  useEffect(() => {
    let cancelled = false

    d3.csv('/owid-energy-data.csv', d3.autoType)
      .then((rows) => {
        if (!cancelled) setRawData(rows)
      })
      .catch(() => {
        if (!cancelled) setLoadError('The energy dataset could not be loaded.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const data = useMemo(
    () =>
      rawData
        .filter((row) => row.country === 'World' && row.year >= 1965 && row.year <= 2024)
        .map((row) => {
          const values = Object.fromEntries(
            SOURCES.map(({ key }) => [key, Number.isFinite(row[key]) ? row[key] : 0]),
          )
          const fossil =
            values.coal_consumption + values.oil_consumption + values.gas_consumption

          return {
            ...values,
            year: row.year,
            total: Number.isFinite(row.primary_energy_consumption)
              ? row.primary_energy_consumption
              : 0,
            fossil,
            windSolar: values.wind_consumption + values.solar_consumption,
          }
        })
        .filter((row) => row.total > 0)
        .sort((a, b) => a.year - b.year),
    [rawData],
  )

  const milestones = useMemo(
    () => MILESTONES.map((year) => data.find((row) => row.year === year)).filter(Boolean),
    [data],
  )

  const summary = useMemo(() => {
    if (data.length === 0) return null
    const first = data[0]
    const last = data[data.length - 1]
    const year2000 = data.find((row) => row.year === 2000)

    return {
      first,
      last,
      growth: last.total / first.total,
      fossilShare: last.fossil / last.total,
      windSolarGrowth: year2000?.windSolar ? last.windSolar / year2000.windSolar : 0,
    }
  }, [data])

  async function downloadPng() {
    const svg = chartRef.current
    if (!svg) return

    setExportState('preparing')
    try {
      const copy = svg.cloneNode(true)
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      copy.setAttribute('width', String(WIDTH))
      copy.setAttribute('height', String(HEIGHT))
      const svgBlob = new Blob([new XMLSerializer().serializeToString(copy)], {
        type: 'image/svg+xml;charset=utf-8',
      })
      const objectUrl = URL.createObjectURL(svgBlob)
      const image = new Image()
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas is unavailable')

      const pngBlob = await new Promise((resolve, reject) => {
        image.onload = () => {
          context.drawImage(image, 0, 0, WIDTH, HEIGHT)
          URL.revokeObjectURL(objectUrl)
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))))
        }
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl)
          reject(new Error('The chart image could not be rendered'))
        }
        image.src = objectUrl
      })

      const downloadUrl = URL.createObjectURL(pngBlob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = 'global-energy-river-1965-2024.png'
      link.click()
      URL.revokeObjectURL(downloadUrl)
      setExportState('done')
      window.setTimeout(() => setExportState('idle'), 2200)
    } catch {
      setExportState('error')
      window.setTimeout(() => setExportState('idle'), 3000)
    }
  }

  if (loadError) {
    return <p className="load-message" role="alert">{loadError}</p>
  }

  return (
    <section className="mural" aria-label="Global primary energy consumption">
      <header className="mural-toolbar">
        <div className="wordmark" aria-label="Energy Atlas">
          <span className="wordmark-mark" aria-hidden="true">E</span>
          <span>ENERGY ATLAS</span>
        </div>
        <span className="toolbar-caption">A changing world, measured in TWh</span>
        <button
          className="export-button"
          type="button"
          onClick={downloadPng}
          disabled={!summary || exportState === 'preparing'}
          title="Download this mural as a 1000 by 666 pixel PNG"
        >
          <Download size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{exportState === 'preparing' ? 'Preparing…' : 'Download PNG'}</span>
        </button>
        <span className="sr-only" aria-live="polite">
          {exportState === 'done' ? 'PNG downloaded.' : exportState === 'error' ? 'PNG export failed.' : ''}
        </span>
      </header>

      {!summary ? (
        <div className="loading-state" role="status">
          <span className="loading-mark" aria-hidden="true" />
          <span>Reading the world’s energy history…</span>
        </div>
      ) : (
        <EnergyChart
          chartRef={chartRef}
          data={data}
          milestones={milestones}
          summary={summary}
        />
      )}
    </section>
  )
}

function EnergyChart({ chartRef, data, milestones, summary }) {
  const [activeYear, setActiveYear] = useState(null)
  const plot = { left: 66, right: 732, top: 250, bottom: 474 }
  const plotWidth = plot.right - plot.left
  const plotHeight = plot.bottom - plot.top
  const stack = d3.stack().keys(SOURCES.map((source) => source.key))(data)
  const maxEnergy = d3.max(stack[stack.length - 1], (point) => point[1]) || 1
  const x = d3.scaleLinear().domain(d3.extent(data, (row) => row.year)).range([plot.left, plot.right])
  const y = d3.scaleLinear().domain([0, maxEnergy]).range([plot.bottom, plot.top])
  const area = d3
    .area()
    .x((point) => x(point.data.year))
    .y0((point) => y(point[0]))
    .y1((point) => y(point[1]))
    .curve(d3.curveMonotoneX)
  const selected = activeYear === null ? null : data.find((row) => row.year === activeYear)
  const ticks = d3.range(0, maxEnergy, 50000).concat(maxEnergy > 150000 ? [] : [maxEnergy])

  const labels = stack
    .map((layer, index) => {
      const point = layer[layer.length - 1]
      const row = data[data.length - 1]
      return {
        key: layer.key,
        label: SOURCES[index].label,
        color: SOURCES[index].color,
        valueY: y((point[0] + point[1]) / 2),
        share: row.total ? row[layer.key] / row.total : 0,
      }
    })
    .sort((a, b) => a.valueY - b.valueY)

  const labelGap = 26
  const labelTop = plot.top + 10
  const labelBottom = plot.bottom - 10
  labels[0].labelY = Math.max(labelTop, labels[0].valueY)
  for (let index = 1; index < labels.length; index += 1) {
    labels[index].labelY = Math.max(labels[index].valueY, labels[index - 1].labelY + labelGap)
  }
  if (labels[labels.length - 1].labelY > labelBottom) {
    labels[labels.length - 1].labelY = labelBottom
    for (let index = labels.length - 2; index >= 0; index -= 1) {
      labels[index].labelY = Math.min(labels[index].labelY, labels[index + 1].labelY - labelGap)
    }
  }
  if (labels[0].labelY < labelTop) {
    labels[0].labelY = labelTop
    for (let index = 1; index < labels.length; index += 1) {
      labels[index].labelY = Math.max(labels[index].labelY, labels[index - 1].labelY + labelGap)
    }
  }

  function handlePointerMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const localX = ((event.clientX - bounds.left) / bounds.width) * WIDTH
    const targetYear = x.invert(localX)
    const index = d3.bisector((row) => row.year).center(data, targetYear)
    setActiveYear(data[index]?.year ?? null)
  }

  const yearTicks = [1965, 1980, 1990, 2000, 2010, 2020, 2024]

  return (
    <div className="mural-frame">
      <svg
        ref={chartRef}
        className="mural-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby="mural-title mural-description"
      >
        <style>{`
          .svg-eyebrow { font: 700 10px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .svg-title { font: 700 31px Georgia, 'Times New Roman', serif; }
          .svg-subtitle { font: 400 13px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .svg-kpi { font: 700 31px Georgia, 'Times New Roman', serif; }
          .svg-kpi-unit { font: 400 11px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .milestone-year { font: 700 11px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .milestone-total { font: 700 13px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .milestone-unit, .milestone-share { font: 400 10px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .axis-y, .axis-x { font: 400 10px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .end-label { font: 700 11px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .end-share { font: 400 10px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .tooltip-year { font: 700 10px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .tooltip-total { font: 400 10px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .takeaway-label { font: 700 9px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .takeaway-value { font: 700 27px Georgia, 'Times New Roman', serif; }
          .takeaway-note { font: 400 10px 'Avenir Next', 'Helvetica Neue', sans-serif; }
          .source-note { font: 500 8px 'Avenir Next', 'Helvetica Neue', sans-serif; }
        `}</style>
        <title id="mural-title">A changing mix in a growing world</title>
        <desc id="mural-description">
          Stacked area chart of global primary energy consumption by source from 1965 to 2024,
          with milestone totals, fossil fuel shares, and recent takeaways.
        </desc>
        <rect width={WIDTH} height={HEIGHT} fill="#f4f2eb" />
        <rect width={WIDTH} height="6" fill="#2c6254" />

        <text x="58" y="39" className="svg-eyebrow" fill="#2c6254">
          ENERGY TRANSITION / GLOBAL SYSTEMS
        </text>
        <text x="56" y="83" className="svg-title" fill="#202a29">
          A changing mix in a growing world
        </text>
        <text x="59" y="111" className="svg-subtitle" fill="#56605c">
          Global primary energy consumption by source, 1965–2024
        </text>
        <line x1="777" x2="777" y1="28" y2="117" stroke="#d5d5cb" />
        <text x="800" y="43" className="svg-eyebrow" fill="#56605c">
          WORLD TOTAL · 2024
        </text>
        <text x="798" y="83" className="svg-kpi" fill="#202a29">
          {formatEnergy(summary.last.total)}
        </text>
        <text x="800" y="107" className="svg-kpi-unit" fill="#56605c">
          terawatt-hours
        </text>

        <line x1="58" x2="944" y1="132" y2="132" stroke="#d3d3c9" />
        {milestones.map((row, index) => {
          const itemWidth = 886 / milestones.length
          const itemX = 58 + index * itemWidth
          return (
            <g key={row.year}>
              <text x={itemX} y="156" className="milestone-year" fill="#2c6254">
                {row.year}
              </text>
              <text x={itemX} y="178" className="milestone-total" fill="#242c2a">
                {formatEnergy(row.total)}
                <tspan className="milestone-unit" fill="#68706c"> TWh</tspan>
              </text>
              <text x={itemX} y="198" className="milestone-share" fill="#68706c">
                {formatShare(row.fossil / row.total)} fossil
              </text>
              {index < milestones.length - 1 && (
                <line
                  x1={itemX + itemWidth - 16}
                  x2={itemX + itemWidth - 16}
                  y1="145"
                  y2="202"
                  stroke="#ddddd4"
                />
              )}
            </g>
          )
        })}

        <g aria-hidden="true">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={plot.left}
                x2={plot.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="#f4f2eb"
                strokeOpacity="0.68"
                strokeWidth="1"
              />
              <text x={plot.left - 10} y={y(tick) + 4} textAnchor="end" className="axis-y">
                {tick === 0 ? '0' : `${Math.round(tick / 1000)}k`}
              </text>
            </g>
          ))}
        </g>

        {milestones.map((row) => (
          <line
            key={row.year}
            x1={x(row.year)}
            x2={x(row.year)}
            y1={plot.top}
            y2={plot.bottom}
            stroke="#283f38"
            strokeOpacity="0.15"
            strokeDasharray="2 5"
          />
        ))}

        {stack.map((layer, index) => (
          <path
            key={layer.key}
            d={area(layer)}
            fill={SOURCES[index].color}
            stroke="#f4f2eb"
            strokeWidth="0.65"
            className="river-layer"
            style={{ animationDelay: `${index * 55}ms` }}
          />
        ))}

        {labels.map((label) => (
          <g key={label.key}>
            <path
              d={`M ${plot.right} ${label.valueY} L 758 ${label.labelY}`}
              fill="none"
              stroke={label.color}
              strokeWidth="1.1"
              strokeOpacity="0.8"
            />
            <circle cx={plot.right} cy={label.valueY} r="2.2" fill={label.color} />
            <text x="766" y={label.labelY - 2} className="end-label" fill={label.color}>
              {label.label}
            </text>
            <text x="766" y={label.labelY + 11} className="end-share" fill="#545d58">
              {formatShare(label.share)}
            </text>
          </g>
        ))}

        {yearTicks.map((year) => (
          <g key={year}>
            <line x1={x(year)} x2={x(year)} y1={plot.bottom} y2={plot.bottom + 5} stroke="#47504c" />
            <text x={x(year)} y={plot.bottom + 21} textAnchor="middle" className="axis-x">
              {year}
            </text>
          </g>
        ))}

        {selected && (
          <g pointerEvents="none">
            <line
              x1={x(selected.year)}
              x2={x(selected.year)}
              y1={plot.top}
              y2={plot.bottom}
              stroke="#182d27"
              strokeWidth="1.2"
            />
            <circle cx={x(selected.year)} cy={y(selected.total)} r="4" fill="#f4f2eb" stroke="#182d27" strokeWidth="2" />
            <g transform={`translate(${Math.min(Math.max(x(selected.year) - 66, plot.left), plot.right - 132)},${plot.top + 8})`}>
              <rect width="132" height="42" rx="2" fill="#202a29" />
              <text x="10" y="16" className="tooltip-year" fill="#d8c674">
                {selected.year}
              </text>
              <text x="10" y="32" className="tooltip-total" fill="#ffffff">
                {formatEnergy(selected.total)} TWh total
              </text>
            </g>
          </g>
        )}

        <rect
          x={plot.left}
          y={plot.top}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActiveYear(null)}
          aria-label="Explore annual energy values"
        />

        <line x1="58" x2="944" y1="521" y2="521" stroke="#d3d3c9" />
        {[
          {
            x: 58,
            color: '#2c6254',
            label: 'A BIGGER SYSTEM',
            value: `${summary.growth.toFixed(1)}×`,
            note: 'more energy used since 1965',
          },
          {
            x: 356,
            color: '#bf5544',
            label: 'FOSSIL FUELS',
            value: formatShare(summary.fossilShare),
            note: 'of the 2024 global total',
          },
          {
            x: 654,
            color: '#d6aa23',
            label: 'WIND + SOLAR',
            value: `${Math.round(summary.windSolarGrowth)}×`,
            note: 'their consumption since 2000',
          },
        ].map((item) => (
          <g key={item.label}>
            <rect x={item.x} y="541" width="280" height="76" rx="2" fill="#ebe9df" />
            <rect x={item.x} y="541" width="3" height="76" fill={item.color} />
            <text x={item.x + 16} y="561" className="takeaway-label" fill="#626b65">
              {item.label}
            </text>
            <text x={item.x + 15} y="596" className="takeaway-value" fill={item.color}>
              {item.value}
            </text>
            <text x={item.x + 94} y="593" className="takeaway-note" fill="#424b47">
              {item.note}
            </text>
          </g>
        ))}
        <text x="59" y="647" className="source-note" fill="#6d746e">
          SOURCE: OUR WORLD IN DATA · ENERGY INSTITUTE · PRIMARY ENERGY CONSUMPTION, TWh
        </text>
        <text x="943" y="647" textAnchor="end" className="source-note" fill="#6d746e">
          ENERGY ATLAS  /  01
        </text>
      </svg>
    </div>
  )
}