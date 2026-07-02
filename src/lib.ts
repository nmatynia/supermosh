import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { createFile, DataStream, MP4ArrayBuffer, MP4File } from "mp4box";

import { TimedChunk } from "./speed";
import { Settings } from "./types";

export const FPS = 30;

const computeDescription = (file: MP4File, trackId: number) => {
  const track = file.getTrackById(trackId);
  for (const entry of track.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  throw new Error("avcC, hvcC, vpcC, or av1C box not found");
};

export const computeChunks = (
  ffmpeg: FFmpeg,
  inputFile: File,
  name: string,
  width: number,
  height: number,
  onConfig: (config: VideoDecoderConfig) => unknown
) =>
  new Promise<EncodedVideoChunk[]>(async (resolve, reject) => {
    try {
      const inputName = `input_${name}.mp4`;
      const outputName = `output_${name}_${Math.random()
        .toFixed(10)
        .substring(2)}.mp4`;
      await ffmpeg.writeFile(inputName, await fetchFile(inputFile));
      await ffmpeg.exec(
        `-i ${inputName} -vf scale=${width}:${height} -vcodec libx264 -g 99999999 -bf 0 -flags:v +cgop -pix_fmt yuv420p -movflags faststart -crf 15 ${outputName}`.split(
          " "
        )
      );
      const data = (await ffmpeg.readFile(outputName)) as Uint8Array;

      const file = createFile();
      file.onError = console.error;
      file.onReady = (info) => {
        const track = info.videoTracks[0];
        onConfig({
          codec: track.codec.startsWith("vp08") ? "vp8" : track.codec,
          codedHeight: track.video.height,
          codedWidth: track.video.width,
          description: computeDescription(file, track.id),
        });
        file.setExtractionOptions(track.id);
        file.start();
      };
      file.onSamples = async (_trackId, _ref, samples) => {
        const chunks = samples.map(
          (sample) =>
            new EncodedVideoChunk({
              type: sample.is_sync ? "key" : "delta",
              timestamp: (1e6 * sample.cts) / sample.timescale,
              duration: (1e6 * sample.duration) / sample.timescale,
              data: sample.data,
            })
        );

        resolve(chunks);
      };
      const buffer = new ArrayBuffer(data.byteLength) as MP4ArrayBuffer;
      new Uint8Array(buffer).set(data);
      buffer.fileStart = 0;
      file.appendBuffer(buffer);
    } catch (e) {
      reject(e);
    }
  });

export const record = async (
  chunks: TimedChunk[],
  config: VideoDecoderConfig,
  mimeType: string,
  settings: Settings,
  onProgress: (progress: number) => unknown,
  trimStart = 0
) =>
  new Promise<string>((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = settings.width;
    canvas.height = settings.height;
    const ctx = canvas.getContext("2d")!;

    const decoder = new VideoDecoder({
      error: console.error,
      output: (frame) => {
        ctx.drawImage(frame, 0, 0);
        frame.close();
      },
    });
    decoder.configure(config);

    const stream = canvas.captureStream();
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.addEventListener("dataavailable", (evt) => {
      const src = URL.createObjectURL(evt.data);
      resolve(src);
    });

    // Chunks appear once in the stream but timestamps can still collide
    // across segments (each clip keeps its source timestamps), so rewrap
    // every decode with a fresh, strictly increasing timestamp. The encoded
    // data is untouched, and MediaRecorder captures the canvas in wall-clock
    // time so chunk timestamps carry no other meaning here.
    const rewrap = (chunk: EncodedVideoChunk, index: number) => {
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      return new EncodedVideoChunk({
        type: chunk.type,
        timestamp: (index * 1e6) / FPS,
        duration: 1e6 / FPS,
        data,
      });
    };

    const totalFrames = chunks.reduce((sum, tc) => sum + tc.hold, 0);
    let idx = 0; // which chunk
    let held = 0; // output ticks already spent on the current chunk
    let outFrame = 0; // output frame counter
    const interval = setInterval(() => {
      onProgress(outFrame / totalFrames);
      // Frames before the trim point are decoded (to build up the correct
      // picture) but not recorded, so the first clip can start later than 0.
      if (outFrame === trimStart) recorder.start();
      // Decode each chunk exactly once — re-decoding the same coded frame
      // freezes or errors real decoders. Slow-mo (hold > 1) is achieved by
      // leaving the picture on the canvas while the recorder keeps rolling.
      if (held === 0) decoder.decode(rewrap(chunks[idx].chunk, outFrame));
      held++;
      outFrame++;
      if (held >= chunks[idx].hold) {
        idx++;
        held = 0;
      }
      if (idx >= chunks.length) {
        clearInterval(interval);
        // Drain frames still buffered in the decoder before cutting the
        // recording, so the tail of the last clip isn't dropped.
        decoder
          .flush()
          .catch(() => {})
          .finally(() => recorder.stop());
      }
    }, 1000 / FPS);
  });
