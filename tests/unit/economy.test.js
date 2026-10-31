import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EconomyRepository } from '../../src/p1228/core/economy.js';

test('account, ledger, claim and transfer remain atomic', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1228-test-'));
  const repository = new EconomyRepository(path.join(dir, 'economy.sqlite3'));
  try {
    repository.ensureAccount('1', '10', 100);
    repository.ensureAccount('1', '30', Number.MAX_SAFE_INTEGER);
    assert.equal(repository.balance('1', '10'), 100);
    assert.throws(() => repository.add('1', '30', 1, 'overflow'), RangeError);
    assert.throws(() => repository.claim('1', '30', 1, 'overflow'), RangeError);
    assert.throws(() => repository.lottery('1', '30', 0, 1), RangeError);
    repository.add('1', '10', 25, 'test-credit');
    assert.equal(repository.balance('1', '10'), 125);
    repository.transfer('1', '10', '20', 40);
    assert.equal(repository.balance('1', '10'), 85);
    assert.equal(repository.balance('1', '20'), 40);
    assert.throws(() => repository.transfer('1', '10', '20', 100));
    assert.throws(() => repository.transfer('1', '10', '30', 1), RangeError);
    repository.claim('1', '10', 10, 'test-daily');
    assert.throws(() => repository.claim('1', '10', 10, 'test-daily'));
    assert.ok(repository.history('1', '10').length >= 3);
  } finally {
    repository.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
