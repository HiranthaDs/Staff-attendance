const SUPABASE_REQUEST_TIMEOUT_MS = 10_000;

export const fetchSupabase: typeof fetch = (input, init = {}) => {
  const timeoutSignal = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;

  return fetch(input, { ...init, signal });
};
