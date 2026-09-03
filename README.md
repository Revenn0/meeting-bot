# Meeting Bot — CHAT_ONLY

One guest joins **your** Google Meet room with camera and microphone off, then uses the **official in-call Meet chat** (not an overlay).

---

## Victor — run this tomorrow morning / rode isso de manhã

**EN**

1. Install [Node.js 20 LTS](https://nodejs.org) if needed (`node -v` should be `v20` or newer).
2. Open a **Meet room in Chrome** and copy the link. Keep that host tab open. Prefer an **open** room so the guest sees **Join now**.
3. In this folder:

```bat
copy .env.example .env
notepad .env
```

Set `MEET_URL`, `BOT_NAME`, `MODE=chat-only`, `CHAT_MESSAGE`. Then:

```bat
npm install
npm start
```

Or double-click `start.bat` / run `.\start.ps1`. Watch Chrome: name → Join now → Leave call appears → official chat opens → messages send → bot leaves after `RECORD_SECONDS`.

**PT-BR**

1. Instale o [Node.js 20 LTS](https://nodejs.org) (`node -v` ≥ 20).
2. Abra uma **sala Meet no Chrome**, copie o link e **deixe a aba do host aberta**. Sala aberta = botão **Entrar agora / Join now**.
3. Nesta pasta: copie `.env.example` → `.env`, edite `MEET_URL` / `BOT_NAME` / `CHAT_MESSAGE`, depois `npm install` e `npm start` (ou `start.bat`).

Live validation **precisa** de um link Meet aberto. Os testes automatizados **não** entram no Meet.

---

## English — PC install (Windows primary)

**Requirements:** Node.js 20+, npm, a Meet room you control.

```bat
git clone https://github.com/Revenn0/meeting-bot.git
cd meeting-bot
git checkout cursor/chat-only-mode-6fa0
copy .env.example .env
```

Edit `.env`:

```
MEET_URL=https://meet.google.com/xxx-yyyy-zzz
BOT_NAME=PC Bot
MODE=chat-only
CHAT_MESSAGE=Hello from the bot
CHAT_INTERVAL_MS=5000
RECORD_SECONDS=60
HEADLESS=false
```

Start (one command):

```bat
npm install
npm start
```

Same thing:

- `npm run bot:one`
- `start.bat`
- `powershell -File start.ps1`

`HEADLESS=false` shows Chrome so you can confirm join + **official** chat. Set `HEADLESS=true` only after that works.

### Troubleshooting

| Symptom | What to do |
|---|---|
| `Set MEET_URL in .env` | Put a real `https://meet.google.com/...` link, not `YOUR-MEET-CODE`. |
| Stuck on pre-join / no Leave call | Room not open or host must admit. Keep the host tab open. The bot prefers visible **Join now** / **Entrar** and ignores hidden **Ask to join**. |
| `Could not open the official Meet chat panel` | Use `WINDOW_SIZE=1280x720` and headful. Chat may sit under **More options**. UI changes: screenshot lands in `output/`. |
| `you can't join this video call` | Google blocked headless/automation. Stay `HEADLESS=false`. |
| Headless vs headful | Headful (`false`) is the reliable PC path. Headless often fails Meet's join checks. |
| Node version | `node -v` must be 20+. |

---

## Português — instalação no PC (Windows)

**Requisitos:** Node.js 20+, npm, sala Meet sua.

```bat
copy .env.example .env
notepad .env
npm install
npm start
```

No Mac: `cp .env.example .env` e `./start.sh` (ou `npm start`).

O bot entra como convidado com **câmera e microfone desligados**, espera a UI **dentro da chamada** (botão Sair / Leave call — **não** vale só clicar e dormir), abre o **chat oficial do Meet**, envia `CHAT_MESSAGE` e sai após `RECORD_SECONDS`.

### Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `Set MEET_URL in .env` | Coloque o link real da sala, não o placeholder. |
| Não entra / não aparece Sair da chamada | Sala fechada ou host precisa admitir. Deixe a aba do host aberta. O bot prefere **Entrar agora / Join now** visível e ignora **Pedir para participar** oculto. |
| Não abre o chat oficial | Janela 1280×720, modo visível. O chat pode estar em **Mais opções**. |
| Bloqueio do Meet | Use `HEADLESS=false`. |
| UI do Meet mudou | Veja o PNG em `output/` e os rótulos no erro. |

---

## Tests (no live Meet)

```bash
npm test
```

The mock fixture covers pre-join, waiting room (must **not** count as in-call), Join now → Leave call, official chat open/send, and chat hidden under More options.

**Live validation always needs an open Meet link.** Automated tests never contact Google.

## Scale: local fleet (one PC, ~10–25 guests)

Every guest must really join (**Leave call** visible) and use official chat when possible. The fleet starts the **next wave after this wave joins**, so two local waves can overlap. See **`FLEET.md`**.

| Command | What it does |
|---|---|
| `npm run bot:one` | One PC guest (`start.bat` / `start.ps1` / `start.sh`) |
| `npm run fleet:10` | One local wave of 10 (`CONFIRM_LIVE=true` + `MEET_URL`) |
| `npm run fleet:20` | Two overlapping local waves (~20) on the same PC |

Hard-stop if ≥50% of a wave hits **You can't join**. Stay in-call even if chat fails.

**Supported path:** one 16–32 GiB PC, ~0.4 GiB unique/bot. `bot:one` → `fleet:10` → `fleet:20` (or a second `fleet:10` with `FLEET_OFFSET=10` while the first is still in-call). `RECORD_SECONDS` ≥ 300. Stop around 20–25 guests when RAM/CPU saturates.

Modal / cloud is **out of scope**. Do not run `fleet:100` on a laptop.

---

## Features / architecture

- **CHAT_ONLY** — official Meet chat only; camera/mic off; no fake media; no WebRTC recording
- **Default recording mode** — still available via `MODE=default` (fake camera + remote `.webm`)
- Isolated guest name per process (`BOT_NAME`)

```
npm start  →  scripts/run-one-bot.js  →  join (Join now)  →  wait until in-call
           →  open official chat  →  send CHAT_MESSAGE  →  leave
```

See `DESIGN.md` for Chromium flags, stagger, and resource notes. Do not stress-test live Meet.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `MEET_URL` | *(required for `npm start`)* | Open Meet link |
| `BOT_NAME` | `Brian Gu` | Guest display name |
| `MODE` | `chat-only` via `npm start` | `chat-only` or `default` |
| `CHAT_MESSAGE` | `Hello` | Official chat text |
| `CHAT_INTERVAL_MS` | `5000` | ≥ 1000 |
| `RECORD_SECONDS` | `15` (`60` in `.env.example`) | How long to stay |
| `HEADLESS` | `false` on `npm start` | `true` hides Chrome |
| `WINDOW_SIZE` | `1280x720` on `npm start` / fleet | Keep large so chat is not overflowed |
| `CONFIRM_LIVE` | unset | Required for `fleet:10` / `fleet:20` |
| `BOT_NAME_PREFIX` | `Fleet` | Unique guest names `{prefix}-{n}` |
| `FLEET_OFFSET` | `0` | Extra machine start index |
| `STARTUP_CONCURRENCY` | `2` | Max Chromiums launching at once |
| `STARTUP_STAGGER_MS` | `0` (fleet) | Optional delay between launch slots |

## License

MIT
