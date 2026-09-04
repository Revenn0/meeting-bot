const TONES = [
  { id: 'formal', label: 'Formal' },
  { id: 'curioso', label: 'Curioso' },
  { id: 'apoiador', label: 'Apoiador' },
  { id: 'direto', label: 'Direto' },
  { id: 'entusiasta', label: 'Entusiasta' },
  { id: 'critico', label: 'Crítico' },
];

const PHASE_LABEL = {
  idle: 'STANDBY',
  live: 'AO VIVO',
  paused: 'PAUSA',
  ended: 'FIM',
};

const STATUS_LABEL = {
  launching: 'A lançar',
  joined: 'Na sala',
  chatting: 'No chat',
  error: 'Erro',
  blocked: 'Bloqueado',
};

const state = {
  view: 'setup',
  onboardStep: 1,
  settings: null,
  models: [],
  selectedModel: '',
  session: null,
  tone: 'curioso',
  meetOk: false,
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function showView(name) {
  state.view = name;
  for (const section of document.querySelectorAll('.view')) {
    section.hidden = section.id !== `view-${name}`;
  }
  for (const btn of document.querySelectorAll('.nav-btn')) {
    btn.classList.toggle('on', btn.dataset.view === name);
  }
}

function setMeter(joined, requested = 15, live = false) {
  const cap = 15;
  const fill = $('meterFill');
  const count = $('meterCount');
  const circ = 2 * Math.PI * 50;
  const value = Math.max(0, Math.min(cap, joined || 0));
  fill.style.strokeDasharray = String(circ);
  fill.style.strokeDashoffset = String(circ - (value / cap) * circ);
  count.textContent = String(value);
  document.querySelector('.meter-wrap').classList.toggle('is-live', live);
}

function setPhase(phase) {
  const pill = $('phasePill');
  pill.dataset.phase = phase;
  pill.textContent = PHASE_LABEL[phase] || phase;
}

function renderTones() {
  const box = $('toneField');
  box.innerHTML = '<legend>Tom da plateia</legend>';
  for (const tone of TONES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tone${tone.id === state.tone ? ' on' : ''}`;
    btn.textContent = tone.label;
    btn.addEventListener('click', () => {
      state.tone = tone.id;
      renderTones();
    });
    box.appendChild(btn);
  }
}

function setOnboardStep(step) {
  state.onboardStep = step;
  for (let i = 1; i <= 4; i += 1) {
    const panel = $(`onboard-${i}`);
    if (panel) panel.hidden = i !== step;
  }
  [...$('onboardSteps').children].forEach((li, index) => {
    li.classList.toggle('on', index === step - 1);
  });
}

function renderModels(models, selected) {
  const list = $('modelList');
  list.innerHTML = '';
  if (!models.length) {
    list.innerHTML = '<p class="hint">Nenhum modelo gratuito encontrado. Atualiza a lista.</p>';
    return;
  }
  for (const model of models) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `model-item${model.id === selected ? ' on' : ''}`;
    btn.innerHTML = `<strong>${model.name || model.id}</strong><small>${model.id}</small>`;
    btn.addEventListener('click', () => {
      state.selectedModel = model.id;
      renderModels(models, model.id);
      $('onboardPickModel').disabled = false;
    });
    list.appendChild(btn);
  }
}

function applySettings(settings) {
  state.settings = settings;
  state.selectedModel = settings.model || state.selectedModel;
  state.tone = settings.lastTone || state.tone;
  $('modelChip').textContent = settings.model ? settings.model : 'modelo —';
  if (settings.lastMeetUrl) $('meetUrl').value = settings.lastMeetUrl;
  if (settings.lastBotCount) setCount(settings.lastBotCount);
  if (settings.lastBrief) $('brief').value = settings.lastBrief;
  if (settings.extraPhrases) $('extraPhrases').value = settings.extraPhrases;
  if (settings.recordSeconds) $('recordSeconds').value = settings.recordSeconds;
  $('showChrome').checked = settings.showChrome !== false;
  renderTones();
}

function setCount(n) {
  const value = Math.max(1, Math.min(15, Number(n) || 1));
  $('botCount').value = value;
  $('botSlider').value = value;
}

function countersHtml(c = {}) {
  const items = [
    ['A lançar', c.launching || 0],
    ['Na sala', (c.joined || 0) + (c.chatting || 0)],
    ['No chat', c.chatting || 0],
    ['Mensagens', c.messagesSent || 0],
    ['Erros', c.error || 0],
    ['Bloqueio', c.blocked || 0],
  ];
  return items.map(([label, value]) => (
    `<div class="counter"><b>${value}</b><span>${label}</span></div>`
  )).join('');
}

function renderSession(session) {
  state.session = session;
  const counters = session.counters || {};
  const joined = (counters.joined || 0) + (counters.chatting || 0);
  setMeter(joined, session.botCount || 15, session.phase === 'live' || session.phase === 'paused');
  setPhase(session.phase || 'idle');
  $('railChat').textContent = String(counters.messagesSent || 0);
  $('railFail').textContent = String(counters.error || 0);
  $('railBlock').textContent = String(counters.blocked || 0);

  $('liveCounters').innerHTML = countersHtml(counters);
  $('debriefCounters').innerHTML = countersHtml(counters);
  $('botGrid').innerHTML = (session.bots || []).map((bot) => `
    <div class="bot" data-status="${bot.status}">
      <strong>${bot.name}</strong>
      <div class="st">${STATUS_LABEL[bot.status] || bot.status}${bot.sent ? ` · ${bot.sent} msg` : ''}</div>
    </div>
  `).join('');

  const log = (session.log || []).map((row) => row.line || row).join('\n');
  const liveLog = $('liveLog');
  liveLog.textContent = log;
  liveLog.scrollTop = liveLog.scrollHeight;

  $('pauseBtn').textContent = session.phase === 'paused' ? 'Retomar' : 'Pausar';
  if (session.phase === 'live' || session.phase === 'paused') {
    $('liveTitle').textContent = session.phase === 'paused'
      ? 'Ensaio em pausa.'
      : 'A plateia está na sala.';
    $('liveKicker').textContent = session.meetCode || 'Ao vivo';
  }
  if (session.debriefText) {
    $('debriefBody').textContent = session.debriefText;
  }

  if (session.phase === 'ended' && state.view === 'live') {
    showView('debrief');
  }
}

async function refreshModels() {
  $('modelsMeta').textContent = 'A pedir lista gratuita…';
  const data = await api('/api/models/refresh', { method: 'POST' });
  state.models = data.models || [];
  $('modelsMeta').textContent = `${state.models.length} modelos grátis`;
  renderModels(state.models, state.selectedModel);
  if (state.selectedModel) $('onboardPickModel').disabled = false;
}

async function validateMeet() {
  const meetUrl = $('meetUrl').value.trim();
  const data = await fetch('/api/meet/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetUrl }),
  }).then((res) => res.json());
  const hint = $('meetHint');
  state.meetOk = Boolean(data.ok);
  hint.textContent = data.ok ? `Sala ${data.code}` : (data.error || 'Link inválido');
  hint.className = `hint ${data.ok ? 'ok' : 'bad'}`;
  return data;
}

function pollSession() {
  setInterval(async () => {
    if (!state.session || (state.session.phase !== 'live' && state.session.phase !== 'paused')) {
      return;
    }
    try {
      const data = await api('/api/session');
      renderSession(data.session);
    } catch {
      // keep last snapshot
    }
  }, 1200);
}

function bind() {
  for (const btn of document.querySelectorAll('.nav-btn')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }
  $('settingsBtn').addEventListener('click', () => {
    showView('onboarding');
    setOnboardStep(2);
  });
  $('onboardNext1').addEventListener('click', () => setOnboardStep(2));
  $('onboardBack2').addEventListener('click', () => setOnboardStep(1));
  $('onboardBack3').addEventListener('click', () => setOnboardStep(2));
  $('onboardBack4').addEventListener('click', () => setOnboardStep(3));
  $('onboardSaveKey').addEventListener('click', async () => {
    const key = $('onboardKey').value.trim();
    if (!key) {
      $('onboardKeyHint').textContent = 'Cola a chave primeiro.';
      return;
    }
    try {
      await api('/api/settings', { method: 'POST', body: { openrouterApiKey: key } });
      $('onboardKeyHint').textContent = 'Guardada em user-data/.env';
      setOnboardStep(3);
      await refreshModels();
    } catch (error) {
      $('onboardKeyHint').textContent = error.message;
    }
  });
  $('refreshModels').addEventListener('click', () => refreshModels().catch((error) => {
    $('modelsMeta').textContent = error.message;
  }));
  $('onboardPickModel').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: { model: state.selectedModel } });
    $('modelChip').textContent = state.selectedModel;
    setOnboardStep(4);
  });
  $('testConnection').addEventListener('click', async () => {
    $('testLog').textContent = 'A testar…';
    try {
      const data = await api('/api/connection/test', {
        method: 'POST',
        body: { model: state.selectedModel },
      });
      $('testLog').textContent = `OK · ${data.result.model}\n${data.result.text}`;
      $('finishOnboard').hidden = false;
    } catch (error) {
      $('testLog').textContent = error.message;
    }
  });
  $('finishOnboard').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: { onboardingComplete: true, model: state.selectedModel } });
    showView('setup');
  });
  $('countMinus').addEventListener('click', () => setCount(Number($('botCount').value) - 1));
  $('countPlus').addEventListener('click', () => setCount(Number($('botCount').value) + 1));
  $('botCount').addEventListener('input', () => setCount($('botCount').value));
  $('botSlider').addEventListener('input', () => setCount($('botSlider').value));
  $('meetUrl').addEventListener('blur', () => validateMeet().catch(() => {}));
  $('meetUrl').addEventListener('input', () => {
    $('meetHint').className = 'hint';
    $('meetHint').textContent = 'Sala aberta, aba do host ligada.';
  });
  $('startSession').addEventListener('click', async () => {
    $('setupError').hidden = true;
    try {
      const meet = await validateMeet();
      if (!meet.ok) throw new Error(meet.error);
      const data = await api('/api/session/start', {
        method: 'POST',
        body: {
          meetUrl: $('meetUrl').value.trim(),
          botCount: Number($('botCount').value),
          brief: $('brief').value,
          tone: state.tone,
          extraPhrases: $('extraPhrases').value,
          recordSeconds: Number($('recordSeconds').value),
          showChrome: $('showChrome').checked,
        },
      });
      renderSession(data.session);
      showView('live');
    } catch (error) {
      $('setupError').hidden = false;
      $('setupError').textContent = error.message;
    }
  });
  $('pauseBtn').addEventListener('click', async () => {
    const path = state.session?.phase === 'paused' ? '/api/session/resume' : '/api/session/pause';
    const data = await api(path, { method: 'POST' });
    renderSession(data.session);
  });
  $('stopBtn').addEventListener('click', async () => {
    const data = await api('/api/session/stop', { method: 'POST' });
    renderSession(data.session);
    showView('debrief');
  });
  $('generateDebrief').addEventListener('click', async () => {
    $('debriefError').hidden = true;
    $('debriefBody').textContent = 'A escrever o debrief…';
    try {
      const data = await api('/api/debrief', { method: 'POST' });
      $('debriefBody').textContent = data.debrief;
    } catch (error) {
      $('debriefError').hidden = false;
      $('debriefError').textContent = error.message;
    }
  });
  $('newSession').addEventListener('click', () => showView('setup'));
}

async function boot() {
  bind();
  renderTones();
  setMeter(0, 15, false);
  const health = await api('/api/health');
  const settingsData = await api('/api/settings');
  applySettings(settingsData.settings);
  const sessionData = await api('/api/session');
  renderSession(sessionData.session);

  if (!settingsData.settings.onboardingComplete || !settingsData.settings.hasKey) {
    showView('onboarding');
    setOnboardStep(1);
  } else if (sessionData.session.phase === 'live' || sessionData.session.phase === 'paused') {
    showView('live');
  } else if (sessionData.session.phase === 'ended') {
    showView('debrief');
  } else {
    showView('setup');
  }

  if (settingsData.settings.hasKey && settingsData.settings.lastModels?.length) {
    state.models = settingsData.settings.lastModels;
    renderModels(state.models, state.selectedModel);
  }
  $('modelChip').title = `Teto ${health.maxBots}`;
  pollSession();
}

boot().catch((error) => {
  document.body.insertAdjacentHTML('beforeend', `<p class="warn">${error.message}</p>`);
});
