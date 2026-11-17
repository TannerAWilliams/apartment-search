// Injectable HTTP transport without runtime-specific fetch helpers such as preconnect.
export type FetchTransport = (url: string, options?: RequestInit) => Promise<Response>;
