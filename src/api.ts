import type { SongMeta, Track, TrackMeta } from "./types";

const SITE = "https://www.songsterr.com";
// Track JSON lives on this CloudFront distribution. If it ever moves, the new
// host is advertised in the site's <link rel="dns-prefetch"> tags.
const DEFAULT_CDN = "dqsljvtekg760.cloudfront.net";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${SITE}/`,
};

async function get(url: string, attempts = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      last = new Error(`HTTP ${res.status} for ${url}`);
    } catch (e) {
      last = e;
    }
    await Bun.sleep(500 * (i + 1));
  }
  throw last;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await get(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

export interface SongRef {
  songId: number;
  revisionId?: number;
  trackIndex?: number;
}

/** Accepts a Songsterr URL (…-s4839025t3/r7733574) or a bare song id. */
export function parseSongRef(input: string): SongRef | null {
  if (/^\d+$/.test(input)) return { songId: Number(input) };
  const s = input.match(/-s(\d+)(?:t(\d+))?/);
  if (!s) return null;
  const r = input.match(/\/r(\d+)/);
  return {
    songId: Number(s[1]),
    trackIndex: s[2] !== undefined ? Number(s[2]) : undefined,
    revisionId: r ? Number(r[1]) : undefined,
  };
}

export interface SearchResult {
  songId: number;
  artist: string;
  title: string;
  tracks: TrackMeta[];
}

export function searchSongs(query: string, size = 20): Promise<SearchResult[]> {
  return getJson(`${SITE}/api/songs?size=${size}&pattern=${encodeURIComponent(query)}`);
}

export function fetchMeta(songId: number, revisionId?: number): Promise<SongMeta> {
  const path = revisionId ? `${songId}/${revisionId}` : `${songId}`;
  return getJson(`${SITE}/api/meta/${path}`);
}

let cdnHost: string | undefined;

async function discoverCdnHost(): Promise<string> {
  const html = await (await get(`${SITE}/`)).text();
  const m = html.match(/\/\/([a-z0-9]+\.cloudfront\.net)/);
  if (!m) throw new Error("Could not discover Songsterr CDN host");
  return m[1]!;
}

export async function fetchTrack(meta: SongMeta, index: number): Promise<Track> {
  const path = `${meta.songId}/${meta.revisionId}/${meta.image}/${index}.json`;
  const res = await get(`https://${cdnHost ?? DEFAULT_CDN}/${path}`);
  if (res.ok) return res.json() as Promise<Track>;
  if (cdnHost) throw new Error(`HTTP ${res.status} fetching track ${index}`);
  cdnHost = await discoverCdnHost();
  return getJson(`https://${cdnHost}/${path}`);
}
