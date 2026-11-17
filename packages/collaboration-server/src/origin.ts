/** A regra de `allowedOrigins`: sem lista, qualquer origem; com lista, só as que estão nela. */
export function isOriginAllowed(
  allowedOrigins: readonly string[] | undefined,
  origin: string | undefined,
): boolean {
  return allowedOrigins === undefined || allowedOrigins.includes(origin ?? '');
}
