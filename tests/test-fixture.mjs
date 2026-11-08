import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handleApi } from '../server/api.mjs';
import { sha256 } from '../server/volunteers.mjs';
const migrations = await Promise.all(['0001_shared_storage.sql', '0002_volunteers_auth.sql', '0003_volunteer_names.sql', '0004_phone_sign_in.sql', '0005_editable_notes.sql', '0006_schedule_history.sql', '0007_planned_shifts.sql'].map(file => readFile(new URL('../migrations/' + file, import.meta.url), 'utf8')));
const rawToken = 'a'.repeat(64), tokenHash = await sha256(rawToken);
export function fixture(options = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); migrations.forEach(sql => db.exec(sql));
  db.prepare('UPDATE volunteers SET email=? WHERE id=?').run('super@example.com', 'nanda-kumar-das');
  db.prepare('INSERT INTO auth_sessions(token_hash,volunteer_id,expires_at) VALUES(?,?,?)').run(tokenHash, options.userId || 'nanda-kumar-das', Math.floor(Date.now() / 1000) + 3600);
  const objects = new Map();
  const env = {
    DB: {
      prepare(sql) { let args = []; return {
        bind(...values) { args = values; return this; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() {
          const before = db.prepare('SELECT total_changes() AS count').get().count;
          const returning = /\bRETURNING\b/i.test(sql);
          const results = returning ? db.prepare(sql).all(...args) : [];
          const direct = returning ? results.length : db.prepare(sql).run(...args).changes;
          const total = db.prepare('SELECT total_changes() AS count').get().count - before;
          return {results, meta:{changes:options.d1TotalChanges ? total : direct}};
        }
      }; },
      async batch(statements) { db.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; } }
    },
    PHOTOS: { async put(key, bytes) { objects.set(key, bytes); }, async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; }, async delete(key) { objects.delete(key); } }
  };
  const call = (path, data, origin = 'https://templeservices.pages.dev', cookie = options.anonymous ? '' : 'tls_session=' + rawToken) => handleApi(new Request('https://templeservices.pages.dev/api/' + path, { ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify(data) } : { headers: { Cookie: cookie } }) }), env);
  return { db, env, call, objects };
}
