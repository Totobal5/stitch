import { Pathy, pathy } from '@bscotch/pathy';
import { config } from 'dotenv';
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';

config();

// Create dist directory
await pathy('./dist').ensureDirectory();

const builder = await esbuild.build({
  entryPoints: ['./src/extension.ts', './src/manifest.update.mts'],
  bundle: true,
  outdir: './dist/',
  target: 'esnext',
  keepNames: true,
  sourcemap: true,
  platform: 'node',
  nodePaths: ['node_modules'],
  external: ['vscode'],
  loader: {
    '.xml': 'text',
    '.html': 'text',
    '.node': 'file',
  },
  inject: ['./scripts/injection.js'],
  define: {
    'import.meta.url': 'import_meta_url',
    STITCH_VERSION: JSON.stringify(process.env.npm_package_version || '0.0.0'),
    STITCH_ENVIRONMENT: JSON.stringify(process.env.CI ? 'production' : 'development'),
  },
});

// Copy the template project from current stitch-core
const assetsTemplatesDir = pathy('./assets/templates');
if (await assetsTemplatesDir.exists()) {
  await fsp.rm(assetsTemplatesDir.absolute, { recursive: true, force: true });
}
await assetsTemplatesDir.ensureDirectory();

const gmlSpecSrc = pathy('../parser/assets/GmlSpec.xml');
const gmlSpecDest = pathy('./assets/GmlSpec.xml');
if (await gmlSpecSrc.exists()) {
  await gmlSpecSrc.copy(gmlSpecDest);
}

// Copy the pixel-checksum binaries from current pixel-checksum,
// if we don't already have the same file. (This is because the
// binary cannot be overwritten when the extension is running in
// the debugger!)
for (const platform of ['linux', 'win32', 'darwin']) {
  const exeName = `pixel-checksum.${platform}.node`;
  const destPath = pathy(`./dist/${exeName}`);
  const srcPath = pathy(`../sprite-source/node_modules/@bscotch/pixel-checksum/${exeName}`);
  const destChecksum = (await destPath.exists()) ? await computeFileChecksum(destPath) : null;
  const srcChecksum = (await srcPath.exists()) ? await computeFileChecksum(srcPath) : null;
  if (!srcChecksum || destChecksum !== srcChecksum) {
    if (await srcPath.exists()) {
      await srcPath.copy(destPath);
    }
  }
}

// Update the icon theme file
await import('./sync-icons.mjs');

/**
 * Compute the checksum for a target file using node's crypto library
 * @param {Pathy} path
 */
async function computeFileChecksum(path) {
  const hash = crypto.createHash('sha256');
  /** @type {Buffer} */
  const file = await fsp.readFile(path.absolute);
  hash.update(file);
  return hash.digest('hex');
}
