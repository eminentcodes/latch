import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync } from 'fflate';
import { screenshotsInPack } from '../src/drivers/kane-evidence.js';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

test('Kane preview selects the final screenshot and ignores account and network metadata', () => {
  const pack = zipSync({
    'tests/test-a/steps/2-open/screenshot.png': png,
    'tests/test-a/steps/12-assert/screenshot.png': png,
    'tests/test-a/steps/12-assert/annotated.png': png,
    'tests/test-a/result.yaml': Uint8Array.from([1, 2]),
    'tests/test-a/logs/0-network.har': Uint8Array.from([3, 4]),
  });
  const screenshots = screenshotsInPack(pack);
  assert.deepEqual(screenshots.map(image => image.ordinal), [12, 2]);
  assert.deepEqual(screenshots[0]!.bytes, png);
});

test('archive traversal and Windows paths cannot become report screenshots', () => {
  const pack = zipSync({
    '../tests/test-a/steps/1-open/screenshot.png': png,
    'tests/test-a/steps/../1-open/screenshot.png': png,
    'tests\\test-a\\steps\\1-open\\screenshot.png': png,
    '/tests/test-a/steps/1-open/screenshot.png': png,
  });
  assert.deepEqual(screenshotsInPack(pack), []);
});

test('corrupt archives and non-image screenshot entries cannot supply preview evidence', () => {
  assert.throws(() => screenshotsInPack(Uint8Array.from([1, 2, 3])));
  assert.throws(() => screenshotsInPack(zipSync({'tests/a/steps/1-x/screenshot.png': Uint8Array.from([1, 2, 3])})), /image format/);
});

test('the installed Kane format can supply JPEG screenshots without changing their bytes', () => {
  const jpeg = Uint8Array.from([255, 216, 255, 224, 1, 255, 217]);
  const screenshot = screenshotsInPack(zipSync({'tests/a/steps/1-0-1/screenshot.jpg': jpeg}))[0]!;
  assert.equal(screenshot.extension, 'jpg');
  assert.deepEqual(screenshot.bytes, jpeg);
});

test('highly compressed oversized screenshots are rejected before preview extraction', () => {
  const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
  oversized.set(png);
  const pack = zipSync({'tests/a/steps/1-x/screenshot.png': oversized});
  assert.throws(() => screenshotsInPack(pack), /size limit/);
});
