export interface Credential { publisher_id: string; token: string }

export function publisherCredentials(value: unknown): Credential[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10 || value.some(c =>
    !c || typeof c.publisher_id !== 'string' || !/^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(c.publisher_id) ||
    typeof c.token !== 'string' || !/^[a-f0-9]{64}$/.test(c.token)) ||
    new Set(value.map(c => c.publisher_id)).size !== value.length ||
    new Set(value.map(c => c.token)).size !== value.length) {
    // Configuration preparation must also work before resource validators have been generated.
    // The Worker maps this configuration failure to its bounded HTTP 503 response.
    throw new Error('publisher_configuration_unavailable');
  }
  return value;
}
