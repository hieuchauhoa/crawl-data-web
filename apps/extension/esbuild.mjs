import { context } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const outdir = resolve("dist");
mkdirSync(outdir, { recursive: true });
cpSync(resolve("manifest.json"), resolve(outdir, "manifest.json"));

const ctx = await context({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts"
  },
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir,
  sourcemap: true,
  logLevel: "info"
});

if (process.argv.includes("--watch")) {
  await ctx.watch();
  console.log("Extension watch mode. Load apps/extension/dist as unpacked extension.");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
