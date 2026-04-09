import { LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import { clampNormalizedCoordinate } from "@shared/wsTypes";

interface ClassroomMapProps {
  className?: string;
  disabled?: boolean;
  markerLabel?: string;
  x: number;
  y: number;
}

export function ClassroomMap({
  className,
  disabled = false,
  markerLabel = "Player",
  x,
  y,
}: ClassroomMapProps) {
  const clampedX = clampNormalizedCoordinate(x);
  const clampedY = clampNormalizedCoordinate(y);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Front</span>
        <span>Back</span>
      </div>

      <div className="relative aspect-[4/3] overflow-hidden rounded-[1.5rem] border border-border/60 bg-muted/20">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(148, 163, 184, 0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.18) 1px, transparent 1px)",
            backgroundSize: "24% 100%, 100% 24%",
          }}
        />
        <div className="absolute inset-4 rounded-[1.1rem] border border-dashed border-border/60 bg-background/70" />

        <div className="absolute inset-x-6 top-5 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Left</span>
          <span>Right</span>
        </div>

        <div
          className="absolute transition-all duration-300"
          style={{
            left: `${clampedX * 100}%`,
            top: `${clampedY * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            className={cn(
              "absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/12 blur-md",
              disabled && "bg-muted/30"
            )}
          />
          <div
            className={cn(
              "relative flex size-11 items-center justify-center rounded-full border border-primary/30 bg-background shadow-lg",
              disabled && "border-border/70 bg-muted text-muted-foreground"
            )}
          >
            <LocateFixed />
          </div>
          <div className="mt-2 -translate-x-1/2 rounded-full border border-border/60 bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm">
            {markerLabel}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
        <span>X {clampedX.toFixed(2)}</span>
        <span>Y {clampedY.toFixed(2)}</span>
      </div>
    </div>
  );
}
