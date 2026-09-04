import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMeetUrl, assertMeetUrl } from '../lib/meet-url.js';

describe('Meet URL', () => {
  it('accepts a standard room code', () => {
    const parsed = parseMeetUrl('https://meet.google.com/abc-defg-hij?authuser=0');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.code, 'abc-defg-hij');
  });

  it('rejects empty, placeholder, and non-Meet hosts', () => {
    assert.equal(parseMeetUrl('').ok, false);
    assert.equal(parseMeetUrl('https://meet.google.com/YOUR-MEET-CODE').ok, false);
    assert.equal(parseMeetUrl('https://zoom.us/j/123').ok, false);
    assert.match(parseMeetUrl('https://zoom.us/j/123').error, /meet\.google\.com/);
    assert.equal(parseMeetUrl('https://meet.google.com/').ok, false);
  });

  it('throws via assertMeetUrl', () => {
    assert.throws(() => assertMeetUrl('notaurl'), /URL/);
  });
});
