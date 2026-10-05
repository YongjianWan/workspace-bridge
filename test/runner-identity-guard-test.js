#!/usr/bin/env node
// @fast
// @semantic
/** The runner fails a run whose tests changed the repository's git commit identity. */
const assert = require('assert');
const { describeIdentityChange } = require('./runner');

const same = { name: 'dev', email: 'dev@example.com' };
assert.strictEqual(describeIdentityChange(same, { ...same }), null);

const renamed = describeIdentityChange(same, { name: 'Test', email: 'dev@example.com' });
assert(renamed && renamed.includes('dev') && renamed.includes('Test'), `name change must be reported, got ${renamed}`);

const emailChanged = describeIdentityChange(same, { name: 'dev', email: 'test@example.com' });
assert(emailChanged, 'email change must be reported');

// An unset identity that becomes set (or the reverse) is also a change.
assert(describeIdentityChange({ name: '', email: '' }, same));
