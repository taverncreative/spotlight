import {
  ALLOWED_VIDEO_TYPES,
  MAX_VIDEO_BYTES,
  REELS_ASPECT,
  REELS_ASPECT_TOLERANCE,
  REELS_MAX_SECONDS,
  STORY_MAX_SECONDS,
  VIDEO_MAX_SECONDS,
  VIDEO_MIN_SECONDS,
  type PostFormat,
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

// `format` changes the DURATION rule and the wording, and nothing else.
//
// The line between blocking and warning is whose rule it is. Meta enforces a
// 60-second story, so exceeding it blocks: the upload would finish and the
// publish would fail inside a cron hours later. Meta does not enforce 9:16 on a
// story -- it letterboxes instead -- so that warns, on both formats.
//
// A feed post keeps the Reels duration rule as a warning, because the same
// footage may be headed for feed video, which allows longer.
export function checkVideo(
  facts: VideoFacts,
  format: PostFormat = "feed"
): VideoCheck {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const isStory = format === "story";

  if (!ALLOWED_VIDEO_TYPES.includes(facts.type)) {
    blocking.push("Use an MP4 or MOV. Meta refuses other formats.");
  }
  if (facts.bytes > MAX_VIDEO_BYTES) {
    // NAMES THE REASON, because "too large" invites the question "says who" and
    // the answer is not us. Someone staring at a rejected 111 MB video should
    // learn it is a plan limit, not go hunting for a setting to change.
    blocking.push(
      `${megabytes(facts.bytes)} is over the ${megabytes(MAX_VIDEO_BYTES)} limit on Supabase's Free Plan, which cannot be raised without upgrading. Trim it or export it smaller.`
    );
  }
  // A zero or NaN duration means the browser could not decode it, which is a
  // decent proxy for Meta not being able to either.
  if (!Number.isFinite(facts.seconds) || facts.seconds <= 0) {
    blocking.push(
      "Could not read this video. It may be corrupt or an unusual codec."
    );
  } else {
    if (facts.seconds < VIDEO_MIN_SECONDS) {
      blocking.push(
        `${seconds(facts.seconds)} is too short — Meta needs at least ${VIDEO_MIN_SECONDS}s.`
      );
    }
    if (isStory) {
      if (facts.seconds > STORY_MAX_SECONDS) {
        blocking.push(
          `${seconds(facts.seconds)} is too long for a story — the limit is ${STORY_MAX_SECONDS}s.`
        );
      }
    } else if (facts.seconds > VIDEO_MAX_SECONDS) {
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
      // A WARNING ON BOTH PATHS, including stories.
      //
      // This used to block a story, on the reasoning that 9:16 IS the format so
      // there was nowhere else the file could go. That was us overruling Meta:
      // Instagram accepts non-9:16 story video and letterboxes it rather than
      // refusing it, so blocking refused something the platform would have
      // taken. Saying what will happen and letting the operator decide is the
      // honest version.
      //
      // The duration cap above stays blocking, because that one Meta genuinely
      // enforces -- the difference is whether the rule is ours or theirs.
      warnings.push(
        isStory
          ? `${facts.width}x${facts.height} is not 9:16. Instagram will letterbox it in the story.`
          : `${facts.width}x${facts.height} is not 9:16. Reels will crop or pillarbox it.`
      );
    }
    if (facts.height < 960 || facts.width < 540) {
      // Soft, not wrong: Meta accepts it. A warning on both paths, because
      // refusing a story for looking soft would be us overruling Meta.
      warnings.push(
        `${facts.width}x${facts.height} is below the 540x960 minimum, so it will look soft.`
      );
    }
  }

  // THERE IS NO LONGER A "LARGE BUT LEGAL" WARNING. It said a big file would be
  // slow, and before that it said the upload could not resume. Both described a
  // 50-200 MB band that no longer exists: anything over 50 MB is now refused
  // outright, and everything under it uploads in chunks with a progress bar.
  // A warning about a band with nothing in it is noise.

  return { blocking, warnings };
}

export function isVideoType(type: string): boolean {
  return ALLOWED_VIDEO_TYPES.includes(type);
}
