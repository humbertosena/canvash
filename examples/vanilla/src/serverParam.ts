/**
 * Endereço do servidor de colaboração em rede, vindo de `?server=`. Só vale o WebSocket sem TLS
 * em uma máquina local: o servidor de referência é de desenvolvimento e este exemplo não deve
 * mandar o desenho para um endereço qualquer que um link traga. Qualquer outro valor é ignorado.
 */
export function parseServerParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'];
  if (url.protocol !== 'ws:' || !loopback.includes(url.hostname)) return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.toString();
}
