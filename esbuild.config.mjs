import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const stdioBridgeConfig = {
  entryPoints: ['src/mcp/stdioBridge.ts'],
  bundle: true,
  outfile: 'dist/stdioBridge.js',
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/ui/index.ts'],
  bundle: true,
  outfile: 'dist/webview/index.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

async function main() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const bridgeCtx = await esbuild.context(stdioBridgeConfig);
    const webviewCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), bridgeCtx.watch(), webviewCtx.watch()]);
    console.log('[esbuild] Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(stdioBridgeConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('[esbuild] Build complete.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
