import { GUIDE_PERCENTAGES } from 'shared'

type CropGuidesProps = {
  visible: boolean
}

const toInsetStyle = (values: typeof GUIDE_PERCENTAGES.trim) => ({
  left: `${values.left}%`,
  top: `${values.top}%`,
  right: `${values.right}%`,
  bottom: `${values.bottom}%`,
})

export default function CropGuides({ visible }: CropGuidesProps) {
  if (!visible) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute rounded-xl border-2 border-rose-400/80"
        style={toInsetStyle(GUIDE_PERCENTAGES.trim)}
      />
      <div
        className="absolute rounded-lg border-2 border-dashed border-sky-400/80"
        style={toInsetStyle(GUIDE_PERCENTAGES.safe)}
      />
    </div>
  )
}
