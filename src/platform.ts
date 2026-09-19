// OS-specific helpers: file naming, well-known folders, and opening files.
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Reserved device names Windows refuses as file names, with or without an extension.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * Make a string safe to use as a single path component on Windows, macOS and
 * Linux: no reserved characters, no trailing dots/spaces (Windows strips them),
 * no reserved device names, and a bounded length.
 */
export function safeFileName(input: string, maxLength = 120): string {
  let s = input
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxLength) s = s.slice(0, maxLength).trim();
  s = s.replace(/[. ]+$/, "");
  if (!s) s = "untitled";
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  return s;
}

export function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

/** Where tabs go by default: ~/Documents/Songsterr Tabs (or ~/Songsterr Tabs if there's no Documents folder). */
export function defaultOutputDir(): string {
  const home = homedir();
  const docs = join(home, "Documents");
  return join(existsSync(docs) ? docs : home, "Songsterr Tabs");
}

/** Per-user config directory: %APPDATA%, ~/Library/Application Support, or $XDG_CONFIG_HOME. */
export function configDir(): string {
  const home = homedir();
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "songsterr-pdf");
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "songsterr-pdf");
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "songsterr-pdf");
}

/** Replace a leading home directory with ~ for display. */
export function tildify(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/**
 * Open a file or folder with the system's default app. Returns false if no
 * opener is available (e.g. a headless Linux box without xdg-open).
 */
export function openPath(path: string): boolean {
  let cmd: string[];
  if (process.platform === "darwin") cmd = ["open", path];
  // explorer.exe takes the path verbatim; `cmd /c start` would choke on & and ^ in names.
  else if (process.platform === "win32") cmd = ["explorer.exe", path];
  else if (isWsl() && Bun.which("wslview")) cmd = ["wslview", path];
  else if (isWsl()) {
    const win = Bun.spawnSync(["wslpath", "-w", path]).stdout.toString().trim();
    cmd = ["explorer.exe", win || path];
  } else if (Bun.which("xdg-open")) cmd = ["xdg-open", path];
  else return false;

  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Default paper size for the user's locale: Letter in the US, Canada and a few others, A4 elsewhere. */
export function localePaper(): "a4" | "letter" {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || process.env.LANG || "";
  return /[-_](US|CA|MX|PH|CL|CO|VE|PR|GT|CR|PA|DO|SV|NI|HN|BO)\b/i.test(locale) ? "letter" : "a4";
}
