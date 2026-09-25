import { describe, expect, it } from "vitest";
import type { DriveFile } from "../web/src/types";
import { baseName, formatTime, isBrowserPlayable, pickSubtitle, resumeAt } from "../web/src/media";

const file = (name: string, over: Partial<DriveFile> = {}): DriveFile =>
  ({ id: name, name, mimeType: "application/octet-stream", ...over }) as DriveFile;

describe("isBrowserPlayable", () => {
  it("accepts the containers browsers can decode", () => {
    expect(isBrowserPlayable("film.mp4")).toBe(true);
    expect(isBrowserPlayable("clip.webm")).toBe(true);
    expect(isBrowserPlayable("phone.mov")).toBe(true);
    expect(isBrowserPlayable("song.mp3")).toBe(true);
  });

  it("rejects containers no browser decodes", () => {
    expect(isBrowserPlayable("film.mkv")).toBe(false);
    expect(isBrowserPlayable("clip.avi")).toBe(false);
    expect(isBrowserPlayable("raw.wmv")).toBe(false);
  });

  it("rejects unknown extensions so a broken player never shows", () => {
    expect(isBrowserPlayable("archive.tar.gz")).toBe(false);
  });
});

describe("baseName", () => {
  it("drops the extension but keeps the rest of the name", () => {
    expect(baseName("Shutter.Island.2010.1080p.mkv")).toBe("Shutter.Island.2010.1080p");
    expect(baseName("index_1072x1920.mp4")).toBe("index_1072x1920");
    expect(baseName("noext")).toBe("noext");
  });
});

describe("pickSubtitle", () => {
  const siblings = [
    file("index_1072x1920.mp4", { mimeType: "video/mp4" }),
    file("index_1072x1920.srt", { mimeType: "application/x-subrip" }),
    file("index_1072x1920.id.vtt", { mimeType: "text/vtt" }),
    file("other.srt", { mimeType: "application/x-subrip" }),
  ];

  it("prefers vtt over srt for the same base name", () => {
    expect(pickSubtitle(siblings, "index_1072x1920.mp4")?.name).toBe("index_1072x1920.id.vtt");
  });

  it("falls back to srt when no vtt exists", () => {
    const onlySrt = [siblings[0], siblings[1]];
    expect(pickSubtitle(onlySrt, "index_1072x1920.mp4")?.name).toBe("index_1072x1920.srt");
  });

  it("ignores subtitles that do not match the video", () => {
    expect(pickSubtitle(siblings, "unrelated.mp4")).toBeNull();
  });

  it("matches on the base name, not the whole file name", () => {
    const list = [file("Movie.2020.mp4", { mimeType: "video/mp4" }), file("Movie.2020.srt")];
    expect(pickSubtitle(list, "Movie.2020.mp4")?.name).toBe("Movie.2020.srt");
  });
});

describe("formatTime", () => {
  it("renders minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(3671)).toBe("1:01:11");
  });

  it("keeps negatives and junk out of the UI", () => {
    expect(formatTime(-5)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });
});

describe("resumeAt", () => {
  it("offers a resume point only past 30 seconds", () => {
    expect(resumeAt(10)).toBe(0);
    expect(resumeAt(30)).toBe(0);
    expect(resumeAt(45)).toBe(45);
  });

  it("ignores a stored point past the end of the video", () => {
    expect(resumeAt(Number.NaN)).toBe(0);
  });
});
