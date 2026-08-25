import { startMicWindows } from './mic.js'

// The on-device Whisper engine. Recommended model: a small multilingual Whisper
// that runs in the browser and transcribes mixed English + Tamil in one stream.
export const WHISPER_MODEL = 'onnx-community/whisper-base'

// Map a Web-Speech recognition language to a Whisper language code (null = let
// Whisper auto-detect per chunk, which is what enables mixed-language services).
export function whisperLang(voiceLang) {
  if (!voiceLang || voiceLang === 'auto') return null // null = detect per chunk (mixed languages)
  if (voiceLang.startsWith('ta')) return 'tamil'
  if (voiceLang.startsWith('en')) return 'english'
  return null
}

// WebGPU is what makes on-device transcription fast enough to be usable. Without
// it transformers.js falls back to WASM, which is typically too slow for live use.
export function onDeviceSupported() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && typeof Worker !== 'undefined'
}

// Orchestrate the engine: spin up the model worker, stream mic windows to it, and
// call onText(text) for each transcript. `getLanguage()` is read per window so the
// operator can change language live WITHOUT reloading the model. Only a genuine
// load failure routes to onError (so the caller falls back to the browser engine);
// a single window that fails to transcribe is skipped and listening continues.
export function startOnDeviceEngine({ model = WHISPER_MODEL, getLanguage, onText, onProgress, onReady, onError }) {
  let stopped = false
  let mic = null
  let ready = false
  let seq = 0
  let worker
  try {
    worker = new Worker(new URL('../../workers/whisperWorker.js', import.meta.url), { type: 'module' })
  } catch (e) {
    onError?.(e)
    return { stop() {} }
  }

  worker.onmessage = (e) => {
    const m = e.data || {}
    if (m.type === 'progress') onProgress?.(m.data)
    else if (m.type === 'ready') {
      ready = true
      onReady?.(m.device)
    } else if (m.type === 'text') {
      if (m.text) onText?.(m.text)
    } else if (m.type === 'skip') {
      /* one window failed to transcribe -- ignore, keep listening */
    } else if (m.type === 'error') onError?.(new Error(m.error))
  }
  worker.onerror = (e) => onError?.(new Error(e.message || 'on-device worker error'))
  worker.postMessage({ type: 'load', model })

  startMicWindows({
    onWindow: (audio) => {
      if (stopped || !ready) return
      const language = getLanguage ? getLanguage() : null
      worker.postMessage({ type: 'audio', audio, language, seq: ++seq }, [audio.buffer])
    },
    onError
  }).then((handle) => {
    mic = handle
    if (stopped) handle?.stop()
  })

  return {
    stop() {
      stopped = true
      try {
        mic?.stop()
      } catch {
        /* ignore */
      }
      try {
        worker.terminate()
      } catch {
        /* ignore */
      }
    }
  }
}
