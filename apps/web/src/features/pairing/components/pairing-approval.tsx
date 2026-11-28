import { Button, Skeleton } from "@detour/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import {
  approvePairingRequest,
  denyPairingRequest,
  pairingLookupQuery,
  viewerQuery,
  type PairingLookup,
} from "../api/pairing.ts";
import {
  describeBrowser,
  describeDecisionFailure,
  describeLookupFailure,
  normalizePairingCode,
  validatePairingCode,
  type LookupFailure,
} from "../model/pairing.ts";
import { AuthCard } from "./auth-card.tsx";

type PairingApprovalProps = {
  readonly initialCode?: string | undefined;
};

type LookupResultProps = {
  readonly decisionStatus: "approved" | "denied" | null;
  readonly decisionError: string | null;
  readonly isPending: boolean;
  readonly error: LookupFailure | null;
  readonly data: PairingLookup | undefined;
  readonly submitting: boolean;
  readonly onDecision: (decision: "approved" | "denied") => Promise<void>;
};

function LookupResult({
  decisionStatus,
  decisionError,
  isPending,
  error,
  data,
  submitting,
  onDecision,
}: LookupResultProps) {
  if (decisionStatus !== null) {
    return (
      <output className="flex items-center gap-2 text-sm text-success">
        <CircleCheck aria-hidden className="size-4" />
        <span>
          {decisionStatus === "approved"
            ? "Extension approved. You can close this tab and return to Detour."
            : "Pairing request denied. You can close this tab."}
        </span>
      </output>
    );
  }
  if (isPending) return <Skeleton className="h-12 w-full" />;
  if (error !== null) {
    return (
      <p role="alert" className="flex items-center gap-2 text-sm text-danger">
        <CircleAlert aria-hidden className="size-4" />
        <span>{describeLookupFailure(error)}</span>
      </p>
    );
  }
  if (data === undefined) return null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-4">
      <p className="text-sm">
        <strong>{data.deviceName}</strong> ({describeBrowser(data.browser)}) is requesting access to
        your Detour account.
      </p>
      <p className="text-sm text-fg-muted">
        Approve only if you just clicked Pair in your own Detour extension and it shows the code{" "}
        <strong>{data.userCode}</strong>. Anyone with this link can ask for access; approving gives
        that browser your account for 90 days.
      </p>
      {decisionError !== null ? (
        <p role="alert" className="text-sm text-danger">
          {decisionError}
        </p>
      ) : null}
      {data.status === "pending" ? (
        <div className="flex gap-2">
          <Button
            variant="primary"
            pending={submitting}
            onClick={() => void onDecision("approved")}
          >
            Approve extension
          </Button>
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => void onDecision("denied")}
          >
            Deny
          </Button>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Current status: {data.status}.</p>
      )}
    </div>
  );
}

export function PairingApproval({ initialCode = "" }: PairingApprovalProps) {
  const queryClient = useQueryClient();
  const codeId = useId();
  const [codeInput, setCodeInput] = useState(normalizePairingCode(initialCode));
  const [decisionStatus, setDecisionStatus] = useState<"approved" | "denied" | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const viewer = useQuery(viewerQuery);
  const normalizedCode = normalizePairingCode(codeInput);
  const codeValidationError =
    normalizedCode.length === 0 ? null : validatePairingCode(normalizedCode);
  const canLookup =
    viewer.data !== null &&
    viewer.data !== undefined &&
    normalizedCode.length > 0 &&
    codeValidationError === null;

  const lookup = useQuery({
    ...pairingLookupQuery(normalizedCode),
    enabled: canLookup,
  });

  async function handleDecision(decision: "approved" | "denied") {
    setDecisionError(null);
    setSubmitting(true);
    const result =
      decision === "approved"
        ? await approvePairingRequest(normalizedCode)
        : await denyPairingRequest(normalizedCode);
    setSubmitting(false);
    if (!result.ok) {
      setDecisionError(describeDecisionFailure(result.error));
      return;
    }
    setDecisionStatus(result.value.status);
    await queryClient.invalidateQueries({ queryKey: ["pairing", "lookup", normalizedCode] });
  }

  if (viewer.isPending) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }

  if (viewer.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        Could not verify your session right now.
      </p>
    );
  }

  if (viewer.data === null) {
    return <AuthCard userCode={normalizedCode} />;
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden className="size-4 text-accent" />
        <h2 className="text-lg font-medium">Confirm browser extension</h2>
      </div>
      <p className="text-sm text-fg-muted">Signed in as {viewer.data.user.email}.</p>

      <div className="flex flex-col gap-1">
        <label htmlFor={codeId} className="text-sm font-medium text-fg-muted">
          Pairing code
        </label>
        <input
          id={codeId}
          type="text"
          value={codeInput}
          onChange={(event) => {
            setDecisionStatus(null);
            setDecisionError(null);
            setCodeInput(event.target.value);
          }}
          placeholder="ABCD-EFGH"
          className="rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-base text-fg"
        />
        {codeValidationError !== null ? (
          <p className="text-xs text-danger">{codeValidationError}</p>
        ) : null}
      </div>

      <LookupResult
        decisionStatus={decisionStatus}
        decisionError={decisionError}
        isPending={canLookup && lookup.isPending}
        error={lookup.isError ? lookup.error : null}
        data={lookup.data}
        submitting={submitting}
        onDecision={handleDecision}
      />
    </section>
  );
}
