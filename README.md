# songsterr-pdf

An interactive command-line tool that saves [Songsterr](https://www.songsterr.com) tabs as clean, printable PDFs, one file per instrument track.

Search for a song, tick the parts you want, and the PDFs open in your system's PDF viewer.

```
┌   songsterr-pdf
│
◇  Search Songsterr
│  enter sandman
│
◇  20 results for "enter sandman"
│
◇  Pick a song
│  Metallica – Enter Sandman   (5 guitar · 1 bass)
│
◇  Which tracks? (space to toggle, enter to confirm)
│  ◼ Rhythm Guitar            guitar
│  ◼ Lead Guitar              guitar
│  ◻ Bass                     bass
│
◇  Saved tabs/Metallica - Enter Sandman/… Rhythm Guitar ….pdf
◇  Saved tabs/Metallica - Enter Sandman/… Lead Guitar ….pdf
│
└  2 PDFs in ./tabs/Metallica - Enter Sandman — opening…
```

## Features

- **Interactive search.** Find a song by artist or title, pick from the results and choose tracks from a checklist. Guitar parts are ticked by default.
- **One PDF per track.** Each guitar, bass or other stringed part gets its own clean A4 file.
- **Tab notation drawn from the note data:**
  - Fret numbers, tuning, and rhythm stems/beams/tuplets under the staff.
  - Techniques: bends (with amounts), hammer-ons/pull-offs, slides, ties, ghost and dead notes, harmonics, vibrato, palm mute, let ring, tapping, pick strokes and grace notes.
  - Layout: section markers, chord names, tempo, time signatures, and repeats with numbered endings.
- **Opens the result.** PDFs open in your default viewer on macOS, Linux and Windows.
- **Scriptable.** It takes URLs, song ids and flags, and runs without prompts when piped or when you pass `-y`.
- **No account or browser needed.** It talks to Songsterr's public JSON endpoints directly.

## Requirements

- [Bun](https://bun.sh) 1.1 or newer

## Install

```sh
git clone https://github.com/j4ckxyz/songsterr-pdf.git
cd songsterr-pdf
bun install
```

Optionally, put it on your `PATH` as `songsterr-pdf`:

```sh
bun link                  # use the source directly
# or
bun run build             # compile a standalone ./songsterr-pdf binary
```

## Usage

### Interactive (recommended)

```sh
bun src/cli.ts
```

1. Type an artist or song name.
2. Pick a song. Each result shows how many guitar and bass parts it has, and **↻ Search again** starts over.
3. Tick the tracks you want (<kbd>Space</kbd> toggles, <kbd>Enter</kbd> confirms).
4. The PDFs are written to `./tabs/<Artist - Title>/` and opened.

Press <kbd>Esc</kbd> or <kbd>Ctrl</kbd>+<kbd>C</kbd> at any prompt to quit.

### Shortcuts

| You want to…                              | Run                                                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| Start with a search already typed         | `bun src/cli.ts "enter sandman"`                           |
| Use a Songsterr link you already have     | `bun src/cli.ts "https://www.songsterr.com/a/wsa/…-s444"`  |
| Use a song id                             | `bun src/cli.ts 444`                                       |
| See a song's tracks and their indices     | `bun src/cli.ts 444 --list`                                |
| Pick tracks without the checklist         | `bun src/cli.ts 444 -t 5,6`                                |
| Grab every bass part                      | `bun src/cli.ts 444 -t bass`                               |
| Run with no prompts (top result, guitars) | `bun src/cli.ts "paranoid" -y`                             |
| Save somewhere else, don't open anything  | `bun src/cli.ts 444 -o ~/Desktop/tabs --no-open`           |

When you paste a link that points at a specific track (the `t3` in `…-s4839025t3`), that track is ticked in the checklist. A link with a revision (`/r7733574`) downloads that exact revision.

### Options

| Flag                  | Description                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `-t, --tracks <sel>`  | Skip the checklist. `guitar`, `bass`, `all` (everything except drums and vocals), or indices like `0,2`. |
| `-o, --out <dir>`     | Output directory. Default: `./tabs/<Artist - Title>`.                                         |
| `-r, --revision <id>` | Download a specific revision. Default: the one in the URL, otherwise the latest.              |
| `-l, --list`          | Print the song's tracks with their indices and kinds, then exit.                              |
| `-y, --yes`           | Non-interactive: use the top search result and its guitar tracks.                             |
| `--no-open`           | Don't open the PDFs when finished.                                                            |
| `-h, --help`          | Show help.                                                                                    |

Without an interactive terminal (in a pipe, script or cron job) the tool acts as if `-y` was passed.

### Output

```
tabs/
└── Metallica - One/
    ├── Metallica - One - 05 Kirk Hammett - … Lead Guitar - Distortion Guitar.pdf
    └── Metallica - One - 06 James Hetfield - … Rhythm Guitar - Distortion Guitar.pdf
```

The two-digit number is the track's index on Songsterr, so files sort in the same order as the site's track list. Each PDF has a header (title, artist, track, tuning, tempo) and a page-numbered footer.

## How it works

Songsterr doesn't serve tab images. The browser downloads each track's notes as JSON and draws them itself, and this tool does the same with its own renderer. The endpoints were found by recording the site's network traffic:

| Purpose              | Request                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Search               | `GET https://www.songsterr.com/api/songs?pattern=<query>&size=20`                                |
| Song + track list    | `GET https://www.songsterr.com/api/meta/<songId>[/<revisionId>]`                                 |
| A track's notes      | `GET https://dqsljvtekg760.cloudfront.net/<songId>/<revisionId>/<image>/<trackIndex>.json`       |

- `image` is a hash from the metadata response that identifies the revision's published data.
- The metadata doesn't say which tracks are guitars. The kind is only in each track's `hash` prefix: `guitar_`, `bass_`, `drums_`, `vocals_` or `other_`.
- If the CDN host ever changes, the tool reads the new one from the `<link rel="dns-prefetch">` tags on Songsterr's homepage.

### Track data format

```
track
├── strings, frets, tuning[]          tuning is MIDI note numbers, highest string first
├── automations.tempo[]               { measure, bpm }
└── measures[]
    ├── signature?  [4, 4]            only present when it changes
    ├── marker?     { text }          section name, e.g. "Chorus"
    ├── repeatStart?, repeat?, alternateEnding?, doubleBarline?
    └── voices[]
        └── beats[]
            ├── duration  [1, 8]      fraction of a whole note, dots/tuplets already applied
            ├── type      8           the written note value (for stems and beams)
            ├── rest?, dots?, tuplet?, beamStart?, beamStop?, graceNote?
            ├── palmMute?, letRing?, tapping?, pickStroke?, chord?, text?
            └── notes[]
                ├── string            0 = highest string
                ├── fret
                └── tie?, ghost?, dead?, hp?, slide?, bend?, harmonic?, leftHandVibrato?, …
```

Grace notes carry a `duration` but take up no time in the bar.

### Rendering

`src/render.ts` lays each measure out on a timeline shared by all of its voices. Spacing grows with note length, and every system is stretched to the full page width. The rest is drawn with [pdfkit](https://pdfkit.org): fret numbers on the strings, rhythm below the staff, and technique markings in lanes above it (bends, vibrato, P.M., let ring, chords, sections). A lane only takes up space when a line uses it. Lyrics are not included.

## Project structure

```
src/
├── cli.ts      Argument parsing, interactive prompts, track selection, opening files
├── api.ts      Songsterr HTTP client: search, metadata, track JSON, CDN discovery
├── render.ts   Tab layout and PDF drawing
└── types.ts    TypeScript types for Songsterr's JSON
```

Type-check with:

```sh
bunx tsc --noEmit
```

## Limitations

- **Drum tracks** are skipped, since drum notation isn't tab. **Vocal** tracks are left out of `all` but can be picked by index.
- Some **rarer techniques** aren't drawn yet, such as slap/pop, whammy bar dives and trills.
- **Repeat signs** are supported but rarely appear, because Songsterr usually writes repeated sections out in full.
- Grace notes can look cramped next to wide (two-digit) fret numbers.
- The endpoints are **undocumented** and could change without notice.

## Disclaimer

This is an unofficial tool with no connection to Songsterr. It's meant for personal practice with tabs you can already view on the site. Please respect Songsterr's terms of service and the rights of the transcribers and artists, and consider [Songsterr Plus](https://www.songsterr.com/plus) if you use the site regularly.
