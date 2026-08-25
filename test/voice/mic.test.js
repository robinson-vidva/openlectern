import { describe, it, expect } from 'vitest'
import { downsample, appendCapped } from '../../src/lib/voice/mic.js'
import { whisperLang } from '../../src/lib/voice/ondevice.js'

describe('downsample', () => {
  it('halves length going 32k -> 16k and preserves endpoints', () => {
    const input = Float32Array.from({ length: 100 }, (_, i) => i / 100)
    const out = downsample(input, 32000, 16000)
    expect(out.length).toBe(50)
    expect(out[0]).toBeCloseTo(0, 5)
    // linear interpolation: sample 49 maps to input index 98
    expect(out[49]).toBeCloseTo(0.98, 5)
  })
  it('returns a copy unchanged when target >= source', () => {
    const input = Float32Array.from([0.1, 0.2, 0.3])
    const out = downsample(input, 16000, 16000)
    expect(Array.from(out)).toEqual([0.1, 0.2, 0.3].map((x) => expect.closeTo(x, 5)))
  })
  it('handles empty input', () => {
    expect(downsample(new Float32Array(0), 48000, 16000).length).toBe(0)
    expect(downsample(null, 48000, 16000).length).toBe(0)
  })
})

describe('appendCapped', () => {
  it('appends within the cap', () => {
    const out = appendCapped(Float32Array.from([1, 2]), Float32Array.from([3, 4]), 10)
    expect(Array.from(out)).toEqual([1, 2, 3, 4])
  })
  it('keeps only the most-recent maxLen samples', () => {
    const out = appendCapped(Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6]), 4)
    expect(Array.from(out)).toEqual([3, 4, 5, 6])
  })
})

describe('whisperLang mapping', () => {
  it('maps recognition languages to Whisper codes; unknown -> auto-detect', () => {
    expect(whisperLang('ta-IN')).toBe('tamil')
    expect(whisperLang('en-US')).toBe('english')
    expect(whisperLang('en-IN')).toBe('english')
    expect(whisperLang(undefined)).toBe(null)
  })
})
