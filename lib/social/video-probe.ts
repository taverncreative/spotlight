import type { VideoFacts } from "@/lib/social/video-checks";

// Reading a video in the browser: its dimensions, its duration, and a still.
//
// BROWSER, NOT SERVER, and that is the whole reason this is cheap. Extracting a
// frame server-side means ffmpeg in a lambda -- a large binary, a cold start and
// a 200 MB upload through a function -- for something a <video> and a <canvas>
// already do locally, before a single byte is sent anywhere.
//
// Every function here revokes its object URL and tears down its element, because
// a leaked one holds the whole decoded file in memory and this runs once per
// selected file.

function withVideo<T>(
  file: File,
  run: (
    video: HTMLVideoElement,
    done: (value: T) => void,
    fail: (reason: Error) => void
  ) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    const done = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (reason: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
    };

    video.addEventListener("error", () =>
      fail(new Error("Could not decode video"))
    );
    // A file the browser cannot read within this is one Meta will struggle with
    // too, and an unbounded wait would hang the uploader on a corrupt file.
    setTimeout(() => fail(new Error("Timed out reading video")), 20_000);

    video.preload = "auto";
    video.muted = true;
    // Required for the frame grab: a cross-origin or unmuted video will not
    // paint to a canvas. Both are moot for a local File, and both are cheap
    // insurance if the source ever changes.
    video.playsInline = true;
    video.src = url;
    run(video, done, fail);
  });
}

export async function readVideoFacts(file: File): Promise<VideoFacts> {
  const { seconds, width, height } = await withVideo<{
    seconds: number;
    width: number;
    height: number;
  }>(file, (video, done) => {
    video.addEventListener("loadedmetadata", () =>
      done({
        seconds: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      })
    );
  }).catch(() => ({ seconds: Number.NaN, width: 0, height: 0 }));

  // A failed read returns NaN rather than throwing, so checkVideo can say
  // "could not read this video" in the same list as every other complaint
  // instead of the uploader needing a separate error path for it.
  return { type: file.type, bytes: file.size, seconds, width, height };
}

// A still from early in the video, as a JPEG blob.
//
// NOT FRAME ZERO. Video very often opens on black or on a fade, and a black
// poster is worse than none -- it looks like a broken image rather than a
// choice. A little way in is almost always representative.
const POSTER_AT_FRACTION = 0.25;
const POSTER_MAX_SECONDS = 1;
const POSTER_QUALITY = 0.82;
// Enough for a calendar tile and a card thumbnail without storing a second copy
// of the video's full resolution.
const POSTER_MAX_EDGE = 1080;

export async function grabPosterFrame(file: File): Promise<Blob | null> {
  try {
    return await withVideo<Blob | null>(file, (video, done, fail) => {
      video.addEventListener("loadedmetadata", () => {
        const at = Number.isFinite(video.duration)
          ? Math.min(POSTER_MAX_SECONDS, video.duration * POSTER_AT_FRACTION)
          : 0;
        video.currentTime = at;
      });

      video.addEventListener("seeked", () => {
        const { videoWidth: w, videoHeight: h } = video;
        if (!w || !h) return fail(new Error("No frame to capture"));

        const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const context = canvas.getContext("2d");
        if (!context) return fail(new Error("No canvas context"));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => done(blob), "image/jpeg", POSTER_QUALITY);
      });
    });
  } catch {
    // A missing poster is a worse-looking list, not a failed upload. The video
    // is the thing being published; refusing it because a thumbnail could not be
    // made would be the tail wagging the dog.
    return null;
  }
}
