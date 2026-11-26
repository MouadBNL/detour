import { Button, RadioCard, RadioGroup } from "@detour/ui";
import { Clock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { parseBlockedTarget } from "../../lib/blocked-target.ts";

type DurationOption = "2" | "5" | "15";

const DURATIONS: readonly { value: DurationOption; label: string; description: string }[] = [
  { value: "2", label: "2 minutes", description: "Quick check, right back out." },
  { value: "5", label: "5 minutes", description: "Short intentional visit." },
  { value: "15", label: "15 minutes", description: "Longer deliberate session." },
];

type BlockedPageProps = {
  search: string;
};

export function BlockedPage({ search }: BlockedPageProps) {
  const target = parseBlockedTarget(search);
  const [duration, setDuration] = useState<DurationOption>("5");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const heading = target.ok ? target.value.host : "Detour gate";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-canvas px-6 py-10 text-fg">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-fg-muted">
          <Clock className="size-4 text-accent" aria-hidden="true" />
          <span className="text-sm font-medium">Detour</span>
        </div>
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="text-sm text-fg-muted">
          {target.ok
            ? "How long do you need, and what are you here for?"
            : "This page intercepts guarded visits before they load."}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5"
      >
        <RadioGroup aria-label="Requested duration" value={duration} onValueChange={setDuration}>
          {DURATIONS.map((option) => (
            <RadioCard
              key={option.value}
              value={option.value}
              label={option.label}
              description={option.description}
            />
          ))}
        </RadioGroup>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Why now?</span>
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Checking one specific thread..."
            className="h-9 rounded-md border border-line-strong bg-canvas px-3 text-base text-fg placeholder:text-fg-subtle"
          />
        </label>

        <Button type="submit" variant="primary" size="lg">
          Request pass
        </Button>

        {submitted ? (
          <output className="text-sm text-fg-muted">
            Requested {duration} minutes
            {reason.trim() ? ` for "${reason.trim()}"` : ""}.
          </output>
        ) : null}
      </form>
    </main>
  );
}
