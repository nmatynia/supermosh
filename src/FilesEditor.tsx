import { FFmpeg } from "@ffmpeg/ffmpeg";
import { Dispatch, SetStateAction } from "react";

import { Section } from "./components/Section";
import { computeChunks, computeDimensions, even, fitFilter, FPS } from "./lib";
import { Fit, Settings, Vid } from "./types";

export const FilesEditor = ({
  vids,
  setVids,
  ffmpeg,
  progress,
  onConfig,
  settings,
  setSettings,
  autoRes,
  busy,
  setBusy,
  filesProgress,
  setFilesProgress,
}: {
  vids: Vid[];
  setVids: React.Dispatch<React.SetStateAction<Vid[]>>;
  ffmpeg: FFmpeg;
  progress: number;
  onConfig: Dispatch<SetStateAction<VideoDecoderConfig | null>>;
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  autoRes: boolean;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  filesProgress: { processed: number; total: number };
  setFilesProgress: Dispatch<
    SetStateAction<{ processed: number; total: number }>
  >;
}) => (
  <Section name="Files">
    {vids.length === 0 ? (
      <p>No video uploaded yet</p>
    ) : (
      <ul>
        {vids.map((vid) => (
          <li key={vid.name}>
            {vid.name} ({(vid.chunks.length / FPS).toFixed(2)}s,{" "}
            {vid.chunks.length} frames)
          </li>
        ))}
      </ul>
    )}
    <p>
      <span>Upload video:</span>
      <input
        type="file"
        accept="video/*,image/*"
        multiple
        onChange={async (evt) => {
          if (!evt.target.files?.length) return;
          const files = [...evt.target.files];
          setBusy(true);
          setFilesProgress({ processed: 0, total: files.length });

          // Read native dimensions of every file first: the auto output
          // resolution needs all clip sizes before any preprocessing runs.
          const metas: Omit<Vid, "chunks" | "fit" | "processedFilter">[] = [];
          const taken = vids.map((vid) => vid.name);
          for (const file of files) {
            const src = URL.createObjectURL(file);
            const withoutSpaces = file.name.replace(/\s/g, "_");
            let name = withoutSpaces;
            let i = 0;
            while (taken.includes(name)) {
              name = `${withoutSpaces}_${i}`;
              i++;
            }
            taken.push(name);
            const { width, height } = await computeDimensions(file, src);
            metas.push({ file, src, name, width, height });
          }

          let target = settings;
          if (autoRes) {
            const known = [...vids, ...metas].filter((v) => v.width);
            if (known.length) {
              target = {
                width: even(Math.min(...known.map((v) => v.width))),
                height: even(Math.min(...known.map((v) => v.height))),
              };
              setSettings(target);
            }
          }

          for (const meta of metas) {
            const fit: Fit = { mode: "contain" };
            const filter = fitFilter(fit, target, meta);
            const chunks = await computeChunks(
              ffmpeg,
              meta.file,
              meta.name,
              filter,
              onConfig
            );
            setVids((prevVids) => [
              ...prevVids,
              { ...meta, chunks, fit, processedFilter: filter },
            ]);
            setFilesProgress((prev) => ({
              ...prev,
              processed: prev.processed + 1,
            }));
          }
          evt.target.value = "";
          setBusy(false);
          setFilesProgress({ processed: 0, total: 0 });
        }}
        disabled={busy}
      />
    </p>
    {busy && (
      <p>
        <span>
          Processed {filesProgress.processed} of {filesProgress.total} files
        </span>
        <br />
        <progress value={progress} />
      </p>
    )}
  </Section>
);
