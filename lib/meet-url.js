const MEET_HOST = /(^|\.)meet\.google\.com$/i;
const PLACEHOLDER = /YOUR-MEET-CODE/i;
const ROOM_CODE = /\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)/i;
const LOOKUP = /\/lookup\/([a-z0-9_-]+)/i;

export function parseMeetUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return { ok: false, error: 'Cole o link da sala Google Meet.' };
  }
  if (PLACEHOLDER.test(text)) {
    return { ok: false, error: 'Substitua o placeholder pelo link real da sala.' };
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'Isto não parece um URL válido.' };
  }

  if (!/^https?:$/i.test(url.protocol)) {
    return { ok: false, error: 'O link tem de começar por https://' };
  }
  if (!MEET_HOST.test(url.hostname)) {
    return { ok: false, error: 'Usa um link meet.google.com (não Zoom nem outro serviço).' };
  }

  const room = text.match(ROOM_CODE);
  const lookup = text.match(LOOKUP);
  if (!room && !lookup) {
    return {
      ok: false,
      error: 'Falta o código da sala (ex.: abc-defg-hij).',
    };
  }

  return {
    ok: true,
    href: url.href,
    code: room ? room[1].toLowerCase() : lookup[1],
  };
}

export function assertMeetUrl(raw) {
  const parsed = parseMeetUrl(raw);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed;
}
