/** Conversions between UTC instants and wall-clock values in an IANA zone. Never sends local offsets. */
const formats = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formats.set(zone, format);
  }
  return format;
}
/** Wall-clock fields of an instant in `zone`, expressed as if they were UTC. */
function wallMs(ms: number, zone: string) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}
export function validZone(zone: string) {
  try { formatter(zone); return zone.length > 0; } catch { return false; }
}
/** UTC ISO instant -> "YYYY-MM-DDTHH:mm" wall-clock value for a datetime-local input. */
export function utcToLocalInput(iso: string, zone: string) {
  return new Date(wallMs(new Date(iso).getTime(), zone)).toISOString().slice(0, 16);
}
/** "YYYY-MM-DDTHH:mm" wall-clock value in `zone` -> UTC ISO ending in Z, or null when invalid / nonexistent (DST gap). */
export function localInputToUtc(local: string, zone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match || !validZone(zone)) return null;
  const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const first = guess - (wallMs(guess, zone) - guess);
  const second = guess - (wallMs(first, zone) - first);
  if (wallMs(second, zone) !== guess) return null;
  return new Date(second).toISOString();
}
/** Current minute rounded up (never earlier than a record created seconds ago); stays within the API's 60 s future tolerance. */
export function nowLocalInput(zone: string) { return utcToLocalInput(new Date(Math.ceil(Date.now() / 60000) * 60000).toISOString(), zone); }
