// The voice controls (mic start/stop, language, auto, live transcript). Chips
// render separately in VoiceChips so they can persist across tabs.
export default function VoiceControls({ v, listenerMode, onListenerMode }) {
  if (!v.supported) {
    return (
      <div className="voice">
        <div className="voice-head">
          <span className="voice-title">Voice</span>
        </div>
        <p className="muted" style={{ margin: '0.4rem 0 0' }}>
          Voice needs Chrome or Edge on this device.
        </p>
      </div>
    )
  }

  return (
    <div className="voice">
      <div className="voice-head">
        <span className="voice-title">Voice</span>
        <span className={`mic ${v.micState}`}>
          <span className="mic-dot" />
          {v.micState === 'listening' ? 'Listening' : v.micState === 'error' ? 'Error' : 'Off'}
        </span>
        <button
          className={`btn small${v.active ? ' primary' : ''}`}
          onClick={v.toggle}
          aria-pressed={v.active}
        >
          {v.active ? 'Stop' : 'Start listening'}
        </button>
      </div>

      <div className="voice-controls">
        <label className="voice-lang">
          Language
          <select value={v.lang} onChange={(e) => v.changeLang(e.target.value)} aria-label="Recognition language">
            {v.langs.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="voice-auto">
          <input type="checkbox" checked={v.auto} onChange={(e) => v.setAuto(e.target.checked)} />
          Auto-show strong matches
        </label>
      </div>

      {onListenerMode && (
        <button className="btn small listener-toggle" onClick={() => onListenerMode(!listenerMode)}>
          {listenerMode ? 'Exit listener mode' : 'Listener mode (leave at the pulpit)'}
        </button>
      )}

      {v.auto && (
        <p className="muted voice-hint">Auto shows exact book + valid verse instantly. Anything unsure still waits as a chip.</p>
      )}
      <p className="muted voice-hint">
        Quote-catch flags scripture spoken without a citation. It matches the loaded translations wording
        (e.g. WEB); a verse remembered in another wording may not match.
      </p>
      {v.error && <p className="error" style={{ margin: '0.4rem 0 0' }}>{v.error}</p>}
      {v.micState === 'listening' && (
        <p className="voice-transcript">{v.transcript || 'Listening for a reference...'}</p>
      )}
      {v.micState === 'listening' && (
        <p className="muted voice-hint">Keep this screen on and unlocked; the mic stops if the phone sleeps.</p>
      )}
    </div>
  )
}
