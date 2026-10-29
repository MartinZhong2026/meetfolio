import assert from 'node:assert/strict';
import { disposableDatabaseUrl } from './database-safety.js';

const local = 'postgres://test:test@127.0.0.1:5432/meetfolio_test';
delete process.env.MEETFOLIO_ALLOW_TEST_DB_RESET;
assert.throws(() => disposableDatabaseUrl(local, 'meetfolio_test'));
process.env.MEETFOLIO_ALLOW_TEST_DB_RESET = 'meetfolio_test';
assert.equal(disposableDatabaseUrl(local, 'meetfolio_test'), local);
for (const url of [
  'postgres://test:test@production.example/meetfolio_test',
  'postgres://test:test@127.0.0.1/production',
  'postgres://test:test@127.0.0.1/meetfolio_test?host=production.example',
]) assert.throws(() => disposableDatabaseUrl(url, 'meetfolio_test'));
assert.throws(() => disposableDatabaseUrl(local, 'meetfolio_e2e'));
console.log('Disposable database target guard: passed');
