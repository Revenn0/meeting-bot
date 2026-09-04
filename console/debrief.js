export function buildDebriefPrompt({ stats, brief, tone, extraPhrases }) {
  return [
    'És um encenador de ensaios. Lê as métricas de uma sessão Plateia Console',
    'em que convidados reais entraram num Google Meet e usaram o chat oficial.',
    'Escreve em português (PT), tom direto, sem floreados de coach.',
    'Estrutura exatamente assim:',
    '1) O que correu bem',
    '2) Riscos (técnicos e de palco)',
    '3) Dicas para o próximo ensaio',
    'Máximo 220 palavras. Sem markdown pesado — títulos em linha simples.',
    '',
    `Brief da apresentação:\n${brief || '(não foi indicado)'}`,
    `Tom pedido à plateia: ${tone || 'curioso'}`,
    extraPhrases ? `Frases extra:\n${extraPhrases}` : '',
    'Métricas da sessão:',
    JSON.stringify(stats, null, 2),
  ].filter(Boolean).join('\n');
}

export function buildSessionStats(session) {
  const bots = session?.bots || [];
  const joined = bots.filter((bot) => ['joined', 'chatting'].includes(bot.status) || bot.joined).length;
  const chatting = bots.filter((bot) => bot.status === 'chatting' || (bot.sent || 0) > 0).length;
  const blocked = bots.filter((bot) => bot.status === 'blocked').length;
  const errors = bots.filter((bot) => bot.status === 'error').length;
  const messagesSent = bots.reduce((sum, bot) => sum + (bot.sent || 0), 0);
  const startedAt = session?.startedAt || null;
  const endedAt = session?.endedAt || Date.now();
  const durationSec = startedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0;

  return {
    requested: session?.botCount || bots.length,
    launched: bots.length,
    joined,
    chatting,
    blocked,
    errors,
    messagesSent,
    durationSec,
    hardStop: Boolean(session?.hardStop),
    hardStopMessage: session?.hardStopMessage || null,
    meetCode: session?.meetCode || null,
    tone: session?.tone || null,
  };
}

export function formatDebriefExport({
  generatedAt = new Date(),
  stats,
  brief,
  tone,
  debriefText,
  model,
}) {
  const when = generatedAt.toISOString();
  const lines = [
    'PLATEIA CONSOLE — debrief de ensaio',
    `Gerado: ${when}`,
    model ? `Modelo: ${model}` : '',
    '',
    '— Resumo —',
    `Pedidos: ${stats.requested}`,
    `Entraram na call: ${stats.joined}`,
    `A conversar no chat: ${stats.chatting}`,
    `Mensagens enviadas: ${stats.messagesSent}`,
    `Falhas: ${stats.errors}`,
    `Bloqueados pelo Meet: ${stats.blocked}`,
    `Duração: ${stats.durationSec}s`,
    stats.meetCode ? `Sala: ${stats.meetCode}` : '',
    tone ? `Tom: ${tone}` : '',
    stats.hardStop ? `Paragem dura: ${stats.hardStopMessage || 'sim'}` : '',
    '',
    '— Brief —',
    brief || '(vazio)',
    '',
    '— Debrief —',
    debriefText || '(ainda não gerado)',
    '',
  ].filter((line) => line !== '');
  return `${lines.join('\n')}\n`;
}
