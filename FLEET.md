# Fleet runbooks — local PC (primary)

Product rule: every guest must **really join** the live call (**Leave call** visible) and use the **official Meet chat** when it is available. Stay in-call even if chat fails. Click+sleep is not a join.

**Victor / this PR:** run fleets **only on a local box** (your PC). Target is hardware-limited: about **10–25** real in-call guests on one machine. Modal / cloud scale-out is **out of scope** (optional appendix only). Do not spend Modal from CI or a cloud-agent VM.

`npm test` never contacts Meet.

## How the local runner works

- Waves of **10**. Next wave starts after this wave **joins** (or fails to join), **not** after guests leave.
- Guests stay for `RECORD_SECONDS` so a second wave can **overlap** on the same PC.
- Optional in-wave stagger: `STARTUP_STAGGER_MS` (default `0`). Startup cap: `STARTUP_CONCURRENCY` (default `2`).
- Unique names: `{BOT_NAME_PREFIX}-{index}`. A second local process can use `FLEET_OFFSET`.
- **Hard stop** if ≥50% of a wave hits **You can't join this video call**. Already in-call guests stay; no more waves.

`RECORD_SECONDS` must outlast the time to launch every local wave, or early guests leave before the room fills.

| Local target | Waves | Suggested `RECORD_SECONDS` |
|---|---|---|
| 1 guest (`bot:one`) | — | 60 |
| 10 (`fleet:10`) | 1 | 180–300 |
| ~20–25 on one PC | 2 | 300–420 |

The runner prints a recommended minimum when you start.

RAM (local stay10): **~0.4 GiB unique / bot**. Plan ~8–12 GiB unique for 20 guests, plus OS/Chrome. A 16–32 GiB PC is the intended host. Do not run `fleet:100` on a laptop.

Open room required. Keep the **host tab** open. Prefer **This call is open to anyone** + visible **Join now**. Hidden **Ask to join** is ignored.

---

## A) One PC — the supported path (~20–25 guests)

**Machine:** 16–32 GiB RAM, SSD, Node 20+.

1. Open the Meet room in your own Chrome. Keep the host tab open. Confirm **This call is open to anyone** and **Join now**.
2. Validate one guest first:

```bat
npm install
copy .env.example .env
notepad .env
npm run bot:one
```

Watch: name → **Join now** (not hidden Ask to join) → **Leave call** appears → official chat (or stay if chat fails).

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

4. If wave 1 is mostly in-call and nobody hits “You can't join”, overlap a **second** local wave **while the first is still in-call**:

```bat
set CONFIRM_LIVE=true
set BOT_NAME_PREFIX=PC1
set FLEET_OFFSET=10
set RECORD_SECONDS=300
npm run fleet:10
```

Or one local process of 20 (`node scripts/run-fleet-live.js --size=20`) with `RECORD_SECONDS≥360`. Stop if RAM or CPU saturates. Proven local stay10 reached ~10–22 in-call on an open room with Join-now reclick.

Hard stop: if ≥50% of a wave sees **You can't join**, the runner exits and must not start another wave.

---

## Scripts

| Command | What it does | Gate |
|---|---|---|
| `npm run bot:one` | One visible PC guest | real `MEET_URL` in `.env` |
| `npm run fleet:10` | One local wave of 10 | `CONFIRM_LIVE=true` + real `MEET_URL` |
| `npm run fleet:100` | Ten waves (gated; **not** for a laptop) | `CONFIRM_LIVE=true` + real `MEET_URL` |

`fleet:100` exists so a future fat host can accumulate, but **this PR’s supported run is local `bot:one` + `fleet:10` up to ~20–25**. The script still refuses to start without `CONFIRM_LIVE=true` and a real Meet link.

Mock (CI / local, **never Meet**): `FLEET_MOCK=true` + optional `FLEET_CHILD=test/fixtures/fake-guest.js`.

---

## Appendix — Modal / cloud (out of scope)

Not the product path for this PR. Do **not** burn Modal from the cloud agent. If someone later runs elsewhere: budget **1.0–1.5 GiB/bot**, headful Xvfb, unique `BOT_NAME_PREFIX` + `FLEET_OFFSET`, open room, hard-stop on can't-join majority. Split across machines rather than packing 100 Chromiums on one 8–16 GiB box.

---

## PT-BR (resumo)

**Caminho suportado = um PC.** `npm run bot:one`, depois `CONFIRM_LIVE=true npm run fleet:10`. Segunda onda local com `FLEET_OFFSET=10` **enquanto a primeira ainda está na call**. ~0,4 GiB únicos/bot. Teto prático ~20–25 convidados. `RECORD_SECONDS` ≥ 300.

A onda seguinte começa depois do **join** (botão Sair), não depois de sair. Pare se a maioria da onda ver “You can't join”. Modal/cloud está fora de escopo neste PR.
