import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  Ban,
  Info,
  RefreshCw,
  ScrollText,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useApiClient } from "@/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useIronclawStatus } from "@/hooks/use-ironclaw-status";

export const Route = createFileRoute("/_layout/_authenticated/logs")({
  component: LogsPage,
});

const logsQueryKey = ["ironclaw", "logs", "operator"] as const;

const LEVEL_ICONS: Record<string, typeof AlertCircle> = {
  error: XCircle,
  warn: AlertCircle,
  info: Info,
  debug: Info,
};

const LEVEL_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  error: "destructive",
  warn: "secondary",
  info: "default",
  debug: "outline",
};

function formatTimestamp(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function LogsPage() {
  const apiClient = useApiClient();
  const { session, status: ironclawStatus } = useIronclawStatus();
  const [levelFilter, setLevelFilter] = useState<string>("all");

  const sessionLoading = ironclawStatus === "checking" && session === null;
  const hasOperatorLogs = session?.capabilities?.operatorWebuiConfig === true;

  const {
    data: logs,
    isLoading,
    isError,
    refetch,
    isRefetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: logsQueryKey,
    queryFn: async () => {
      const result = await apiClient.ironclaw.operator.logs.list({});
      return result.data;
    },
    enabled: hasOperatorLogs,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    if (levelFilter === "all") return logs;
    return logs.filter((log) => log.level === levelFilter);
  }, [logs, levelFilter]);

  const levels = useMemo(() => {
    if (!logs) return [];
    const set = new Set(logs.map((l) => l.level));
    return Array.from(set);
  }, [logs]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <ScrollText className="h-4 w-4 text-primary" />
        </div>
        <h1 className="text-sm font-semibold text-foreground">Logs</h1>
        <div className="w-px h-5 bg-border mx-1" />
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="Filter by level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {levels.map((level) => (
              <SelectItem key={level} value={level} className="capitalize">
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {dataUpdatedAt > 0 && (
          <span className="text-[10px] text-muted-foreground">
            Updated {formatTimestamp(new Date(dataUpdatedAt).toISOString())}
          </span>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => refetch()}
          disabled={isRefetching}
          title="Refresh logs"
        >
          <RefreshCw className={`size-4 ${isRefetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        {sessionLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !hasOperatorLogs ? (
          <div className="flex items-center justify-center h-full p-6">
            <Card className="flex flex-col items-center gap-3 p-6 text-center max-w-sm">
              <Ban className="h-8 w-8 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Operator logs unavailable</p>
                <p className="text-xs text-muted-foreground">
                  Your IronClaw session does not have operator-level log access. View logs per
                  thread from the thread view instead.
                </p>
              </div>
            </Card>
          </div>
        ) : isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center h-full p-6">
            <Card className="flex flex-col items-center gap-3 p-6 text-center max-w-sm">
              <XCircle className="h-8 w-8 text-destructive" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Failed to load logs</p>
                <p className="text-xs text-muted-foreground">
                  Something went wrong. Check your connection and try again.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw size={14} className="mr-1.5" />
                Retry
              </Button>
            </Card>
          </div>
        ) : !logs || logs.length === 0 ? (
          <div className="flex items-center justify-center h-full p-6">
            <div className="text-center space-y-2">
              <ScrollText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No logs available</p>
            </div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full p-6">
            <div className="text-center space-y-2">
              <ScrollText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No {levelFilter} logs found</p>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="divide-y divide-border">
              {filteredLogs.map((log) => {
                const LevelIcon = LEVEL_ICONS[log.level] ?? Info;
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 px-6 py-2.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="shrink-0 pt-0.5">
                      <LevelIcon
                        size={13}
                        className={
                          log.level === "error"
                            ? "text-destructive"
                            : log.level === "warn"
                              ? "text-amber-500"
                              : "text-muted-foreground"
                        }
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground leading-relaxed break-words">
                        {log.message}
                      </p>
                      {log.source && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                          {log.source}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <Badge
                        variant={LEVEL_VARIANTS[log.level] ?? "outline"}
                        className="text-[10px] px-1.5 py-0 capitalize"
                      >
                        {log.level}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
