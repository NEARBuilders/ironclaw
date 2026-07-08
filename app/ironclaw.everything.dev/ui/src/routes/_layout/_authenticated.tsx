import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { ExternalLink, Home, MessageSquare, Rocket } from "lucide-react";
import { type SessionData, sessionQueryOptions } from "@/app";

interface AuthContext {
  isAuthenticated: boolean;
  user: SessionData["user"] | null;
  session: SessionData["session"] | null;
  activeOrganizationId: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  isBanned: boolean;
}

export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const { queryClient, authClient } = context;

    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );

    if (!session?.user) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }

    if (session.user.banned) {
      throw redirect({
        to: "/login",
        hash: "banned",
      });
    }

    const auth: AuthContext = {
      isAuthenticated: true,
      user: session.user,
      session: session.session,
      activeOrganizationId: session.session?.activeOrganizationId || null,
      isAnonymous: session.user.isAnonymous || false,
      isAdmin: session.user.role === "admin",
      isBanned: session.user.banned || false,
    };
    return {
      auth,
      session,
    };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div
      className="h-full flex flex-col"
      style={{
        paddingBottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <Outlet />
      <BottomNav pathname={pathname} />
    </div>
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
