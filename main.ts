// Assemble the submission bundle for the Monsoon Quarter FPS entry.
// Copies game/ and screenshots/ into the output folder, then asks the
// kit to build the dossier from what landed there. Node stdlib only.
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The folder next to this file is the entry root.
const entryRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

async function assemble() {
  await mkdir(outDir, { recursive: true });
  await cp(join(entryRoot, 'game'), join(outDir, 'game'), { recursive: true });

  const shotsOut = join(outDir, 'screenshots');
  await mkdir(shotsOut, { recursive: true });
  try {
    await cp(join(entryRoot, 'screenshots'), shotsOut, { recursive: true });
  } catch {
    // No screenshots folder in the entry; keep the empty one.
  }

  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  await writeFile(join(outDir, 'dossier.json'), dossier);
}

await assemble();
