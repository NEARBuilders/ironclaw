import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { getAppName, sessionQueryOptions } from "@/app";
import builtOn from "@/assets/built_on.png";
import builtOnRev from "@/assets/built_on_rev.png";
import { IronclawStatus } from "@/components/ironclaw-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserNav } from "@/components/user-nav";

export const Route = createFileRoute("/_layout")({
  beforeLoad: async ({ context }) => {
    const { queryClient, authClient } = context;
    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );

    return {
      runtimeConfig: context.runtimeConfig,
      session,
    };
  },
  component: Layout,
});

function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isNavigating = useRouterState({ select: (s) => s.status === "pending" });
  const { runtimeConfig, session } = Route.useRouteContext();
  const appName = getAppName(runtimeConfig);
  const isAuthenticated = !!session?.user;

  const isChatRoute = pathname.startsWith("/chat");

  return (
    <TooltipProvider>
      <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-background text-foreground">
        <header
          className={`shrink-0 bg-card/50 ${isAuthenticated ? "border-b border-border animate-fade-in" : ""}`}
        >
          {isNavigating && (
            <div className="absolute top-0 left-0 right-0 h-[2px] z-50 overflow-hidden">
              <div
                className="h-full bg-foreground animate-progress-bar"
                style={{ width: "100%" }}
              />
            </div>
          )}

          <div className="flex items-center justify-between px-3 sm:px-6 h-11 sm:h-12">
            <Link
              to={isAuthenticated ? "/" : "/login"}
              aria-label={`${appName} home`}
              className="flex items-center gap-2 touch-manipulation transition-opacity duration-200 hover:opacity-70"
            >
              <img src="/logo.png" alt={`${appName} logo`} className="w-7 h-7 object-contain" />
              <span className="hidden sm:inline text-sm font-semibold tracking-tight">
                {appName}
              </span>
            </Link>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {isAuthenticated && <IronclawStatus />}
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main
          className={`flex-1 w-full min-h-0 flex flex-col ${!isChatRoute ? "overflow-y-auto" : "overflow-hidden"}`}
        >
          <Outlet />
        </main>

        {!isChatRoute && (
          <footer
            className="shrink-0 flex justify-center py-6"
            style={{
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <a
              href="https://near.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="relative h-6 w-[100px]"
            >
              <img
                src={builtOn}
                alt="Built on NEAR"
                className="absolute inset-0 h-full w-full object-contain dark:hidden"
              />
              <img
                src={builtOnRev}
                alt="Built on NEAR"
                className="absolute inset-0 hidden h-full w-full object-contain dark:block"
              />
            </a>
          </footer>
        )}
      </div>
    </TooltipProvider>
  );
}
