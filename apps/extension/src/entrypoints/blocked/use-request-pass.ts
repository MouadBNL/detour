import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import type { BlockedTarget } from "../../lib/blocked-target.ts";
import { requestPassAccess } from "../../lib/extension-api.ts";
import { requestPassFormSchema } from "../../lib/form-schemas.ts";

type RequestPassValues = z.input<typeof requestPassFormSchema>;

const DEFAULT_VALUES: RequestPassValues = { duration: "5", reason: "" };

export type PassOutcome = {
  readonly minutes: number;
  readonly reason: string;
  readonly installed: Awaited<ReturnType<typeof requestPassAccess>>;
};

async function requestPass(target: BlockedTarget, values: RequestPassValues): Promise<PassOutcome> {
  const reason = values.reason.trim();
  const minutes = Number(values.duration);
  const installed = await requestPassAccess({
    domain: target.host,
    durationMinutes: minutes,
    reason,
  });
  return { minutes, reason, installed };
}

/**
 * The blocked page's "request a pass" form: Zod validation on submit, then `grant_access`.
 * Navigates to the target only once the background worker has installed the allow rule.
 */
export function useRequestPass(target: BlockedTarget, navigate: (href: string) => void) {
  const mutation = useMutation({
    mutationFn: (values: RequestPassValues) => requestPass(target, values),
    onSuccess: (outcome) => {
      if (outcome.installed.ok) navigate(target.href);
    },
  });
  const form = useForm({
    defaultValues: DEFAULT_VALUES,
    validators: { onSubmit: requestPassFormSchema },
    onSubmit: ({ value }) => mutation.mutate(value),
  });

  return { form, pending: mutation.isPending, outcome: mutation.data ?? null };
}
