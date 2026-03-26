/**
 * Chess sound effects via Web Audio API synthesis.
 * No external audio files required — all sounds are generated programmatically.
 *
 * Usage:
 *   import { playChessSound } from '@/lib/chess-sounds';
 *   playChessSound('move');   // normal piece move
 *   playChessSound('capture'); // piece taken
 *   playChessSound('check');   // king in check
 *   playChessSound('castle');  // castling
 *   playChessSound('promote'); // pawn promotion
 *   playChessSound('win');     // game won
 *   playChessSound('lose');    // game lost
 *   playChessSound('draw');    // draw agreed / stalemate
 */

export type ChessSoundType = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'win' | 'lose' | 'draw';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Resume context if suspended, then run callback. Handles browser autoplay policy. */
function withCtx(fn: (c: AudioContext) => void): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') {
    c.resume().then(() => fn(c)).catch(() => {});
  } else {
    fn(c);
  }
}

/** Play a short sine/square tone burst */
function tone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.35,
  startDelay = 0,
) {
  withCtx(c => {
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.connect(gain);
    gain.connect(c.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, c.currentTime + startDelay);

    gain.gain.setValueAtTime(0, c.currentTime + startDelay);
    gain.gain.linearRampToValueAtTime(volume, c.currentTime + startDelay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + startDelay + duration);

    osc.start(c.currentTime + startDelay);
    osc.stop(c.currentTime + startDelay + duration + 0.05);
  });
}

/** Play a noise burst (for capture impact) */
function noise(duration: number, volume = 0.2, startDelay = 0) {
  withCtx(c => {
    const bufferSize = c.sampleRate * duration;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = c.createBufferSource();
    source.buffer = buffer;

    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.8;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);

    gain.gain.setValueAtTime(volume, c.currentTime + startDelay);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + startDelay + duration);

    source.start(c.currentTime + startDelay);
    source.stop(c.currentTime + startDelay + duration + 0.05);
  });
}

const SOUNDS: Record<ChessSoundType, () => void> = {
  /** Soft wooden "thunk" — piece placed on board */
  move: () => {
    tone(220, 0.08, 'sine', 0.3);
    tone(110, 0.12, 'sine', 0.15, 0.04);
  },

  /** Impact + noise — capture */
  capture: () => {
    tone(180, 0.06, 'square', 0.25);
    noise(0.10, 0.18);
    tone(130, 0.15, 'sine', 0.2, 0.05);
  },

  /** Two-part alert tone — check */
  check: () => {
    tone(660, 0.10, 'sine', 0.35);
    tone(880, 0.14, 'sine', 0.3, 0.12);
  },

  /** Two quick "clicks" — castling (king + rook move) */
  castle: () => {
    tone(320, 0.08, 'sine', 0.28);
    tone(260, 0.08, 'sine', 0.22, 0.12);
  },

  /** Rising arpeggio — pawn promotion */
  promote: () => {
    tone(523, 0.09, 'sine', 0.3);        // C5
    tone(659, 0.09, 'sine', 0.3, 0.10);  // E5
    tone(784, 0.09, 'sine', 0.3, 0.20);  // G5
    tone(1047, 0.14, 'sine', 0.35, 0.30); // C6
  },

  /** Triumphant ascending chord — win */
  win: () => {
    tone(523, 0.18, 'sine', 0.3);        // C5
    tone(659, 0.18, 'sine', 0.28, 0.18); // E5
    tone(784, 0.18, 'sine', 0.28, 0.36); // G5
    tone(1047, 0.35, 'sine', 0.32, 0.54); // C6
  },

  /** Descending somber tones — lose */
  lose: () => {
    tone(330, 0.20, 'sine', 0.28);        // E4
    tone(294, 0.20, 'sine', 0.25, 0.22);  // D4
    tone(262, 0.30, 'sine', 0.22, 0.44);  // C4
  },

  /** Neutral two-note phrase — draw */
  draw: () => {
    tone(392, 0.14, 'sine', 0.28);        // G4
    tone(349, 0.18, 'sine', 0.25, 0.18);  // F4
  },
};

let enabled = true;

/** Enable or disable all chess sounds */
export function setChessSoundsEnabled(value: boolean) {
  enabled = value;
}

/** Play a chess sound effect (no-op if sounds are disabled or Web Audio unavailable) */
export function playChessSound(type: ChessSoundType): void {
  if (!enabled) return;
  try {
    SOUNDS[type]?.();
  } catch {
    // Silently swallow — browser may block audio without prior user interaction
  }
}

/**
 * Derive which sound to play from a chess.js move result.
 * Pass the flags string from chess.js move object.
 *
 *   flags: 'n' = normal, 'b' = big pawn, 'e' = en-passant,
 *          'c' = capture, 'p' = promotion, 'k' = king-side castle,
 *          'q' = queen-side castle
 */
export function soundForMove(
  flags: string,
  isCheck: boolean,
  isCapture: boolean,
): ChessSoundType {
  if (isCheck) return 'check';
  if (flags.includes('k') || flags.includes('q')) return 'castle';
  if (flags.includes('p')) return 'promote';
  if (isCapture || flags.includes('e')) return 'capture';
  return 'move';
}
