import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ExternalLink, Home, MessageSquare, Rocket } from "lucide-react";
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
          style={{
            paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <Outlet />
        </main>

        {!isChatRoute && (
          <footer
            className="shrink-0 flex justify-center py-6"
            style={{
              paddingBottom: "calc(5rem + env(safe-area-inset-bottom, 0px))",
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

        <BottomNav pathname={pathname} />
      </div>
    </TooltipProvider>
  );
}

interface BottomNavProps {
  pathname: string;
}

function BottomNav({ pathname }: BottomNavProps) {
  const isActive = (to: string) => {
    if (to === "/") return pathname === "/";
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  const linkClass = (active: boolean) =>
    `flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 min-h-12 min-w-[4rem] transition-colors duration-200 touch-manipulation ${
      active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-sm animate-fade-in z-40">
      <div
        className="mx-auto flex max-w-md items-center justify-around px-2"
        style={{
          paddingTop: "0.5rem",
          paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <Link to="/" preload="intent" className={linkClass(isActive("/"))}>
          <Home className="w-[20px] h-[20px]" />
          <span className="text-[11px] font-medium">home</span>
        </Link>
        <Link to="/chat" preload="intent" className={linkClass(isActive("/chat"))}>
          <MessageSquare className="w-[20px] h-[20px]" />
          <span className="text-[11px] font-medium">chat</span>
        </Link>
        <a
          href="https://agent.near.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 min-h-12 min-w-[4rem] text-muted-foreground hover:text-foreground transition-colors duration-200 touch-manipulation"
        >
          <div className="relative">
            <Rocket className="w-[20px] h-[20px]" />
            <ExternalLink className="absolute -top-1 -right-2 w-3 h-3 text-muted-foreground/70" />
          </div>
          <span className="text-[11px] font-medium">deploy</span>
        </a>
      </div>
    </nav>
  );
}
