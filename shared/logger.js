import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '../logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logFile = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);

function write(level, module, message, data) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    module,
    message,
    ...(data !== undefined ? { data } : {}),
  });
  fs.appendFileSync(logFile, entry + '\n');
  console.log(entry);
}

export const logger = {
  info: (module, message, data) => write('INFO', module, message, data),
  warn: (module, message, data) => write('WARN', module, message, data),
  error: (module, message, data) => write('ERROR', module, message, data),
};
