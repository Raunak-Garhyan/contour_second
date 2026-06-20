const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

function playTone(freq: number, duration: number, type: OscillatorType = "sine", volume = 0.15) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration);
}

export function playClick() {
  playTone(800, 0.08, "sine", 0.1);
}

export function playCountdown() {
  playTone(440, 0.15, "sine", 0.12);
}

export function playGo() {
  playTone(660, 0.1, "sine", 0.15);
  setTimeout(() => playTone(880, 0.2, "sine", 0.15), 100);
}

export function playSubmit() {
  playTone(523, 0.1, "triangle", 0.12);
  setTimeout(() => playTone(659, 0.1, "triangle", 0.12), 80);
  setTimeout(() => playTone(784, 0.15, "triangle", 0.12), 160);
}

export function playScore(score: number) {
  if (score >= 7) {
    playTone(523, 0.1, "sine", 0.1);
    setTimeout(() => playTone(659, 0.1, "sine", 0.1), 100);
    setTimeout(() => playTone(784, 0.15, "sine", 0.12), 200);
    setTimeout(() => playTone(1047, 0.3, "sine", 0.12), 300);
  } else if (score >= 4) {
    playTone(440, 0.15, "triangle", 0.1);
    setTimeout(() => playTone(523, 0.2, "triangle", 0.1), 150);
  } else {
    playTone(300, 0.2, "sawtooth", 0.08);
    setTimeout(() => playTone(250, 0.3, "sawtooth", 0.08), 200);
  }
}

export function playTimerTick() {
  playTone(1000, 0.04, "sine", 0.06);
}

export function playClear() {
  playTone(400, 0.08, "square", 0.06);
  setTimeout(() => playTone(300, 0.1, "square", 0.06), 60);
}
