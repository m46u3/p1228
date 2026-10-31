import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function ipv4Number(ip) {
  return ip.split('.').reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
}
function inCidr(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(ip) & mask) === (ipv4Number(base) & mask);
}
function isPublicIpv4(ip) {
  const blocked = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, bits]) => inCidr(ip, base, bits));
}
function isPublicIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPublicIpv4(ip);
  if (version !== 6) return false;
  const normalized = ip.toLowerCase();
  // Permit only global-unicast 2000::/3. Reject mapped IPv4 and documentation space.
  if (!/^[23][0-9a-f]{0,3}:/u.test(normalized)) return false;
  if (normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0db8:')) return false;
  if (normalized.startsWith('2002:') || normalized.startsWith('2001:')) return false;
  return true;
}

async function resolvePublicHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname)
    throw new Error('HTTPSの音声URLを指定してください。');
  if (url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('認証情報付きURLや443以外のポートには対応していません。');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))
    throw new Error('ローカルホストへの接続は許可されていません。');
  const hostname = url.hostname.replace(/^\[|\]$/gu, '');
  let addresses;
  if (net.isIP(hostname)) addresses = [{ address: hostname }];
  else addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address)))
    throw new Error('非公開IPアドレスへの接続は許可されていません。');
  return { url, addresses };
}

export async function validatePublicHttpsUrl(value) {
  const { url } = await resolvePublicHttpsUrl(value);
  return url;
}

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const resolved = addresses.map(({ address }) => ({
      address,
      family: net.isIP(address),
    }));
    if (options?.all) callback(null, resolved);
    else callback(null, resolved[0].address, resolved[0].family);
  };
}

function requestHttps(url, addresses, signal) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { lookup: pinnedLookup(addresses), signal }, (response) =>
      resolve(response),
    );
    request.once('error', reject);
  });
}

export async function downloadPublicAudio(
  value,
  destinationPath,
  { maxBytes = 50 * 1024 * 1024, timeoutMs = 60000, signal } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new RangeError('maxBytes must be a positive safe integer');
  let destination = await resolvePublicHttpsUrl(value);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const response = await requestHttps(destination.url, destination.addresses, requestSignal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.destroy();
      if (!location) throw new Error('音声URLのリダイレクト先が不正です。');
      destination = await resolvePublicHttpsUrl(new URL(location, destination.url).toString());
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.destroy();
      throw new Error(`音声URLの取得に失敗しました (HTTP ${response.statusCode})`);
    }
    const type = (response.headers['content-type'] ?? '').split(';')[0].toLowerCase();
    if (type && !type.startsWith('audio/') && type !== 'application/octet-stream') {
      response.destroy();
      throw new Error('音声ファイルではないContent-Typeが返されました。');
    }
    const declared = Number(response.headers['content-length'] ?? 0);
    if (declared > maxBytes) {
      response.destroy();
      throw new Error('音声ファイルがサイズ上限を超えています。');
    }
    let total = 0;
    let fileCreated = false;
    const output = createWriteStream(destinationPath, { flags: 'wx' });
    output.once('open', () => {
      fileCreated = true;
    });
    try {
      await pipeline(
        response,
        new Transform({
          transform(chunk, encoding, callback) {
            total += chunk.length;
            if (total > maxBytes) {
              callback(new Error('音声ファイルがサイズ上限を超えています。'));
              return;
            }
            callback(null, chunk);
          },
        }),
        output,
        { signal: requestSignal },
      );
    } catch (error) {
      if (fileCreated) {
        try {
          await fs.rm(destinationPath, { force: true });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Audio download failed and its partial file could not be removed.',
          );
        }
      }
      throw error;
    }
    if (!total) {
      await fs.rm(destinationPath, { force: true });
      throw new Error('空の音声ファイルが返されました。');
    }
    return { path: destinationPath, url: destination.url.toString() };
  }
  throw new Error('リダイレクト回数が上限を超えました。');
}
