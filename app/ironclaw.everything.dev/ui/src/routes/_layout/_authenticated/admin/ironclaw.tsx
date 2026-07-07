import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Cloud, Key, Loader2, RefreshCw, Save, Shield, ShieldCheck, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApiClient } from "@/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

type ToolSetting = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof useApiClient>["ironclaw"]["settings"]["tools"]["list"]>
  >["data"]
>[number];

const toolsQueryKey = ["ironclaw", "admin", "tools"] as const;

const STATE_LABELS: Record<ToolSetting["state"], string> = {
  default: "Default",
  always_allow: "Always Allow",
  ask_each_time: "Ask Each Time",
  disabled: "Disabled",
};

const STATE_VARIANTS: Record<
  ToolSetting["state"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  default: "secondary",
  always_allow: "default",
  ask_each_time: "outline",
  disabled: "destructive",
};

function AdminIronclaw() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [mode, setMode] = useState<"direct" | "hosted">("direct");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [hasSettings, setHasSettings] = useState(false);

  const canTest = baseUrl && (apiToken || tokenConfigured);

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

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      await apiClient.ironclaw.ping();
      toast.success("Connection successful — binary is reachable");
    } catch {
      toast.error("Connection failed — check your tunnel URL and API token");
    } finally {
      setTestingConnection(false);
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

  const {
    data: settings,
    isLoading: toolsLoading,
    isError: toolsError,
    refetch: refetchTools,
  } = useQuery({
    queryKey: toolsQueryKey,
    queryFn: async () => {
      const result = await apiClient.ironclaw.settings.tools.list();
      return result.data;
    },
    enabled: hasSettings,
  });

  const listMutation = useMutation({
    mutationFn: () => apiClient.ironclaw.settings.tools.list(),
    onSuccess: (result) => {
      queryClient.setQueryData<ToolSetting[]>(toolsQueryKey, result.data);
      toast.success("Tool settings refreshed");
    },
    onError: () => toast.error("Failed to refresh tool settings"),
  });

  const setAutoApprove = useMutation({
    mutationFn: (enabled: boolean) => apiClient.ironclaw.settings.tools.set({ enabled }),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: toolsQueryKey });
            const previous = queryClient.getQueryData<ToolSetting[]>(toolsQueryKey);
      queryClient.setQueryData<ToolSetting[]>(toolsQueryKey, (old) => {
        if (!old) return old;
        return old.map((s) =>
          s.capabilityId === "auto_approve"
            ? { ...s, state: (enabled ? "always_allow" : "default") as ToolSetting["state"] }
            : s
        );
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData<ToolSetting[]>(toolsQueryKey, context.previous);
      toast.error("Failed to update auto-approve");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: toolsQueryKey });
    },
  });

  const setPermission = useMutation({
    mutationFn: ({ capabilityId, state }: { capabilityId: string; state: ToolSetting["state"] }) =>
      apiClient.ironclaw.settings.tools.setPermission({ capabilityId, state }),
    onMutate: async ({ capabilityId, state }) => {
      await queryClient.cancelQueries({ queryKey: toolsQueryKey });
      const previous = queryClient.getQueryData<ToolSetting[]>(toolsQueryKey);
      queryClient.setQueryData<ToolSetting[]>(toolsQueryKey, (old) => {
        if (!old) return old;
        return old.map((s) =>
          s.capabilityId === capabilityId ? { ...s, state } : s
        );
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData<ToolSetting[]>(toolsQueryKey, context.previous);
      toast.error("Failed to update tool permission");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: toolsQueryKey });
    },
  });

  const globalAutoApprove = settings?.find((s) => s.capabilityId === "auto_approve");
  const toolEntries = settings?.filter((s) => s.capabilityId !== "auto_approve") ?? [];

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
              <Button
                type="button"
                variant="outline"
                disabled={testingConnection || !canTest}
                onClick={handleTestConnection}
              >
                {testingConnection ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {testingConnection ? "Testing..." : "Test connection"}
              </Button>
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

      {hasSettings && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold text-foreground">Approval Policy</h3>
              <p className="text-xs text-muted-foreground">
                Controls how tool execution requests ask for permission. The auto-approve toggle
                applies globally; individual tool overrides below take precedence.
              </p>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => listMutation.mutate()}
              disabled={listMutation.isPending}
              title="Refresh tool settings"
            >
              <RefreshCw className={`size-4 ${listMutation.isPending ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {toolsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : toolsError ? (
            <Card className="flex flex-col items-center gap-3 p-6 text-center">
              <p className="text-sm text-destructive">Failed to load tool settings</p>
              <Button variant="outline" size="sm" onClick={() => refetchTools()}>
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
            </Card>
          ) : (
            <>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="auto-approve"
                    checked={globalAutoApprove?.state === "always_allow"}
                    onCheckedChange={(checked) => setAutoApprove.mutate(checked === true)}
                    disabled={setAutoApprove.isPending}
                  />
                  <Label htmlFor="auto-approve" className="flex-1 cursor-pointer">
                    <span className="text-sm font-medium text-foreground">
                      Auto-approve all tools
                    </span>
                    <p className="text-xs text-muted-foreground">
                      When enabled, tool calls run without asking for approval.
                    </p>
                  </Label>
                  {setAutoApprove.isPending && (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  )}
                  <Badge
                    variant={globalAutoApprove?.state === "always_allow" ? "default" : "secondary"}
                  >
                    {globalAutoApprove?.state === "always_allow" ? "On" : "Off"}
                  </Badge>
                </div>
              </Card>

              {toolEntries.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Per-tool permissions ({toolEntries.length})
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40%]">Tool</TableHead>
                        <TableHead className="w-[20%]">Capability</TableHead>
                        <TableHead className="w-[20%]">Current</TableHead>
                        <TableHead className="w-[20%]">Override</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {toolEntries.map((tool) => (
                        <TableRow key={tool.capabilityId}>
                          <TableCell className="font-medium">
                            {tool.toolName || tool.capabilityId}
                          </TableCell>
                          <TableCell>
                            <code className="text-xs text-muted-foreground">
                              {tool.capabilityId}
                            </code>
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATE_VARIANTS[tool.state]}>
                              <ShieldCheck size={10} className="mr-1" />
                              {STATE_LABELS[tool.state]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={tool.state}
                              onValueChange={(state: ToolSetting["state"]) =>
                                setPermission.mutate({
                                  capabilityId: tool.capabilityId,
                                  state,
                                })
                              }
                              disabled={
                                setPermission.isPending &&
                                setPermission.variables?.capabilityId === tool.capabilityId
                              }
                            >
                              <SelectTrigger className="h-8 w-[140px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                <SelectItem value="always_allow">Always Allow</SelectItem>
                                <SelectItem value="ask_each_time">Ask Each Time</SelectItem>
                                <SelectItem value="disabled">Disabled</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {!toolsLoading && toolEntries.length === 0 && (
                <Card className="flex flex-col items-center gap-3 p-6 text-center">
                  <Shield className="h-8 w-8 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">No tool settings</p>
                    <p className="text-xs text-muted-foreground">
                      No tools with configurable permissions exist yet.
                    </p>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
