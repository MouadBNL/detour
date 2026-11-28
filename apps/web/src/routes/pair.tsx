import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { PairingApproval, viewerQuery } from "../features/pairing/index.ts";

// The router parses search values as JSON first, so `?code=12345678` arrives as a number: coerce
// it, and treat anything unparseable as "no code" rather than failing the route.
const PairSearchSchema = z.object({
  code: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute("/pair")({
  validateSearch: (search) => PairSearchSchema.parse(search),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(viewerQuery);
  },
  component: PairPage,
});

function PairPage() {
  const { code } = Route.useSearch();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Pair Detour extension</h1>
      <PairingApproval initialCode={code} />
    </main>
  );
}
