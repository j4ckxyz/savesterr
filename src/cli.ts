#!/usr/bin/env bun
import { parseArgs } from "util";
import { mkdir } from "fs/promises";
import { join, resolve } from "path";
import * as p from "@clack/prompts";
import { fetchMeta, fetchTrack, parseSongRef, searchSongs, type SearchResult, type SongRef } from "./api";
import { renderTrackPdf } from "./render";
import type { SongMeta, TrackMeta } from "./types";

const USAGE = `songsterr-pdf — save Songsterr tabs as PDFs, one file per track

Usage:
  songsterr-pdf                                 Interactive: search, pick a song and tracks
  songsterr-pdf "search terms"                  Search, then pick interactively
  songsterr-pdf <songsterr-url | song-id>       Go straight to a song

Options:
  -t, --tracks <sel>   Skip the track picker: guitar, bass, all (no drums/vocals), or indices e.g. 0,2
  -o, --out <dir>      Output directory (default: ./tabs/<Artist - Title>)
  -r, --revision <id>  Specific revision (defaults to the one in the URL, else latest)
  -l, --list           List the song's tracks and exit
  -y, --yes            Non-interactive: take the top search result and guitar tracks
      --no-open        Don't open the PDFs when done
  -h, --help           Show this help

Examples:
  songsterr-pdf
  songsterr-pdf "enter sandman"
  songsterr-pdf https://www.songsterr.com/a/wsa/metallica-one-tab-s444 -t 5,6`;

function sanitize(s: string): string {
  return s.replace(/[/\\?%*:|"<>\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim();
}

function trackTitle(t: TrackMeta): string {
  return t.title ?? ([t.name, t.instrument].filter(Boolean).join(" - ") || t.instrument);
}

// The API's track objects only encode their kind in the hash prefix
// (guitar_, bass_, drums_, vocals_, other_); instrumentId 1024 is drums.
function kind(t: TrackMeta): string {
  const prefix = t.hash?.split("_")[0];
  if (t.instrumentId === 1024 || prefix === "drums") return "drums";
  if (t.isVocalTrack || prefix === "vocals") return "vocals";
  return prefix || "other";
}

function renderable(t: TrackMeta): boolean {
  return !["drums", "vocals"].includes(kind(t)) && !t.isEmpty && !!t.tuning?.length;
}

function selectTracks(meta: SongMeta, sel: string): number[] {
  const idx = meta.tracks.map((t, i) => ({ t, i }));
  switch (sel) {
    case "guitar":
    case "bass":
      return idx.filter(({ t }) => kind(t) === sel && renderable(t)).map(({ i }) => i);
    case "all":
      return idx.filter(({ t }) => renderable(t)).map(({ i }) => i);
    default: {
      const picked = sel.split(",").map((s) => Number(s.trim()));
      for (const i of picked) {
        if (!Number.isInteger(i) || !meta.tracks[i]) throw new Error(`No track with index ${i} (use --list)`);
        if (kind(meta.tracks[i]!) === "drums") throw new Error(`Track ${i} is drums, which can't be rendered as tab`);
      }
      return picked;
    }
  }
}

function openFile(file: string) {
  const cmd =
    process.platform === "darwin"
      ? ["open", file]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", file]
        : ["xdg-open", file];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
}

/** Exits cleanly when the user presses Ctrl-C / Esc in a prompt. */
function unwrap<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

function songHint(s: SearchResult): string {
  const counts = new Map<string, number>();
  for (const t of s.tracks ?? []) counts.set(kind(t), (counts.get(kind(t)) ?? 0) + 1);
  return ["guitar", "bass"]
    .filter((k) => counts.get(k))
    .map((k) => `${counts.get(k)} ${k}`)
    .join(" · ");
}

async function pickSong(initialQuery?: string): Promise<SongRef> {
  let query = initialQuery;
  for (;;) {
    query ??= unwrap(
      await p.text({
        message: "Search Songsterr",
        placeholder: "artist or song title",
        validate: (v) => (v?.trim() ? undefined : "Type something to search for"),
      }),
    ).trim();

    const s = p.spinner();
    s.start(`Searching for "${query}"`);
    const results = await searchSongs(query);
    s.stop(results.length ? `${results.length} results for "${query}"` : `No results for "${query}"`);

    if (results.length) {
      const choice = unwrap(
        await p.select<number>({
          message: "Pick a song",
          options: [
            ...results.map((r) => ({ value: r.songId, label: `${r.artist} – ${r.title}`, hint: songHint(r) })),
            { value: -1, label: "↻ Search again" },
          ],
          maxItems: 12,
        }),
      );
      if (choice !== -1) return { songId: choice };
    }
    query = undefined;
  }
}

async function pickTracks(meta: SongMeta, preselect?: number): Promise<number[]> {
  const options = meta.tracks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => renderable(t))
    .map(({ t, i }) => ({ value: i, label: trackTitle(t), hint: kind(t) }));
  if (!options.length) throw new Error("This song has no tracks that can be rendered as tab");

  let initial = preselect !== undefined && renderable(meta.tracks[preselect]!) ? [preselect] : [];
  if (!initial.length) initial = options.filter((o) => o.hint === "guitar").map((o) => o.value);

  return unwrap(
    await p.multiselect<number>({
      message: "Which tracks? (space to toggle, enter to confirm)",
      options,
      initialValues: initial,
      required: true,
    }),
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      tracks: { type: "string", short: "t" },
      out: { type: "string", short: "o" },
      revision: { type: "string", short: "r" },
      list: { type: "boolean", short: "l" },
      yes: { type: "boolean", short: "y" },
      "no-open": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const interactive = !values.yes && !!process.stdin.isTTY && !!process.stdout.isTTY;
  const input = positionals.join(" ").trim();
  const direct = input ? parseSongRef(input) : null;

  if (!input && !interactive) {
    console.log(USAGE);
    process.exit(1);
  }
  if (interactive) p.intro(" songsterr-pdf ");

  // 1. Resolve the song.
  let ref: SongRef;
  if (direct) ref = direct;
  else if (interactive) ref = await pickSong(input || undefined);
  else {
    const [hit] = await searchSongs(input, 1);
    if (!hit) throw new Error(`No songs found for "${input}"`);
    ref = { songId: hit.songId };
  }

  const revisionId = values.revision ? Number(values.revision) : ref.revisionId;
  const meta = await fetchMeta(ref.songId, revisionId);
  const heading = `${meta.artist} – ${meta.title} (song ${meta.songId}, revision ${meta.revisionId})`;

  if (values.list) {
    console.log(heading);
    meta.tracks.forEach((t, i) => console.log(`  [${String(i).padStart(2)}] ${kind(t).padEnd(6)}  ${trackTitle(t)}`));
    return;
  }

  // 2. Choose tracks.
  let indices: number[];
  if (values.tracks) indices = selectTracks(meta, values.tracks);
  else if (interactive) {
    p.log.info(heading);
    indices = await pickTracks(meta, ref.trackIndex);
  } else indices = selectTracks(meta, "guitar");

  if (!indices.length) {
    const msg = `No matching tracks in this song. Use --list to see tracks, then --tracks <indices>.`;
    if (interactive) p.cancel(msg);
    else console.error(msg);
    process.exit(1);
  }

  // 3. Render.
  const outDir = values.out ?? join("tabs", sanitize(`${meta.artist} - ${meta.title}`));
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];
  const spin = interactive ? p.spinner() : null;

  for (const [n, i] of indices.entries()) {
    const title = trackTitle(meta.tracks[i]!);
    spin?.start(`[${n + 1}/${indices.length}] ${title}`);
    const track = await fetchTrack(meta, i);
    const pdf = await renderTrackPdf(meta, track, title);
    const file = join(outDir, sanitize(`${meta.artist} - ${meta.title} - ${String(i).padStart(2, "0")} ${title}.pdf`));
    await Bun.write(file, pdf);
    files.push(resolve(file));
    if (spin) spin.stop(`Saved ${file}`);
    else console.log(`  ✓ ${file}`);
  }

  // 4. Open in the system PDF viewer.
  if (!values["no-open"]) for (const f of files) openFile(f);
  const done = `${files.length} PDF${files.length === 1 ? "" : "s"} in ${resolve(outDir)}${values["no-open"] ? "" : " — opening…"}`;
  if (interactive) p.outro(done);
  else console.log(done);
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
