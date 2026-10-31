import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { downloadPublicAudio, validatePublicHttpsUrl } from '../../src/p1228/core/security.js';

test('rejects non-HTTPS, userinfo, and local hostnames before resolving', async () => {
  await assert.rejects(validatePublicHttpsUrl('http://example.com/audio.mp3'));
  await assert.rejects(validatePublicHttpsUrl('https://user:pass@example.com/audio.mp3'));
  await assert.rejects(validatePublicHttpsUrl('https://localhost/audio.mp3'));
});

test('streams public audio to disk and enforces the byte limit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p1228-audio-test-'));
  const destinationPath = path.join(dir, 'audio.mp3');
  const oversizedPath = path.join(dir, 'oversized.mp3');
  const originalGet = https.get;
  try {
    https.get = (_url, _options, callback) => {
      const request = new EventEmitter();
      queueMicrotask(() => {
        const response = Readable.from([Buffer.from('audio')]);
        response.statusCode = 200;
        response.headers = { 'content-type': 'audio/mpeg' };
        callback(response);
      });
      return request;
    };

    const result = await downloadPublicAudio('https://8.8.8.8/audio.mp3', destinationPath, {
      maxBytes: 5,
    });
    assert.equal(result.path, destinationPath);
    assert.deepEqual(await fs.readFile(destinationPath), Buffer.from('audio'));

    await assert.rejects(
      downloadPublicAudio('https://8.8.8.8/audio.mp3', oversizedPath, { maxBytes: 4 }),
      /size limit|サイズ上限/u,
    );
    await assert.rejects(fs.access(oversizedPath));

    await assert.rejects(
      downloadPublicAudio('https://8.8.8.8/audio.mp3', destinationPath, { maxBytes: 5 }),
      { code: 'EEXIST' },
    );
    assert.deepEqual(await fs.readFile(destinationPath), Buffer.from('audio'));
  } finally {
    https.get = originalGet;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('pins the validated DNS address and rejects redirects to private hosts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p1228-audio-pin-test-'));
  const destinationPath = path.join(dir, 'audio.mp3');
  const originalLookup = dns.lookup;
  const originalGet = https.get;
  let lookupCount = 0;
  let pinnedAddress;
  let requestCount = 0;
  let redirectToPrivate = false;
  try {
    dns.lookup = async () => {
      lookupCount += 1;
      return [{ address: lookupCount === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }];
    };
    https.get = (url, options, callback) => {
      requestCount += 1;
      if (!redirectToPrivate)
        options.lookup(new URL(url).hostname, {}, (error, address) => {
          assert.ifError(error);
          pinnedAddress = address;
        });
      const request = new EventEmitter();
      queueMicrotask(() => {
        const response = Readable.from([Buffer.from('audio')]);
        response.statusCode = redirectToPrivate ? 302 : 200;
        response.headers = redirectToPrivate
          ? { location: 'https://127.0.0.1/private' }
          : { 'content-type': 'audio/mpeg' };
        callback(response);
      });
      return request;
    };

    await downloadPublicAudio('https://media.example/audio.mp3', destinationPath, { maxBytes: 5 });
    assert.equal(pinnedAddress, '8.8.8.8');
    assert.equal(lookupCount, 1);
    redirectToPrivate = true;
    await assert.rejects(
      downloadPublicAudio('https://8.8.8.8/audio.mp3', destinationPath, { maxBytes: 5 }),
      /非公開IPアドレス/u,
    );
    assert.equal(requestCount, 2);
  } finally {
    dns.lookup = originalLookup;
    https.get = originalGet;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
