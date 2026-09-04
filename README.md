# Plateia Console

Sala de controlo local para ensaiar apresentações com uma **plateia real** no Google Meet.

Até **15** convidados entram na tua sala e usam o **chat oficial**. Motor CHAT_ONLY já existente neste fork. Sem Modal. Sem upstream `beihaogu`.

UI em português. Design: sala de ensaio escura (tinta `#0B0F14`, âmbar `#F5A524`, menta `#3DDC97`).

## Victor — Windows

Lê **`INSTALAR.md`**. Resumo:

1. Instala [Node.js 20 LTS](https://nodejs.org).
2. `INSTALAR.bat` → `ABRIR.bat`
3. Cola a chave OpenRouter (fica em `user-data/.env`).
4. Escolhe um modelo **grátis**, testa, cola o link Meet, 1–15 convidados, brief, **Entrar em ensaio**.
5. Termina → debrief → exporta `.txt`.

```bat
npm install
npm start
```

Abre `http://127.0.0.1:8787`.

## Regras do produto

- Os bots **entram de verdade** no Google Meet (não é overlay).
- Chat = painel oficial da chamada.
- Teto **exato: 15**. `FLEET_SIZE` acima disso é recusado.
- A chave nunca vai para o git.

## API local

| Método | Caminho | Função |
|---|---|---|
| GET/POST | `/api/settings` | Guardar chave/modelo/preferências |
| GET/POST | `/api/models` · `/api/models/refresh` | Modelos grátis OpenRouter |
| POST | `/api/connection/test` | Ping ao modelo |
| POST | `/api/session/start\|pause\|resume\|stop` | Frota |
| GET | `/api/session` · `/api/session/events` | Estado + SSE |
| POST | `/api/debrief` | Texto via OpenRouter |
| GET | `/api/debrief/export` | `.txt` |

## Testes

```bash
npm test
```

Não contactam o Meet. A validação ao vivo precisa de um link teu, aberto.

## Motor CHAT_ONLY

`lib/` + `scripts/run-one-bot.js` + `scripts/run-fleet-live.js` continuam a ser o join/frota. A consola só orquestra, com teto 15.

`npm run bot:one` — um convidado via `.env`  
`npm run fleet:10` / `fleet:15` — frota local (`CONFIRM_LIVE=true`)

Ver `FLEET.md` e `DESIGN.md`.

## Licença

MIT
