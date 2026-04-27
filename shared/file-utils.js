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
