// Microphone capture for the on-device (Whisper) speech engine.
//
// Whisper wants 16 kHz mono Float32 samples. This captures the mic, downsamples
// to 16 kHz, and emits an overlapping window of the last `windowSec` seconds
// every `hopSec` seconds, so speech that straddles a window boundary is still
// covered by the next window.

export const TARGET_RATE = 16000

// Linear-interpolation downsample from `fromRate` to `toRate`. Pure and testable.
export function downsample(input, fromRate, toRate) {
  if (!input || !input.length || toRate >= fromRate) return Float32Array.from(input || [])
  const ratio = fromRate / toRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

// Append b onto a (Float32Array), keeping at most `maxLen` most-recent samples.
export function appendCapped(a, b, maxLen) {
  const merged = new Float32Array(a.length + b.length)
  merged.set(a)
  merged.set(b, a.length)
  return merged.length > maxLen ? merged.slice(merged.length - maxLen) : merged
}

// Start capturing. Returns { stop() } or null on failure (onError is called).
export async function startMicWindows({ windowSec = 6, hopSec = 3, minSec = 1.2, onWindow, onError }) {
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
  } catch (e) {
    onError?.(e)
    return null
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const ctx = new AudioCtx()
  const source = ctx.createMediaStreamSource(stream)
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0 // route to destination silently so onaudioprocess fires without feedback
  const srcRate = ctx.sampleRate
  const windowSamples = Math.round(TARGET_RATE * windowSec)
  const hopSamples = Math.round(TARGET_RATE * hopSec)
  const minSamples = Math.round(TARGET_RATE * minSec)
  let buf = new Float32Array(0)
  let sinceHop = 0

  node.onaudioprocess = (e) => {
    const down = downsample(e.inputBuffer.getChannelData(0), srcRate, TARGET_RATE)
    buf = appendCapped(buf, down, windowSamples)
    sinceHop += down.length
    if (sinceHop >= hopSamples && buf.length >= minSamples) {
      sinceHop = 0
      onWindow?.(buf.slice())
    }
  }
  source.connect(node)
  node.connect(mute)
  mute.connect(ctx.destination)

  return {
    stop() {
      try {
        node.onaudioprocess = null
        node.disconnect()
        source.disconnect()
        mute.disconnect()
        stream.getTracks().forEach((t) => t.stop())
        ctx.close()
      } catch {
        /* ignore teardown races */
      }
    }
  }
}
