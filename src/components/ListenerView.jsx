// Dedicated listener screen: leave this phone face-up near the speaker, plugged
// in. It listens and broadcasts detections; it does not operate.
export default function ListenerView({ v, name, code, onExit }) {
  const label = v.micState === 'listening' ? 'Listening' : v.micState === 'error' ? 'Mic error' : 'Mic off'
  return (
    <div className="listener">
      <span className={`listener-status mic ${v.micState}`}>
        <span className="mic-dot" />
        {label}
      </span>
      <div className="listener-title">Listener at the pulpit</div>
      <p className="listener-transcript">{v.transcript || 'Waiting for speech...'}</p>
      {v.error && <p className="error">{v.error}</p>}
      <p className="listener-reminder">Keep this phone plugged in and the screen unlocked.</p>
      <button className="btn wide" onClick={onExit}>Exit listener mode</button>
      <p className="muted listener-meta">Session {code}{name ? ` · ${name}` : ''}</p>
    </div>
  )
}
