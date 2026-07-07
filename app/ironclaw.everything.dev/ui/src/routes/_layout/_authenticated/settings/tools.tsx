import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw, Shield, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useApiClient } from "@/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

export const Route = createFileRoute("/_layout/_authenticated/settings/tools")({
  component: ToolsSettingsPage,
});

type ToolSetting = NonNullable<
  Awaited<
    ReturnType<ReturnType<typeof useApiClient>["ironclaw"]["settings"]["tools"]["list"]>
  >["data"]
>[number];

const toolsQueryKey = ["ironclaw", "settings", "tools"] as const;

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

function ToolsSettingsPage() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: toolsQueryKey,
    queryFn: async () => {
      const result = await apiClient.ironclaw.settings.tools.list();
      return result.data;
    },
  });

  const listMutation = useMutation({
    mutationFn: () => apiClient.ironclaw.settings.tools.list(),
    onSuccess: (result) => {
      queryClient.setQueryData(toolsQueryKey, result.data);
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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">Tool Settings</h2>
          <p className="text-xs text-muted-foreground">
            Control tool execution permissions and auto-approve behavior.
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

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : isError ? (
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-destructive">Failed to load tool settings</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
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
                <span className="text-sm font-medium text-foreground">Auto-approve all tools</span>
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

          {!isLoading && toolEntries.length === 0 && (
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
  );
}
