// Persistent user settings, stored as JSON in the platform config directory.
import { mkdir } from "fs/promises";
import { join } from "path";
import { configDir, defaultOutputDir, localePaper } from "./platform";

export type Paper = "a4" | "letter";
export type AfterDownload = "files" | "folder" | "nothing";

export interface Settings {
  /** Root folder; each song gets its own subfolder inside it. */
  outputDir: string;
  paper: Paper;
  /** What to open once PDFs are saved. */
  afterDownload: AfterDownload;
  /** Put every selected track into one PDF instead of one file per track. */
  combine: boolean;
  /** Check GitHub for a newer release (at most once a day). */
  checkForUpdates: boolean;
}

export const DEFAULTS: Settings = {
  outputDir: defaultOutputDir(),
  paper: localePaper(),
  afterDownload: "files",
  combine: false,
  checkForUpdates: true,
};

export const settingsPath = () => join(configDir(), "settings.json");

export async function loadSettings(): Promise<Settings> {
  try {
    const saved = (await Bun.file(settingsPath()).json()) as Partial<Settings>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await Bun.write(settingsPath(), JSON.stringify(s, null, 2) + "\n");
}
