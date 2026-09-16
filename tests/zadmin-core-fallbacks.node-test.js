import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fixedLengthHexEqual,
  normalizeAdminScope,
  normalizeAdminSearch,
  pepperedDigest,
} from '../supabase/functions/_shared/zadmin-core.js';

test('covers null input fallbacks at the admin trust boundary', async () => {
  assert.equal(normalizeAdminScope(null), null);
  assert.equal(normalizeAdminSearch(null), '');

  const nullDigest = await pepperedDigest(null, null, null);
  assert.match(nullDigest, /^[a-f0-9]{64}$/);

  assert.equal(fixedLengthHexEqual(null, null), true);
});
