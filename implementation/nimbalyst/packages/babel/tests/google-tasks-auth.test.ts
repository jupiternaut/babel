import { describe, expect, it } from "vitest";
import {
  GoogleTasksImporter,
  MemoryGoogleTasksHttp,
  SYNTHETIC_ACCOUNT_ID,
  SyntheticGoogleTasksAuth,
  createSyntheticSession,
  refuseUserOAuthTokens,
} from "../src/connectors/google-tasks/index.ts";

describe("Google Tasks synthetic auth", () => {
  it("exposes an OAuth-shaped startLogin argument but defaults to a synthetic session", async () => {
    const flow = new SyntheticGoogleTasksAuth();
    const started = await flow.startLogin(true);
    expect(started).toEqual({
      kind: "synthetic",
      oauthStarted: false,
      authorizationUrl: null,
    });
    const session = await flow.completeLogin({ code: "would-be-oauth-code" });
    expect(session).toEqual({
      mode: "synthetic",
      accountId: SYNTHETIC_ACCOUNT_ID,
      authorized: true,
      reauthRequired: false,
      usedUserToken: false,
    });
    expect(flow.currentSession()?.usedUserToken).toBe(false);
  });

  it("never reads user OAuth tokens from the environment", async () => {
    const previous = process.env.GOOGLE_ACCESS_TOKEN;
    process.env.GOOGLE_ACCESS_TOKEN = "must-not-be-read";
    try {
      expect(refuseUserOAuthTokens()).toEqual({
        usedUserToken: false,
        reason: "默认合成会话，不读取用户 OAuth token。",
      });
      const flow = new SyntheticGoogleTasksAuth();
      await flow.completeLogin();
      expect(flow.currentSession()?.usedUserToken).toBe(false);
      expect(flow.currentSession()?.mode).toBe("synthetic");
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_ACCESS_TOKEN;
      else process.env.GOOGLE_ACCESS_TOKEN = previous;
    }
  });

  it("blocks a pull when the synthetic session is revoked", async () => {
    const flow = new SyntheticGoogleTasksAuth(createSyntheticSession());
    await flow.revoke();
    const http = new MemoryGoogleTasksHttp({
      accountId: SYNTHETIC_ACCOUNT_ID,
      pages: {
        "": {
          items: [{ id: "gt-1", title: "x", status: "needsAction", updated: "2026-09-14T10:00:00.000Z" }],
        },
      },
    });
    const result = await new GoogleTasksImporter(http, flow).pull({
      tasklistId: "list-babel",
      local: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reauthRequired).toBe(true);
    expect(result.realSync).toBe(false);
    expect(result.error).toBe("需重新登录");
    expect(result.imported).toEqual([]);
  });
});
