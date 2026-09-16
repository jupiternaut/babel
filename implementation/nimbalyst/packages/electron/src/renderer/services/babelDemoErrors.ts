export const BABEL_DEMO_UNIMPLEMENTED_CODE = 'UNAVAILABLE';
export const BABEL_DEMO_UNIMPLEMENTED_MESSAGE = '该操作尚未在演示适配中实现';

export class BabelHostCommandError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BabelHostCommandError';
    this.code = code;
    this.details = details;
  }
}

export function unimplementedCommandError(commandType: string): BabelHostCommandError {
  return new BabelHostCommandError(BABEL_DEMO_UNIMPLEMENTED_CODE, BABEL_DEMO_UNIMPLEMENTED_MESSAGE, {
    command: commandType,
  });
}

export function formatBabelHostError(error: unknown): { code: string; message: string } {
  if (error instanceof BabelHostCommandError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    const rawCode = (error as Error & { code?: unknown }).code;
    const code = typeof rawCode === 'string' ? rawCode : 'UNAVAILABLE';
    return { code, message: error.message };
  }
  return { code: 'UNAVAILABLE', message: String(error) };
}
