# Fleet runbooks — 10 → 100 real Meet guests

Product rule: every guest must **really join** the live call (Leave call visible) and use the **official Meet chat** when it is available. Stay in-call even if chat fails. Click+sleep is not a join.

`npm test` never contacts Meet. **Do not** run `fleet:100` from CI or from this cloud agent.

Local stay10 proved ~10–22 in-call on an **open** room with Join-now reclick. Modal false positives and “You can't join” are why waves hard-stop.

RAM (order of magnitude):

| Source | Unique / bot | Notes |
|---|---|---|
| Local mock PSS | ~0.17–0.27 GiB | file:// page, no Meet decode |
| Local live (stay10) | **~0.4 GiB unique** | Use this for PC planning |
| Modal / cloud | **budget 1.0–1.5 GiB / bot** | Headful Xvfb + Meet UI + decode |

---

## A) One PC — up to ~20 guests

**Machine:** 16–32 GiB RAM, SSD, Node 20+. Expect ~8–12 GiB unique for 20 bots at 0.4 GiB each, plus OS/Chrome host.

1. Open the Meet room in your own Chrome. Keep the host tab open. Confirm **This call is open to anyone** and **Join now**.
2. Validate one guest first:

```bat
npm install
copy .env.example .env
notepad .env
npm run bot:one
```

3. First wave of 10 (required):

```bat
set CONFIRM_LIVE=true
set BOT_NAME_PREFIX=PC1
set STARTUP_CONCURRENCY=2
set STARTUP_STAGGER_MS=1500
set WAVE_PAUSE_MS=8000
set RECORD_SECONDS=180
npm run fleet:10
```

PowerShell:

```powershell
$env:CONFIRM_LIVE="true"
$env:BOT_NAME_PREFIX="PC1"
$env:STARTUP_CONCURRENCY="2"
$env:RECORD_SECONDS="180"
npm run fleet:10
```

4. If wave 1 is mostly in-call and nobody hits “You can't join”, run a **second** `fleet:10` with `FLEET_OFFSET=10` and `BOT_NAME_PREFIX=PC1` (names PC1-11…PC1-20). Stop if RAM or CPU saturates.

Hard stop: if ≥50% of a wave sees **You can't join**, the runner exits and must not start another wave.

---

## B) Modal / cloud — 100+ guests

**Do not** pack 100 Chromiums on one 8–16 GiB box. Budget **1.0–1.5 GiB RAM per bot** (100 × 1.25 GiB ≈ 125 GiB) **or** split across machines.

Recommended split:

| Workers | Guests each | Offset | Prefix |
|---|---|---|---|
| 1 | 20 | 0 | M1 |
| 2 | 20 | 20 | M2 |
| 3 | 20 | 40 | M3 |
| 4 | 20 | 60 | M4 |
| 5 | 20 | 80 | M5 |

Each worker:

```bash
export CONFIRM_LIVE=true
export MEET_URL='https://meet.google.com/xxx-yyyy-zzz'
export BOT_NAME_PREFIX=M3
export FLEET_OFFSET=40
export WAVE_SIZE=10
export STARTUP_CONCURRENCY=2
export STARTUP_STAGGER_MS=2000
export WAVE_PAUSE_MS=10000
export RECORD_SECONDS=300
export HEADLESS=false
export DISPLAY=:99
npm run fleet:10
```

To request 100 from **one** process (five waves of 10 on a host that actually has the RAM):

```bash
export CONFIRM_LIVE=true
export MEET_URL='https://meet.google.com/xxx-yyyy-zzz'
npm run fleet:100
```

`fleet:100` **refuses** to start unless `CONFIRM_LIVE=true` and `MEET_URL` is a real Meet link.

Modal container notes:

- ≥ **1.5 GiB RAM** and shared memory (`shm`) per concurrent Chromium
- Headful via Xvfb (`HEADLESS=false`, `DISPLAY=:99`) — headless often gets “You can't join”
- Unique `BOT_NAME_PREFIX` per replica
- Open room required; host tab stays up
- If a wave majority is blocked, treat it as Meet policy — scale out later, do not retry immediately

---

## PT-BR (resumo)

**PC (~20):** `npm run bot:one` depois `CONFIRM_LIVE=true npm run fleet:10`. Segunda onda com `FLEET_OFFSET=10`. ~0,4 GiB únicos/bot.

**Modal/100+:** 5 réplicas × 20 convidados, 1,0–1,5 GiB/bot, nomes e offsets únicos. `fleet:100` só com `CONFIRM_LIVE=true` + `MEET_URL` real. Pare se a maioria da onda ver “You can't join”.
