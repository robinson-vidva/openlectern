// On-device speech-to-text via Whisper, using transformers.js loaded from a CDN
// at runtime -- ONLY when the operator turns on the on-device engine. Loading the
// library lazily (not as an npm dependency) keeps it out of the default bundle and
// off every self-hoster's install; the model weights download from the Hugging
// Face CDN on first use and are then cached by the browser.
//
// Messages:
//   { type:'load', model }        -> { type:'progress', data } ... { type:'ready' }
//   { type:'audio', audio, language, seq } -> { type:'text', text, seq }
//   errors                        -> { type:'error', error }

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2/dist/transformers.min.js'

let asr = null
let loadPromise = null

async function ensureModel(model) {
  if (asr) return asr
  if (!loadPromise) {
    loadPromise = (async () => {
      const t = await import(/* @vite-ignore */ LIB)
      t.env.allowLocalModels = false // always fetch from the Hub/CDN
      // Prefer WebGPU; transformers.js falls back to WASM if unavailable.
      asr = await t.pipeline('automatic-speech-recognition', model || 'onnx-community/whisper-base', {
        device: 'webgpu',
        dtype: 'q8',
        progress_callback: (data) => self.postMessage({ type: 'progress', data })
      })
      return asr
    })()
  }
  return loadPromise
}

self.onmessage = async (e) => {
  const msg = e.data || {}
  try {
    if (msg.type === 'load') {
      await ensureModel(msg.model)
      self.postMessage({ type: 'ready' })
    } else if (msg.type === 'audio') {
      if (!asr) return
      const out = await asr(msg.audio, {
        task: 'transcribe',
        language: msg.language || null, // null = auto-detect (multilingual)
        chunk_length_s: 30,
        return_timestamps: false
      })
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out?.text || '').trim()
      self.postMessage({ type: 'text', text, seq: msg.seq })
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String((err && err.message) || err) })
  }
}
