export class RequestError extends Error {
  constructor(code, status, details = {}, message = '') { super(message || code); this.code = code; this.status = status; this.details = details; }
}
export const renew = { calls: 0, fail: null };
export async function renewSession() { renew.calls++; if (renew.fail) throw renew.fail; }
