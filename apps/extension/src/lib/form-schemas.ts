import { z } from "zod";
import { normalizeDomain } from "./guard-state.ts";

export const MAX_REASON_LENGTH = 300;

export const GRANT_DURATION_OPTIONS = ["2", "5", "15", "30"] as const;

export type GrantDurationOption = (typeof GRANT_DURATION_OPTIONS)[number];

/** Validates the popup "add site" form: any input `normalizeDomain` accepts. */
export const addSiteFormSchema = z.object({
  domain: z
    .string()
    .refine((value) => normalizeDomain(value).ok, "Enter a valid domain like example.com."),
});

/** Validates the blocked-page "request a pass" form. */
export const requestPassFormSchema = z.object({
  duration: z.enum(GRANT_DURATION_OPTIONS),
  reason: z.string().trim().max(MAX_REASON_LENGTH, "Keep your reason under 300 characters."),
});
