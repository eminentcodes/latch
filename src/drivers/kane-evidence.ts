import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { unzipSync } from 'fflate';
import type { Evidence } from '../types.js';

const maxPackBytes = 64 * 1024 * 1024;
const maxImageBytes = 8 * 1024 * 1024;
const maxExtractedBytes = 32 * 1024 * 1024;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export function screenshotsInPack(bytes: Uint8Array): {entry: string; ordinal: number; bytes: Uint8Array; extension: 'png' | 'jpg'}[] {
  if (bytes.byteLength > maxPackBytes) throw new Error('Kane evidence pack exceeds the local preview size limit.');
  let totalBytes = 0;
  const files = unzipSync(bytes, {filter: file => {
    const path = file.name;
    if (path.includes('\\') || path.startsWith('/') || path.split('/').includes('..')
      || !/^tests\/[^/]+\/steps\/\d+-[^/]+\/screenshot\.(png|jpe?g)$/.test(path)) return false;
    totalBytes += file.originalSize;
    if (file.originalSize > maxImageBytes || totalBytes > maxExtractedBytes) {
      throw new Error('Kane screenshots exceed the local preview size limit.');
    }
    return true;
  }});
  return Object.entries(files).map(([entry, image]) => {
    const png = entry.endsWith('.png');
    const valid = png ? pngSignature.every((byte, index) => image[index] === byte)
      : image[0] === 255 && image[1] === 216 && image[2] === 255;
    if (!valid) throw new Error('Kane screenshot does not match its PNG or JPEG image format.');
    const ordinal = Number(/\/steps\/(\d+)-/.exec(entry)?.[1]);
    if (!Number.isSafeInteger(ordinal)) throw new Error('Kane screenshot has an invalid step number.');
    return {entry, ordinal, bytes: image, extension: png ? 'png' as const : 'jpg' as const};
  }).sort((a, b) => b.ordinal - a.ordinal || a.entry.localeCompare(b.entry));
}

export async function extractKaneScreenshots(packPath: string, outputDir: string, reportRoot: string): Promise<Evidence[]> {
  if ((await stat(packPath)).size > maxPackBytes) throw new Error('Kane evidence pack exceeds the local preview size limit.');
  const screenshots = screenshotsInPack(await readFile(packPath));
  const destination = join(outputDir, 'screenshots');
  if (screenshots.length) await mkdir(destination, {recursive: true});
  const evidence: Evidence[] = [];
  for (const [index, screenshot] of screenshots.entries()) {
    // Destination names come from Latch, never from archive paths.
    const path = join(destination, `step-${screenshot.ordinal}-${index}.${screenshot.extension}`);
    await writeFile(path, screenshot.bytes);
    evidence.push({kind: 'screenshot', path: relative(reportRoot, path).split('\\').join('/'),
      label: index === 0 ? `Kane screenshot · final step ${screenshot.ordinal}` : `Kane screenshot · step ${screenshot.ordinal}`});
  }
  return evidence;
}
