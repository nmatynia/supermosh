import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { useEffect, useRef, useState } from "react";

import { FilesEditor } from "./FilesEditor";
import { computeChunks, even, fitFilter } from "./lib";
import { Rendering } from "./Rendering";
import { Timeline } from "./Timeline";
import { Segment, Settings, Vid } from "./types";

export const Studio = () => {
  const [loadingFfmpeg, setLoadingFfmpeg] = useState(true);
  const ffmpegRef = useRef(new FFmpeg());
  const [vids, setVids] = useState<Vid[]>([]);
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [config, setConfig] = useState<VideoDecoderConfig | null>(null);
  const [settings, setSettings] = useState<Settings>({
    width: 640,
    height: 480,
  });
  // While true, the output resolution follows the smallest width/height
  // across uploaded clips; any manual edit switches it off.
  const [autoRes, setAutoRes] = useState(true);
  // Shared between upload (FilesEditor) and reprocess (Rendering) so the two
  // can't run concurrently and both can show progress.
  const [busy, setBusy] = useState(false);
  const [filesProgress, setFilesProgress] = useState({
    processed: 0,
    total: 0,
  });

  // Re-run ffmpeg preprocessing for every clip whose current fit/output
  // settings no longer match what its chunks were built with.
  const reprocess = async () => {
    const target = { width: even(settings.width), height: even(settings.height) };
    setSettings(target);
    const stale = vids.filter(
      (vid) => fitFilter(vid.fit, target, vid) !== vid.processedFilter
    );
    setBusy(true);
    setFilesProgress({ processed: 0, total: stale.length });
    for (const vid of stale) {
      const filter = fitFilter(vid.fit, target, vid);
      vid.chunks = await computeChunks(
        ffmpegRef.current,
        vid.file,
        vid.name,
        filter,
        setConfig
      );
      vid.processedFilter = filter;
      setFilesProgress((prev) => ({
        ...prev,
        processed: prev.processed + 1,
      }));
    }
    setVids([...vids]);
    setBusy(false);
    setFilesProgress({ processed: 0, total: 0 });
  };

  useEffect(() => {
    (async () => {
      ffmpegRef.current.on("progress", (evt) => setProgress(evt.progress));

      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      console.log("loading ffmpeg...");
      await ffmpegRef.current.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript"
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm"
        ),
      });
      setLoadingFfmpeg(false);
      console.log("ffmpeg loaded");
    })();
  }, []);

  return loadingFfmpeg ? (
    <>Loading...</>
  ) : (
    <main className="Studio">
      <FilesEditor
        vids={vids}
        setVids={setVids}
        progress={progress}
        ffmpeg={ffmpegRef.current}
        onConfig={setConfig}
        settings={settings}
        setSettings={setSettings}
        autoRes={autoRes}
        busy={busy}
        setBusy={setBusy}
        filesProgress={filesProgress}
        setFilesProgress={setFilesProgress}
      />
      <Timeline vids={vids} segments={segments} setSegments={setSegments} />
      <Rendering
        vids={vids}
        setVids={setVids}
        segments={segments}
        config={config}
        settings={settings}
        setSettings={setSettings}
        autoRes={autoRes}
        setAutoRes={setAutoRes}
        busy={busy}
        reprocess={reprocess}
        progress={progress}
        filesProgress={filesProgress}
      />
    </main>
  );
};
