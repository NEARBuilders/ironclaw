import ironclawLogo from "@/assets/ironclaw-attack.png";
import type { StagedAttachment } from "@/lib/attachments";

interface PromptSuggestion {
  emoji: string;
  label: string;
  prompt: string;
}

const SUGGESTIONS: PromptSuggestion[] = [
  {
    emoji: "🍜",
    label: "Restaurants nearby",
    prompt: "Find good restaurants near the ICML venue in Seoul",
  },
  {
    emoji: "🚇",
    label: "Subway arrival",
    prompt: "When is the next subway arriving at Gangnam Station?",
  },
  {
    emoji: "🗺️",
    label: "Directions",
    prompt: "How do I get from my hotel to the COEX convention center?",
  },
  {
    emoji: "🌤️",
    label: "Weather today",
    prompt: "What's the weather in Seoul today?",
  },
  {
    emoji: "😷",
    label: "Air quality",
    prompt: "What's the air quality (fine dust) in Seoul right now?",
  },
  {
    emoji: "🍻",
    label: "Bars to meet up",
    prompt: "Find bars nearby where I can meet other ICML researchers",
  },
  {
    emoji: "🌃",
    label: "Busy tonight?",
    prompt: "Which neighborhoods in Seoul are busy tonight?",
  },
  {
    emoji: "🎌",
    label: "Attractions",
    prompt: "What attractions are near the ICML venue?",
  },
];

interface KoreaPromptEmptyStateProps {
  onSelect: (content: string, attachments?: StagedAttachment[]) => void;
  disabled?: boolean;
}

export function KoreaPromptEmptyState({ onSelect, disabled }: KoreaPromptEmptyStateProps) {
  return (
    <div className="flex flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-5 py-8 sm:py-12">
        <div className="flex flex-col items-center text-center gap-3">
          <img
            src={ironclawLogo}
            alt="IronClaw"
            className="h-20 w-20 sm:h-24 sm:w-24 object-contain drop-shadow-sm"
          />
          <div className="space-y-1">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Talk to IronClaw
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground leading-snug">
              Your Seoul concierge for ICML 2026.
              <br />
              Tap a prompt below or type your own.
            </p>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2.5 sm:gap-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(s.prompt)}
              className="group flex flex-col items-start gap-1.5 rounded-2xl border-2 border-border bg-card px-3.5 py-3 text-left transition-all duration-200 hover:border-foreground/40 hover:bg-muted/40 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none touch-manipulation min-h-[5rem]"
            >
              <span className="text-xl leading-none" aria-hidden="true">
                {s.emoji}
              </span>
              <span className="text-xs sm:text-sm font-semibold text-foreground leading-tight">
                {s.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
