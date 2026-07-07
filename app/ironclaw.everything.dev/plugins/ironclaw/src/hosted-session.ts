export const HOSTED_IRONCLAW_TENANT_ID = "ironclaw-hosted";

const ACCESS_SESSION_REFRESH_SKEW_MS = 30_000;

interface HostedSession {
  token: string;
  expiresAtMs: number;
}

interface HostedSessionEntry {
  session?: HostedSession;
  pending?: Promise<HostedSession>;
}

interface HostedSessionRequest {
  baseUrl: string;
  operatorToken: string;
  tenantId: string;
  userId: string;
  agentId?: string;
  projectId?: string;
}

const hostedSessionCache = new Map<string, HostedSessionEntry>();

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function cacheKey(request: HostedSessionRequest): string {
  return [
    normalizeBaseUrl(request.baseUrl),
    request.tenantId,
    request.userId,
    request.agentId ?? "",
    request.projectId ?? "",
  ].join("\u0000");
}

export function resolveHostedIdentity(context: {
  userId?: string;
  apiKey?: { userId?: string };
  actingUserId?: string;
}): { tenantId: string; userId: string } | null {
  const userId = context.actingUserId ?? context.userId ?? context.apiKey?.userId ?? null;
  if (!userId) {
    return null;
  }

  return {
    tenantId: HOSTED_IRONCLAW_TENANT_ID,
    userId,
  };
}

async function mintHostedAccessSession(request: HostedSessionRequest): Promise<HostedSession> {
  const response = await fetch(`${normalizeBaseUrl(request.baseUrl)}/api/webchat/v2/operator/access-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.operatorToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenant_id: request.tenantId,
      user_id: request.userId,
      ...(request.agentId ? { agent_id: request.agentId } : {}),
      ...(request.projectId ? { project_id: request.projectId } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to mint access session for tenant ${request.tenantId} user ${request.userId}: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
    );
  }

  const data = (await response.json()) as { token?: string; expires_at?: string };
  if (!data.token) {
    throw new Error(
      `Access session response missing token for tenant ${request.tenantId} user ${request.userId}`,
    );
  }
  if (!data.expires_at) {
    throw new Error(
      `Access session response missing expiry for tenant ${request.tenantId} user ${request.userId}`,
    );
  }

  const expiresAtMs = Date.parse(data.expires_at);
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error(
      `Access session response had invalid expiry for tenant ${request.tenantId} user ${request.userId}`,
    );
  }

  return {
    token: data.token,
    expiresAtMs,
  };
}

export async function resolveHostedAccessToken(request: HostedSessionRequest): Promise<string> {
  const key = cacheKey(request);
  const now = Date.now();
  const existing = hostedSessionCache.get(key);

  if (
    existing?.session &&
    existing.session.expiresAtMs - ACCESS_SESSION_REFRESH_SKEW_MS > now
  ) {
    return existing.session.token;
  }

  if (existing?.pending) {
    return (await existing.pending).token;
  }

  let pending: Promise<HostedSession>;
  pending = mintHostedAccessSession(request)
    .then((session) => {
      hostedSessionCache.set(key, { session });
      return session;
    })
    .catch((error) => {
      const current = hostedSessionCache.get(key);
      if (current?.pending === pending) {
        hostedSessionCache.delete(key);
      }
      throw error;
    });

  hostedSessionCache.set(key, {
    session: existing?.session,
    pending,
  });

  return (await pending).token;
}

export function clearHostedAccessSessionCache(): void {
  hostedSessionCache.clear();
}
