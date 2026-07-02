import { Dispatch, SetStateAction, useEffect, useState } from "react";

import { Section } from "./components/Section";
import { computeDimensions, even, fitFilter, record } from "./lib";
import { NumberInput } from "./NumberInput";
import { clipOutputChunks } from "./speed";
import { Fit, FitMode, Segment, Settings, Vid } from "./types";

const MODES: { mode: FitMode; label: string; hint: string }[] = [
  {
    mode: "contain",
    label: "fit",
    hint: "Scale to fit inside the frame — keeps aspect ratio, adds black bars (default)",
  },
  {
    mode: "cover",
    label: "cover",
    hint: "Scale to fill the frame — keeps aspect ratio, crops the overflow",
  },
  {
    mode: "stretch",
    label: "stretch",
    hint: "Stretch to exactly the output size — ignores aspect ratio",
  },
  {
    mode: "custom",
    label: "custom",
    hint: "Pick an exact size — centered on the frame, padded/cropped as needed",
  },
];

const OBJECT_FIT: Record<Exclude<FitMode, "custom">, "contain" | "cover" | "fill"> = {
  contain: "contain",
  cover: "cover",
  stretch: "fill",
};

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const ratioLabel = (w: number, h: number) => {
  if (!w || !h) return "";
  const g = gcd(w, h);
  const a = w / g;
  const b = h / g;
  return a <= 40 && b <= 40 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`;
};

export const Rendering = ({
  segments,
  vids,
  setVids,
  config,
  settings,
  setSettings,
  autoRes,
  setAutoRes,
  busy,
  reprocess,
  progress,
  filesProgress,
}: {
  segments: Segment[];
  vids: Vid[];
  setVids: Dispatch<SetStateAction<Vid[]>>;
  config: VideoDecoderConfig | null;
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  autoRes: boolean;
  setAutoRes: Dispatch<SetStateAction<boolean>>;
  busy: boolean;
  reprocess: () => Promise<void>;
  progress: number;
  filesProgress: { processed: number; total: number };
}) => {
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [src, setSrc] = useState("");
  const [downloadName, setDownloadName] = useState("");

  // Vids normally carry their native resolution from upload time; measure and
  // backfill it for any that don't (e.g. state kept alive across a hot
  // reload), so every fit computation sees the same numbers.
  useEffect(() => {
    for (const vid of vids) {
      if (vid.width) continue;
      computeDimensions(vid.file, vid.src)
        .then(({ width, height }) => {
          if (!width) return;
          setVids((prev) =>
            prev.map((v) => (v.name === vid.name ? { ...v, width, height } : v))
          );
        })
        .catch(() => {});
    }
  }, [vids, setVids]);

  const natOf = (vid: Vid) => ({ width: vid.width, height: vid.height });

  const W = even(settings.width);
  const H = even(settings.height);

  // The resolution "auto" targets: smallest width and smallest height across
  // all clips, so no clip has to be upscaled in either dimension.
  const known = vids.map(natOf).filter((n) => n.width);
  const autoTarget = known.length
    ? {
        width: even(Math.min(...known.map((n) => n.width))),
        height: even(Math.min(...known.map((n) => n.height))),
      }
    : null;

  const setManual = (next: Settings) => {
    setAutoRes(false);
    setSettings(next);
  };

  const setFit = (name: string, fit: Fit) =>
    setVids((prev) =>
      prev.map((vid) => (vid.name === name ? { ...vid, fit } : vid))
    );

  // Entering custom mode starts from the clip's contain size, so the preview
  // doesn't jump, with the aspect-ratio lock on.
  const toCustom = (vid: Vid) => {
    const nat = natOf(vid);
    const s = nat.width ? Math.min(W / nat.width, H / nat.height) : 1;
    setFit(vid.name, {
      mode: "custom",
      width: nat.width ? Math.min(even(nat.width * s), W) : W,
      height: nat.height ? Math.min(even(nat.height * s), H) : H,
      lock: true,
    });
  };

  const filterOf = (vid: Vid) => fitFilter(vid.fit, settings, natOf(vid));
  const staleVids = vids.filter((vid) => filterOf(vid) !== vid.processedFilter);

  const caption = (vid: Vid) => {
    const nat = natOf(vid);
    if (!nat.width) return "";
    const { fit } = vid;
    if (fit.mode === "stretch")
      return Math.abs(nat.width / nat.height - W / H) < 0.01
        ? "fills the frame exactly"
        : "stretched to fill — aspect ratio not preserved";
    if (fit.mode === "custom") {
      const w = even(fit.width ?? W);
      const h = even(fit.height ?? H);
      return `${w}×${h}, centered${w > W || h > H ? ", edges cropped" : ""}`;
    }
    const s =
      fit.mode === "cover"
        ? Math.max(W / nat.width, H / nat.height)
        : Math.min(W / nat.width, H / nat.height);
    const w = even(nat.width * s);
    const h = even(nat.height * s);
    if (fit.mode === "cover") {
      if (w > W) return "fills the frame — sides cropped";
      if (h > H) return "fills the frame — top & bottom cropped";
      return "fills the frame exactly";
    }
    if (w < W) return "fits inside — black bars left & right";
    if (h < H) return "fits inside — black bars top & bottom";
    return "fills the frame exactly";
  };

  return (
    <Section name="Rendering">
      <div className="Rendering-output">
        <strong>Output</strong>
        <NumberInput
          value={settings.width}
          onChange={(width) => setManual({ ...settings, width })}
          min={4}
          step={2}
        />
        <span>&times;</span>
        <NumberInput
          value={settings.height}
          onChange={(height) => setManual({ ...settings, height })}
          min={4}
          step={2}
        />
        <span>
          px <span className="Rendering-ratio">({ratioLabel(W, H)})</span>
        </span>
        {autoTarget && (
          <button
            className={
              autoRes &&
              settings.width === autoTarget.width &&
              settings.height === autoTarget.height
                ? "is-active"
                : ""
            }
            title="Match the smallest width and height across your clips, so nothing gets upscaled"
            onClick={() => {
              setSettings(autoTarget);
              setAutoRes(true);
            }}
          >
            auto {autoTarget.width}&times;{autoTarget.height}
          </button>
        )}
        {[
          { name: "480p", width: 640, height: 480 },
          { name: "720p", width: 1280, height: 720 },
          { name: "1080p", width: 1920, height: 1080 },
        ].map(({ name, width, height }) => (
          <button
            key={name}
            onClick={() => setManual({ width, height })}
            disabled={settings.width === width && settings.height === height}
          >
            {name}
          </button>
        ))}
        <button
          title="Swap width and height"
          onClick={() =>
            setManual({ width: settings.height, height: settings.width })
          }
        >
          flip
        </button>
      </div>

      {vids.length > 0 && (
        <div className="Rendering-clips">
          {vids.map((vid) => {
            const nat = natOf(vid);
            const stale = filterOf(vid) !== vid.processedFilter;
            const isImage = vid.file.type.startsWith("image");
            const customStyle =
              vid.fit.mode === "custom"
                ? {
                    width: `${((vid.fit.width ?? W) / W) * 100}%`,
                    height: `${((vid.fit.height ?? H) / H) * 100}%`,
                    objectFit: "fill" as const,
                  }
                : { objectFit: OBJECT_FIT[vid.fit.mode] };
            const mediaProps = {
              className: `FitCard-media${
                vid.fit.mode === "custom" ? " is-custom" : ""
              }`,
              style: customStyle,
              src: vid.src,
            };
            return (
              <div
                key={vid.name}
                className={`FitCard${stale ? " is-stale" : ""}`}
              >
                <div className="FitCard-head">
                  <span className="FitCard-name" title={vid.name}>
                    {vid.name}
                  </span>
                  <span className="FitCard-res">
                    {nat.width ? `${nat.width}×${nat.height}` : ""}
                  </span>
                </div>
                <div
                  className="FitCard-stage"
                  style={{ aspectRatio: `${W} / ${H}` }}
                  title="Preview of how this clip sits in the output frame"
                >
                  {isImage ? (
                    <img {...mediaProps} alt={vid.name} />
                  ) : (
                    <video {...mediaProps} muted playsInline preload="metadata" />
                  )}
                </div>
                <div className="FitCard-modes">
                  {MODES.map(({ mode, label, hint }) => (
                    <button
                      key={mode}
                      className={vid.fit.mode === mode ? "is-active" : ""}
                      title={hint}
                      disabled={busy}
                      onClick={() =>
                        mode === "custom"
                          ? toCustom(vid)
                          : setFit(vid.name, { mode })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {vid.fit.mode === "custom" && (
                  <div className="FitCard-custom">
                    <NumberInput
                      value={vid.fit.width ?? W}
                      onChange={(width) =>
                        setFit(vid.name, {
                          ...vid.fit,
                          width,
                          height:
                            vid.fit.lock && nat.width
                              ? even((width * nat.height) / nat.width)
                              : vid.fit.height,
                        })
                      }
                      min={4}
                      step={2}
                      disabled={busy}
                    />
                    <span>&times;</span>
                    <NumberInput
                      value={vid.fit.height ?? H}
                      onChange={(height) =>
                        setFit(vid.name, {
                          ...vid.fit,
                          height,
                          width:
                            vid.fit.lock && nat.height
                              ? even((height * nat.width) / nat.height)
                              : vid.fit.width,
                        })
                      }
                      min={4}
                      step={2}
                      disabled={busy}
                    />
                    <span>px</span>
                    <button
                      className={vid.fit.lock ? "is-active" : ""}
                      disabled={busy}
                      title="Keep the clip's original aspect ratio when editing a dimension"
                      onClick={() => {
                        const lock = !vid.fit.lock;
                        const width = vid.fit.width ?? W;
                        setFit(vid.name, {
                          ...vid.fit,
                          lock,
                          // Snap back to the source ratio when locking.
                          height:
                            lock && nat.width
                              ? even((width * nat.height) / nat.width)
                              : vid.fit.height,
                        });
                      }}
                    >
                      {vid.fit.lock ? "🔒" : "🔓"} ratio
                    </button>
                  </div>
                )}
                <div className="FitCard-caption">
                  {caption(vid)}
                  {stale && " · needs reprocess"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {staleVids.length > 0 && (
        <p className="Rendering-stale">
          <span>
            Output size or fit changed — {staleVids.length} clip
            {staleVids.length > 1 ? "s" : ""} must be reprocessed before
            rendering.
          </span>
          <button disabled={busy} onClick={reprocess}>
            reprocess
          </button>
          {busy && (
            <span>
              {filesProgress.processed} of {filesProgress.total}{" "}
              <progress value={progress} />
            </span>
          )}
        </p>
      )}

      {segments.length === 0 || config === null ? (
        <p>Please add segments in the timeline</p>
      ) : segments.every(
          (s) => vids.find((v) => v.name === s.name)!.chunks.length == 1,
        ) ? (
        <p>
          Can't render when all segments are of length 1, as that would mean
          rendering a sequence of images, which would not produce any glitch
        </p>
      ) : staleVids.length > 0 ? null : (
        <div>
          <button
            onClick={async () => {
              setRendering(true);
              setSrc("");

              // The first clip must always decode from its keyframe (index 0)
              // so there's a real picture on screen. Its `from` is instead used
              // as a trim point: those leading frames get decoded but not
              // recorded (see `trimStart` in record()).
              const trimStart = segments[0].from;
              const chunks = segments.flatMap((s, idx) =>
                Array(s.repeat)
                  .fill(null)
                  .flatMap(() =>
                    clipOutputChunks(
                      vids.find((vid) => vid.name === s.name)!.chunks,
                      s,
                      idx === 0,
                    ),
                  ),
              );
              const mimeType = MediaRecorder.isTypeSupported("video/mp4")
                ? "video/mp4"
                : "video/webm";
              const newSrc = await record(
                chunks,
                config,
                mimeType,
                { width: W, height: H },
                setRenderProgress,
                trimStart,
              );
              setSrc(newSrc);
              setDownloadName(
                `Supermosh_${new Date()
                  .toISOString()
                  .substring(0, 19)
                  .replaceAll(":", "-")}.${
                  mimeType === "video/mp4" ? "mp4" : "webm"
                }`,
              );
              setRendering(false);
            }}
            disabled={rendering || busy}
          >
            render
          </button>
          {rendering && <progress value={renderProgress} />}
        </div>
      )}
      {src && (
        <>
          <p>
            <video
              style={{
                width: "100%",
                maxHeight: "50vh",
              }}
              src={src}
              muted
              loop
              controls
              playsInline
              autoPlay
            />
          </p>
          <p>
            <a download={downloadName} href={src}>
              Download
            </a>
          </p>
        </>
      )}
    </Section>
  );
};
