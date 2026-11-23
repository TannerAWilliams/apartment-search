/**
 * JSON from the network or from storage is untrusted until it is checked, so it is `unknown`, not `any`.
 * Every caller must narrow it or state the shape it expects.
 */
interface Body {
  json(): Promise<unknown>;
}
interface Response {
  json(): Promise<unknown>;
}
interface Request {
  json(): Promise<unknown>;
}
interface JSON {
  parse(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown;
}
/** An array whose items have not been checked yet holds `unknown`, not `any`. */
interface ArrayConstructor {
  isArray(arg: unknown): arg is unknown[];
}
