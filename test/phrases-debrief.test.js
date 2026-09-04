import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  audiencePhrasePrompt,
  briefToFleetPrompt,
  buildLocalFleet,
  buildLocalPhrases,
  extractBriefSeeds,
  extractJsonObject,
  parseFleetAssignment,
  parseGeneratedPhrases,
  splitExtraPhrases,
} from '../console/phrases.js';
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

  it('extracts short topical seeds from a long brief', () => {
    const seeds = extractBriefSeeds(
      'Pitch de 8 minutos sobre energia solar para PME: custo, prazo e o risco se o financiamento falhar. Quero que a plateia pergunte pelo número-chave.',
    );
    assert.ok(seeds.some((seed) => /energia solar/i.test(seed)));
    assert.ok(seeds.some((seed) => /custo|prazo|financiamento/i.test(seed)));
    assert.equal(seeds.some((seed) => /^quero que/i.test(seed)), false);
  });

  it('weaves the brief into a distinct local script per guest', () => {
    const fleet = buildLocalFleet({
      brief: 'Pitch de 8 minutos sobre energia solar para PME.',
      tone: 'direto',
      botCount: 3,
      botNames: ['Ana', 'Bruno', 'Carla'],
    });
    assert.equal(fleet.bots.length, 3);
    const primaries = fleet.bots.map((bot) => bot.messages[0]);
    assert.equal(new Set(primaries).size, 3);
    assert.ok(fleet.bots.every((bot) => bot.messages.length >= 2 && bot.messages.length <= 4));
    const blob = fleet.bots.flatMap((bot) => bot.messages).join(' ');
    assert.match(blob, /energia|solar|PME/i);
  });

  it('builds a JSON fleet prompt from the brief', () => {
    const prompt = briefToFleetPrompt({
      brief: 'Demo de onboarding da Plateia',
      tone: 'apoiador',
      extraPhrases: 'Pode repetir o número-chave?',
      botCount: 4,
      botNames: ['P-1', 'P-2', 'P-3', 'P-4'],
    });
    assert.match(prompt, /Demo de onboarding da Plateia/);
    assert.match(prompt, /"bots"/);
    assert.match(prompt, /Exatamente 4/);
    assert.match(prompt, /P-1/);
    assert.match(prompt, /apoiador/);
    assert.equal(audiencePhrasePrompt({ brief: 'X', botCount: 2 }).includes('JSON'), true);
  });

  it('parses numbered model output', () => {
    const lines = parseGeneratedPhrases('1. Olá\n2. "Boa pergunta"\n', ['fallback']);
    assert.deepEqual(lines, ['Olá', 'Boa pergunta']);
  });

  it('parses fenced JSON fleet and pads to botCount', () => {
    const text = [
      'claro, aqui vai:',
      '```json',
      JSON.stringify({
        bots: [
          { index: 1, name: 'A', messages: ['Como fecha o pitch de energia?', 'E o prazo da PME?'] },
          { index: 2, name: 'B', messages: ['Qual é o número que importa?'] },
        ],
      }),
      '```',
    ].join('\n');
    const fleet = parseFleetAssignment(text, {
      botCount: 3,
      botNames: ['A', 'B', 'C'],
      tone: 'direto',
    });
    assert.equal(fleet.parsed, 'json');
    assert.equal(fleet.bots.length, 3);
    assert.equal(fleet.bots[0].messages[0], 'Como fecha o pitch de energia?');
    assert.ok(fleet.bots[1].messages.length >= 2);
    assert.ok(fleet.bots[2].messages[0]);
    assert.equal(extractJsonObject('not json'), null);
  });

  it('falls back to line parsing and truncates extras', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `${i + 1}. Fala ${i + 1} sobre o brief`);
    const fleet = parseFleetAssignment(lines.join('\n'), {
      botCount: 2,
      botNames: ['A', 'B'],
    });
    assert.equal(fleet.parsed, 'lines');
    assert.equal(fleet.bots.length, 2);
    assert.ok(fleet.bots[0].messages.includes('Fala 1 sobre o brief'));
    assert.equal(fleet.bots[0].messages.length <= 4, true);
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
