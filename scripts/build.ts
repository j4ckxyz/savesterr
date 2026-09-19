#!/usr/bin/env bun
/**
 * Builds standalone executables for every supported platform into ./dist,
 * plus a SHA256SUMS file used by the installers and `songsterr-pdf update`.
 *
 *   bun scripts/build.ts            # all targets
 *   bun scripts/build.ts --current  # just this machine (dist/songsterr-pdf[.exe])
 *   bun scripts/build.ts linux-x64 darwin-arm64
 *   bun scripts/build.ts --current --as-version 0.0.1   # pretend to be old (tests `update`)
 */
import type { BunPlugin } from "bun";
import { mkdir, rm } from "fs/promises";
import { basename } from "path";
import pkg from "../package.json" with { type: "json" };

// Release asset name suffix → Bun compile target.
export const TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-musl": "bun-linux-x64-musl",
  "linux-arm64-musl": "bun-linux-arm64-musl",
  "windows-x64": "bun-windows-x64",
  "windows-arm64": "bun-windows-arm64",
} as const;
type Target = keyof typeof TARGETS;

/**
 * pdfkit loads its built-in (AFM) font metrics lazily through a runtime
 * `createRequire(import.meta.url)('#standard-fonts/…')`, which can't resolve
 * inside a compiled executable. Rewrite those into static requires so the
 * bundler embeds the font data.
 */
const pdfkitFonts: BunPlugin = {
  name: "pdfkit-standard-fonts",
  setup(build) {
    build.onLoad({ filter: /pdfkit[\\/]js[\\/]pdfkit\.node\.mjs$/ }, async ({ path }) => {
      const src = await Bun.file(path).text();
      const out = src.replace(/require\$1\('#standard-fonts\/(\w+)'\)/g, "require('./standard-fonts/$1.cjs')");
      if (out === src) throw new Error("pdfkit font loader not found — pdfkit internals changed");
      return { contents: out, loader: "js" };
    });
  },
};

const currentTarget = (): Target => {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}` as Target;
};

let version = pkg.version;

async function build(target: Target, outfile: string) {
  const result = await Bun.build({
    entrypoints: ["src/cli.ts"],
    compile: {
      target: TARGETS[target],
      outfile,
      autoloadDotenv: false,
      autoloadBunfig: false,
      windows: {
        title: "songsterr-pdf",
        description: pkg.description,
        version,
        publisher: "songsterr-pdf",
      },
    },
    minify: true,
    sourcemap: "none",
    // Lets `songsterr-pdf update` fetch the matching asset (e.g. linux-x64-musl).
    define: { BUILD_TARGET: JSON.stringify(target), BUILD_VERSION: JSON.stringify(version) },
    plugins: [pdfkitFonts],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Build failed for ${target}`);
  }
  return result.outputs[0]!.path;
}

async function main() {
  const args = Bun.argv.slice(2);
  const asVersion = args.indexOf("--as-version");
  if (asVersion !== -1) {
    version = args[asVersion + 1] ?? version;
    args.splice(asVersion, 2);
  }
  await mkdir("dist", { recursive: true });

  if (args.includes("--current")) {
    const out = `dist/songsterr-pdf${process.platform === "win32" ? ".exe" : ""}`;
    console.log(`✓ ${await build(currentTarget(), out)}`);
    return;
  }

  const targets = (args.length ? args : Object.keys(TARGETS)) as Target[];
  for (const t of targets) if (!(t in TARGETS)) throw new Error(`Unknown target ${t}. Known: ${Object.keys(TARGETS).join(", ")}`);

  await rm("dist", { recursive: true, force: true });
  await mkdir("dist");
  const sums: string[] = [];
  for (const t of targets) {
    const out = `dist/songsterr-pdf-${t}${t.startsWith("windows") ? ".exe" : ""}`;
    const path = await build(t, out);
    const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
    sums.push(`${hash}  ${basename(path)}`);
    console.log(`✓ ${basename(path).padEnd(38)} ${(Bun.file(path).size / 1e6).toFixed(1)} MB`);
  }
  await Bun.write("dist/SHA256SUMS", sums.join("\n") + "\n");
  console.log(`\nv${version}: ${targets.length} binaries + SHA256SUMS in ./dist`);
}

await main();
