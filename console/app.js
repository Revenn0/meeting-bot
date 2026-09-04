import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSettingsStore } from './settings-store.js';
import { createOpenRouter } from './openrouter.js';
import { createSessionController } from './session-controller.js';
import { parseMeetUrl } from '../lib/meet-url.js';
import { MAX_FLEET_SIZE, assertFleetSize } from '../lib/wave-planner.js';
import {
  TONES,
  briefToFleetPrompt,
  buildLocalFleet,
  defaultGuestNames,
  parseFleetAssignment,
} from './phrases.js';
import { buildDebriefPrompt, buildSessionStats, formatDebriefExport } from './debrief.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPlateiaApp({
  root,
  settingsStore: injectedStore,
  session: injectedSession,
  openrouter: injectedOpenrouter,
  publicDir = path.join(__dirname, 'public'),
} = {}) {
  const settingsStore = injectedStore || createSettingsStore({ root });
  const openrouter = injectedOpenrouter || createOpenRouter();
  const session = injectedSession || createSessionController({ root, settingsStore });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));
  app.use(express.static(publicDir));

  function sendError(res, error, status = 400) {
    res.status(status).json({ ok: false, error: error.message || String(error) });
  }

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'Plateia Console',
      maxBots: MAX_FLEET_SIZE,
      tones: TONES,
    });
  });

  app.get('/api/settings', (_req, res) => {
    res.json({ ok: true, settings: settingsStore.publicView() });
  });

  app.post('/api/settings', (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};
      if (body.openrouterApiKey !== undefined) {
        patch.openrouterApiKey = String(body.openrouterApiKey).trim();
      }
      if (body.model !== undefined) patch.model = String(body.model).trim();
      if (body.onboardingComplete !== undefined) {
        patch.onboardingComplete = Boolean(body.onboardingComplete);
      }
      if (body.lastMeetUrl !== undefined) patch.lastMeetUrl = String(body.lastMeetUrl);
      if (body.lastBotCount !== undefined) patch.lastBotCount = Number(body.lastBotCount);
      if (body.lastBrief !== undefined) patch.lastBrief = String(body.lastBrief);
      if (body.lastTone !== undefined) patch.lastTone = String(body.lastTone);
      if (body.extraPhrases !== undefined) patch.extraPhrases = String(body.extraPhrases);
      if (body.botNamePrefix !== undefined) patch.botNamePrefix = String(body.botNamePrefix);
      if (body.recordSeconds !== undefined) patch.recordSeconds = Number(body.recordSeconds);
      if (body.chatIntervalMs !== undefined) patch.chatIntervalMs = Number(body.chatIntervalMs);
      if (body.showChrome !== undefined) patch.showChrome = Boolean(body.showChrome);
      if (body.enrichPhrases !== undefined) patch.enrichPhrases = Boolean(body.enrichPhrases);
      const saved = settingsStore.save(patch);
      res.json({ ok: true, settings: settingsStore.publicView(saved) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/models', async (_req, res) => {
    try {
      const settings = settingsStore.load();
      if (!settings.openrouterApiKey) {
        throw new Error('Guarde a chave OpenRouter primeiro.');
      }
      const models = await openrouter.listFreeModels(settings.openrouterApiKey);
      settingsStore.save({ lastModels: models, lastModelsAt: Date.now() });
      res.json({ ok: true, models, refreshedAt: Date.now() });
    } catch (error) {
      sendError(res, error, 502);
    }
  });

  app.post('/api/models/refresh', async (_req, res) => {
    try {
      const settings = settingsStore.load();
      if (!settings.openrouterApiKey) {
        throw new Error('Guarde a chave OpenRouter primeiro.');
      }
      const models = await openrouter.listFreeModels(settings.openrouterApiKey);
      settingsStore.save({ lastModels: models, lastModelsAt: Date.now() });
      res.json({ ok: true, models, refreshedAt: Date.now() });
    } catch (error) {
      sendError(res, error, 502);
    }
  });

  app.post('/api/connection/test', async (req, res) => {
    try {
      const settings = settingsStore.load();
      const apiKey = String(req.body?.openrouterApiKey || settings.openrouterApiKey || '').trim();
      const model = String(req.body?.model || settings.model || '').trim();
      if (!apiKey) throw new Error('Falta a chave OpenRouter.');
      if (!model) throw new Error('Escolha um modelo gratuito.');
      const result = await openrouter.testConnection({ apiKey, model });
      settingsStore.save({
        ...(req.body?.openrouterApiKey ? { openrouterApiKey: apiKey } : {}),
        model,
      });
      res.json({ ok: true, result });
    } catch (error) {
      sendError(res, error, 502);
    }
  });

  app.post('/api/meet/validate', (req, res) => {
    res.json(parseMeetUrl(req.body?.meetUrl));
  });

  async function resolveFleetFromBrief({
    brief,
    tone,
    extraPhrases,
    botCount,
    botNamePrefix,
    enrichPhrases,
  }) {
    const count = assertFleetSize(botCount);
    const names = defaultGuestNames(count, botNamePrefix);
    const topic = String(brief || '').trim();
    const local = buildLocalFleet({
      brief: topic,
      tone,
      extraPhrases,
      botCount: count,
      botNames: names,
    });
    const wantEnrich = enrichPhrases !== false;
    const settings = settingsStore.load();
    const hasAi = Boolean(settings.openrouterApiKey && settings.model);

    if (wantEnrich && !topic) {
      const error = new Error(
        'Escreve o brief da apresentação para a IA gerar falas distintas por convidado.',
      );
      error.status = 400;
      error.code = 'BRIEF_REQUIRED';
      throw error;
    }

    if (!wantEnrich || !hasAi) {
      const warning = wantEnrich && !hasAi
        ? 'Sem chave ou modelo OpenRouter — a usar banco local a partir do brief.'
        : '';
      return {
        fleet: { ...local, source: 'local' },
        source: 'local',
        model: '',
        warning,
        enriched: false,
      };
    }

    try {
      const generated = await openrouter.complete({
        apiKey: settings.openrouterApiKey,
        model: settings.model,
        maxTokens: 2000,
        temperature: 0.6,
        messages: [
          {
            role: 'system',
            content: 'Devolve só JSON válido com falas de plateia. Sem markdown, sem prosa.',
          },
          {
            role: 'user',
            content: briefToFleetPrompt({
              brief: topic,
              tone,
              extraPhrases,
              botCount: count,
              botNames: names,
            }),
          },
        ],
      });
      const fleet = parseFleetAssignment(generated.text, {
        botCount: count,
        botNames: names,
        fallback: local,
        tone,
      });
      if (fleet.parsed === 'fallback') {
        return {
          fleet: { ...local, source: 'local' },
          source: 'local',
          model: generated.model || settings.model,
          warning: 'O modelo não devolveu falas válidas — a usar banco local.',
          enriched: false,
        };
      }
      return {
        fleet: { ...fleet, source: 'openrouter' },
        source: 'openrouter',
        model: generated.model || settings.model,
        warning: '',
        enriched: true,
      };
    } catch (error) {
      const warning = `OpenRouter falhou — a usar banco local. ${error.message}`;
      console.warn('[plateia] phrase enrich skipped:', error.message);
      return {
        fleet: { ...local, source: 'local' },
        source: 'local',
        model: settings.model,
        warning,
        enriched: false,
      };
    }
  }

  app.get('/api/session', (_req, res) => {
    res.json({ ok: true, session: session.snapshot() });
  });

  app.post('/api/phrases/preview', async (req, res) => {
    try {
      const settings = settingsStore.load();
      const body = req.body || {};
      const resolved = await resolveFleetFromBrief({
        brief: body.brief,
        tone: body.tone || settings.lastTone,
        extraPhrases: body.extraPhrases,
        botCount: body.botCount || settings.lastBotCount,
        botNamePrefix: body.botNamePrefix || settings.botNamePrefix,
        enrichPhrases: body.enrichPhrases,
      });
      res.json({
        ok: true,
        source: resolved.source,
        model: resolved.model,
        warning: resolved.warning,
        enriched: resolved.enriched,
        bots: resolved.fleet.bots,
      });
    } catch (error) {
      sendError(res, error, error.status || 400);
    }
  });

  app.post('/api/session/start', async (req, res) => {
    try {
      const settings = settingsStore.load();
      const body = req.body || {};
      const resolved = await resolveFleetFromBrief({
        brief: body.brief,
        tone: body.tone || settings.lastTone,
        extraPhrases: body.extraPhrases,
        botCount: body.botCount || settings.lastBotCount,
        botNamePrefix: body.botNamePrefix || settings.botNamePrefix,
        enrichPhrases: body.enrichPhrases,
      });
      if (body.enrichPhrases !== undefined || resolved.enriched) {
        settingsStore.save({ enrichPhrases: body.enrichPhrases !== false });
      }
      const snap = await session.start({
        meetUrl: body.meetUrl,
        botCount: body.botCount,
        brief: body.brief,
        tone: body.tone || settings.lastTone,
        extraPhrases: body.extraPhrases,
        recordSeconds: body.recordSeconds ?? settings.recordSeconds,
        chatIntervalMs: body.chatIntervalMs ?? settings.chatIntervalMs,
        botNamePrefix: body.botNamePrefix || settings.botNamePrefix,
        showChrome: body.showChrome ?? settings.showChrome,
        fleet: resolved.fleet,
        phrases: resolved.fleet.bots.map((bot) => bot.messages[0]),
        phraseSource: resolved.source,
        phraseWarning: resolved.warning,
      });
      res.json({
        ok: true,
        session: snap,
        source: resolved.source,
        warning: resolved.warning,
      });
    } catch (error) {
      sendError(res, error, error.status || 400);
    }
  });

  app.post('/api/session/pause', async (_req, res) => {
    try {
      res.json({ ok: true, session: await session.pause() });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/session/resume', async (_req, res) => {
    try {
      res.json({ ok: true, session: await session.resume() });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/session/stop', async (_req, res) => {
    try {
      res.json({ ok: true, session: await session.stop() });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/session/reset', async (_req, res) => {
    try {
      if (typeof session.reset === 'function') {
        res.json({ ok: true, session: session.reset() });
        return;
      }
      res.json({ ok: true, session: session.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/session/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: 'session', payload: session.snapshot() })}\n\n`);
    const unsubscribe = session.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    req.on('close', unsubscribe);
  });

  app.post('/api/debrief', async (req, res) => {
    try {
      const snap = session.snapshot();
      if (snap.phase === 'idle') {
        throw new Error('Ainda não há ensaio para analisar.');
      }
      const settings = settingsStore.load();
      const stats = buildSessionStats(snap);
      const prompt = buildDebriefPrompt({
        stats,
        brief: snap.brief,
        tone: snap.tone,
        extraPhrases: snap.extraPhrases,
      });
      const result = await openrouter.complete({
        apiKey: settings.openrouterApiKey,
        model: req.body?.model || settings.model,
        maxTokens: 700,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
      });
      session.setDebrief({ text: result.text, model: result.model });
      res.json({
        ok: true,
        debrief: result.text,
        model: result.model,
        stats,
        exportText: formatDebriefExport({
          stats,
          brief: snap.brief,
          tone: snap.tone,
          debriefText: result.text,
          model: result.model,
        }),
      });
    } catch (error) {
      sendError(res, error, 502);
    }
  });

  app.get('/api/debrief/export', (_req, res) => {
    const snap = session.snapshot();
    const stats = buildSessionStats(snap);
    const text = formatDebriefExport({
      stats,
      brief: snap.brief,
      tone: snap.tone,
      debriefText: snap.debriefText,
      model: snap.debriefModel,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="plateia-debrief.txt"');
    res.send(text);
  });

  app.use((error, _req, res, _next) => {
    sendError(res, error, 500);
  });

  return { app, settingsStore, session, openrouter };
}
