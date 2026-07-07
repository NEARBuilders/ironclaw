import { afterEach, describe, expect, it, vi } from "vitest";
import { clearHostedAccessSessionCache, resolveHostedAccessToken } from "../src/hosted-session";

describe("hosted-session", () => {
  afterEach(() => {
    clearHostedAccessSessionCache();
    vi.restoreAllMocks();
  });

  it("discovers the remote tenant before minting an access session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tenant_id: "reborn-cli", user_id: "operator" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ token: "session-token", expires_at: "2026-07-13T00:00:00.000Z" }),
          { status: 200 },
        ),
      );

    const token = await resolveHostedAccessToken({
      baseUrl: "https://example.com",
      operatorToken: "operator-token",
      userId: "user-1",
      agentId: "agent-1",
      projectId: "project-1",
    });

    expect(token).toBe("session-token");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const discoveryCall = fetchSpy.mock.calls[0]!;
    expect(discoveryCall[0]).toBe("https://example.com/api/webchat/v2/session");
    expect(
      new Headers((discoveryCall[1] as RequestInit | undefined)?.headers).get("Authorization"),
    ).toBe("Bearer operator-token");

    const mintCall = fetchSpy.mock.calls[1]!;
    expect(mintCall[0]).toBe("https://example.com/api/webchat/v2/operator/access-sessions");
    expect(
      new Headers((mintCall[1] as RequestInit | undefined)?.headers).get("Authorization"),
    ).toBe("Bearer operator-token");

    const body = JSON.parse((mintCall[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.tenant_id).toBe("reborn-cli");
    expect(body.user_id).toBe("user-1");
    expect(body.agent_id).toBe("agent-1");
    expect(body.project_id).toBe("project-1");
  });
});
