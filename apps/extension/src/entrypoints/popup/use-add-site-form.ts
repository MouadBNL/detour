import { useForm } from "@tanstack/react-form";
import { addSiteFormSchema } from "../../lib/form-schemas.ts";
import { normalizeDomain } from "../../lib/guard-state.ts";
import { beginAddSite, useAddSite, type PendingAddSite } from "./use-popup-queries.ts";

/** Submit meta: the requests started in the submit event, or none when the domain is invalid. */
function noPendingAdd(): PendingAddSite | null {
  return null;
}

/** The popup's "add site" form: Zod validation on submit, the add itself through `useAddSite`. */
export function useAddSiteForm() {
  const addSite = useAddSite();
  const form = useForm({
    defaultValues: { domain: "" },
    validators: { onSubmit: addSiteFormSchema },
    onSubmitMeta: noPendingAdd(),
    onSubmit: ({ meta, formApi }) => {
      if (meta === null) return;
      addSite.mutate(meta, {
        onSuccess: (outcome) => {
          if (outcome.status.ok) formApi.reset();
        },
      });
    },
  });

  /**
   * Call from the submit event itself. The permission request and `add_site` start before
   * anything is awaited, so Firefox still sees the user gesture.
   */
  function submit(): void {
    const normalized = normalizeDomain(form.getFieldValue("domain"));
    void form.handleSubmit(normalized.ok ? beginAddSite(normalized.value) : noPendingAdd());
  }

  return { form, submit, pending: addSite.isPending, outcome: addSite.data ?? null };
}
