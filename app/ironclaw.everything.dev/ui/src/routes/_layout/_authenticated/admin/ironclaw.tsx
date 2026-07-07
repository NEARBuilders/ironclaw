import { createFileRoute } from "@tanstack/react-router";
import { Cloud, Key, Loader2, Save, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApiClient } from "@/app";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_layout/_authenticated/admin/ironclaw")({
  component: AdminIronclaw,
  head: () => ({
    title: "Admin | IronClaw Platform",
    meta: [
      {
        name: "description",
        content: "Configure the platform-wide IronClaw mode and connection settings.",
      },
    ],
  }),
});

function AdminIronclaw() {
  const apiClient = useApiClient();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [mode, setMode] = useState<"direct" | "hosted">("direct");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [hasSettings, setHasSettings] = useState(false);

  useEffect(() => {
    apiClient.ironclaw.settings
      .get({ scope: "platform" })
      .then((res) => {
        setBaseUrl(res.baseUrl);
        setTokenConfigured(res.hasToken ?? false);
        setMode((res.mode as "direct" | "hosted" | undefined) ?? "direct");
        setHasSettings(true);
      })
      .catch(() => {
        setHasSettings(false);
      })
      .finally(() => setLoading(false));
  }, [apiClient]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiClient.ironclaw.settings.update({
        baseUrl,
        mode,
        ...(apiToken ? { apiToken } : {}),
        scope: "platform",
      });
      setHasSettings(true);
      if (apiToken) setTokenConfigured(true);
      toast.success(mode === "hosted" ? "Hosted IronClaw saved" : "IronClaw platform default saved");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await apiClient.ironclaw.settings.delete({ scope: "platform" });
      setBaseUrl("");
      setApiToken("");
      setMode("direct");
      setTokenConfigured(false);
      setHasSettings(false);
      toast.success("Disconnected from platform IronClaw");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">IronClaw Platform</h2>
        <p className="text-sm text-muted-foreground">
          Configure the platform-wide IronClaw mode for everyone.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-2 pb-4 border-b border-border">
              <span className="text-xs text-muted-foreground">Mode:</span>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMode("direct")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    mode === "direct"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Platform Tunnel
                </button>
                <button
                  type="button"
                  onClick={() => setMode("hosted")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    mode === "hosted"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Hosted Agent
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tunnelUrl" className="flex items-center gap-1.5">
                <Terminal size={14} />
                {mode === "hosted" ? "Hosted URL" : "Tunnel URL"}
              </Label>
              <Input
                id="tunnelUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  mode === "hosted"
                    ? "https://your-railway-app.up.railway.app"
                    : "https://your-tunnel.ngrok.io"
                }
                required
              />
              <p className="text-xs text-muted-foreground">
                {mode === "hosted"
                  ? "Public URL for the deployed IronClaw service. All users will mint per-user sessions against this deployment."
                  : "Public URL pointing to your ironclaw reborn binary (e.g. via ngrok, Cloudflare Tunnel). This is the platform-wide default tunnel. All users without a personal or org tunnel will use this."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiToken" className="flex items-center gap-1.5">
                <Key size={14} />
                {mode === "hosted" ? "Operator Token" : "API Token"}
              </Label>
              <Input
                id="apiToken"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder={
                  tokenConfigured
                    ? "Token is configured"
                    : mode === "hosted"
                      ? "The operator token for the hosted deployment"
                      : "The bearer token your binary expects"
                }
                required={!tokenConfigured}
              />
              <p className="text-xs text-muted-foreground">
                {tokenConfigured
                  ? "Token is already configured. Leave empty to keep the existing token."
                  : mode === "hosted"
                    ? "Must match the operator token for the hosted IronClaw deployment."
                    : "Must match the bearer token configured on your Reborn binary."}
              </p>
            </div>
          </Card>

          <div className="flex items-center justify-between gap-4">
            {!hasSettings && (
              <p className="text-xs text-muted-foreground">
                No settings configured yet. Add a platform URL and token to connect.
              </p>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {hasSettings && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disconnecting}
                  onClick={handleDisconnect}
                  className="text-destructive hover:text-destructive"
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Cloud size={14} />
                  )}
                  {disconnecting ? "Disconnecting..." : "Disconnect"}
                </Button>
              )}
              <Button type="submit" disabled={saving || !baseUrl}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={14} />}
                {saving ? "Saving..." : "Save settings"}
              </Button>
            </div>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 space-y-1.5">
        <p className="text-xs font-medium text-foreground">About platform-wide defaults</p>
        <p className="text-xs text-muted-foreground">
          This configuration is used for all users when set to Hosted Agent, or as the default
          platform tunnel when set to Platform Tunnel. Only admins can configure this setting.
        </p>
      </div>
    </div>
  );
}
