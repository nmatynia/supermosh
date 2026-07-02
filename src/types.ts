export type InputProps<T> = {
  value: T;
  onChange: (newValue: T) => unknown;
};

export type Vid = {
  src: string;
  file: File;
  name: string;
  chunks: EncodedVideoChunk[];
};

export type Ease = "linear" | "in" | "out" | "inout" | "hold";

// A speed keyframe: at source frame `frame`, the playback speed is `speed`
// (1 = normal, <1 = mosh-stretch slow-mo, >1 = frame-skip speed-up). `ease`
// controls interpolation from this keyframe to the next one.
export type SpeedKey = {
  frame: number;
  speed: number;
  ease: Ease;
};

export type Segment = {
  name: string;
  from: number;
  to: number;
  repeat: number;
  speedKeys?: SpeedKey[];
};

export type Settings = {
  width: number;
  height: number;
};
