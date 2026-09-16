import type {
  GoogleTasksAuthSession,
  GoogleTasksLoginFlow,
  GoogleTasksLoginStart,
} from "./types.ts";

export const SYNTHETIC_ACCOUNT_ID = "synthetic-google-account";

export function createSyntheticSession(
  accountId = SYNTHETIC_ACCOUNT_ID,
  extras?: { reauthRequired?: boolean; authorized?: boolean },
): GoogleTasksAuthSession {
  return {
    mode: "synthetic",
    accountId,
    authorized: extras?.authorized ?? true,
    reauthRequired: extras?.reauthRequired ?? false,
    usedUserToken: false,
  };
}

/**
 * Login flow shape is available, but the default never starts OAuth
 * and never reads user tokens, env secrets, or credential files.
 */
export class SyntheticGoogleTasksAuth implements GoogleTasksLoginFlow {
  private session: GoogleTasksAuthSession | null = null;

  constructor(session?: GoogleTasksAuthSession | null) {
    this.session = session ?? null;
  }

  async startLogin(preferOAuth = false): Promise<GoogleTasksLoginStart> {
    void preferOAuth;
    return {
      kind: "synthetic",
      oauthStarted: false,
      authorizationUrl: null,
    };
  }

  async completeLogin(input?: { code?: string; syntheticAccountId?: string }): Promise<GoogleTasksAuthSession> {
    void input?.code;
    this.session = createSyntheticSession(input?.syntheticAccountId ?? SYNTHETIC_ACCOUNT_ID);
    return this.session;
  }

  currentSession(): GoogleTasksAuthSession | null {
    return this.session;
  }

  async revoke(): Promise<void> {
    this.session = createSyntheticSession(this.session?.accountId ?? SYNTHETIC_ACCOUNT_ID, {
      authorized: false,
      reauthRequired: true,
    });
  }
}

export function refuseUserOAuthTokens(): { usedUserToken: false; reason: string } {
  return {
    usedUserToken: false,
    reason: "默认合成会话，不读取用户 OAuth token。",
  };
}
