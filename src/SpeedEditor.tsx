import {
  Dispatch,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { EASES, evalSpeed, MAX_SPEED, MIN_SPEED } from "./speed";
import { Ease, Segment, SpeedKey } from "./types";

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

const H = 180;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 22;

// Log-scale value axis: slowing below 1x is where the mosh-stretch lives, so
// it gets as much vertical room as the speed-up half instead of being squashed
// into the bottom sliver of a linear scale.
const LOG_MIN = Math.log(MIN_SPEED);
const LOG_MAX = Math.log(MAX_SPEED);
const GRID_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
const SNAP_PX = 6;

const fmtSpeed = (s: number) => `${Math.round(s * 100) / 100}×`;

// Smallest of 1/2/5 × 10^n that is >= raw — keeps frame ruler labels readable
// at any zoom.
const niceStep = (raw: number) => {
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
};

export const SpeedEditor = ({
  segment,
  index,
  setSegments,
}: {
  segment: Segment;
  index: number;
  setSegments: Dispatch<SetStateAction<Segment[]>>;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<null | { frame: number; speed: number }>(
    null
  );

  // Track the rendered width so graph coordinates are 1:1 with screen pixels —
  // no viewBox stretching, so keyframe dots stay round.
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(() =>
      setWidth(el.getBoundingClientRect().width)
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(width, 240);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const { from, to } = segment;
  const span = Math.max(to - from, 1);
  const keys = segment.speedKeys ?? [];

  const fx = (f: number) => PAD_L + ((f - from) / span) * plotW;
  const fy = (speed: number) =>
    PAD_T +
    (1 -
      (Math.log(clamp(speed, MIN_SPEED, MAX_SPEED)) - LOG_MIN) /
        (LOG_MAX - LOG_MIN)) *
      plotH;

  // Write keys back sorted; empty => undefined (constant 1x).
  const commit = (next: SpeedKey[]) => {
    const sorted = [...next].sort((a, b) => a.frame - b.frame);
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === index
          ? { ...seg, speedKeys: sorted.length ? sorted : undefined }
          : seg
      )
    );
  };

  const toGraph = (clientX: number, clientY: number, snap: boolean) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    const frame = clamp(
      Math.round(from + ((x - PAD_L) / plotW) * span),
      from,
      to
    );
    let speed = clamp(
      Math.exp(LOG_MIN + (1 - (y - PAD_T) / plotH) * (LOG_MAX - LOG_MIN)),
      MIN_SPEED,
      MAX_SPEED
    );
    if (snap)
      for (const g of GRID_SPEEDS)
        if (Math.abs(fy(g) - y) < SNAP_PX) speed = g;
    return { frame, speed: Math.round(speed * 100) / 100 };
  };

  // Frame range a key can move in without crossing its neighbours, so the
  // sort order (and this index) stays put.
  const frameBounds = (i: number) => ({
    lo: i > 0 ? keys[i - 1].frame + 1 : from,
    hi: i < keys.length - 1 ? keys[i + 1].frame - 1 : to,
  });

  const onPointerMove = (evt: React.PointerEvent) => {
    const i = dragRef.current;
    const { frame, speed } = toGraph(evt.clientX, evt.clientY, !evt.altKey);
    if (i === null) {
      setHover({ frame, speed });
      return;
    }
    const { lo, hi } = frameBounds(i);
    // Shift locks the frame so only the speed changes.
    const f = evt.shiftKey ? keys[i].frame : clamp(frame, lo, hi);
    commit(keys.map((k, j) => (j === i ? { ...k, frame: f, speed } : k)));
    setHover({ frame: f, speed });
  };

  const endDrag = (evt: React.PointerEvent) => {
    if (dragRef.current === null) return;
    (evt.target as Element).releasePointerCapture?.(evt.pointerId);
    dragRef.current = null;
  };

  // Click on empty graph: add a keyframe there and immediately start dragging
  // it, one gesture. New keys inherit the ease of the key to their left.
  const onBackgroundDown = (evt: React.PointerEvent) => {
    if (evt.button !== 0) return;
    evt.preventDefault();
    const { frame, speed } = toGraph(evt.clientX, evt.clientY, !evt.altKey);
    const left = keys.filter((k) => k.frame <= frame).pop();
    const newKey: SpeedKey = { frame, speed, ease: left?.ease ?? "linear" };
    const next = [...keys, newKey].sort((a, b) => a.frame - b.frame);
    commit(next);
    const i = next.indexOf(newKey);
    setSelected(i);
    dragRef.current = i;
    (evt.currentTarget as Element).setPointerCapture(evt.pointerId);
  };

  const deleteKey = (i: number) => {
    commit(keys.filter((_, j) => j !== i));
    setSelected(null);
  };

  const onKeyDown = (evt: React.KeyboardEvent) => {
    if (selected === null || !keys[selected]) return;
    const k = keys[selected];
    const { lo, hi } = frameBounds(selected);
    const dF = evt.shiftKey ? 10 : 1;
    const dS = evt.shiftKey ? 1.25 : 1.05;
    let next: SpeedKey | null = null;
    if (evt.key === "Delete" || evt.key === "Backspace") {
      deleteKey(selected);
    } else if (evt.key === "ArrowLeft") {
      next = { ...k, frame: clamp(k.frame - dF, lo, hi) };
    } else if (evt.key === "ArrowRight") {
      next = { ...k, frame: clamp(k.frame + dF, lo, hi) };
    } else if (evt.key === "ArrowUp") {
      next = {
        ...k,
        speed:
          Math.round(clamp(k.speed * dS, MIN_SPEED, MAX_SPEED) * 100) / 100,
      };
    } else if (evt.key === "ArrowDown") {
      next = {
        ...k,
        speed:
          Math.round(clamp(k.speed / dS, MIN_SPEED, MAX_SPEED) * 100) / 100,
      };
    } else {
      return;
    }
    evt.preventDefault();
    if (next) commit(keys.map((key, j) => (j === selected ? next! : key)));
  };

  // Curve sampled per source frame across the clip.
  const samples: string[] = [];
  for (let f = from; f <= to; f++) {
    samples.push(`${fx(f)},${fy(evalSpeed(keys, f))}`);
  }
  const fillPoints = [
    ...samples,
    `${PAD_L + plotW},${PAD_T + plotH}`,
    `${PAD_L},${PAD_T + plotH}`,
  ].join(" ");

  const frameStep = niceStep(
    Math.max(1, Math.ceil(span / Math.max(2, plotW / 70)))
  );
  const frameTicks: number[] = [];
  for (let f = Math.ceil(from / frameStep) * frameStep; f <= to; f += frameStep)
    frameTicks.push(f);

  const sel = selected !== null ? keys[selected] : null;

  return (
    <div className="SpeedEditor">
      <div className="SpeedEditor-head">
        <strong>Speed remap</strong>
        <span>
          click + drag to add · double-click a point to delete · Shift locks
          frame · Alt = no snap · arrow keys nudge
        </span>
        {keys.length > 0 && (
          <button
            onClick={() => {
              commit([]);
              setSelected(null);
            }}
          >
            reset to 1×
          </button>
        )}
      </div>

      <svg
        ref={svgRef}
        className="SpeedEditor-svg"
        viewBox={`0 0 ${W} ${H}`}
        tabIndex={0}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        {/* frame ruler */}
        {frameTicks.map((f) => (
          <g key={f}>
            <line
              x1={fx(f)}
              x2={fx(f)}
              y1={PAD_T}
              y2={PAD_T + plotH}
              className="SpeedEditor-tick"
            />
            <text x={fx(f)} y={H - 7} className="SpeedEditor-ticklabel">
              {f}
            </text>
          </g>
        ))}

        {/* speed gridlines, log-spaced so <1x gets real room */}
        {GRID_SPEEDS.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={fy(v)}
              y2={fy(v)}
              className={v === 1 ? "SpeedEditor-base" : "SpeedEditor-grid"}
            />
            <text
              x={PAD_L - 6}
              y={fy(v) + 3}
              textAnchor="end"
              className="SpeedEditor-axis"
            >
              {fmtSpeed(v)}
            </text>
          </g>
        ))}

        <text
          x={W - PAD_R - 4}
          y={PAD_T + 10}
          className="SpeedEditor-zone"
        >
          faster · skips frames
        </text>
        <text
          x={W - PAD_R - 4}
          y={PAD_T + plotH - 5}
          className="SpeedEditor-zone"
        >
          slower · holds frames
        </text>

        <polygon className="SpeedEditor-fill" points={fillPoints} />
        <polyline className="SpeedEditor-curve" points={samples.join(" ")} />

        {/* hover / drag crosshair + readout */}
        {hover && (
          <g pointerEvents="none">
            <line
              x1={fx(hover.frame)}
              x2={fx(hover.frame)}
              y1={PAD_T}
              y2={PAD_T + plotH}
              className="SpeedEditor-hoverline"
            />
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={fy(hover.speed)}
              y2={fy(hover.speed)}
              className="SpeedEditor-hoverline"
            />
            <text
              x={clamp(fx(hover.frame) + 10, PAD_L, W - PAD_R - 80)}
              y={clamp(fy(hover.speed) - 10, PAD_T + 10, PAD_T + plotH - 4)}
              className="SpeedEditor-readout"
            >
              {hover.frame} · {fmtSpeed(hover.speed)}
            </text>
          </g>
        )}

        {keys.map((k, i) => (
          <g key={i}>
            {/* oversized invisible hit area so points are easy to grab */}
            <circle
              cx={fx(k.frame)}
              cy={fy(k.speed)}
              r={11}
              className="SpeedEditor-hit"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setSelected(i);
                dragRef.current = i;
                (e.target as Element).setPointerCapture(e.pointerId);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                deleteKey(i);
              }}
            />
            <circle
              cx={fx(k.frame)}
              cy={fy(k.speed)}
              r={i === selected ? 6 : 5}
              className={`SpeedEditor-dot${
                i === selected ? " is-selected" : ""
              }`}
            />
          </g>
        ))}
      </svg>

      {sel ? (
        <div className="SpeedEditor-controls">
          <label>
            frame
            <input
              type="number"
              min={from}
              max={to}
              value={sel.frame}
              onChange={(e) => {
                const { lo, hi } = frameBounds(selected!);
                const frame = clamp(parseInt(e.target.value) || from, lo, hi);
                commit(
                  keys.map((k, j) => (j === selected ? { ...k, frame } : k))
                );
              }}
            />
          </label>
          <label>
            speed
            <input
              type="number"
              step={0.05}
              min={MIN_SPEED}
              max={MAX_SPEED}
              value={sel.speed}
              onChange={(e) => {
                const speed = clamp(
                  parseFloat(e.target.value) || 1,
                  MIN_SPEED,
                  MAX_SPEED
                );
                commit(
                  keys.map((k, j) => (j === selected ? { ...k, speed } : k))
                );
              }}
            />
          </label>
          <label>
            ease
            <select
              value={sel.ease}
              onChange={(e) =>
                commit(
                  keys.map((k, j) =>
                    j === selected ? { ...k, ease: e.target.value as Ease } : k
                  )
                )
              }
            >
              {EASES.map((ease) => (
                <option key={ease}>{ease}</option>
              ))}
            </select>
          </label>
          <button onClick={() => deleteKey(selected!)}>delete keyframe</button>
        </div>
      ) : (
        <div className="SpeedEditor-controls">
          <span>No keyframe selected — click the graph to add one.</span>
        </div>
      )}
    </div>
  );
};
