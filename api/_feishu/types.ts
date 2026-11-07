export type FeishuEnv = Record<string, string | undefined>;
export type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export class FeishuError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
