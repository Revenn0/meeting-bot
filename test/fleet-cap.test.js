import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_FLEET_SIZE,
  assertFleetAllowed,
  assertFleetSize,
  clampFleetSize,
} from '../lib/wave-planner.js';

describe('fleet hard cap', () => {
  it('is exactly 15', () => {
    assert.equal(MAX_FLEET_SIZE, 15);
    assert.equal(clampFleetSize(1), 1);
    assert.equal(clampFleetSize(15), 15);
    assert.equal(clampFleetSize(16), 15);
    assert.equal(clampFleetSize(100), 15);
    assert.equal(clampFleetSize(0), 1);
  });

  it('rejects live fleets above 15 even with CONFIRM_LIVE', () => {
    assert.equal(assertFleetSize(15), 15);
    assert.throws(() => assertFleetSize(16), /cannot exceed 15/);
    assert.throws(
      () => assertFleetAllowed({
        size: 16,
        meetUrl: 'https://meet.google.com/aaa-bbbb-ccc',
        confirmLive: true,
      }),
      /cannot exceed 15/,
    );
  });

  it('still allows mock fleets above 15 for engine tests', () => {
    assert.deepEqual(
      assertFleetAllowed({ size: 20, meetUrl: 'file:///tmp/mock.html', mock: true }),
      { mode: 'mock', size: 20 },
    );
  });
});
