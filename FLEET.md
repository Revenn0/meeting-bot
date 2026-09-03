# Local fleet — one PC (~10–25 guests)

Product rule: every guest must **really join** the live call (**Leave call** visible) and use the **official Meet chat** when it is available. Stay in-call even if chat fails. Click+sleep is not a join.

**This PR is local-only.** Run on Victor’s box / one PC. Hardware limit is about **10–25** real in-call guests. Modal / cloud scale-out is **out of scope** — there is no Modal runbook and no Modal spend from this repo’s agent/CI.

`npm test` never contacts Meet.

## How the local runner works

- Waves of **10**. Next wave starts after this wave **joins** (or fails to join), **not** after guests leave.
- Guests stay for `RECORD_SECONDS` so a second wave can **overlap** on the same PC.
- Optional in-wave stagger: `STARTUP_STAGGER_MS` (default `0`). Startup cap: `STARTUP_CONCURRENCY` (default `2`).
- Unique names: `{BOT_NAME_PREFIX}-{index}`. A second local process can use `FLEET_OFFSET`.
- **Hard stop** if ≥50% of a wave hits **You can't join this video call**. Already in-call guests stay; no more waves.

`RECORD_SECONDS` must outlast the time to launch every local wave, or early guests leave before the room fills.

| Local target | Command | Waves | Suggested `RECORD_SECONDS` |
|---|---|---|---|
| 1 guest | `npm run bot:one` | — | 60 |
| 10 | `npm run fleet:10` | 1 | 180–300 |
| ~20 on one PC | `npm run fleet:20` | 2 (overlap) | 300–420 |

RAM (local stay10): **~0.4 GiB unique / bot**. Plan ~8–12 GiB unique for 20 guests, plus OS/Chrome. Intended host: **16–32 GiB PC**. Stop when RAM/CPU saturates (~20–25).

Open room required. Keep the **host tab** open. Prefer **This call is open to anyone** + visible **Join now**. Hidden **Ask to join** is ignored.

---

## PC install + run

**Machine:** Windows PC (primary), Node 20+, 16–32 GiB RAM, SSD.

1. Open the Meet room in your own Chrome. Keep the host tab open. Confirm **This call is open to anyone** and **Join now**.
2. One guest first:

```bat
npm install
copy .env.example .env
notepad .env
npm run bot:one
```

Same as `start.bat` / `.\start.ps1` / `./start.sh`. Watch: name → **Join now** (not hidden Ask to join) → **Leave call** appears → official chat (or stay if chat fails).

3. First wave of 10:

```bat
set CONFIRM_LIVE=true
set BOT_NAME_PREFIX=PC1
set STARTUP_CONCURRENCY=2
set STARTUP_STAGGER_MS=1500
set WAVE_PAUSE_MS=8000
set RECORD_SECONDS=300
npm run fleet:10
```

PowerShell:

```powershell
$env:CONFIRM_LIVE="true"
$env:BOT_NAME_PREFIX="PC1"
$env:STARTUP_CONCURRENCY="2"
$env:STARTUP_STAGGER_MS="1500"
$env:RECORD_SECONDS="300"
npm run fleet:10
```

4. If wave 1 is mostly in-call and nobody hits “You can't join”, overlap toward ~20:

```bat
set CONFIRM_LIVE=true
set BOT_NAME_PREFIX=PC1
set STARTUP_CONCURRENCY=2
set STARTUP_STAGGER_MS=1500
set RECORD_SECONDS=360
npm run fleet:20
```

Or a second `fleet:10` in another terminal with `FLEET_OFFSET=10` **while the first wave is still in-call**. Proven local stay10 reached ~10–22 in-call on an open room with Join-now reclick.

Hard stop: if ≥50% of a wave sees **You can't join**, the runner exits and must not start another wave.

---

## Scripts

| Command | What it does | Gate |
|---|---|---|
| `npm run bot:one` / `start.bat` | One visible PC guest | real `MEET_URL` in `.env` |
| `npm run fleet:10` | One local wave of 10 | `CONFIRM_LIVE=true` + real `MEET_URL` |
| `npm run fleet:20` | Two overlapping local waves (~20) | `CONFIRM_LIVE=true` + real `MEET_URL` |
| `npm run fleet:100` | Gated leftover — **do not run on a PC** | `CONFIRM_LIVE=true` + real `MEET_URL` |

Mock (CI / local, **never Meet**): `FLEET_MOCK=true` + optional `FLEET_CHILD=test/fixtures/fake-guest.js`.

---

## PT-BR (resumo)

**Só um PC.** `npm run bot:one` → `CONFIRM_LIVE=true npm run fleet:10` → se estiver estável, `fleet:20` (ou segunda onda com `FLEET_OFFSET=10` enquanto a primeira ainda está na call). ~0,4 GiB únicos/bot. Teto ~20–25. `RECORD_SECONDS` ≥ 300.

A onda seguinte começa depois do **join** (botão Sair), não depois de sair. Pare se a maioria da onda ver “You can't join”. Sem Modal.
