import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ExternalLink, MessageCircle, Rocket } from "lucide-react";
import ironclawLogo from "@/assets/ironclaw-attack.png";

export const Route = createFileRoute("/_layout/")({
  head: () => ({
    meta: [
      { title: "IronClaw | Your Seoul Concierge for ICML 2026" },
      {
        name: "description",
        content:
          "Talk to IronClaw — your AI concierge for ICML 2026 in Seoul. Ask about restaurants, transit, weather, air quality, and where to meet other researchers.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:py-16">
        <div className="w-full max-w-md space-y-8 sm:space-y-10">
          <div className="flex flex-col items-center text-center space-y-5">
            <img
              src={ironclawLogo}
              alt="IronClaw"
              className="h-24 w-24 sm:h-28 sm:w-28 object-contain drop-shadow-sm"
            />
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                IronClaw
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground font-medium leading-snug">
                Your Seoul concierge for ICML 2026
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <Link
              to="/chat"
              preload="intent"
              className="group flex w-full items-center justify-center gap-2.5 rounded-2xl bg-foreground px-6 py-4 text-base font-semibold text-background shadow-sm transition-all duration-200 hover:bg-foreground/90 active:scale-[0.98] touch-manipulation min-h-14"
            >
              <img
                src={ironclawLogo}
                alt=""
                aria-hidden="true"
                className="h-6 w-6 object-contain transition-transform duration-200 group-hover:rotate-6"
              />
              <span>Talk to IronClaw</span>
              <ArrowRight
                size={18}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>

            <a
              href="https://agent.near.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex w-full items-center gap-3 rounded-2xl border-2 border-border bg-card px-5 py-4 text-left transition-all duration-200 hover:border-foreground/40 hover:bg-muted/40 active:scale-[0.98] touch-manipulation min-h-14"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Rocket size={20} className="text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Deploy your own IronClaw agent
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">agent.near.ai</p>
              </div>
              <ExternalLink
                size={16}
                className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
              />
            </a>

            <a
              href="https://t.me/IronClawAI"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex w-full items-center gap-3 rounded-2xl border-2 border-[color:var(--near-green)]/30 bg-[color:var(--near-green)]/5 px-5 py-4 text-left transition-all duration-200 hover:border-[color:var(--near-green)]/60 hover:bg-[color:var(--near-green)]/10 active:scale-[0.98] touch-manipulation min-h-14"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--near-green)]/10">
                <MessageCircle size={20} className="text-[color:var(--near-green)]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Join the IronClaw chat</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  t.me/IronClawAI · get onboarded
                </p>
              </div>
              <ExternalLink
                size={16}
                className="shrink-0 text-muted-foreground group-hover:text-[color:var(--near-green)] transition-colors"
              />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
