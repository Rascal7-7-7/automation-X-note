/**
 * Atomic file write utilities.
 * Write to .tmp then rename — prevents partial-write corruption on crash.
 */
import fs from 'fs';

/**
 * Atomically write JSON to filePath.
 * @param {string} filePath
 * @param {*} data - anything JSON.stringify accepts
 * @param {object} [opts]
 * @param {boolean} [opts.pretty=true] - use 2-space indent
 */
export function saveJSON(filePath, data, { pretty = true } = {}) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : 0));
  fs.renameSync(tmp, filePath);
}

/**
 * Atomically write raw string to filePath.
 * @param {string} filePath
 * @param {string} content
 */
export function saveFile(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

/**
 * Convert a local image file to a base64 data URI.
 * @param {string} filePath
 * @returns {string}
 */
export function imageToDataUri(filePath) {
  const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const b64  = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}
