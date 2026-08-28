type RequestInitLike = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
};

export type FetchLike = (
  _input: string,
  _init: RequestInitLike,
) => Promise<Pick<Response, 'ok' | 'status' | 'json' | 'text'>>;

export type ProviderHealthOptions = {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
  timeoutMs: number;
  pollIntervalMs: number;
  log?: (_message: string) => void;
};

export type ProviderHealthResult = {
  recovered: boolean;
  waitedMs: number;
  polls: number;
};

export const waitForProviderHealth = async (
  options: ProviderHealthOptions,
): Promise<ProviderHealthResult> => {
  const { baseUrl, apiKey, timeoutMs, pollIntervalMs, log } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/models`;
  const startedAt = Date.now();
  let polls = 0;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  log?.(`Waiting for provider health at ${url}...`);

  while (true) {
    polls += 1;
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(Math.min(pollIntervalMs, 5000)),
      });
      if (response.ok) {
        const waitedMs = Date.now() - startedAt;
        log?.(`Provider health check succeeded after ${waitedMs} ms (${polls} polls).`);
        return { recovered: true, waitedMs, polls };
      }
    } catch {
      // Server down is the normal state; swallow all probe errors.
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      const waitedMs = Date.now() - startedAt;
      log?.(`Provider health check failed after ${waitedMs} ms (${polls} polls).`);
      return { recovered: false, waitedMs, polls };
    }
    const sleepMs = Math.min(pollIntervalMs, timeoutMs - elapsed);
    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
  }
};
