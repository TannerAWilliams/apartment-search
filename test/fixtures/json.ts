import type { LogRecord } from '../../server/log.ts';

type JsonSource = { json(): Promise<unknown> };

/**
 * A JSON body read with the shape the test expects. The assertions that follow check the values, so a
 * body with another shape fails the test.
 */
export async function readJson<T>(source: JsonSource | Promise<JsonSource>): Promise<T> {
  return (await (await source).json()) as T;
}

/** The body of an error response. */
export type ErrorBody = { error: string; commuteError?: boolean };

/** A line the app logged, parsed. */
export const logRecord = (line: string) => JSON.parse(line) as LogRecord;

/** The JSON body a fake server received, with the shape the code under test sends. */
export const sentJson = <T>(body: BodyInit | null | undefined) => JSON.parse(String(body)) as T;

/** A JSON-RPC request to the Openigloo MCP server: the fields the fake servers read. */
export type RpcRequest = {
  jsonrpc: '2.0' /** Absent on notifications, which the fakes answer without reading it. */;
  id: number;
  method: string;
  params: { name?: string; arguments: { area: string; bedrooms: number[]; min_rent?: number; max_rent?: number; limit: number } };
};

/** A GraphQL request, as the StreetEasy reader sends it. */
export type GraphQlRequest = { query: string };
