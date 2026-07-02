export type InputProps<T> = {
  value: T;
  onChange: (newValue: T) => unknown;
};

export type FitMode = "contain" | "cover" | "stretch" | "custom";

// How a clip is mapped onto the output canvas during preprocessing.
// width/height/lock only apply to "custom": an exact size, centered on the
// canvas (padded with black and/or cropped as needed).
export type Fit = {
  mode: FitMode;
  width?: number;
  height?: number;
  lock?: boolean;
};

export type Vid = {
  src: string;
  file: File;
  name: string;
  chunks: EncodedVideoChunk[];
  // Native resolution of the source file, before preprocessing rescales it.
  width: number;
  height: number;
  fit: Fit;
  // The ffmpeg -vf chain the current chunks were built with. Comparing it to
  // fitFilter(fit, settings, ...) tells whether the clip needs reprocessing.
  processedFilter: string;
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
