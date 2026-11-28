import { os } from "../../orpc/implementer.ts";
import { respond, webAuthenticated } from "../../orpc/procedures.ts";
import {
  decidePairing,
  listPairedDevices,
  lookupPairing,
  pollPairing,
  revokePairedDevice,
  startPairing,
} from "./pairing.service.ts";

const start = os.pairing.start.handler(async ({ context, input, errors }) =>
  respond(await startPairing(context, input), errors),
);

const poll = os.pairing.poll.handler(async ({ context, input, errors }) =>
  respond(await pollPairing(context, input), errors),
);

const lookup = os.pairing.lookup
  .use(webAuthenticated)
  .handler(async ({ context, input, errors }) =>
    respond(await lookupPairing(context, input), errors),
  );

const approve = os.pairing.approve
  .use(webAuthenticated)
  .handler(async ({ context, input, errors }) =>
    respond(
      await decidePairing(context, { userCode: input.userCode, decision: "approved" }),
      errors,
      (error) => errors.CONFLICT({ data: { reason: error.type } }),
    ),
  );

const deny = os.pairing.deny
  .use(webAuthenticated)
  .handler(async ({ context, input, errors }) =>
    respond(
      await decidePairing(context, { userCode: input.userCode, decision: "denied" }),
      errors,
      (error) => errors.CONFLICT({ data: { reason: error.type } }),
    ),
  );

const listDevices = os.pairing.listDevices
  .use(webAuthenticated)
  .handler(async ({ context, errors }) => respond(await listPairedDevices(context), errors));

const revokeDevice = os.pairing.revokeDevice
  .use(webAuthenticated)
  .handler(async ({ context, input, errors }) =>
    respond(await revokePairedDevice(context, input), errors),
  );

export const pairingRouter = {
  start,
  poll,
  lookup,
  approve,
  deny,
  listDevices,
  revokeDevice,
};
