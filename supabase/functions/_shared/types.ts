// Shared row types. Used by the React app (demo + Supabase mode) and by the Deno Edge Functions.

export type GstinStatus = "active" | "cancelled" | "not_found";
export type BillStatus =
  | "received"
  | "needs_vendor_info"
  | "needs_review"
  | "in_approval"
  | "approved"
  | "rejected"
  | "duplicate";
export type Outcome = "pass" | "warn" | "fail" | "skipped";
export type Role = "ap_clerk" | "approver" | "finance_controller";

export interface Vendor {
  id: string;
  name: string;
  gstin: string | null;
  gstin_status: GstinStatus;
  msme_status: string | null; // "micro" | "small" | "medium" | null (not registered)
  udyam_no: string | null;
  bank_name: string | null;
  bank_last4: string | null;
  ifsc: string | null;
  bank_verified: boolean;
  email_domain: string | null;
  tds_section: string | null; // "194C" | "194J" | "194I" | "194Q" | null
  fy_taxable_total: number; // taxable value already paid/booked this FY, before the current bill
  contact_email: string | null;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id: string;
  amount: number;
  billed_amount: number;
  tolerance_pct: number;
}

export interface Bill {
  id: string;
  vendor_id: string | null;
  vendor_gstin: string | null;
  bank_last4: string | null;
  ifsc: string | null;
  invoice_no: string | null;
  invoice_date: string | null; // yyyy-mm-dd
  due_date: string | null;
  payment_terms: string | null;
  subtotal: number | null;
  discount: number;
  cgst: number;
  sgst: number;
  igst: number;
  adjustments: number;
  tax_total: number | null;
  total: number | null;
  tds_section: string | null;
  tds_pct: number;
  status: BillStatus;
  department: string | null;
  narration: string | null;
  po_id: string | null;
  po_reference: string | null;
  rcm: boolean;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_hash: string | null;
  source_email_id: string | null;
  extracted: Extraction | null;
  field_confidence: Record<string, number> | null;
  insights: Insight[] | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillLine {
  id: string;
  bill_id: string;
  position: number;
  description: string | null;
  hsn_sac: string | null;
  qty: number | null;
  rate: number | null;
  gst_pct: number | null;
  amount_excl_gst: number | null;
}

export interface ValidationResult {
  id: string;
  bill_id: string;
  check_key: string;
  outcome: Outcome;
  detail: string;
  evidence: Record<string, unknown>;
  source: "computed" | "simulated_registry";
  created_at: string;
}

export interface Condition {
  field: "department" | "amount" | "vendor_msme";
  op: "eq" | "gt" | "gte" | "lt";
  value: string | number | boolean;
}
export interface Level {
  level: number;
  approver_name: string;
  approver_role: Role;
}
export interface ApprovalRule {
  id: string;
  name: string;
  priority: number;
  conditions: Condition[];
  levels: Level[];
  created_at: string;
}

export type ApprovalStatus = "waiting" | "pending" | "approved" | "rejected" | "changes_requested" | "cancelled";
export interface Approval {
  id: string;
  bill_id: string;
  rule_id: string | null;
  level: number;
  approver_name: string;
  approver_role: Role;
  status: ApprovalStatus;
  comment: string | null;
  pending_since: string | null;
  acted_at: string | null;
  created_at: string;
}

export interface TraceEvent {
  id: string;
  bill_id: string | null;
  email_id: string | null;
  ts: string;
  actor: string; // ap_agent | validation_agent | workflow_agent | intake_agent | <person name>
  action: string;
  reasoning: string;
  evidence: Record<string, unknown>;
}

export interface EmailAttachment {
  filename: string;
  mime: string;
  size: number;
  hash: string;
  path: string | null; // storage path, null if not stored (e.g. unsupported)
}

export type EmailClass =
  | "invoice"
  | "credit_note"
  | "statement"
  | "quotation_or_proforma"
  | "auto_reply"
  | "newsletter"
  | "vendor_reply"
  | "other";

export interface Email {
  id: string;
  message_id: string;
  source: "simulated" | "gmail";
  from_address: string;
  subject: string;
  body_text: string;
  received_at: string;
  in_reply_to: string | null;
  thread_id: string | null;
  attachments: EmailAttachment[];
  attachment_hash: string | null;
  classification: EmailClass | null;
  classification_reason: string | null;
  flag: string | null; // needs a human: no attachment, zip, unsupported, ...
  processed: boolean;
  bill_ids: string[];
  created_at: string;
}

export interface VendorMessage {
  id: string;
  bill_id: string;
  to_address: string;
  subject: string;
  body: string;
  status: "draft" | "sent";
  simulated: boolean;
  rfc_message_id: string | null;
  thread_id: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Insight {
  kind: "terms" | "rcm" | "amount" | "sender" | "injection" | "msme" | "info";
  text: string;
}

/** What the AP agent pulls out of a document. Every field nullable: null = not in the document. */
export interface Extraction {
  vendor_name: string | null;
  vendor_gstin: string | null;
  vendor_pan: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_terms: string | null;
  po_reference: string | null;
  bank_account_last4: string | null;
  ifsc: string | null;
  currency: string | null;
  line_items: {
    description: string | null;
    hsn_sac: string | null;
    qty: number | null;
    rate: number | null;
    gst_pct: number | null;
    amount_excl_gst: number | null;
  }[];
  subtotal: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total: number | null;
  suspicious_instructions: string | null;
}

export interface ExtractionResult {
  fields: Extraction;
  confidence: Record<string, number>;
  engine: string;
}

export interface Tables {
  vendors: Vendor;
  purchase_orders: PurchaseOrder;
  bills: Bill;
  bill_lines: BillLine;
  validation_results: ValidationResult;
  approval_rules: ApprovalRule;
  approvals: Approval;
  trace_events: TraceEvent;
  emails: Email;
  vendor_messages: VendorMessage;
}
export type TableName = keyof Tables;

export const PEOPLE: { name: string; role: Role; title: string }[] = [
  { name: "Priya Nair", role: "ap_clerk", title: "AP Clerk" },
  { name: "Rahul Mehta", role: "approver", title: "Approver" },
  { name: "Anita Desai", role: "finance_controller", title: "Finance Controller" },
];

export const ROLE_LABEL: Record<Role, string> = {
  ap_clerk: "AP Clerk",
  approver: "Approver",
  finance_controller: "Finance Controller",
};

/** The buyer: the company using AP Desk (invented). */
export const COMPANY = {
  name: "Kaveri Polymers Pvt Ltd",
  gstin: "27AAHCK4821M1Z7",
  state_code: "27",
  state: "Maharashtra",
  ap_mailbox: "ap@kaveripolymers.in",
  domain: "kaveripolymers.in",
};

export const DEPARTMENTS = ["Operations", "Marketing", "IT", "Legal", "Admin", "Logistics"];
export const REQUIRED_FIELDS = ["invoice_no", "invoice_date", "total", "vendor_gstin"] as const;
