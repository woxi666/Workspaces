// Tiny WebAudio synth — no external assets needed.
let ctx: AudioContext | null = null
let muted = false

export function setMuted(m: boolean) {
  muted = m
}

function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freqA: number, freqB: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
  const c = ac()
  const o = c.createOscillator()
  const g = c.createGain()
  const t0 = c.currentTime + delay
  o.type = type
  o.frequency.setValueAtTime(freqA, t0)
  o.frequency.exponentialRampToValueAtTime(Math.max(freqB, 1), t0 + dur)
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  o.connect(g).connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.05)
}

function noise(dur: number, vol: number, filterFreq: number, delay = 0) {
  const c = ac()
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = filterFreq
  const g = c.createGain()
  g.gain.value = vol
  src.connect(f).connect(g).connect(c.destination)
  src.start(c.currentTime + delay)
}

export type SoundName = 'launch' | 'hit' | 'explode' | 'ability' | 'poof' | 'win' | 'lose' | 'stretch'

export function playSound(name: SoundName) {
  if (muted) return
  try {
    switch (name) {
      case 'launch':
        tone(320, 90, 0.28, 'sawtooth', 0.18)
        noise(0.2, 0.12, 1200)
        break
      case 'stretch':
        tone(160, 220, 0.08, 'triangle', 0.05)
        break
      case 'hit':
        tone(140, 60, 0.1, 'square', 0.12)
        break
      case 'explode':
        noise(0.6, 0.5, 900)
        tone(90, 30, 0.5, 'sine', 0.4)
        break
      case 'ability':
        tone(500, 1400, 0.16, 'sine', 0.16)
        break
      case 'poof':
        noise(0.18, 0.2, 2500)
        tone(600, 200, 0.15, 'triangle', 0.08)
        break
      case 'win':
        tone(523, 523, 0.14, 'sine', 0.2, 0)
        tone(659, 659, 0.14, 'sine', 0.2, 0.13)
        tone(784, 784, 0.14, 'sine', 0.2, 0.26)
        tone(1047, 1047, 0.3, 'sine', 0.24, 0.39)
        break
      case 'lose':
        tone(400, 350, 0.2, 'triangle', 0.16, 0)
        tone(350, 300, 0.2, 'triangle', 0.16, 0.2)
        tone(300, 180, 0.4, 'triangle', 0.16, 0.4)
        break
    }
  } catch {
    // audio unavailable — ignore
  }
}
