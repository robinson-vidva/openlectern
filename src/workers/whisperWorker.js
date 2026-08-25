// On-device speech-to-text via Whisper, using transformers.js loaded from a CDN
// at runtime -- ONLY when the operator turns on the on-device engine. Loading the
// library lazily (not as an npm dependency) keeps it out of the default bundle and
// off every self-hoster's install; the model weights download from the Hugging
// Face CDN on first use and are then cached by the browser.
//
// Messages in:  { type:'load', model } | { type:'audio', audio, language, seq }
// Messages out: { type:'progress', data } | { type:'ready', device }
//               | { type:'text', text, seq } | { type:'skip' } | { type:'error', error }

// Bare package URL resolves to the ESM entry (the form the transformers.js docs
// use). Pinned to the v3 major; env/pipeline API is stable across 3.x.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3'
const DEFAULT_MODEL = 'onnx-community/whisper-base' // multilingual (not the .en variant)

let asr = null
let loadPromise = null
let activeDevice = 'webgpu'

async function buildPipeline(t, model, device) {
  return t.pipeline('automatic-speech-recognition', model, {
    device,
    // fp32 avoids WebGPU quantization-compat errors; q8 keeps the CPU path small.
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'fp32' } : 'q8',
    progress_callback: (data) => self.postMessage({ type: 'progress', data })
  })
}

async function ensureModel(model) {
  if (asr) return asr
  if (!loadPromise) {
    loadPromise = (async () => {
      const t = await import(/* @vite-ignore */ LIB)
      t.env.allowLocalModels = false // always fetch from the Hub/CDN
      try {
        asr = await buildPipeline(t, model || DEFAULT_MODEL, 'webgpu')
        activeDevice = 'webgpu'
      } catch (gpuErr) {
        // No WebGPU (or an unsupported config): fall back to CPU/WASM -- slower,
        // but it still transcribes instead of the engine dying.
        self.postMessage({ type: 'progress', data: { status: 'fallback' } })
        asr = await buildPipeline(t, model || DEFAULT_MODEL, 'wasm')
        activeDevice = 'wasm'
      }
      return asr
    })()
  }
  return loadPromise
}

self.onmessage = async (e) => {
  const msg = e.data || {}
  if (msg.type === 'load') {
    try {
      await ensureModel(msg.model)
      self.postMessage({ type: 'ready', device: activeDevice })
    } catch (err) {
      // Genuine load failure (bad network, model unavailable): fatal -> the main
      // thread falls back to the browser engine.
      self.postMessage({ type: 'error', error: String((err && err.message) || err) })
    }
  } else if (msg.type === 'audio') {
    if (!asr) return
    try {
      const out = await asr(msg.audio, {
        task: 'transcribe',
        language: msg.language || null, // null = auto-detect (mixed languages)
        chunk_length_s: 30,
        return_timestamps: false
      })
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out?.text || '').trim()
      self.postMessage({ type: 'text', text, seq: msg.seq })
    } catch (err) {
      // A single window failing must NOT kill the engine; skip it and keep going.
      self.postMessage({ type: 'skip', error: String((err && err.message) || err) })
    }
  }
}
