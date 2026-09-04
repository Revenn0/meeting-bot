const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';

export function isFreeModel(model = {}) {
  const id = String(model.id || '').toLowerCase();
  if (id.includes(':free') || id.endsWith('/free') || id.includes('/free:')) {
    return true;
  }
  const pricing = model.pricing || {};
  const prompt = pricing.prompt;
  const completion = pricing.completion;
  const promptFree = prompt === 0 || prompt === '0' || prompt === '0.0';
  const completionFree = completion === 0 || completion === '0' || completion === '0.0';
  return promptFree && completionFree;
}

export function summarizeModel(model = {}) {
  return {
    id: model.id,
    name: model.name || model.id,
    context: model.context_length || model.top_provider?.context_length || null,
    description: model.description || '',
  };
}

export function filterFreeModels(models = []) {
  const seen = new Set();
  const free = [];
  for (const model of models) {
    if (!isFreeModel(model) || !model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    free.push(summarizeModel(model));
  }
  free.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt'));
  return free;
}

export function createOpenRouter({
  fetchImpl = globalThis.fetch,
  referer = 'http://127.0.0.1:8787',
  title = 'Plateia Console',
} = {}) {
  const headers = (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': referer,
    'X-Title': title,
  });

  async function listFreeModels(apiKey) {
    if (!apiKey) {
      throw new Error('Cole a chave OpenRouter antes de listar modelos.');
    }
    const response = await fetchImpl(OPENROUTER_MODELS, {
      headers: headers(apiKey),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenRouter modelos HTTP ${response.status}: ${body.slice(0, 180)}`);
    }
    const data = await response.json();
    return filterFreeModels(data.data || data.models || []);
  }

  async function complete({ apiKey, model, messages, maxTokens = 700, temperature = 0.4 }) {
    if (!apiKey) throw new Error('Falta a chave OpenRouter.');
    if (!model) throw new Error('Escolha um modelo gratuito.');
    const response = await fetchImpl(OPENROUTER_CHAT, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenRouter chat HTTP ${response.status}: ${body.slice(0, 220)}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('O modelo não devolveu texto.');
    }
    return {
      text: String(text).trim(),
      model: data.model || model,
      usage: data.usage || null,
    };
  }

  async function testConnection({ apiKey, model }) {
    const result = await complete({
      apiKey,
      model,
      maxTokens: 24,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: 'Responde só com a palavra PLATEIA.',
        },
      ],
    });
    return {
      ok: /plateia/i.test(result.text),
      text: result.text,
      model: result.model,
    };
  }

  return { listFreeModels, complete, testConnection };
}
