import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLocalPhrases, parseGeneratedPhrases, splitExtraPhrases } from '../console/phrases.js';
import { buildDebriefPrompt, buildSessionStats, formatDebriefExport } from '../console/debrief.js';

describe('phrases and debrief', () => {
  it('builds one phrase per guest from extras + tone bank', () => {
    const phrases = buildLocalPhrases({
      brief: 'Pitch de 8 minutos sobre energia',
      tone: 'curioso',
      extraPhrases: 'Qual é o custo?\nE o prazo?',
      count: 4,
    });
    assert.equal(phrases.length, 4);
    assert.equal(phrases[0], 'Qual é o custo?');
    assert.equal(splitExtraPhrases('a\n\nb ; c').length, 3);
  });

  it('parses numbered model output', () => {
    const lines = parseGeneratedPhrases('1. Olá\n2. "Boa pergunta"\n', ['fallback']);
    assert.deepEqual(lines, ['Olá', 'Boa pergunta']);
  });

  it('summarizes a session and formats an export', () => {
    const stats = buildSessionStats({
      botCount: 3,
      startedAt: 1_000,
      endedAt: 61_000,
      meetCode: 'abc-defg-hij',
      tone: 'formal',
      bots: [
        { status: 'chatting', sent: 2, joined: true },
        { status: 'blocked', sent: 0 },
        { status: 'error', sent: 0 },
      ],
    });
    assert.equal(stats.joined, 1);
    assert.equal(stats.messagesSent, 2);
    assert.equal(stats.durationSec, 60);
    const prompt = buildDebriefPrompt({ stats, brief: 'Demo', tone: 'formal' });
    assert.match(prompt, /O que correu bem/);
    const text = formatDebriefExport({
      stats,
      brief: 'Demo',
      tone: 'formal',
      debriefText: 'Correu bem o join.',
      model: 'test/free:free',
    });
    assert.match(text, /PLATEIA CONSOLE/);
    assert.match(text, /Correu bem o join/);
    assert.match(text, /abc-defg-hij/);
  });
});
