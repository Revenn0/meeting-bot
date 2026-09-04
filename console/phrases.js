export const TONES = [
  { id: 'formal', label: 'Formal' },
  { id: 'curioso', label: 'Curioso' },
  { id: 'apoiador', label: 'Apoiador' },
  { id: 'direto', label: 'Direto' },
  { id: 'entusiasta', label: 'Entusiasta' },
  { id: 'critico', label: 'Crítico (construtivo)' },
];

export const MAX_CHAT_LINE = 140;
export const MIN_MESSAGES_PER_BOT = 2;
export const MAX_MESSAGES_PER_BOT = 4;

const BANK = {
  formal: [
    'Pode clarificar o ponto principal deste bloco?',
    'Como isto se aplica no contexto real da apresentação?',
    'Qual é a evidência que sustenta esta afirmação?',
    'Obrigado, ficou mais claro — pode avançar um exemplo?',
    'Há algum risco que o público deveria ter em conta?',
  ],
  curioso: [
    'Interessante — e se o cenário for o contrário?',
    'Pode dar um exemplo concreto disto?',
    'Como chegou a esta conclusão?',
    'Isto muda alguma coisa no que vinha a dizer antes?',
    'Qual seria a pergunta mais difícil sobre este ponto?',
  ],
  apoiador: [
    'Gostei desta imagem — ajuda a fixar a ideia.',
    'Boa síntese. Faz sentido para quem está a ouvir.',
    'Este ritmo está claro. Pode aprofundar um pouco?',
    'Concordo com o enquadramento. Há um próximo passo?',
    'Obrigado, isto está a encaixar bem.',
  ],
  direto: [
    'Qual é a tese em uma frase?',
    'Isto é para decidir o quê, exatamente?',
    'Onde está o número que importa?',
    'O que acontece se isto falhar?',
    'Pode cortar o que for acessório?',
  ],
  entusiasta: [
    'Boa! Este ponto tem energia.',
    'Isto vai ficar na cabeça de quem assiste.',
    'Excelente viragem — quero ouvir o resto.',
    'Forte. Pode repetir a frase-chave?',
    'Estou connosco — continua.',
  ],
  critico: [
    'O argumento ainda parece um pouco frágil aqui.',
    'Um cético ia perguntar: e a prova?',
    'Há um contra-exemplo óbvio que convém antecipar.',
    'O ritmo baixou — vale recuperar a tensão.',
    'Cuidado com jargão: o público pode perder-se.',
  ],
};

const AI_VOICE_RE = /\b(como (uma )?ia|as an ai|sou (um )?modelo|i am an ai|enquanto ia)\b/i;

const BRIEF_ANGLES = [
  (seed) => `Sobre «${clip(seed, 36)}» — pode expandir?`,
  (seed) => `Como isto se aplica a ${clip(seed, 40)}?`,
  (seed) => `Qual é o risco em ${clip(seed, 40)}?`,
  (seed) => `Há um exemplo concreto de ${clip(seed, 38)}?`,
  (seed) => `Isto muda o que disseste sobre ${clip(seed, 34)}?`,
  (seed) => `Podes repetir a tese de ${clip(seed, 36)}?`,
  (seed) => `Quem decide o próximo passo em ${clip(seed, 32)}?`,
  (seed) => `Ficou o ponto de ${clip(seed, 36)}. E a seguir?`,
];

export function splitExtraPhrases(raw) {
  return String(raw || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function defaultGuestNames(count, prefix = 'Plateia') {
  const n = Math.max(0, Number(count) || 0);
  const safe = String(prefix || 'Plateia').replace(/\s+/g, '-').slice(0, 24) || 'Plateia';
  return Array.from({ length: n }, (_, i) => `${safe}-${i + 1}`);
}

export function clip(text, max = 48) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function sanitizeChatLine(raw, { max = MAX_CHAT_LINE } = {}) {
  let line = String(raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[-*\d.)]+\s*/, '')
    .replace(/^["«»“”']+|["«»“”']+$/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line || AI_VOICE_RE.test(line)) return '';
  if (line.length > max) line = `${line.slice(0, max - 1).trimEnd()}…`;
  return line;
}

export function extractBriefSeeds(brief) {
  const text = String(brief || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const parts = text
    .split(/[.!?;:\n]+|(?:,\s+)|(?:\s+e\s+(?=o |a |os |as ))/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 5)
    .filter((part) => !/^(quero que|a plateia deve|os bots devem)\b/i.test(part))
    .map((part) => {
      const sobre = part.match(/\bsobre\s+(.+)/i);
      const topic = sobre ? sobre[1] : part;
      return topic.replace(/^(o |a |os |as |um |uma )/, '').slice(0, 56).trim();
    })
    .filter(Boolean);
  if (parts.length) return [...new Set(parts)].slice(0, 15);
  return [text.slice(0, 56)];
}

function toneBank(tone) {
  return BANK[tone] || BANK.curioso;
}

function uniquePush(list, line, seen) {
  const clean = sanitizeChatLine(line);
  if (!clean) return;
  const key = clean.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  list.push(clean);
}

export function ensureMessageCount(messages, pads = [], {
  min = MIN_MESSAGES_PER_BOT,
  max = MAX_MESSAGES_PER_BOT,
} = {}) {
  const seen = new Set();
  const out = [];
  for (const line of messages || []) uniquePush(out, line, seen);
  for (const line of pads) {
    if (out.length >= Math.max(min, 1)) break;
    uniquePush(out, line, seen);
  }
  if (!out.length) out.push('Olá — estou a acompanhar.');
  if (out.length < min) {
    for (const line of toneBank('curioso')) {
      if (out.length >= min) break;
      uniquePush(out, line, seen);
    }
  }
  return out.slice(0, max);
}

export function buildLocalFleet({
  brief = '',
  tone = 'curioso',
  extraPhrases = '',
  botCount = 6,
  botNames = [],
} = {}) {
  const count = Math.max(1, Number(botCount) || 1);
  const names = botNames.length >= count
    ? botNames.slice(0, count)
    : defaultGuestNames(count);
  const extras = splitExtraPhrases(extraPhrases).map((line) => sanitizeChatLine(line)).filter(Boolean);
  const bank = toneBank(tone);
  const seeds = extractBriefSeeds(brief);
  const hint = String(brief || '').replace(/\s+/g, ' ').trim();

  const bots = names.map((name, index) => {
    const seed = seeds[index % Math.max(seeds.length, 1)] || hint;
    const messages = [];
    const seen = new Set();
    if (extras[index]) uniquePush(messages, extras[index], seen);
    if (seed) {
      uniquePush(messages, BRIEF_ANGLES[index % BRIEF_ANGLES.length](seed), seen);
    }
    uniquePush(messages, bank[index % bank.length], seen);
    const extraFollow = extras[(index + names.length) % Math.max(extras.length, 1)];
    if (extraFollow) uniquePush(messages, extraFollow, seen);
    uniquePush(messages, bank[(index + 2) % bank.length], seen);
    return {
      index: index + 1,
      name,
      messages: ensureMessageCount(messages, bank),
    };
  });

  return { bots, source: 'local' };
}

export function buildLocalPhrases({
  brief = '',
  tone = 'curioso',
  extraPhrases = '',
  count = 6,
  botNames = [],
} = {}) {
  const fleet = buildLocalFleet({
    brief,
    tone,
    extraPhrases,
    botCount: count,
    botNames,
  });
  return fleet.bots.map((bot) => bot.messages[0]);
}

export function briefToFleetPrompt({
  brief,
  tone = 'curioso',
  extraPhrases = '',
  botCount = 6,
  botNames = [],
} = {}) {
  const count = Math.max(1, Number(botCount) || 1);
  const names = (botNames.length >= count ? botNames : defaultGuestNames(count)).slice(0, count);
  const extras = splitExtraPhrases(extraPhrases);
  const topic = String(brief || '').trim();
  return [
    'És argumentista de chat de plateia para um ensaio no Google Meet.',
    'As falas vão para o chat oficial da sala, como público real — não és um assistente.',
    `Tom: ${tone}.`,
    `Convidados: ${count}. Nomes: ${names.join(', ')}.`,
    topic
      ? `BRIEF OBRIGATÓRIO (as falas TÊM de sair daqui; proibido banco genérico tipo "pode clarificar o ponto"):\n${topic}`
      : 'Sem brief — recusa frases vazias e pede contexto.',
    extras.length
      ? `Frases extra do apresentador (varia, não copies todas iguais):\n${extras.join('\n')}`
      : '',
    [
      'Reparte o brief em vozes distintas: pergunta, comentário, dúvida, síntese, risco, exemplo, prazo, número.',
      'Cada convidado tem 2 a 4 falas curtas (máx. 120 caracteres), naturais, PT-PT ou PT-BR.',
      'Sem emojis, sem “como IA”, sem aspas a envolver a frase, sem markdown.',
      'Não inventes dados que o brief não sugere; podes perguntar pelo que falta.',
    ].join(' '),
    [
      'Responde APENAS com JSON válido, sem texto à volta nem bloco markdown:',
      '{ "bots": [ { "index": 1, "name": "Plateia-1", "messages": ["fala 1", "fala 2"] } ] }',
      `Exatamente ${count} objetos em bots, index de 1 a ${count}, names iguais aos dados.`,
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
}

export function audiencePhrasePrompt(input = {}) {
  return briefToFleetPrompt(input);
}

export function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : raw).trim();
  const attempts = [candidate];
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    attempts.push(candidate.slice(start, end + 1));
  }
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try next shape
    }
  }
  return null;
}

export function parseGeneratedPhrases(text, fallback) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => sanitizeChatLine(line.replace(/^\s*[-*\d.)]+\s*/, '')))
    .filter((line) => line && line.length <= 200);
  if (lines.length >= 1) return lines;
  return fallback;
}

function emptyFleetSlot(index, name, pads) {
  return {
    index,
    name,
    messages: ensureMessageCount([], pads),
  };
}

export function parseFleetAssignment(text, {
  botCount = 1,
  botNames = [],
  fallback = null,
  tone = 'curioso',
} = {}) {
  const count = Math.max(1, Number(botCount) || 1);
  const names = (botNames.length >= count ? botNames : defaultGuestNames(count)).slice(0, count);
  const local = fallback?.bots
    ? fallback
    : buildLocalFleet({ botCount: count, botNames: names, tone });
  const padsFor = (i) => local.bots[i]?.messages || toneBank(tone);

  const parsed = extractJsonObject(text);
  const rawBots = Array.isArray(parsed?.bots) ? parsed.bots : null;
  if (rawBots) {
    const byIndex = new Map();
    rawBots.forEach((bot, order) => {
      const index = Number(bot?.index);
      const slot = Number.isFinite(index) && index >= 1 ? index : order + 1;
      const messages = ensureMessageCount(bot?.messages, padsFor(slot - 1));
      if (!messages.length) return;
      byIndex.set(slot, {
        index: slot,
        name: sanitizeChatLine(bot?.name, { max: 40 }) || names[slot - 1] || `Plateia-${slot}`,
        messages,
      });
    });
    const bots = names.map((name, i) => {
      const found = byIndex.get(i + 1);
      if (found) {
        return { ...found, index: i + 1, name: found.name || name };
      }
      return emptyFleetSlot(i + 1, name, padsFor(i));
    });
    return { bots, source: 'openrouter', parsed: 'json' };
  }

  const lines = parseGeneratedPhrases(text, []);
  if (lines.length) {
    const bots = names.map((name, i) => {
      const chunk = [];
      if (lines.length >= count * MIN_MESSAGES_PER_BOT) {
        const width = Math.min(MAX_MESSAGES_PER_BOT, Math.floor(lines.length / count) || 1);
        for (let k = 0; k < width; k += 1) {
          chunk.push(lines[i * width + k]);
        }
      } else {
        chunk.push(lines[i % lines.length]);
        if (lines.length > count) chunk.push(lines[count + (i % Math.max(lines.length - count, 1))]);
      }
      return {
        index: i + 1,
        name,
        messages: ensureMessageCount(chunk, padsFor(i)),
      };
    });
    return { bots, source: 'openrouter', parsed: 'lines' };
  }

  return { ...local, source: local.source || 'local', parsed: 'fallback' };
}

export function primaryPhrases(fleet) {
  return (fleet?.bots || []).map((bot) => bot.messages?.[0]).filter(Boolean);
}

export function messagesForBot(fleet, botIndex) {
  const bots = fleet?.bots || [];
  const slot = bots[botIndex] || bots[0];
  return slot?.messages?.length ? slot.messages : ['Olá — estou a acompanhar.'];
}
