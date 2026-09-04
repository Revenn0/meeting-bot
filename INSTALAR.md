# Instalar a Plateia Console no Windows

Produto local: até **15** convidados reais entram no **teu** Google Meet e usam o **chat oficial**. Sem Modal, sem nuvem. A chave OpenRouter fica só neste PC.

## O que precisas

1. **Windows 10/11**
2. **Node.js 20 LTS** — [nodejs.org](https://nodejs.org) (marca “LTS”). Depois abre um terminal novo e confirma: `node -v` deve mostrar `v20` ou superior.
3. Uma sala **Google Meet aberta** no Chrome (a tua). Deixa a aba do host ligada. Preferível: “esta chamada está aberta a qualquer pessoa” + botão **Entrar agora**.
4. Uma **chave OpenRouter** (há modelos grátis). Cria em [openrouter.ai](https://openrouter.ai) → Keys.

RAM: conta ~0,4 GiB por convidado. 8 convidados cabem num portátil de 16 GiB; 15 pede máquina folgada.

## Pasta zip (a forma mais simples)

1. Descompacta o zip numa pasta tua (ex.: `Documentos\PlateiaConsole`).
2. Duplo clique em **`INSTALAR.bat`**. Espera o `npm install` acabar.
3. Duplo clique em **`ABRIR.bat`**. Abre o browser em `http://127.0.0.1:8787`.
4. No primeiro arranque:
   - cola a chave OpenRouter (fica em `user-data\.env`, nunca no git);
   - atualiza a lista e escolhe um modelo **grátis**;
   - testa a ligação;
   - entra na consola.
5. Cola o link Meet, escolhe 1–15 convidados, escreve o brief, carrega em **Entrar em ensaio**.
6. Admite os convidados se o Meet pedir. Vê o medidor 0–15 e o registo ao vivo.
7. **Terminar** → debrief automático (podes gerar outra vez) → **Exportar .txt**.

Se o browser não abrir sozinho, vai a `http://127.0.0.1:8787`.

## A partir do Git

```bat
git clone https://github.com/Revenn0/meeting-bot.git
cd meeting-bot
git checkout product/plateia-console
INSTALAR.bat
ABRIR.bat
```

## Onde ficam os dados

| Ficheiro | Conteúdo |
|---|---|
| `user-data\.env` | `OPENROUTER_API_KEY` — **não partilhes, não commits** |
| `user-data\settings.json` | modelo, último brief, tom (sem a chave) |
| `user-data\session-control.json` | pausa/stop do ensaio atual |

## Problemas frequentes

| Sintoma | O que fazer |
|---|---|
| `node` não é reconhecido | Instala o Node 20 LTS e **reabre** o Explorador / terminal |
| A consola não abre | Corre `ABRIR.bat` e, à mão, `http://127.0.0.1:8787` |
| “Falta o código da sala” | Link completo `https://meet.google.com/xxx-yyyy-zzz` |
| Convidados não entram | Sala fechada ou host tem de admitir. Deixa a aba do host aberta. |
| “You can't join” | Google bloqueou automação. Usa Chrome visível (opção ligada). Não forces mais de 15. |
| Chat oficial não abre | Janela 1280×720, modo visível. O chat pode estar em **Mais opções**. |
| Debrief falha | Confirma a chave e escolhe outro modelo grátis (Atualizar lista). |

## Linha de comandos (opcional)

A consola é o caminho principal. O motor CHAT_ONLY antigo continua disponível:

```bat
copy .env.example .env
notepad .env
bot-one.bat
```

```bat
set CONFIRM_LIVE=true
npm run fleet:10
npm run fleet:15
```

`fleet:15` é o máximo. Não há `fleet:20` / `fleet:100` no produto.

## Atualizações

A consola verifica o GitHub **sempre que abre** (`GET /repos/Revenn0/meeting-bot/releases/latest`). Não precisa de token. Se o GitHub limitar o ritmo (403/429), a verificação falha em silêncio e a consola continua.

1. Se o Release for mais novo que o `package.json` local, aparece o ecrã **Atualização disponível** (`2.0.0 → 2.1.0`).
2. **Atualizar agora** descarrega o asset, aplica por cima da pasta da app e **preserva `user-data/`** (chave OpenRouter, settings, `skippedUpdateVersion`). Se existir `package-lock.json`, corre `npm install --omit=dev`.
3. **Agora não** guarda essa versão em `user-data\settings.json` (`skippedUpdateVersion`). Nas aberturas seguintes a mesma versão **não** ocupa o ecrã — só o chip **Atualização disponível** no topo. Uma versão *mais nova* volta a ocupar o ecrã.
4. **Verificar atualizações** está sempre no cabeçalho (mesmo com uma versão ignorada).
5. Se o ensaio estiver **ao vivo ou em pausa**, a aplicação recusa aplicar. Termina o ensaio primeiro — os bots no Meet não são mortos à força.

Nomes de asset (por ordem de preferência):

| Nome | Uso |
|---|---|
| `plateia-console-windows.zip` | **Preferido.** Zip da pasta da consola (o que `npm run pack:windows` gera). |
| `PlateiaConsole-Setup.exe` | Alternativa. Só corre no Windows; a consola descarrega e lança o instalador. |

Sem Release publicado, há um *fallback* de desenvolvimento: compara o `package.json` em `product/plateia-ui-minimal` (depois `product/plateia-console`, depois `main`) e descarrega o zipball desse branch. **Os utilizadores finais precisam de um GitHub Release com o zip.**

### Publicar um Release (Victor)

Esta árvore está em **2.0.0**. O auto-update entra no próximo Release — não bumps agora. Quando fores publicar:

1. Sobe `version` em `package.json` (ex.: `2.1.0`).
2. `npm run pack:windows` → `dist\plateia-console-windows.zip`
3. No GitHub: **Releases → Draft a new release**
   - Tag: `v2.1.0` (semver; o `v` inicial é opcional)
   - Anexa **`plateia-console-windows.zip`**
4. Publica. Os PCs ainda em 2.0.0 passam a ver o ecrã de atualização.

Depois de aplicar: **Reiniciar agora**, ou fecha e abre **`ABRIR.bat`**.

## Testes (sem Meet)

```bat
npm test
```

Os testes **nunca** entram no Google Meet.

## Empacotar outro zip

Na máquina de build (com Node):

```bat
npm run pack:windows
```

Gera `dist\plateia-console-windows.zip` — fonte + scripts, **sem** `node_modules`. No PC do Victor: `INSTALAR.bat` depois `ABRIR.bat`.
