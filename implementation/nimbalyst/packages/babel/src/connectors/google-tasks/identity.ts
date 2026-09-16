export function googleTaskIdentity(accountId: string, tasklistId: string, taskId: string): string {
  return `${accountId}/${tasklistId}/${taskId}`;
}

export function parseGoogleTaskIdentity(identity: string): {
  accountId: string;
  tasklistId: string;
  taskId: string;
} | null {
  const parts = identity.split("/");
  if (parts.length < 3) return null;
  const [accountId, tasklistId, ...taskRest] = parts;
  const taskId = taskRest.join("/");
  if (!accountId || !tasklistId || !taskId) return null;
  return { accountId, tasklistId, taskId };
}
