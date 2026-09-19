// Version checks and self-update against GitHub Releases.
import { chmod, mkdir, rename, rm } from "fs/promises";
import { basename, join } from "path";
import pkg from "../package.json" with { type: "json" };
import { configDir } from "./platform";

// Injected by scripts/build.ts; absent when running from source.
declare const BUILD_TARGET: string; // e.g. "linux-x64-musl" — picks the matching release asset
declare const BUILD_VERSION: string; // normally package.json's version; overridable for update testing

export const VERSION: string = typeof BUILD_VERSION === "string" ? BUILD_VERSION : pkg.version;
export const REPO = process.env.SONGSTERR_PDF_REPO || "j4ckxyz/songsterr-pdf";

export const buildTarget: string | null = typeof BUILD_TARGET === "string" ? BUILD_TARGET : null;
export const isCompiled = buildTarget !== null;

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface Asset {
  name: string;
  url: string; // API URL; serves the binary with Accept: application/octet-stream
  size: number;
}

interface Release {
  tag_name: string;
  html_url: string;
  assets: Asset[];
}

/** Compare dotted versions ("1.10.0" > "1.9.2"). Leading "v" is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Private repos (and heavy API use) need a token: GITHUB_TOKEN / GH_TOKEN, or the gh CLI's login.
let cachedToken: string | null | undefined;
function githubToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  if (!cachedToken && Bun.which("gh")) {
    try {
      const r = Bun.spawnSync(["gh", "auth", "token"], { stderr: "ignore" });
      cachedToken = r.exitCode === 0 ? r.stdout.toString().trim() || null : null;
    } catch {
      cachedToken = null;
    }
  }
  return cachedToken;
}

async function github(url: string, accept: string, timeoutMs: number): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept, "User-Agent": `songsterr-pdf/${VERSION}` };
  const signal = AbortSignal.timeout(timeoutMs);
  let res = await fetch(url, { headers, signal });
  // A 404 on a private repo just means "not authenticated"; retry with a token if we can find one.
  if ((res.status === 404 || res.status === 403) && githubToken()) {
    res = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${githubToken()}` }, signal });
  }
  return res;
}

export async function latestRelease(timeoutMs = 10_000): Promise<Release> {
  const res = await github(`https://api.github.com/repos/${REPO}/releases/latest`, "application/vnd.github+json", timeoutMs);
  if (res.status === 404) throw new Error(`No releases found for ${REPO} (private repo? set GITHUB_TOKEN or run \`gh auth login\`)`);
  if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status}`);
  return res.json() as Promise<Release>;
}

interface CheckCache {
  checkedAt: number;
  latest: string;
}

/**
 * Returns the newer version string if one is available, else null. Uses a
 * daily cache so startup stays instant; never throws.
 */
export async function checkForUpdate(opts: { force?: boolean; timeoutMs?: number } = {}): Promise<string | null> {
  const cacheFile = join(configDir(), "update-check.json");
  try {
    let latest: string | undefined;
    if (!opts.force) {
      const cache = (await Bun.file(cacheFile).json().catch(() => null)) as CheckCache | null;
      if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) latest = cache.latest;
    }
    if (!latest) {
      latest = (await latestRelease(opts.timeoutMs ?? 2500)).tag_name.replace(/^v/, "");
      await mkdir(configDir(), { recursive: true });
      await Bun.write(cacheFile, JSON.stringify({ checkedAt: Date.now(), latest } satisfies CheckCache));
    }
    return compareVersions(latest, VERSION) > 0 ? latest : null;
  } catch {
    return null;
  }
}

async function download(asset: Asset): Promise<Uint8Array> {
  const res = await github(asset.url, "application/octet-stream", 5 * 60_000);
  if (!res.ok) throw new Error(`Download of ${asset.name} failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export type UpdateResult = { updated: false; version: string } | { updated: true; from: string; to: string };

/** Download the latest release for this platform and replace the running executable. */
export async function selfUpdate(log: (msg: string) => void = () => {}): Promise<UpdateResult> {
  if (!isCompiled) {
    throw new Error("You're running from source — update with `git pull && bun install` instead.");
  }
  const release = await latestRelease();
  const latest = release.tag_name.replace(/^v/, "");
  if (compareVersions(latest, VERSION) <= 0) return { updated: false, version: VERSION };

  const isWindows = process.platform === "win32";
  const assetName = `songsterr-pdf-${buildTarget}${isWindows ? ".exe" : ""}`;
  const asset = release.assets.find((a) => a.name === assetName);
  const sumsAsset = release.assets.find((a) => a.name === "SHA256SUMS");
  if (!asset) throw new Error(`Release ${release.tag_name} has no build for ${buildTarget}`);

  log(`Downloading ${assetName} (${(asset.size / 1e6).toFixed(0)} MB)`);
  const bytes = await download(asset);

  if (sumsAsset) {
    const sums = new TextDecoder().decode(await download(sumsAsset));
    const expected = sums.split("\n").find((l) => l.trim().endsWith(assetName))?.split(/\s+/)[0];
    const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (!expected || expected !== actual) throw new Error("Checksum mismatch — download was corrupted; nothing was changed.");
  }

  const exe = process.execPath;
  const staged = `${exe}.new`;
  try {
    await Bun.write(staged, bytes);
    if (!isWindows) await chmod(staged, 0o755);
    if (isWindows) {
      // Windows won't overwrite a running .exe but will rename it; the .old is removed on next launch.
      await rm(`${exe}.old`, { force: true }).catch(() => {});
      await rename(exe, `${exe}.old`);
    }
    await rename(staged, exe);
  } catch (e) {
    await rm(staged, { force: true }).catch(() => {});
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM")
      throw new Error(`No permission to replace ${exe}. Re-run with sudo, or reinstall with the install script.`);
    throw e;
  }
  return { updated: true, from: VERSION, to: latest };
}

/** Remove the previous binary left behind by an update on Windows. */
export async function cleanupAfterUpdate(): Promise<void> {
  if (isCompiled && process.platform === "win32") await rm(`${process.execPath}.old`, { force: true }).catch(() => {});
}

export const releasesUrl = `https://github.com/${REPO}/releases`;
export const exeName = () => basename(process.execPath);
