// Apply only after origin/auth, API quota and bounded body checks. Source refresh
// can legitimately use its 120-second provider budget; body reads retain 30s idle.
export function allowApiResponseTime(server: { timeout(request: Request, seconds: number): void }, request: Request) {
  server.timeout(request, 180);
}
