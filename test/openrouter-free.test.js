import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterFreeModels, isFreeModel, createOpenRouter } from '../console/openrouter.js';

describe('OpenRouter free filter', () => {
  it('keeps :free and zero-priced models', () => {
    const models = filterFreeModels([
      { id: 'google/gemma-2-9b-it:free', name: 'Gemma free', pricing: { prompt: '0', completion: '0' } },
      { id: 'openai/gpt-4o', name: 'Paid', pricing: { prompt: '0.005', completion: '0.015' } },
      { id: 'meta/llama-zero', name: 'Zero', pricing: { prompt: 0, completion: 0 } },
    ]);
    assert.deepEqual(models.map((m) => m.id), [
      'google/gemma-2-9b-it:free',
      'meta/llama-zero',
    ]);
    assert.equal(isFreeModel({ id: 'x/y:free' }), true);
    assert.equal(isFreeModel({ id: 'x/y', pricing: { prompt: '1', completion: '0' } }), false);
  });

  it('lists and completes through the injected fetch', async () => {
    const fetchImpl = async (url, options) => {
      if (String(url).includes('/models')) {
        return {
          ok: true,
          async json() {
            return { data: [{ id: 'test/free:free', name: 'Test Free', pricing: { prompt: '0', completion: '0' } }] };
          },
        };
      }
      assert.match(options.body, /PLATEIA|ensaio|user/);
      return {
        ok: true,
        async json() {
          return { model: 'test/free:free', choices: [{ message: { content: 'PLATEIA' } }] };
        },
      };
    };
    const client = createOpenRouter({ fetchImpl });
    const models = await client.listFreeModels('sk-test');
    assert.equal(models[0].id, 'test/free:free');
    const ping = await client.testConnection({ apiKey: 'sk-test', model: 'test/free:free' });
    assert.equal(ping.ok, true);
  });
});
