// Vendor follow-up: draft (LLM), send (Gmail or simulated, only on a click), mark reply received.
import { serve } from "../_shared/deno.ts";
import { draftVendorEmail, markVendorReply, sendVendorMessage } from "../_shared/pipeline.ts";

serve(async (body, ctx) => {
  const actor = String(body.actor ?? "AP Clerk");
  switch (body.op) {
    case "draft":
      return { message: await draftVendorEmail(ctx, String(body.bill_id), actor) };
    case "send": {
      const e = body.edits as { to_address: string; subject: string; body: string };
      return await sendVendorMessage(ctx, String(body.message_id), e, actor);
    }
    case "reply":
      return { bill: await markVendorReply(ctx, String(body.bill_id), actor) };
    default:
      throw new Error("op must be draft, send or reply");
  }
});
