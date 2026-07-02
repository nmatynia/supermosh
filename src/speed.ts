import { Ease, Segment, SpeedKey } from "./types";

export const EASES: Ease[] = ["linear", "in", "out", "inout", "hold"];

// Editable / displayable speed range. Slowing is the interesting direction for
// datamosh (each source frame's motion re-applies, producing the bloom), so the
// range is skewed toward slow but still allows moderate speed-ups.
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 4;

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

// Easing applied across the interval from a keyframe to the next. `hold` keeps
// the left value until the next keyframe, then jumps.
const easeFns: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => t * (2 - t),
  inout: (t) => t * t * (3 - 2 * t),
  hold: () => 0,
};

// Speed multiplier at a given source frame, given the (unsorted) keyframes.
// No keyframes => constant 1x (current behaviour).
export const evalSpeed = (
  keys: SpeedKey[] | undefined,
  frame: number
): number => {
  if (!keys || keys.length === 0) return 1;
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  if (frame <= sorted[0].frame) return sorted[0].speed;
  const last = sorted[sorted.length - 1];
  if (frame >= last.frame) return last.speed;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame);
      return a.speed + (b.speed - a.speed) * easeFns[a.ease](t);
    }
  }
  return 1;
};

// A chunk to decode plus how many output frames its picture stays on screen.
export type TimedChunk = {
  chunk: EncodedVideoChunk;
  hold: number;
};

// Expand a clip's source chunks into a decode plan, applying the speed curve.
// A frame at speed s occupies ~1/s output frames: slowing HOLDS the decoded
// picture for extra frames, speeding drops chunks (which the decoder never
// sees, so later deltas mosh onto the wrong picture).
//
// Each chunk appears at most once: feeding the same coded frame to the
// decoder twice is undefined behaviour in practice — Chrome's software H.264
// decoder errors out on it, and some hardware decoders silently stop emitting
// frames (the render freezes). Slow-mo must happen at presentation time, not
// by re-decoding.
//
// `isFirst` keeps the pre-`from` run-up at 1x so the trim offset holds.
export const clipOutputChunks = (
  chunks: EncodedVideoChunk[],
  s: Segment,
  isFirst: boolean
): TimedChunk[] => {
  const out: TimedChunk[] = [];
  const start = isFirst ? 0 : s.from;
  let carry = 0;
  for (let f = start; f < s.to; f++) {
    const speed =
      f < s.from ? 1 : clamp(evalSpeed(s.speedKeys, f), MIN_SPEED, MAX_SPEED);
    carry += 1 / speed;
    const count = Math.floor(carry);
    carry -= count;
    if (count > 0) out.push({ chunk: chunks[f], hold: count });
  }
  return out;
};

// Number of output frames a clip produces (before `repeat`) under its speed
// curve — used to show the remapped duration in the UI.
export const clipOutputLength = (chunks: EncodedVideoChunk[], s: Segment) =>
  clipOutputChunks(chunks, s, false).reduce((sum, tc) => sum + tc.hold, 0);
