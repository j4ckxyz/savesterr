import { describe, expect, test } from "bun:test";
import { parseSongRef } from "../src/api";
import { safeFileName } from "../src/platform";
import { renderPdf } from "../src/render";
import { compareVersions } from "../src/update";
import { guitarTrack, meta } from "./fixture";

describe("parseSongRef", () => {
  test("full URL with track and revision", () => {
    expect(parseSongRef("https://www.songsterr.com/a/wsa/olivia-rodrigo-drop-dead-bass-tab-s4839025t3/r7733574")).toEqual({
      songId: 4839025,
      trackIndex: 3,
      revisionId: 7733574,
    });
  });
  test("URL without track or revision", () => {
    expect(parseSongRef("https://www.songsterr.com/a/wsa/metallica-one-tab-s444")).toEqual({
      songId: 444,
      trackIndex: undefined,
      revisionId: undefined,
    });
  });
  test("bare id", () => expect(parseSongRef("444")).toEqual({ songId: 444 }));
  test("plain search text is not a ref", () => expect(parseSongRef("enter sandman")).toBeNull());
});

describe("safeFileName", () => {
  test("strips characters Windows rejects", () => expect(safeFileName('AC/DC: "Back" <In> Black?')).toBe("AC-DC- -Back- -In- Black-"));
  test("drops trailing dots and spaces", () => expect(safeFileName("Don't Stop Me Now ...Revisited...  ")).toBe("Don't Stop Me Now ...Revisited"));
  test("avoids reserved device names", () => {
    expect(safeFileName("CON")).toBe("_CON");
    expect(safeFileName("nul.txt")).toBe("_nul.txt");
  });
  test("bounds length", () => expect(safeFileName("x".repeat(500), 50)).toHaveLength(50));
  test("never empty", () => expect(safeFileName("...")).toBe("untitled"));
});

describe("compareVersions", () => {
  test("orders numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0", "1.0.1")).toBe(-1);
  });
});

const pageCount = (pdf: Uint8Array) => (new TextDecoder("latin1").decode(pdf).match(/\/Type \/Page\b/g) ?? []).length;
const mediaBox = (pdf: Uint8Array) => new TextDecoder("latin1").decode(pdf).match(/\/MediaBox \[([^\]]+)\]/)?.[1]?.trim();

describe("renderPdf", () => {
  test("renders a multi-page A4 PDF", async () => {
    const pdf = await renderPdf(meta, [{ track: guitarTrack(), title: "Lead" }], { paper: "a4" });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(mediaBox(pdf)).toBe("0 0 595.28 841.89");
  });

  test("supports US Letter", async () => {
    const pdf = await renderPdf(meta, [{ track: guitarTrack(4), title: "Lead" }], { paper: "letter" });
    expect(mediaBox(pdf)).toBe("0 0 612 792");
  });

  test("combines tracks, each starting on a new page", async () => {
    const one = await renderPdf(meta, [{ track: guitarTrack(4), title: "Lead" }]);
    const two = await renderPdf(meta, [
      { track: guitarTrack(4), title: "Lead" },
      { track: guitarTrack(4), title: "Rhythm" },
    ]);
    expect(pageCount(two)).toBe(pageCount(one) * 2);
    expect(new TextDecoder("latin1").decode(two)).toContain("/Outlines");
  });

  test("handles an empty track", async () => {
    const pdf = await renderPdf(meta, [{ track: { ...guitarTrack(0), measures: [] }, title: "Empty" }]);
    expect(pageCount(pdf)).toBe(1);
  });
});
