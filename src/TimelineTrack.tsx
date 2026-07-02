import { Dispatch, SetStateAction, useRef, useState } from "react";

import { RangePreview } from "./RangePreview";
import { clipOutputLength, evalSpeed, MAX_SPEED, MIN_SPEED } from "./speed";
import { SpeedEditor } from "./SpeedEditor";
import { Segment, Vid } from "./types";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// A segment contributes (to - from) frames, looped `repeat` times.
const frameLength = (s: Segment) => (s.to - s.from) * s.repeat;

// Sparkline of a segment's speed curve, drawn over its clip (0-100 viewBox,
// log-scaled like the SpeedEditor so <1x dips are visible).
const speedCurvePoints = (s: Segment) => {
  const span = Math.max(s.to - s.from, 1);
  const logMin = Math.log(MIN_SPEED);
  const logMax = Math.log(MAX_SPEED);
  const N = 48;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const f = s.from + (span * i) / N;
    const sp = clamp(evalSpeed(s.speedKeys, f), MIN_SPEED, MAX_SPEED);
    const y = 100 - ((Math.log(sp) - logMin) / (logMax - logMin)) * 100;
    pts.push(`${(i / N) * 100},${y}`);
  }
  return pts.join(" ");
};

// Non-first clips must skip their keyframe (from >= 1) so they mosh onto the
// previous clip instead of resetting the picture.
const fixFroms = (segments: Segment[]) => {
  segments.forEach((s, i) => {
    if (i > 0 && s.from === 0) s.from = 1;
  });
};

type Drag = {
  index: number;
  edge: "from" | "to";
  startX: number;
  startFrom: number;
  startTo: number;
};

export const TimelineTrack = ({
  segments,
  setSegments,
  vids,
}: {
  segments: Segment[];
  setSegments: Dispatch<SetStateAction<Segment[]>>;
  vids: Vid[];
}) => {
  const [pxPerFrame, setPxPerFrame] = useState(6);
  const [selected, setSelected] = useState(0);
  const dragRef = useRef<null | Drag>(null);

  const getVid = (s: Segment) => vids.find((vid) => vid.name === s.name)!;

  // Cumulative frame offset where each segment starts on the track.
  const offsets: number[] = [];
  const totalFrames = segments.reduce((start, s) => {
    offsets.push(start);
    return start + frameLength(s);
  }, 0);

  const onWheel = (evt: React.WheelEvent) => {
    if (!evt.ctrlKey) return;
    evt.preventDefault();
    // Multiplicative zoom: 1px of drag maps to fewer frames the deeper you
    // zoom, so sensitivity gets finer as you zoom in.
    const factor = evt.deltaY < 0 ? 1.15 : 1 / 1.15;
    setPxPerFrame((p) => clamp(p * factor, 0.5, 60));
  };

  const onHandleDown = (
    evt: React.PointerEvent,
    index: number,
    edge: "from" | "to"
  ) => {
    evt.preventDefault();
    evt.stopPropagation();
    (evt.target as HTMLElement).setPointerCapture(evt.pointerId);
    const s = segments[index];
    dragRef.current = {
      index,
      edge,
      startX: evt.clientX,
      startFrom: s.from,
      startTo: s.to,
    };
    setSelected(index);
  };

  const onPointerMove = (evt: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dFrames = Math.round((evt.clientX - drag.startX) / pxPerFrame);
    setSegments((prev) =>
      prev.map((s, idx) => {
        if (idx !== drag.index) return s;
        if (drag.edge === "from") {
          const min = drag.index === 0 ? 0 : 1;
          return { ...s, from: clamp(drag.startFrom + dFrames, min, s.to - 1) };
        }
        const vid = getVid(s);
        return {
          ...s,
          to: clamp(drag.startTo + dFrames, s.from + 1, vid.chunks.length),
        };
      })
    );
  };

  const onPointerUp = (evt: React.PointerEvent) => {
    if (!dragRef.current) return;
    (evt.target as HTMLElement).releasePointerCapture?.(evt.pointerId);
    dragRef.current = null;
    setSegments((prev) => {
      const next = prev.map((s) => ({ ...s }));
      fixFroms(next);
      return next;
    });
  };

  const selectedSeg = segments[selected];
  const prevSeg = selected > 0 ? segments[selected - 1] : null;

  return (
    <div className="TimelineTrack">
      <div className="TimelineTrack-toolbar">
        <span>Ctrl + scroll to zoom · drag clip edges to trim</span>
        <span>{pxPerFrame.toFixed(1)} px/frame</span>
      </div>

      <div className="TimelineTrack-scroll" onWheel={onWheel}>
        <div
          className="TimelineTrack-lane"
          style={{ width: Math.max(totalFrames * pxPerFrame, 1) }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {segments.map((s, i) => (
            <div
              key={i}
              className={`TimelineTrack-clip${
                i === selected ? " is-selected" : ""
              }`}
              style={{
                left: offsets[i] * pxPerFrame,
                width: frameLength(s) * pxPerFrame,
              }}
              onPointerDown={() => setSelected(i)}
            >
              {s.speedKeys?.length ? (
                <svg
                  className="TimelineTrack-clip-curve"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <polyline points={speedCurvePoints(s)} />
                </svg>
              ) : null}
              <div
                className="TimelineTrack-handle left"
                onPointerDown={(e) => onHandleDown(e, i, "from")}
              />
              <div className="TimelineTrack-clip-body">
                <span className="TimelineTrack-clip-name">
                  {s.name}
                  {s.speedKeys?.length ? (
                    <span className="TimelineTrack-clip-badge">spd</span>
                  ) : null}
                </span>
                <span className="TimelineTrack-clip-meta">
                  {s.from}–{s.to}
                  {s.repeat > 1 ? ` ×${s.repeat}` : ""}
                  {s.speedKeys?.length
                    ? ` → ${clipOutputLength(getVid(s).chunks, s) * s.repeat}f`
                    : ""}
                </span>
              </div>
              <div
                className="TimelineTrack-handle right"
                onPointerDown={(e) => onHandleDown(e, i, "to")}
              />
            </div>
          ))}
        </div>
      </div>

      {prevSeg && selectedSeg && (
        <div className="TimelineTrack-seam">
          <div className="TimelineTrack-seam-side">
            <span>out: {prevSeg.name} @ {prevSeg.to - 1}</span>
            <RangePreview vid={getVid(prevSeg)} i={prevSeg.to - 1} />
          </div>
          <div className="TimelineTrack-seam-arrow">→ mosh →</div>
          <div className="TimelineTrack-seam-side">
            <span>in: {selectedSeg.name} @ {selectedSeg.from}</span>
            <RangePreview vid={getVid(selectedSeg)} i={selectedSeg.from} />
          </div>
        </div>
      )}

      {selectedSeg && (
        <SpeedEditor
          segment={selectedSeg}
          index={selected}
          setSegments={setSegments}
        />
      )}
    </div>
  );
};
