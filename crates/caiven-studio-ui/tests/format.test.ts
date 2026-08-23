import assert from 'node:assert/strict';
import test from 'node:test';
import { tidyPath } from '../src/lib/format.ts';

test('tidyPath keeps the last two POSIX segments', () => {
  assert.equal(tidyPath('/Users/me/carts/lantern/main.lua'), '…/lantern/main.lua');
  assert.equal(tidyPath('/carts/one'), '/carts/one');
});

test('tidyPath trims Windows backslash paths instead of returning them whole', () => {
  assert.equal(tidyPath('C:\\Users\\me\\carts\\lantern\\main.lua'), '…\\lantern\\main.lua');
  assert.equal(tidyPath('C:\\carts'), 'C:\\carts');
});
