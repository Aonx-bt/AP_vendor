// Bill operations from the drawer and the upload dialog.
import { serve } from "../_shared/deno.ts";
import { createBillFromFile, markPaid, resetBill, runExtraction, saveBillEdits, sendToApprovalOverride } from "../_shared/pipeline.ts";
import { fromBase64 } from "../_shared/util.ts";
import type { Bill, BillLine } from "../_shared/types.ts";

serve(async (body, ctx) => {
  const actor = String(body.actor ?? "user");
  const id = String(body.bill_id ?? "");
  switch (body.op) {
    case "upload": {
      const bill = await createBillFromFile(ctx, {
        bytes: fromBase64(String(body.data)), mime: String(body.mime), name: String(body.name), department: (body.department as string) || null, actor,
      });
      return { bill: await runExtraction(ctx, bill.id) };
    }
    case "save":
      return { bill: await saveBillEdits(ctx, id, body.patch as Partial<Bill>, (body.lines as Partial<BillLine>[]) ?? null, actor) };
    case "reset":
      return { bill: await resetBill(ctx, id, actor) };
    case "override":
      return { bill: await sendToApprovalOverride(ctx, id, actor, String(body.comment ?? "")) };
    case "paid":
      return { bill: await markPaid(ctx, id, actor) };
    default:
      throw new Error("unknown op");
  }
});
