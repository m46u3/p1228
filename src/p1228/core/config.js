import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ override: false });

export function env(name, fallback = '') {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function positiveInt(name, fallback, { minimum = 1 } = {}) {
  const raw = env(name, String(fallback));
  if (!/^-?\d+$/.test(raw)) throw new TypeError(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(`${name} must be >= ${minimum}`);
  return value;
}

export function parseTokens(multiName, singleName) {
  const raw = env(multiName);
  const tokens = raw
    .split(/[\r\n,]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const unique = [...new Set(tokens)];
  if (unique.length) return unique;
  const single = env(singleName);
  return single ? [single] : [];
}

export function commonSettings() {
  const rawGuild = env('DISCORD_TEST_GUILD_ID');
  if (rawGuild && !/^\d{5,25}$/.test(rawGuild))
    throw new TypeError('DISCORD_TEST_GUILD_ID must be a Discord snowflake');
  return {
    testGuildId: rawGuild || null,
    logLevel: env('LOG_LEVEL', 'INFO').toUpperCase(),
    logDir: path.resolve(env('BOT_LOG_DIR', './logs')),
    dataDir: path.resolve(env('BOT_DATA_DIR', './data')),
  };
}
