# Frota local — teto 15

Produto **Plateia Console**: no máximo **15** convidados reais no Google Meet, chat oficial. Sem Modal.

Cada convidado tem de **entrar de verdade** (botão Sair / Leave call visível). Ficar na call mesmo se o chat falhar.

`npm test` nunca contacta o Meet.

## Como corre

- Ondas pequenas (a consola usa ondas de até 8). A onda seguinte começa depois do **join**, não depois de sair.
- Os convidados ficam `RECORD_SECONDS` para as ondas se sobreporem no mesmo PC.
- Nomes únicos: `{prefix}-{n}`.
- **Paragem dura** se ≥50% de uma onda vir “You can't join”.

| Alvo | Comando | Notas |
|---|---|---|
| Consola 1–15 | `ABRIR.bat` / `npm start` | Caminho do produto |
| 1 convidado CLI | `npm run bot:one` | `.env` com `MEET_URL` |
| 10 | `CONFIRM_LIVE=true npm run fleet:10` | Uma onda |
| 15 | `CONFIRM_LIVE=true npm run fleet:15` | Máximo |

`FLEET_SIZE` > 15 é recusado. Não existe `fleet:100`.

RAM: ~0,4 GiB únicos / bot. PC 16–32 GiB para chegar aos 15.

Sala aberta. Aba do host ligada. Preferir **Entrar agora** visível.

## PT-BR

`INSTALAR.bat` → `ABRIR.bat`. Cola o Meet, escolhe 1–15, ensaiar. Sem Modal.
