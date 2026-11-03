// Agent 3: approval workflow. Approve / reject / request changes on one approval level.
import { serve } from "../_shared/deno.ts";
import { approvalAction, type ApprovalActionKind } from "../_shared/pipeline.ts";

serve(async (body, ctx) => {
  const bill = await approvalAction(ctx, {
    approvalId: String(body.approval_id),
    action: body.action as ApprovalActionKind,
    actor: String(body.actor),
    comment: body.comment ? String(body.comment) : "",
  });
  return { bill };
});
