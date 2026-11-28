import { Button } from "@detour/ui";
import { Plus } from "lucide-react";
import { useId } from "react";
import { describeExtensionApiError } from "../../lib/extension-api.ts";
import { useAddSiteForm } from "./use-add-site-form.ts";
import type { SiteOutcome } from "./use-popup-queries.ts";

function AddSiteOutcome({ outcome }: { outcome: SiteOutcome }) {
  if (!outcome.status.ok) {
    return (
      <p role="alert" className="text-xs text-danger">
        Could not add {outcome.domain}. {describeExtensionApiError(outcome.status.error)}
      </p>
    );
  }
  return (
    <output className="text-xs text-fg-muted">
      {outcome.granted
        ? `Guarding ${outcome.domain}.`
        : `Added ${outcome.domain}, but host access was not granted.`}
    </output>
  );
}

export function AddSiteForm() {
  const id = useId();
  const { form, submit, pending, outcome } = useAddSiteForm();
  const inputId = `${id}-domain`;
  const errorId = `${id}-domain-error`;

  return (
    <form
      noValidate
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <form.Field name="domain">
        {(field) => {
          const error = field.state.meta.errors[0]?.message;
          return (
            <>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor={inputId}>
                  Domain to guard
                </label>
                <input
                  id={inputId}
                  name={field.name}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={error === undefined ? undefined : true}
                  aria-describedby={error === undefined ? undefined : errorId}
                  placeholder="example.com"
                  className="h-8 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg placeholder:text-fg-subtle aria-invalid:border-danger"
                />
                <Button type="submit" size="sm" variant="primary" pending={pending}>
                  <Plus aria-hidden="true" />
                  Add
                </Button>
              </div>
              {error === undefined ? null : (
                <p id={errorId} className="text-xs text-danger">
                  {error}
                </p>
              )}
            </>
          );
        }}
      </form.Field>
      {outcome === null ? null : <AddSiteOutcome outcome={outcome} />}
    </form>
  );
}
