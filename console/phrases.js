export const TONES = [
  { id: 'formal', label: 'Formal' },
  { id: 'curioso', label: 'Curioso' },
  { id: 'apoiador', label: 'Apoiador' },
  { id: 'direto', label: 'Direto' },
  { id: 'entusiasta', label: 'Entusiasta' },
  { id: 'critico', label: 'Crítico (construtivo)' },
];

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

export function splitExtraPhrases(raw) {
  return String(raw || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function buildLocalPhrases({
  brief = '',
  tone = 'curioso',
  extraPhrases = '',
  count = 6,
} = {}) {
  const extras = splitExtraPhrases(extraPhrases);
  const bank = BANK[tone] || BANK.curioso;
  const hint = String(brief || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const generated = bank.map((line) => {
    if (!hint) return line;
    return line;
  });
  if (hint && tone === 'curioso') {
    generated.push(`Sobre “${hint.slice(0, 42)}…” — pode expandir?`);
  }
  const pool = [...extras, ...generated];
  if (!pool.length) pool.push('Olá — estou a acompanhar.');
  const phrases = [];
  for (let i = 0; i < count; i += 1) {
    phrases.push(pool[i % pool.length]);
  }
  return phrases;
}

export function audiencePhrasePrompt({ brief, tone, extraPhrases, count }) {
  const extras = splitExtraPhrases(extraPhrases);
  return [
    'Gera falas curtas (máx. 120 caracteres) para convidados num ensaio de apresentação no Google Meet.',
    'Cada fala vai para o chat oficial da sala, como se fosse um espetador real.',
    `Tom: ${tone}.`,
    `Quantidade: ${count} frases, uma por linha, sem numeração, sem aspas.`,
    brief ? `Contexto da apresentação:\n${brief}` : 'Sem brief detalhado.',
    extras.length ? `Inclui variações destas frases extra:\n${extras.join('\n')}` : '',
    'Português de Portugal ou Brasil, natural, sem emojis, sem parecer bot.',
  ].filter(Boolean).join('\n\n');
}

export function parseGeneratedPhrases(text, fallback) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter((line) => line && line.length <= 200);
  if (lines.length >= 1) return lines;
  return fallback;
}
