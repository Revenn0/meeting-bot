import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { runAccumulatingFleet } from '../lib/fleet-runner.js';
import { spawnLiveGuest } from '../lib/fleet-spawn.js';
import {
  MAX_FLEET_SIZE,
  assertFleetSize,
  estimateJoinWaitMs,
  estimateMinRecordSeconds,
  planWaves,
} from '../lib/wave-planner.js';
import {
  parseBotJoinLine,
  parseBotResultLine,
  parseBotStatusLine,
  parseChatSentLine,
} from '../lib/bot-result.js';
import { writeSessionControl } from '../lib/session-control.js';
import { assertMeetUrl } from '../lib/meet-url.js';
import { buildLocalFleet, messagesForBot, primaryPhrases } from './phrases.js';
import { buildSessionStats } from './debrief.js';

const UI_STATUSES = ['launching', 'joined', 'chatting', 'error', 'blocked'];

function mapJoinToUi(status) {
  if (status === 'in-call') return 'joined';
  if (status === 'blocked') return 'blocked';
  if (status === 'not-in-call' || status === 'fatal') return 'error';
  return 'launching';
}

export function createEmptySession() {
  return {
    id: null,
    phase: 'idle',
    startedAt: null,
    endedAt: null,
    meetUrl: '',
    meetCode: '',
    botCount: 0,
    brief: '',
    tone: 'curioso',
    extraPhrases: '',
    recordSeconds: 180,
    phrases: [],
    fleet: null,
    phraseSource: 'local',
    phraseWarning: '',
    bots: [],
    log: [],
    hardStop: false,
    hardStopMessage: null,
    debriefText: '',
    debriefModel: '',
    paused: false,
  };
}

export function buildGuestChatEnv({
  messages,
  recordSeconds,
  chatIntervalMs,
  showChrome,
  controlFile,
}) {
  const list = (Array.isArray(messages) && messages.length)
    ? messages.map((line) => String(line).trim()).filter(Boolean)
    : ['Olá — estou a acompanhar.'];
  return {
    CHAT_MESSAGE: list[0],
    CHAT_MESSAGES_JSON: JSON.stringify(list),
    RECORD_SECONDS: String(recordSeconds),
    CHAT_INTERVAL_MS: String(chatIntervalMs),
    HEADLESS: showChrome ? 'false' : 'true',
    WINDOW_SIZE: '1280x720',
    SESSION_CONTROL_FILE: controlFile,
    MODE: 'chat-only',
  };
}

export function createSessionController({
  root,
  settingsStore,
  launchGuest,
  spawnGuest,
  now = () => Date.now(),
  logLimit = 400,
} = {}) {
  let session = createEmptySession();
  const listeners = new Set();
  let runPromise = null;
  let liveGuests = [];
  const controlFile = settingsStore
    ? path.join(settingsStore.dir, 'session-control.json')
    : path.join(root || process.cwd(), 'user-data', 'session-control.json');

  const emit = (type, payload) => {
    const event = { type, at: now(), payload };
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // ignore subscriber errors
      }
    }
  };

  const appendLog = (line) => {
    const text = String(line || '').trimEnd();
    if (!text) return;
    session.log.push({ at: now(), line: text });
    if (session.log.length > logLimit) {
      session.log.splice(0, session.log.length - logLimit);
    }
    emit('log', { line: text });
  };

  const findBot = (name, botIndex) => {
    return session.bots.find((bot) => (
      (name && bot.name === name) || (Number.isFinite(botIndex) && bot.index === botIndex)
    ));
  };

  const applyLine = (line, hint = {}) => {
    const bot = findBot(hint.name, hint.botIndex);
    const join = parseBotJoinLine(line);
    if (join && bot) {
      bot.status = mapJoinToUi(join.status);
      bot.reason = join.reason || bot.reason;
      if (bot.status === 'joined' || bot.status === 'chatting') {
        bot.joined = true;
        bot.joinedAt = bot.joinedAt || now();
      }
      emit('bot', { ...bot });
    }
    const status = parseBotStatusLine(line);
    if (status && bot) {
      if (status.status === 'chatting') bot.status = 'chatting';
      if (Number.isFinite(status.sent)) bot.sent = status.sent;
      emit('bot', { ...bot });
    }
    const result = parseBotResultLine(line);
    if (result && bot) {
      if (Number.isFinite(result.sent)) bot.sent = result.sent;
      if (result.chat && bot.status === 'joined') bot.status = 'chatting';
      emit('bot', { ...bot });
    }
    const sent = parseChatSentLine(line);
    if (sent && bot) {
      bot.sent = Math.max(bot.sent || 0, sent.sent);
      if (bot.status === 'joined') bot.status = 'chatting';
      emit('bot', { ...bot });
    }
  };

  const snapshot = () => {
    const stats = buildSessionStats(session);
    const counters = {
      launching: session.bots.filter((bot) => bot.status === 'launching').length,
      joined: session.bots.filter((bot) => bot.status === 'joined').length,
      chatting: session.bots.filter((bot) => bot.status === 'chatting').length,
      error: session.bots.filter((bot) => bot.status === 'error').length,
      blocked: session.bots.filter((bot) => bot.status === 'blocked').length,
      messagesSent: stats.messagesSent,
      inCall: stats.joined,
    };
    return {
      ...session,
      log: session.log.slice(-120),
      counters,
      stats,
      maxBots: MAX_FLEET_SIZE,
    };
  };

  const writeControl = () => {
    writeSessionControl(controlFile, {
      paused: session.paused,
      stop: session.phase === 'ended',
      sessionId: session.id,
    });
  };

  const stopChildren = (signal = 'SIGTERM') => {
    for (const guest of liveGuests) {
      if (guest.child && !guest.child.killed) {
        guest.child.kill(signal);
      }
    }
  };

  const defaultLaunch = (bot, context) => {
    const messages = messagesForBot(context.fleet, bot.botIndex);
    const spawn = spawnGuest || spawnLiveGuest;
    const guest = spawn({
      name: bot.name,
      botIndex: bot.botIndex,
      meetUrl: context.meetUrl,
      root,
      extraEnv: buildGuestChatEnv({
        messages,
        recordSeconds: context.recordSeconds,
        chatIntervalMs: context.chatIntervalMs,
        showChrome: context.showChrome,
        controlFile,
      }),
      onLog: (line) => {
        appendLog(line);
        applyLine(line, { name: bot.name, botIndex: bot.botIndex });
      },
    });
    liveGuests.push(guest);
    return guest;
  };

  async function start(input) {
    if (session.phase === 'live' || session.phase === 'paused') {
      throw new Error('Já existe um ensaio a decorrer. Pare-o antes de começar outro.');
    }
    const parsed = assertMeetUrl(input.meetUrl);
    const botCount = assertFleetSize(input.botCount);
    const recordSeconds = Math.max(30, Number.parseInt(input.recordSeconds, 10) || 180);
    const chatIntervalMs = Math.max(1000, Number.parseInt(input.chatIntervalMs, 10) || 8000);
    const tone = input.tone || 'curioso';
    const brief = String(input.brief || '').slice(0, 4000);
    const extraPhrases = String(input.extraPhrases || '').slice(0, 2000);
    const namePrefix = String(input.botNamePrefix || 'Plateia').replace(/\s+/g, '-').slice(0, 24);
    const showChrome = input.showChrome !== false;
    const waves = planWaves({
      total: botCount,
      waveSize: Math.min(8, botCount),
      namePrefix,
    });
    const botNames = waves.flatMap((wave) => wave.bots.map((bot) => bot.name));
    const fleet = input.fleet?.bots?.length
      ? {
        ...input.fleet,
        bots: botNames.map((name, i) => ({
          index: i + 1,
          name: input.fleet.bots[i]?.name || name,
          messages: input.fleet.bots[i]?.messages?.length
            ? input.fleet.bots[i].messages
            : messagesForBot(input.fleet, i),
        })),
      }
      : (input.phrases?.length
        ? {
          bots: botNames.map((name, i) => ({
            index: i + 1,
            name,
            messages: [input.phrases[i % input.phrases.length]],
          })),
          source: input.phraseSource || 'local',
        }
        : buildLocalFleet({ brief, tone, extraPhrases, botCount, botNames }));
    const phrases = primaryPhrases(fleet);

    session = {
      ...createEmptySession(),
      id: randomUUID(),
      phase: 'live',
      startedAt: now(),
      meetUrl: parsed.href,
      meetCode: parsed.code,
      botCount,
      brief,
      tone,
      extraPhrases,
      recordSeconds,
      phrases,
      fleet,
      phraseSource: input.phraseSource || fleet.source || 'local',
      phraseWarning: input.phraseWarning || '',
      bots: waves.flatMap((wave) => wave.bots.map((bot) => ({
        name: bot.name,
        index: bot.botIndex,
        status: 'launching',
        sent: 0,
        joined: false,
        reason: '',
        joinedAt: null,
        messages: messagesForBot(fleet, bot.botIndex),
      }))),
    };
    liveGuests = [];
    writeControl();
    appendLog(`[plateia] Ensaio ${session.id.slice(0, 8)} · ${botCount} convidados · ${parsed.code}`);
    appendLog(`[plateia] Falas: ${session.phraseSource}${session.phraseWarning ? ` · ${session.phraseWarning}` : ''}`);
    emit('session', snapshot());

    if (settingsStore) {
      settingsStore.save({
        lastMeetUrl: parsed.href,
        lastBotCount: botCount,
        lastBrief: brief,
        lastTone: tone,
        extraPhrases,
        botNamePrefix: namePrefix,
        recordSeconds,
        chatIntervalMs,
        showChrome,
      });
    }

    const joinTimeoutMs = estimateJoinWaitMs({});
    const wavePauseMs = 5000;
    const minRecord = estimateMinRecordSeconds({
      waveCount: waves.length,
      joinWaitMs: joinTimeoutMs,
      wavePauseMs,
    });
    const staySeconds = Math.max(recordSeconds, minRecord);
    session.recordSeconds = staySeconds;

    const launch = launchGuest || ((bot) => defaultLaunch(bot, {
      meetUrl: parsed.href,
      fleet,
      phrases,
      recordSeconds: staySeconds,
      chatIntervalMs,
      showChrome,
    }));

    runPromise = runAccumulatingFleet({
      waves,
      launchGuest: launch,
      concurrency: 2,
      staggerMs: 1500,
      wavePauseMs,
      joinTimeoutMs,
      onLog: appendLog,
      shouldAbort: () => session.phase === 'ended' || session.paused,
    }).then((result) => {
      session.hardStop = Boolean(result.hardStop);
      session.hardStopMessage = result.hardStopMessage || null;
      if (session.phase !== 'ended') {
        session.phase = 'ended';
        session.endedAt = now();
        session.paused = false;
        writeControl();
        appendLog('[plateia] Ensaio terminado.');
        emit('session', snapshot());
      }
      return result;
    }).catch((error) => {
      appendLog(`[plateia] Erro da frota: ${error.message}`);
      session.phase = 'ended';
      session.endedAt = now();
      writeControl();
      emit('session', snapshot());
      throw error;
    });

    return snapshot();
  }

  async function pause() {
    if (session.phase !== 'live') {
      throw new Error('Não há ensaio a decorrer para pausar.');
    }
    session.paused = true;
    session.phase = 'paused';
    writeControl();
    appendLog('[plateia] Pausa — não entram mais convidados; o chat oficial pára de enviar.');
    emit('session', snapshot());
    return snapshot();
  }

  async function resume() {
    if (session.phase !== 'paused') {
      throw new Error('O ensaio não está em pausa.');
    }
    session.paused = false;
    session.phase = 'live';
    writeControl();
    appendLog('[plateia] A retomar o chat oficial.');
    emit('session', snapshot());
    return snapshot();
  }

  async function stop() {
    if (session.phase === 'idle') {
      throw new Error('Não há ensaio para parar.');
    }
    if (session.phase === 'ended') {
      return snapshot();
    }
    session.phase = 'ended';
    session.endedAt = now();
    session.paused = false;
    writeControl();
    appendLog('[plateia] A parar convidados…');
    stopChildren('SIGTERM');
    emit('session', snapshot());
    try {
      await Promise.race([
        runPromise || Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    } catch {
      // already logged
    }
    return snapshot();
  }

  return {
    start,
    pause,
    resume,
    stop,
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get controlFile() {
      return controlFile;
    },
    get phase() {
      return session.phase;
    },
    setDebrief({ text, model }) {
      session.debriefText = text || '';
      session.debriefModel = model || '';
      emit('session', snapshot());
      return snapshot();
    },
    reset() {
      if (session.phase === 'live' || session.phase === 'paused') {
        throw new Error('Para o ensaio atual antes de limpar a consola.');
      }
      session = createEmptySession();
      liveGuests = [];
      writeControl();
      emit('session', snapshot());
      return snapshot();
    },
  };
}
