import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from './config.js';

function assertSafeBalance(balance) {
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new RangeError('残高が安全な整数の範囲を超えています。');
  return balance;
}

function claimDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env('APP_TIMEZONE', 'Asia/Tokyo'),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export class EconomyRepository {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('busy_timeout = 5000');
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
        PRIMARY KEY(guild_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
        delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_claims (
        guild_id TEXT NOT NULL, user_id TEXT NOT NULL, claim_type TEXT NOT NULL,
        claim_date TEXT NOT NULL, PRIMARY KEY(guild_id, user_id, claim_type, claim_date)
      );
    `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  ensureAccount(guildId, userId, initialBalance = 0) {
    if (!Number.isSafeInteger(initialBalance) || initialBalance < 0)
      throw new RangeError('初期残高は0以上の整数にしてください。');
    return this.db
      .transaction(() => {
        const result = this.db
          .prepare('INSERT OR IGNORE INTO accounts(guild_id,user_id,balance) VALUES(?,?,?)')
          .run(String(guildId), String(userId), initialBalance);
        if (result.changes) this._ledger(guildId, userId, initialBalance, 'initial-balance');
      })
      .immediate();
  }

  balance(guildId, userId) {
    return (
      this.db
        .prepare('SELECT balance FROM accounts WHERE guild_id=? AND user_id=?')
        .get(String(guildId), String(userId))?.balance ?? 0
    );
  }

  add(guildId, userId, delta, reason) {
    if (!Number.isSafeInteger(delta)) throw new TypeError('delta must be a safe integer');
    return this.db
      .transaction(() => {
        this.db
          .prepare('INSERT OR IGNORE INTO accounts(guild_id,user_id,balance) VALUES(?,?,0)')
          .run(String(guildId), String(userId));
        const current = this.balance(guildId, userId);
        const balance = current + delta;
        if (balance < 0) throw new Error('残高が不足しています。');
        assertSafeBalance(balance);
        this.db
          .prepare('UPDATE accounts SET balance=? WHERE guild_id=? AND user_id=?')
          .run(balance, String(guildId), String(userId));
        if (delta) this._ledger(guildId, userId, delta, reason);
        return balance;
      })
      .immediate();
  }

  claim(guildId, userId, amount, claimType) {
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new RangeError('報酬は0以上の整数にしてください。');
    return this.db
      .transaction(() => {
        this.db
          .prepare('INSERT INTO daily_claims VALUES(?,?,?,?)')
          .run(String(guildId), String(userId), claimType, claimDate());
        this.db
          .prepare('INSERT OR IGNORE INTO accounts(guild_id,user_id,balance) VALUES(?,?,0)')
          .run(String(guildId), String(userId));
        const balance = assertSafeBalance(this.balance(guildId, userId) + amount);
        this.db
          .prepare('UPDATE accounts SET balance=? WHERE guild_id=? AND user_id=?')
          .run(balance, String(guildId), String(userId));
        this._ledger(guildId, userId, amount, claimType);
        return balance;
      })
      .immediate();
  }

  lottery(guildId, userId, fee, payout, initialBalance = 0) {
    for (const value of [fee, payout, initialBalance])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new RangeError('参加費・当選金・初期残高は0以上の整数にしてください。');
    return this.db
      .transaction(() => {
        this.db
          .prepare('INSERT OR IGNORE INTO accounts(guild_id,user_id,balance) VALUES(?,?,?)')
          .run(String(guildId), String(userId), initialBalance);
        const current = this.balance(guildId, userId);
        if (current < fee) throw new Error('残高が不足しています。');
        const balance = assertSafeBalance(current - fee + payout);
        this.db
          .prepare('INSERT INTO daily_claims VALUES(?,?,?,?)')
          .run(String(guildId), String(userId), 'entertainment-lottery', claimDate());
        this.db
          .prepare('UPDATE accounts SET balance=? WHERE guild_id=? AND user_id=?')
          .run(balance, String(guildId), String(userId));
        this._ledger(guildId, userId, -fee, 'lottery-entry');
        if (payout) this._ledger(guildId, userId, payout, 'lottery-prize');
        return this.balance(guildId, userId);
      })
      .immediate();
  }

  transfer(guildId, senderId, recipientId, amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || String(senderId) === String(recipientId))
      throw new Error('送金額または送金先を確認してください。');
    return this.db
      .transaction(() => {
        for (const id of [senderId, recipientId])
          this.db
            .prepare('INSERT OR IGNORE INTO accounts(guild_id,user_id,balance) VALUES(?,?,0)')
            .run(String(guildId), String(id));
        const balance = this.balance(guildId, senderId);
        if (balance < amount) throw new Error('残高が不足しています。');
        const recipientBalance = assertSafeBalance(this.balance(guildId, recipientId) + amount);
        this.db
          .prepare('UPDATE accounts SET balance=balance-? WHERE guild_id=? AND user_id=?')
          .run(amount, String(guildId), String(senderId));
        this.db
          .prepare('UPDATE accounts SET balance=? WHERE guild_id=? AND user_id=?')
          .run(recipientBalance, String(guildId), String(recipientId));
        this._ledger(guildId, senderId, -amount, 'transfer-out');
        this._ledger(guildId, recipientId, amount, 'transfer-in');
      })
      .immediate();
  }

  top(guildId, limit = 10) {
    return this.db
      .prepare(
        'SELECT user_id AS userId,balance FROM accounts WHERE guild_id=? ORDER BY balance DESC LIMIT ?',
      )
      .all(String(guildId), limit);
  }

  history(guildId, userId, limit = 10) {
    return this.db
      .prepare(
        'SELECT delta,reason,created_at AS createdAt FROM ledger WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT ?',
      )
      .all(String(guildId), String(userId), limit);
  }

  close() {
    this.db.close();
  }
  _ledger(guildId, userId, delta, reason) {
    this.db
      .prepare('INSERT INTO ledger(guild_id,user_id,delta,reason,created_at) VALUES(?,?,?,?,?)')
      .run(String(guildId), String(userId), delta, reason, new Date().toISOString());
  }
}
