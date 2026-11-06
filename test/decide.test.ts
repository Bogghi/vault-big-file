// Run with: npm test (node strips the types natively)
import assert from 'node:assert/strict';
import { decide } from '../src/decide.ts';

const L = { size: 10, mtime: 1 };
const L2 = { size: 10, mtime: 2 };
const R = { etag: 'a' };
const R2 = { etag: 'b' };
const B = { size: 10, mtime: 1, etag: 'a' };

// never synced on this device
assert.equal(decide(undefined, undefined, undefined), 'none');
assert.equal(decide(L, undefined, undefined), 'upload');
assert.equal(decide(undefined, R, undefined), 'download');
assert.equal(decide(L, R, undefined), 'compare');

// synced before
assert.equal(decide(L, R, B), 'none');
assert.equal(decide(L2, R, B), 'upload');
assert.equal(decide(L, R2, B), 'download');
assert.equal(decide(L2, R2, B), 'compare');
assert.equal(decide(undefined, R, B), 'delete-remote');
assert.equal(decide(undefined, R2, B), 'download'); // deleted here, edited elsewhere: edit wins
assert.equal(decide(L, undefined, B), 'trash-local');
assert.equal(decide(L2, undefined, B), 'upload'); // deleted elsewhere, edited here: edit wins
assert.equal(decide(undefined, undefined, B), 'forget');

console.log('decide: all assertions passed');
