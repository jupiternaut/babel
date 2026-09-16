import { BabelHostCommandError } from '../../../services/babelDemoErrors';

export interface BabelHostEndpoint {
  endpoint: string;
  projectId: string;
}

/**
 * Same /v2/query and /v2/command contract as BabelDemoTrackerDataSource.
 * Used only for queries/commands the data source does not expose publicly.
 */
export async function babelHostQuery<T>(
  host: BabelHostEndpoint,
  name: string,
  input: Record<string, unknown> = {},
  projectId?: string,
): Promise<T> {
  return babelHostRequest<T>(host, '/v2/query', {
    name,
    projectId: projectId ?? host.projectId,
    input,
  });
}

export async function babelHostCommand(
  host: BabelHostEndpoint,
  name: string,
  input: Record<string, unknown>,
  options: { idempotencyKey?: string; expectedRevision?: number; projectId?: string } = {},
): Promise<Record<string, unknown>> {
  return babelHostRequest<Record<string, unknown>>(host, '/v2/command', {
    name,
    projectId: options.projectId ?? host.projectId,
    input,
    idempotencyKey: options.idempotencyKey,
    expectedRevision: options.expectedRevision,
  }, options.idempotencyKey);
}

async function babelHostRequest<T>(
  host: BabelHostEndpoint,
  pathname: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const response = await fetch(`${host.endpoint.replace(/\/$/, '')}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const parsed = await response.json() as { ok?: boolean; code?: string; message?: string };
  if (parsed && parsed.ok === false) {
    throw new BabelHostCommandError(
      parsed.code ?? 'UNAVAILABLE',
      parsed.message ?? parsed.code ?? '演示服务拒绝了该请求',
    );
  }
  return parsed as T;
}
