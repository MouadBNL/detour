import { Button, RadioCard, RadioGroup } from "@detour/ui";
import { useId } from "react";
import type { BlockedTarget } from "../../lib/blocked-target.ts";
import { describeExtensionApiError } from "../../lib/extension-api.ts";
import { GRANT_DURATION_OPTIONS, type GrantDurationOption } from "../../lib/form-schemas.ts";
import { useRequestPass, type PassOutcome } from "./use-request-pass.ts";

const DURATIONS: Record<GrantDurationOption, { label: string; description: string }> = {
  "2": { label: "2 minutes", description: "Quick check, right back out." },
  "5": { label: "5 minutes", description: "Short intentional visit." },
  "15": { label: "15 minutes", description: "Longer deliberate session." },
  "30": { label: "30 minutes", description: "A focused block, then you are done." },
};

function PassOutcomeNote({ outcome }: { outcome: PassOutcome }) {
  if (!outcome.installed.ok) {
    return (
      <p role="alert" className="text-sm text-danger">
        Could not install pass rule. {describeExtensionApiError(outcome.installed.error)}
      </p>
    );
  }
  const because = outcome.reason === "" ? "" : ` ("${outcome.reason}")`;
  return (
    <output className="text-sm text-fg-muted">
      {`Pass ready for ${String(outcome.minutes)} minutes${because}. Opening site...`}
    </output>
  );
}

type PassFormProps = {
  target: BlockedTarget;
  onNavigate: (href: string) => void;
};

/** Asks how long and why, then installs a pass for `target` and opens it. */
export function PassForm({ target, onNavigate }: PassFormProps) {
  const id = useId();
  const { form, pending, outcome } = useRequestPass(target, onNavigate);
  const reasonId = `${id}-reason`;
  const reasonErrorId = `${id}-reason-error`;

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="duration">
        {(field) => (
          <RadioGroup
            aria-label="Requested duration"
            value={field.state.value}
            onValueChange={(next) => field.handleChange(next)}
          >
            {GRANT_DURATION_OPTIONS.map((option) => (
              <RadioCard
                key={option}
                value={option}
                label={DURATIONS[option].label}
                description={DURATIONS[option].description}
              />
            ))}
          </RadioGroup>
        )}
      </form.Field>

      <form.Field name="reason">
        {(field) => {
          const error = field.state.meta.errors[0]?.message;
          return (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={reasonId} className="text-sm font-medium text-fg">
                Why now?
              </label>
              <input
                id={reasonId}
                name={field.name}
                type="text"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={error === undefined ? undefined : reasonErrorId}
                placeholder="Checking one specific thread..."
                className="h-9 rounded-md border border-line-strong bg-canvas px-3 text-base text-fg placeholder:text-fg-subtle aria-invalid:border-danger"
              />
              {error === undefined ? null : (
                <p id={reasonErrorId} className="text-sm text-danger">
                  {error}
                </p>
              )}
            </div>
          );
        }}
      </form.Field>

      <Button type="submit" variant="primary" size="lg" pending={pending}>
        {pending ? "Requesting pass…" : "Request pass"}
      </Button>

      {outcome === null ? null : <PassOutcomeNote outcome={outcome} />}
    </form>
  );
}
