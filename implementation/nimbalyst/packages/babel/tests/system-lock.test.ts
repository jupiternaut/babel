// @vitest-environment node
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { acquireProfileLock } from '../src/system/profile-lock.ts';

it('allows only one profile owner and failed contenders cannot release its lease', async () => {
  const profile = path.join(os.tmpdir(), randomUUID());
  const release = await acquireProfileLock(profile);
  try {
    for (let i = 0; i < 3; i++) await expect(acquireProfileLock(profile)).rejects.toMatchObject({ code: 'BUSY' });
    const other = await acquireProfileLock(`${profile}-other`);
    await other();
  } finally { await release(); }
  const reacquired = await acquireProfileLock(profile);
  await reacquired();
});
