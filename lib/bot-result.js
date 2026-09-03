export const BOT_EXIT = {
  IN_CALL: 0,
  FATAL: 1,
  BLOCKED: 20,
  NOT_IN_CALL: 21,
};

export class MeetBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MeetBlockedError';
    this.code = 'MEET_BLOCKED';
  }
}

export class NotInCallError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotInCallError';
    this.code = 'NOT_IN_CALL';
  }
}

export function exitCodeForError(error) {
  if (!error) return BOT_EXIT.IN_CALL;
  if (error.code === 'MEET_BLOCKED' || error instanceof MeetBlockedError) {
    return BOT_EXIT.BLOCKED;
  }
  if (error.code === 'NOT_IN_CALL' || error instanceof NotInCallError) {
    return BOT_EXIT.NOT_IN_CALL;
  }
  if (/you can't join this video call/i.test(error.message || '')) {
    return BOT_EXIT.BLOCKED;
  }
  if (/Not in the live Meet call/i.test(error.message || '')) {
    return BOT_EXIT.NOT_IN_CALL;
  }
  return BOT_EXIT.FATAL;
}

export function classifyChildExit(code) {
  if (code === BOT_EXIT.IN_CALL) return 'in-call';
  if (code === BOT_EXIT.BLOCKED) return 'blocked';
  if (code === BOT_EXIT.NOT_IN_CALL) return 'not-in-call';
  return 'fatal';
}

export function logBotResult(result) {
  console.log(`[bot-result] ${JSON.stringify(result)}`);
}
