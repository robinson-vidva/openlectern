// Voice suggestion chips. Rendered in a persistent slot so they are visible from
// any tab while the mic is listening. Newest first; tap to show.
export default function VoiceChips({ v }) {
  if (!v.chips.length) return null
  return (
    <div className="voice-chips">
      {v.chips.map((chip) => (
        <button
          key={chip.key}
          className={`voice-chip${chip.shown ? ' shown' : ''}`}
          onClick={() => v.tapChip(chip)}
        >
          <span className="vc-ref">{chip.ref}</span>
          {chip.text && <span className="vc-text">{chip.text}</span>}
          {chip.auto && <span className="vc-auto">auto</span>}
        </button>
      ))}
    </div>
  )
}
