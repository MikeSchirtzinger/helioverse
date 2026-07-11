/** Compact an ISO-8601 timestamp without changing its UTC meaning. */
export function formatUtc(iso: string): string {
  return iso.replace('T', ' ').replace(/:00Z$/, 'Z');
}
