interface Props {
  consumer: number | null
  relatability: number | null
  explainability: number | null
  visual: number | null
}

function ScoreDot({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null
  const color =
    value >= 8 ? 'bg-emerald-500' : value >= 6 ? 'bg-yellow-400' : 'bg-gray-300'
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
      <span className="text-xs text-gray-500">
        {label}: <span className="font-semibold text-gray-700">{value}</span>
      </span>
    </div>
  )
}

export function ScoreBreakdown({ consumer, relatability, explainability, visual }: Props) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <ScoreDot label="Consumer" value={consumer} />
      <ScoreDot label="Relatable" value={relatability} />
      <ScoreDot label="Explainable" value={explainability} />
      <ScoreDot label="Visual" value={visual} />
    </div>
  )
}
