import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils";

export type SkillItem = {
  name: string;
  detail?: string;
};

const DOT_STYLE = "bg-[color:var(--near-green)]";

function SkillRow({ skill }: { skill: SkillItem }) {
  return (
    <div className="flex flex-col min-w-[240px]">
      <div className="flex w-full min-h-[28px] items-center gap-2 border-0 bg-transparent px-1 py-1.5 text-left text-xs">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_STYLE)} />
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          active
        </span>
        <Sparkles size={10} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium text-foreground/80">{skill.name}</span>
        {skill.detail && (
          <span className="truncate text-muted-foreground/60">— {skill.detail}</span>
        )}
      </div>
    </div>
  );
}

export function SkillRun({ skills }: { skills: SkillItem[] }) {
  const [expanded, setExpanded] = useState(false);

  if (skills.length === 0) return null;

  if (skills.length <= 2) {
    return (
      <div className="w-full max-w-[85%] min-w-[240px] space-y-0.5">
        {skills.map((skill, i) => (
          <SkillRow key={`${skill.name}-${i}`} skill={skill} />
        ))}
      </div>
    );
  }

  const summary = `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`;

  return (
    <div className="w-full max-w-[85%] min-w-[240px]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="v2-button flex w-full items-center gap-2 border-0 bg-transparent px-1 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <Sparkles size={10} className="shrink-0" />
        <span className="truncate font-medium">{summary}</span>
        {expanded ? (
          <ChevronDown size={12} className="ml-auto shrink-0 text-muted-foreground/50" />
        ) : (
          <ChevronRight size={12} className="ml-auto shrink-0 text-muted-foreground/50" />
        )}
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {skills.map((skill, i) => (
            <SkillRow key={`${skill.name}-${i}`} skill={skill} />
          ))}
        </div>
      )}
    </div>
  );
}
