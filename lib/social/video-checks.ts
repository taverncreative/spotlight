import {
  ALLOWED_VIDEO_TYPES,
  LARGE_VIDEO_WARN_BYTES,
  MAX_VIDEO_BYTES,
  REELS_ASPECT,
  REELS_ASPECT_TOLERANCE,
  REELS_MAX_SECONDS,
  VIDEO_MAX_SECONDS,
  VIDEO_MIN_SECONDS,
} from "@/lib/social/schemas";

// What is wrong with a video, decided before it is uploaded.
//
// Pure: it takes numbers a browser has already read off the file and returns
// sentences. No DOM, no network, so the rules are testable and the component
// only has to gather facts and draw the answer.
//
// TWO SEVERITIES, and the split is the point.
//
//   blocking  Meta or the bucket will refuse this, so uploading is a waste of
//             the operator's time and bandwidth.
//   warning   fine for feed video, wrong for a Reel. 3-90 seconds and 9:16 are
//             REELS rules, and feed video -- a later slice -- allows longer and
//             other ratios. Blocking on them would refuse footage that is
//             perfectly valid for where it might be going.
//
// The alternative, letting Meta decide, means the operator finds out after a
// long upload and a publish attempt that fails minutes later inside a cron.

export type VideoFacts = {
  type: string;
  bytes: number;
  seconds: number;
  width: number;
  height: number;
};

export type VideoCheck = {
  blocking: string[];
  warnings: string[];
};

function seconds(value: number): string {
  return value >= 60
    ? `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`
    : `${value.toFixed(1)}s`;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function checkVideo(facts: VideoFacts): VideoCheck {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!ALLOWED_VIDEO_TYPES.includes(facts.type)) {
    blocking.push("Use an MP4 or MOV. Meta refuses other formats.");
  }
  if (facts.bytes > MAX_VIDEO_BYTES) {
    blocking.push(
      `${megabytes(facts.bytes)} is too large — the limit is ${megabytes(MAX_VIDEO_BYTES)}.`
    );
  }
  // A zero or NaN duration means the browser could not decode it, which is a
  // decent proxy for Meta not being able to either.
  if (!Number.isFinite(facts.seconds) || facts.seconds <= 0) {
    blocking.push("Could not read this video. It may be corrupt or an unusual codec.");
  } else {
    if (facts.seconds < VIDEO_MIN_SECONDS) {
      blocking.push(
        `${seconds(facts.seconds)} is too short — Meta needs at least ${VIDEO_MIN_SECONDS}s.`
      );
    }
    if (facts.seconds > VIDEO_MAX_SECONDS) {
      blocking.push(
        `${seconds(facts.seconds)} is too long — the limit is ${seconds(VIDEO_MAX_SECONDS)}.`
      );
    } else if (facts.seconds > REELS_MAX_SECONDS) {
      warnings.push(
        `${seconds(facts.seconds)} is too long for a Reel (90s). It can still go out as feed video.`
      );
    }
  }

  if (facts.width > 0 && facts.height > 0) {
    const ratio = facts.width / facts.height;
    if (Math.abs(ratio - REELS_ASPECT) > REELS_ASPECT_TOLERANCE) {
      warnings.push(
        `${facts.width}x${facts.height} is not 9:16. Reels will crop or pillarbox it.`
      );
    }
    if (facts.height < 960 || facts.width < 540) {
      warnings.push(
        `${facts.width}x${facts.height} is below the 540x960 Reels minimum, so it will look soft.`
      );
    }
  }

  // Last, because it is about the upload rather than the video.
  //
  // IT NO LONGER CLAIMS THE UPLOAD CANNOT RESUME. That was true when every
  // upload was one long request, and it stayed on screen after resumable
  // uploads landed -- where it actively misled a diagnosis, because a stale
  // warning reads as evidence about which code path ran.
  if (facts.bytes > LARGE_VIDEO_WARN_BYTES && facts.bytes <= MAX_VIDEO_BYTES) {
    warnings.push(`${megabytes(facts.bytes)} will take a few minutes to upload.`);
  }

  return { blocking, warnings };
}

export function isVideoType(type: string): boolean {
  return ALLOWED_VIDEO_TYPES.includes(type);
}
