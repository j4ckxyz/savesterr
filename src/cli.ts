#!/usr/bin/env bun
import { parseArgs } from "util";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
import * as p from "@clack/prompts";
import { fetchMeta, fetchTrack, parseSongRef, searchSongs, type SearchResult, type SongRef } from "./api";
import { loadSettings, saveSettings, settingsPath, type AfterDownload, type Paper, type Settings } from "./config";
import { openPath, safeFileName, tildify } from "./platform";
import { renderPdf } from "./render";
import type { SongMeta, TrackMeta } from "./types";
import { buildTarget, checkForUpdate, cleanupAfterUpdate, isCompiled, selfUpdate, VERSION } from "./update";

const USAGE = `savesterr ${VERSION} — save Songsterr tabs as PDFs

Usage:
  savesterr                         Start the app: search, pick tracks, save PDFs
  savesterr "enter sandman"         Start with a search
  savesterr <songsterr-link>        Go straight to a song
  savesterr update                  Update to the latest version
  savesterr settings                Change the save folder, paper size and more

Options:
  -t, --tracks <which>   guitar, bass, all, or track numbers like 0,2 (skips the track picker)
  -o, --out <folder>     Save into this folder instead of the one in settings
      --paper <size>     a4 or letter
      --combine          Put all selected tracks in one PDF
      --no-open          Don't open anything when done
  -r, --revision <id>    Download an older revision of the tab
  -l, --list             List a song's tracks and exit
  -y, --yes              No questions: top search result, guitar tracks
  -v, --version          Print the version
  -h, --help             Show this help

Examples:
  savesterr
  savesterr "paranoid black sabbath" -y
  savesterr https://www.songsterr.com/a/wsa/metallica-one-tab-s444 -t 5,6 --combine`;

// ─── Track helpers ──────────────────────────────────────────────────────────

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
        if (!Number.isInteger(i) || !meta.tracks[i]) throw new Error(`There's no track ${i} — run with --list to see them`);
        if (kind(meta.tracks[i]!) === "drums") throw new Error(`Track ${i} is drums, which can't be written as tab`);
      }
      return picked;
    }
  }
}

function songHint(s: SearchResult): string {
  const counts = new Map<string, number>();
  for (const t of s.tracks ?? []) counts.set(kind(t), (counts.get(kind(t)) ?? 0) + 1);
  const parts = ["guitar", "bass"].filter((k) => counts.get(k)).map((k) => `${counts.get(k)} ${k}`);
  return parts.length ? parts.join(" · ") : "no guitar/bass";
}

function looksLikeLink(s: string): boolean {
  return /songsterr\.com/i.test(s) || /-s\d+(t\d+)?\b/.test(s);
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(1)) : path;
}

/** Exits cleanly when the user presses Ctrl-C / Esc in a prompt. */
function unwrap<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Bye!");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ─── Core: download + render ────────────────────────────────────────────────

interface DownloadOptions {
  outDir: string;
  paper: Paper;
  combine: boolean;
  onProgress?: (msg: string) => void;
}

async function downloadTracks(meta: SongMeta, indices: number[], o: DownloadOptions): Promise<string[]> {
  await mkdir(o.outDir, { recursive: true });
  let fetched = 0;
  const parts = await mapLimit(indices, 4, async (i) => {
    const track = await fetchTrack(meta, i);
    o.onProgress?.(`Downloading tracks (${++fetched}/${indices.length})`);
    return { index: i, track, title: trackTitle(meta.tracks[i]!) };
  });

  const song = safeFileName(meta.title, 60);
  if (o.combine && parts.length > 1) {
    o.onProgress?.("Drawing tab");
    const file = join(o.outDir, `${song} - ${parts.length} tracks.pdf`);
    await Bun.write(file, await renderPdf(meta, parts, { paper: o.paper }));
    return [resolve(file)];
  }

  const files: string[] = [];
  for (const [n, part] of parts.entries()) {
    o.onProgress?.(`Drawing tab (${n + 1}/${parts.length})`);
    const name = `${song} - ${String(part.index).padStart(2, "0")} ${safeFileName(part.title, 80)}.pdf`;
    const file = join(o.outDir, name);
    await Bun.write(file, await renderPdf(meta, [part], { paper: o.paper }));
    files.push(resolve(file));
  }
  return files;
}

function songFolder(settings: Settings, meta: SongMeta, outOverride?: string): string {
  return outOverride ? resolve(expandHome(outOverride)) : join(expandHome(settings.outputDir), safeFileName(`${meta.artist} - ${meta.title}`));
}

/** Open what the user asked for; many files → just the folder. */
function openResults(files: string[], folder: string, how: AfterDownload): string {
  if (how === "nothing" || !files.length) return "";
  if (how === "folder" || files.length > 4) return openPath(folder) ? "Opened the folder." : "";
  return files.every((f) => openPath(f)) ? `Opened ${files.length === 1 ? "the PDF" : "the PDFs"}.` : "";
}

// ─── Interactive pieces ─────────────────────────────────────────────────────

async function pickSong(initialQuery?: string): Promise<SongRef> {
  let query = initialQuery;
  for (;;) {
    query ??= unwrap(
      await p.text({
        message: "Search for a song, or paste a Songsterr link",
        placeholder: "e.g. enter sandman",
        validate: (v) => (v?.trim() ? undefined : "Type an artist or song name"),
      }),
    ).trim();

    if (looksLikeLink(query)) {
      const ref = parseSongRef(query);
      if (ref) return ref;
      p.log.warn("That doesn't look like a Songsterr tab link.");
      query = undefined;
      continue;
    }

    const s = p.spinner();
    s.start(`Searching for "${query}"`);
    let results: SearchResult[];
    try {
      results = await searchSongs(query);
    } catch (e) {
      s.error("Search failed");
      p.log.error(`${e instanceof Error ? e.message : e}. Check your internet connection.`);
      query = undefined;
      continue;
    }
    s.stop(results.length ? `Found ${results.length} songs` : `Nothing found for "${query}" — try fewer words`);

    if (results.length) {
      const choice = unwrap(
        await p.select<number>({
          message: "Pick a song",
          options: [
            ...results.map((r) => ({ value: r.songId, label: `${r.artist} – ${r.title}`, hint: songHint(r) })),
            { value: -1, label: "↩ Search for something else" },
          ],
          maxItems: 12,
        }),
      );
      if (choice !== -1) return { songId: choice };
    }
    query = undefined;
  }
}

async function pickTracks(meta: SongMeta, preselect?: number): Promise<number[] | null> {
  const options = meta.tracks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => renderable(t))
    .map(({ t, i }) => ({ value: i, label: trackTitle(t), hint: kind(t) }));
  if (!options.length) {
    p.log.warn("This song has no guitar or bass parts that can be written as tab.");
    return null;
  }

  let initial = preselect !== undefined && meta.tracks[preselect] && renderable(meta.tracks[preselect]!) ? [preselect] : [];
  if (!initial.length) initial = options.filter((o) => o.hint === "guitar").map((o) => o.value);
  if (!initial.length) initial = [options[0]!.value];

  return unwrap(
    await p.multiselect<number>({
      message: "Which parts do you want?  (space = select, enter = download)",
      options,
      initialValues: initial,
      required: true,
    }),
  );
}

async function editSettings(settings: Settings): Promise<Settings> {
  const s = { ...settings };
  for (;;) {
    const choice = unwrap(
      await p.select<keyof Settings | "done">({
        message: "Settings",
        options: [
          { value: "outputDir", label: "Save folder", hint: tildify(expandHome(s.outputDir)) },
          { value: "paper", label: "Paper size", hint: s.paper === "a4" ? "A4" : "US Letter" },
          {
            value: "afterDownload",
            label: "When done",
            hint: { files: "open the PDFs", folder: "open the folder", nothing: "do nothing" }[s.afterDownload],
          },
          { value: "combine", label: "Multiple parts", hint: s.combine ? "one combined PDF" : "one PDF per part" },
          { value: "checkForUpdates", label: "Check for updates", hint: s.checkForUpdates ? "daily" : "off" },
          { value: "done", label: "✓ Done" },
        ],
      }),
    );
    if (choice === "done") break;
    if (choice === "outputDir")
      s.outputDir = unwrap(
        await p.text({
          message: "Save tabs in which folder? (each song gets its own subfolder)",
          initialValue: tildify(expandHome(s.outputDir)),
          validate: (v) => (v?.trim() ? undefined : "Enter a folder path"),
        }),
      ).trim();
    if (choice === "paper")
      s.paper = unwrap(
        await p.select<Paper>({
          message: "Paper size",
          initialValue: s.paper,
          options: [
            { value: "a4", label: "A4", hint: "most of the world" },
            { value: "letter", label: "US Letter", hint: "US, Canada, parts of Latin America" },
          ],
        }),
      );
    if (choice === "afterDownload")
      s.afterDownload = unwrap(
        await p.select<AfterDownload>({
          message: "After saving",
          initialValue: s.afterDownload,
          options: [
            { value: "files", label: "Open the PDFs" },
            { value: "folder", label: "Open the folder" },
            { value: "nothing", label: "Do nothing" },
          ],
        }),
      );
    if (choice === "combine")
      s.combine = unwrap(
        await p.select<boolean>({
          message: "When you pick several parts",
          initialValue: s.combine,
          options: [
            { value: false, label: "Save one PDF per part" },
            { value: true, label: "Combine them into one PDF", hint: "with a bookmark per part" },
          ],
        }),
      );
    if (choice === "checkForUpdates")
      s.checkForUpdates = unwrap(await p.confirm({ message: "Check for new versions once a day?", initialValue: s.checkForUpdates }));
  }
  await saveSettings(s);
  p.log.success(`Settings saved to ${tildify(settingsPath())}`);
  return s;
}

async function runUpdate(interactive: boolean): Promise<boolean> {
  const s = interactive ? p.spinner() : null;
  s?.start("Checking for updates");
  try {
    const result = await selfUpdate((msg) => (s ? s.message(msg) : console.log(msg)));
    const msg = result.updated
      ? `Updated v${result.from} → v${result.to}. Restart savesterr to use it.`
      : `You're on the latest version (v${result.version}).`;
    s ? s.stop(msg) : console.log(msg);
    return result.updated;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s ? s.error(msg) : console.error(`Error: ${msg}`);
    if (!interactive) process.exit(1);
    return false;
  }
}

/** One full interactive round: song → tracks → PDFs. */
async function interactiveDownload(settings: Settings, flags: Flags, ref?: SongRef): Promise<string | null> {
  ref ??= await pickSong();
  const s = p.spinner();
  s.start("Loading song");
  const meta = await fetchMeta(ref.songId, flags.revision ?? ref.revisionId);
  s.stop(`${meta.artist} – ${meta.title}`);

  const indices = flags.tracks ? selectTracks(meta, flags.tracks) : await pickTracks(meta, ref.trackIndex);
  if (!indices?.length) return null;

  const folder = songFolder(settings, meta, flags.out);
  s.start("Downloading tracks");
  const files = await downloadTracks(meta, indices, {
    outDir: folder,
    paper: flags.paper ?? settings.paper,
    combine: flags.combine ?? settings.combine,
    onProgress: (m) => s.message(m),
  });
  s.stop(`Saved ${files.length} PDF${files.length === 1 ? "" : "s"} to ${tildify(folder)}`);
  for (const f of files) p.log.message(f.slice(folder.length + 1), { symbol: "📄" });

  const opened = openResults(files, folder, flags.noOpen ? "nothing" : settings.afterDownload);
  if (opened) p.log.info(opened);
  return folder;
}

async function appLoop(settings: Settings, flags: Flags, initialQuery?: string) {
  const updateCheck = isCompiled && settings.checkForUpdates ? checkForUpdate() : Promise.resolve(null);
  p.intro(` savesterr v${VERSION} `);

  // Recommend updating up front if a newer release exists (the daily cache keeps this instant).
  let newer = await Promise.race([updateCheck, Bun.sleep(1500).then(() => null)]);
  if (newer) {
    const go = unwrap(
      await p.select<boolean>({
        message: `A new version is available: v${VERSION} → v${newer}`,
        options: [
          { value: true, label: `Update to v${newer} now`, hint: "recommended" },
          { value: false, label: "Not now" },
        ],
      }),
    );
    if (go && (await runUpdate(true))) {
      p.outro("Run savesterr again to start the new version.");
      return;
    }
  }

  let ref: SongRef | undefined;
  if (initialQuery) ref = looksLikeLink(initialQuery) || /^\d+$/.test(initialQuery) ? (parseSongRef(initialQuery) ?? undefined) : await pickSong(initialQuery);

  let lastFolder: string | null = null;
  for (;;) {
    try {
      lastFolder = (await interactiveDownload(settings, flags, ref)) ?? lastFolder;
    } catch (e) {
      p.log.error(e instanceof Error ? e.message : String(e));
    }
    ref = undefined;

    for (;;) {
      const next = unwrap(
        await p.select<string>({
          message: "What next?",
          options: [
            { value: "again", label: "Download another song" },
            ...(lastFolder ? [{ value: "open", label: "Open the folder" }] : []),
            ...(newer ? [{ value: "update", label: `Update to v${newer}`, hint: "recommended" }] : []),
            { value: "settings", label: "Settings" },
            { value: "quit", label: "Quit" },
          ],
        }),
      );
      if (next === "again") break;
      if (next === "open" && lastFolder) openPath(lastFolder);
      if (next === "settings") settings = await editSettings(settings);
      if (next === "update" && (await runUpdate(true))) {
        p.outro("Run savesterr again to start the new version.");
        return;
      }
      if (next === "update") newer = null;
      if (next === "quit") {
        p.outro("Happy playing! 🎸");
        return;
      }
    }
  }
}

// ─── Entry ──────────────────────────────────────────────────────────────────

interface Flags {
  tracks?: string;
  out?: string;
  revision?: number;
  paper?: Paper;
  combine?: boolean;
  noOpen?: boolean;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      tracks: { type: "string", short: "t" },
      out: { type: "string", short: "o" },
      revision: { type: "string", short: "r" },
      paper: { type: "string" },
      combine: { type: "boolean" },
      "no-open": { type: "boolean" },
      list: { type: "boolean", short: "l" },
      yes: { type: "boolean", short: "y" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) return console.log(USAGE);
  if (values.version) return console.log(`savesterr ${VERSION}${buildTarget ? ` (${buildTarget})` : " (source)"}`);

  await cleanupAfterUpdate();
  if (values.paper && !["a4", "letter"].includes(values.paper.toLowerCase())) throw new Error(`--paper must be a4 or letter`);
  const flags: Flags = {
    tracks: values.tracks,
    out: values.out,
    revision: values.revision ? Number(values.revision) : undefined,
    paper: values.paper?.toLowerCase() as Paper | undefined,
    combine: values.combine,
    noOpen: values["no-open"],
  };
  let settings = await loadSettings();
  const interactive = !values.yes && !!process.stdin.isTTY && !!process.stdout.isTTY;
  const input = positionals.join(" ").trim();

  // Subcommands.
  if (input === "update") return void (await runUpdate(interactive));
  if (input === "settings") {
    if (!interactive) return console.log(`${settingsPath()}\n${JSON.stringify(settings, null, 2)}`);
    p.intro(` savesterr v${VERSION} `);
    await editSettings(settings);
    return p.outro("Done.");
  }

  if (interactive && !values.list) return appLoop(settings, flags, input || undefined);

  // Non-interactive / scripted mode.
  if (!input) {
    console.log(USAGE);
    process.exit(1);
  }
  let ref = parseSongRef(input);
  if (!ref) {
    const [hit] = await searchSongs(input, 1);
    if (!hit) throw new Error(`No songs found for "${input}"`);
    ref = { songId: hit.songId };
  }
  const meta = await fetchMeta(ref.songId, flags.revision ?? ref.revisionId);
  console.log(`${meta.artist} – ${meta.title} (song ${meta.songId}, revision ${meta.revisionId})`);

  if (values.list) {
    meta.tracks.forEach((t, i) => console.log(`  [${String(i).padStart(2)}] ${kind(t).padEnd(6)}  ${trackTitle(t)}`));
    return;
  }

  const indices = selectTracks(meta, flags.tracks ?? "guitar");
  if (!indices.length) throw new Error(`No matching tracks. Run with --list to see them, then pick with --tracks.`);

  const folder = songFolder(settings, meta, flags.out);
  const files = await downloadTracks(meta, indices, {
    outDir: folder,
    paper: flags.paper ?? settings.paper,
    combine: flags.combine ?? settings.combine,
  });
  for (const f of files) console.log(`  ✓ ${f}`);
  if (!flags.noOpen && process.stdout.isTTY) openResults(files, folder, settings.afterDownload);

  if (isCompiled && settings.checkForUpdates && process.stdout.isTTY) {
    const newer = await checkForUpdate({ timeoutMs: 1500 });
    if (newer) console.log(`\nUpdate available: v${VERSION} → v${newer}. Run: savesterr update`);
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
