import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

function rotate(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return;
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const archive = `${file}.${stamp}.gz`;
  fs.writeFileSync(archive, zlib.gzipSync(fs.readFileSync(file)));
  fs.writeFileSync(file, '');
  const dir = path.dirname(file);
  const archives = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${path.basename(file)}.`) && name.endsWith('.gz'))
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  const now = Date.now();
  for (const item of [...archives]) {
    if (now - fs.statSync(item).mtimeMs > MAX_AGE_MS) {
      fs.rmSync(item, { force: true });
      archives.splice(archives.indexOf(item), 1);
    }
  }
  let total = archives.reduce((sum, item) => sum + fs.statSync(item).size, 0);
  while (archives.length && total > MAX_ARCHIVE_BYTES) {
    const oldest = archives.shift();
    total -= fs.statSync(oldest).size;
    fs.rmSync(oldest, { force: true });
  }
}

export function createLogger(name, logDir, level = 'INFO') {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, `${name}.log`);
  const threshold = LEVELS[level] ?? LEVELS.INFO;
  let openedDay = new Date().toISOString().slice(0, 10);
  function write(severity, message, meta = undefined) {
    if (LEVELS[severity] < threshold) return;
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (day !== openedDay || (fs.existsSync(file) && fs.statSync(file).size >= MAX_BYTES)) {
      rotate(file);
      openedDay = day;
    }
    const record = {
      time: now.toISOString(),
      level: severity,
      name,
      message: String(message),
      ...(meta === undefined ? {} : { meta }),
    };
    const line = `${JSON.stringify(record)}\n`;
    process.stdout.write(line);
    fs.appendFileSync(file, line, 'utf8');
  }
  return {
    debug: (m, x) => write('DEBUG', m, x),
    info: (m, x) => write('INFO', m, x),
    warn: (m, x) => write('WARN', m, x),
    error: (m, x) => write('ERROR', m, x),
  };
}
