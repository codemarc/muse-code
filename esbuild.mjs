import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify") || process.env.NODE_ENV === "production";

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: !minify,
  minify,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context({ ...options, minify: false, sourcemap: true });
  await ctx.watch();
  console.log("watching…");
} else {
  await esbuild.build(options);
}
