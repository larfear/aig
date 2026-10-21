export const loopback = (hostname: string): boolean => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);

export function baseURL(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || (url.protocol === 'http:' && !loopback(url.hostname))) {
    throw new Error('Gateway requires an HTTPS origin, or HTTP loopback');
  }
  return url;
}
