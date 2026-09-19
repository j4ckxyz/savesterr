# songsterr-pdf

**Turn any [Songsterr](https://www.songsterr.com) tab into a clean, printable PDF, from your terminal.**

Search for a song, tick the guitar parts you want, and the PDFs open in your PDF viewer. It's a single self-contained program for macOS, Windows and Linux, with nothing else to install.

```
┌   songsterr-pdf v1.0.0
│
◇  Search for a song, or paste a Songsterr link
│  enter sandman
│
◇  Pick a song
│  Metallica – Enter Sandman          5 guitar · 1 bass
│
◇  Which parts do you want?  (space = select, enter = download)
│  ◼ Rhythm Guitar                    guitar
│  ◼ Lead Guitar                      guitar
│  ◻ Bass                             bass
│
◇  Saved 2 PDFs to ~/Documents/Songsterr Tabs/Metallica - Enter Sandman
│
◆  What next?
│  ● Download another song
│  ○ Open the folder
│  ○ Settings
│  ○ Quit
```

---

## Install

**macOS / Linux**: paste into Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/j4ckxyz/songsterr-pdf/main/install.sh | sh
```

**Windows**: paste into PowerShell:

```powershell
irm https://raw.githubusercontent.com/j4ckxyz/songsterr-pdf/main/install.ps1 | iex
```

Then open a **new** terminal window and run:

```sh
songsterr-pdf
```

The installer picks the right build for your computer, verifies its checksum, and adds it to your `PATH`. Nothing needs admin rights.

<details>
<summary><b>Installing from a private copy of this repository</b></summary>

GitHub doesn't serve files from private repositories to anonymous `curl`/`irm` requests. If you have access, sign in with the [GitHub CLI](https://cli.github.com) (`gh auth login`) and use these instead. The installers automatically fall back to your `gh` login for the download.

```sh
# macOS / Linux
gh api repos/j4ckxyz/songsterr-pdf/contents/install.sh -H "Accept: application/vnd.github.raw" | sh
```

```powershell
# Windows
gh api repos/j4ckxyz/songsterr-pdf/contents/install.ps1 -H "Accept: application/vnd.github.raw" | Out-String | iex
```

</details>

<details>
<summary><b>Install options</b> (custom folder, specific version)</summary>

Set these environment variables before running the installer:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SONGSTERR_PDF_INSTALL_DIR` | `~/.local/bin` · `%LOCALAPPDATA%\Programs\songsterr-pdf` | Where the program goes |
| `SONGSTERR_PDF_VERSION` | latest | Install a specific version, e.g. `1.0.0` |
| `SONGSTERR_PDF_NO_MODIFY_PATH` | – | Set to `1` to leave your shell startup files alone (macOS/Linux) |

```sh
curl -fsSL https://raw.githubusercontent.com/j4ckxyz/songsterr-pdf/main/install.sh | SONGSTERR_PDF_INSTALL_DIR=/usr/local/bin sh
```

You can also download a binary for your platform from the [Releases](https://github.com/j4ckxyz/songsterr-pdf/releases) page and put it anywhere on your `PATH`.

</details>

## Update

```sh
songsterr-pdf update
```

The app checks for new versions once a day. If one is out, it offers to update when you start it and adds an **Update** option to the menu.

## Using it

Run `songsterr-pdf` and follow the prompts:

1. **Search** by artist or song name, or **paste a Songsterr link** you already have open.
2. **Pick the song.** Each result shows how many guitar and bass parts it has.
3. **Tick the parts** you want with <kbd>Space</kbd>, then press <kbd>Enter</kbd>. Guitar parts are ticked for you.
4. Your PDFs are saved to **`Documents/Songsterr Tabs/<Artist - Title>/`** and opened.
5. Choose **Download another song**, **Open the folder**, **Settings** or **Quit**.

<kbd>Esc</kbd> or <kbd>Ctrl</kbd>+<kbd>C</kbd> quits at any point.

### Settings

Run `songsterr-pdf settings`, or choose **Settings** from the menu:

| Setting | Options | Default |
| --- | --- | --- |
| Save folder | any folder | `Documents/Songsterr Tabs` |
| Paper size | A4 · US Letter | based on your region |
| When done | open the PDFs · open the folder · do nothing | open the PDFs |
| Multiple parts | one PDF per part · one combined PDF (with bookmarks) | one PDF per part |
| Check for updates | daily · off | daily |

Settings are stored in `~/Library/Application Support/songsterr-pdf` (macOS), `%APPDATA%\songsterr-pdf` (Windows) or `~/.config/songsterr-pdf` (Linux).

### Shortcuts for power users

Everything can also be done straight from the command line, which is handy for scripts:

| You want to… | Run |
| --- | --- |
| Start with a search already typed | `songsterr-pdf "enter sandman"` |
| Open a Songsterr link directly | `songsterr-pdf "https://www.songsterr.com/a/wsa/metallica-one-tab-s444"` |
| See a song's parts and their numbers | `songsterr-pdf 444 --list` |
| Pick parts without the checklist | `songsterr-pdf 444 -t 5,6` |
| Get every bass part | `songsterr-pdf 444 -t bass` |
| Put the parts in one PDF | `songsterr-pdf 444 -t 5,6 --combine` |
| Use US Letter paper | `songsterr-pdf 444 --paper letter` |
| No questions: top result, guitar parts | `songsterr-pdf "paranoid black sabbath" -y` |
| Save somewhere specific, open nothing | `songsterr-pdf 444 -o ~/Desktop/tabs --no-open` |

<details>
<summary><b>All options</b></summary>

```
songsterr-pdf                         Start the app: search, pick tracks, save PDFs
songsterr-pdf "enter sandman"         Start with a search
songsterr-pdf <songsterr-link>        Go straight to a song
songsterr-pdf update                  Update to the latest version
songsterr-pdf settings                Change the save folder, paper size and more

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
```

- A link that points at a specific part (the `t3` in `…-s4839025t3`) pre-selects that part. A link with a revision (`/r7733574`) downloads that exact revision.
- A bare number is treated as a Songsterr song id. To *search* for a number, use the app's search box.
- When output isn't a terminal (pipes, scripts, cron), the tool never prompts and behaves as if `-y` was passed.

</details>

## What's in the PDFs

Each part gets a header (title, artist, part, tuning, tempo), page numbers, and properly engraved tab:

- **Tab and rhythm:** fret numbers on the strings, with rhythm stems, beams, dots and tuplets underneath.
- **Techniques:** bends (with amounts and releases), hammer-ons/pull-offs, slides, ties, ghost and dead notes, natural and artificial harmonics, vibrato, palm muting, let ring, tapping, pick strokes and grace notes.
- **Structure:** section markers, chord names, tempo changes, time signatures, and repeats with numbered endings.
- **Layout:** measures are spaced by rhythm and every line is justified to the page width. Space is only reserved for markings a line actually uses.

Lyrics are not included.

## Supported systems

| System | Supported versions | Tested in CI |
| --- | --- | --- |
| **macOS** | 13 Ventura and newer · Apple Silicon and Intel | macOS 14, 26 (Apple Silicon) · macOS 15 (Intel) |
| **Windows** | Windows 10 1809 and newer, Windows 11 · x64 and ARM64 | Windows Server 2022, 2025 (x64) |
| **Linux** | glibc 2.17+ (CentOS/RHEL 7 era, 2014) or musl (Alpine) · x64 and ARM64 | See [Linux distributions](#linux-distributions) |

These floors come from the [Bun](https://bun.sh) runtime that the app is compiled with. The macOS binaries declare a minimum of macOS 13.0, and on x64 the CPU needs SSE4.2 (any Intel/AMD chip from about 2009 onwards).

### Linux distributions

Every CI run downloads a real tab inside each of these distributions:

<!-- DISTRO-TABLE:START -->
| Distribution | C library | x64 | ARM64 |
| --- | --- | --- | --- |
| CentOS 6 | glibc 2.12 | ⛔ too old | – |
| CentOS 7 · Amazon Linux 2 | glibc 2.17 · 2.26 | ✅ | – |
| Ubuntu 16.04 · 18.04 · 20.04 · 22.04 · 24.04 | glibc 2.23 – 2.39 | ✅ | ✅ 24.04 |
| Debian 10 · 11 · 12 | glibc 2.28 – 2.36 | ✅ | ✅ 11 |
| Rocky Linux 9 · Fedora · Arch | current glibc | ✅ | – |
| Alpine 3.12 · latest | musl | ✅ | ✅ latest |
<!-- DISTRO-TABLE:END -->

The installer detects musl-based systems such as Alpine and Void and installs the matching build automatically. Those systems need the C++ runtime first: `apk add libstdc++ libgcc`.

## Troubleshooting

<details>
<summary><b>"command not found: songsterr-pdf" after installing</b></summary>

Open a new terminal window: the installer added the program's folder to your `PATH`, and terminals that were already open don't see that change. You can also run it by its full path (`~/.local/bin/songsterr-pdf`, or `%LOCALAPPDATA%\Programs\songsterr-pdf\songsterr-pdf.exe` on Windows).

</details>

<details>
<summary><b>The PDFs don't open on Linux</b></summary>

Opening files uses `xdg-open` (or `wslview`/Explorer on WSL). On a server or minimal install without a desktop, the PDFs are still saved; the app shows you where.

</details>

<details>
<summary><b>"No permission to replace …" when updating</b></summary>

You installed into a system folder such as `/usr/local/bin`. Run `sudo songsterr-pdf update`, or re-run the installer.

</details>

<details>
<summary><b>A song has no parts to pick</b></summary>

Only guitar, bass and other stringed parts can be written as tab. Drum and vocal parts are skipped.

</details>

## Uninstall

```sh
# macOS / Linux
rm ~/.local/bin/songsterr-pdf
rm -rf ~/Library/Application\ Support/songsterr-pdf ~/.config/songsterr-pdf   # settings
```

```powershell
# Windows
Remove-Item -Recurse "$env:LOCALAPPDATA\Programs\songsterr-pdf", "$env:APPDATA\songsterr-pdf"
```

Your downloaded tabs in `Documents/Songsterr Tabs` are left alone. On macOS/Linux you can also delete the `# songsterr-pdf` line the installer added to your shell's startup file (e.g. `~/.zshrc`).

---

## How it works

Songsterr doesn't serve tab images. The browser downloads each part's notes as JSON and draws them itself, and this app does the same with its own renderer. The endpoints were found by recording the site's network traffic:

| Purpose | Request |
| --- | --- |
| Search | `GET https://www.songsterr.com/api/songs?pattern=<query>&size=20` |
| Song + part list | `GET https://www.songsterr.com/api/meta/<songId>[/<revisionId>]` |
| A part's notes | `GET https://dqsljvtekg760.cloudfront.net/<songId>/<revisionId>/<image>/<partIndex>.json` |

- `image` is a hash from the song response that identifies the revision's published data.
- A part's kind is only encoded in its `hash` prefix: `guitar_`, `bass_`, `drums_`, `vocals_` or `other_`.
- If the CDN host ever changes, the app reads the new one from the `<link rel="dns-prefetch">` tags on Songsterr's homepage.

<details>
<summary><b>Part data format</b></summary>

```
part
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

</details>

## Development

Requires [Bun](https://bun.sh) 1.3+.

```sh
git clone https://github.com/j4ckxyz/songsterr-pdf.git && cd songsterr-pdf
bun install
bun start                 # run from source (same as: bun src/cli.ts)
bun test                  # unit + rendering tests
bun run typecheck
bun run build             # standalone binary for this machine → dist/songsterr-pdf
bun run build:all         # every platform + SHA256SUMS → dist/
scripts/test-distros.sh   # run the Linux builds across distros (needs Docker)
```

```
src/
├── cli.ts        Commands, flags, the interactive app and menus
├── api.ts        Songsterr HTTP client: search, song info, part data, CDN discovery
├── render.ts     Tab layout and PDF drawing (pdfkit)
├── config.ts     Saved settings
├── update.ts     Version checks and self-update from GitHub Releases
├── platform.ts   OS differences: safe file names, folders, opening files
└── types.ts      Types for Songsterr's JSON
scripts/
├── build.ts          Cross-compiles all targets
└── test-distros.sh   Linux compatibility matrix
install.sh, install.ps1   One-line installers
```

A small build plugin in `scripts/build.ts` embeds pdfkit's font metrics. pdfkit normally loads them from disk at runtime, which doesn't work inside a single-file executable.

### Releasing

1. Bump `version` in `package.json` and commit.
2. `git tag v1.2.3 && git push --tags`

The **Release** workflow tests the code, builds all 8 binaries on macOS so the Mac builds are code-signed, and publishes them with `SHA256SUMS` and the installers. The **Install & update test** workflow then runs both installers and `songsterr-pdf update` on every OS against the new release.

## Limitations

- Drum parts aren't supported, since drum notation isn't tab.
- A few rarer techniques aren't drawn yet, such as slap/pop, whammy-bar dives and trills.
- Songsterr's endpoints are undocumented and could change without notice. If downloads start failing, check for an update.

## Disclaimer

This is an unofficial tool with no connection to Songsterr. It's meant for personal practice with tabs you can already view on the site. Please respect Songsterr's terms of service and the work of the transcribers and artists, and consider [Songsterr Plus](https://www.songsterr.com/plus) if you use it regularly.
