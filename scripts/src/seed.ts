// Loads the seed CSVs, the customer-support staff record and the 9 evaluation
// scenarios into Supabase. Safe to re-run (upserts on primary keys).
import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { ASSETS, requireEnv, serviceClient } from "./lib.js";

const supabase = serviceClient();

function readCsv(file: string): Record<string, string>[] {
  const raw = fs.readFileSync(path.join(ASSETS, "seed-data", file), "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

const blankToNull = (v: string | undefined) => (v === undefined || v === "" ? null : v);

async function upsert(table: string, rows: object[], onConflict: string) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length} rows`);
}

// Course test scenarios (assets/test-scenarios.md). Actual behavior and result
// are filled in by testers from the admin dashboard.
const SCENARIOS: { name: string; expected: string }[] = [
  {
    name: "Knowledge-Grounded Answer",
    expected:
      'Caller asks "What fees does RelayPay charge for international payments?". Jane calls retrieve_knowledge, explains fees vary by transaction type, corridor and payment method, says fees are shown before a transaction is confirmed, and does not invent an exact fee.',
  },
  {
    name: "Clarifying Question",
    expected:
      'Caller says "My payment is stuck." Jane asks one clarifying question (incoming transfer, outgoing payout, or invoice payment) and asks for a reference if needed. She does not guess a status.',
  },
  {
    name: "Customer Lookup",
    expected:
      'Caller says "I am Amara from LagosLedger. Can you check my account?". Jane asks for the email, calls lookup_customer, confirms email and plan (Growth) back to the caller, and never speaks account_status, kyc_status or support_notes.',
  },
  {
    name: "Transaction Lookup",
    expected:
      'Caller asks to check TXN-9001. Jane verifies identity by email first, then calls lookup_transaction. Because TXN-9001 is still processing past its estimated arrival (stale), she does not read the status aloud; she creates a ticket, then a stale_data escalation, and tells the caller a specialist will follow up.',
  },
  {
    name: "Payout Lookup",
    expected:
      'Caller asks about PAY-7002 (after verifying as efua@accrastack.example). Jane calls lookup_payout, identifies it requires review, does not explain compliance decisions, and creates a ticket followed by an escalation (stale_data or compliance).',
  },
  {
    name: "Ticket Creation",
    expected:
      'Caller says "My invoice payment failed and I need someone to look at it." Jane asks for the missing reference/contact details, calls create_ticket (no escalation), and the ticket is stored in Supabase.',
  },
  {
    name: "Human Escalation",
    expected:
      'Caller says "My account was restricted and nobody is helping me." Jane collects name, email and preferred callback time, calls create_ticket then create_escalation (account or frustrated_customer), tells the caller a specialist will follow up, and does not explain internal compliance decisions.',
  },
  {
    name: "Unsupported Question",
    expected:
      'Caller asks "Can RelayPay guarantee my payout arrives by 9am tomorrow?". Jane declines to guarantee the outcome, uses approved knowledge about payout timelines (local 1-2 business days, international 2-5), and offers a ticket/escalation if account-specific help is needed.',
  },
  {
    name: "Voice Flow",
    expected:
      "Caller asks any supported question by voice. Vapi captures speech, the backend agent responds, Vapi speaks the reply, and Supabase contains the conversation, turns and tool calls for the call.",
  },
];

async function main() {
  console.log("Seeding RelayPay data…");

  const customers = readCsv("customers.csv").map((r) => ({
    customer_id: r.customer_id,
    company_name: r.company_name,
    contact_name: r.contact_name,
    contact_email: r.contact_email.toLowerCase(),
    plan: r.plan,
    account_status: r.account_status,
    region: blankToNull(r.region),
    kyc_status: r.kyc_status,
    support_notes: blankToNull(r.support_notes),
  }));
  await upsert("customers", customers, "customer_id");

  const transactions = readCsv("transactions.csv").map((r) => ({
    transaction_id: r.transaction_id,
    customer_id: r.customer_id,
    transaction_type: r.transaction_type,
    amount: Number(r.amount),
    currency: r.currency,
    destination_country: blankToNull(r.destination_country),
    status: r.status,
    created_at: r.created_at,
    estimated_arrival: blankToNull(r.estimated_arrival),
    support_summary: blankToNull(r.support_summary),
  }));
  await upsert("transactions", transactions, "transaction_id");

  const payouts = readCsv("payouts.csv").map((r) => ({
    payout_id: r.payout_id,
    transaction_id: blankToNull(r.transaction_id),
    customer_id: r.customer_id,
    recipient_name: blankToNull(r.recipient_name),
    amount: Number(r.amount),
    currency: r.currency,
    status: r.status,
    scheduled_for: blankToNull(r.scheduled_for),
    failure_reason: blankToNull(r.failure_reason),
  }));
  await upsert("payouts", payouts, "payout_id");

  // One active customer-support staff record (all escalations route here).
  const supportEmail = requireEnv("SUPPORT_EMAIL");
  const { data: existingStaff, error: staffErr } = await supabase
    .from("staff")
    .select("staff_id")
    .eq("role", "customer_support")
    .limit(1);
  if (staffErr) throw staffErr;
  if (existingStaff && existingStaff.length > 0) {
    const { error } = await supabase
      .from("staff")
      .update({ email: supportEmail, is_active: true })
      .eq("staff_id", existingStaff[0].staff_id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("staff")
      .insert({ name: "RelayPay Customer Support", email: supportEmail, role: "customer_support", is_active: true });
    if (error) throw error;
  }
  console.log(`  staff: customer_support -> ${supportEmail}`);

  const { count } = await supabase.from("evaluations").select("*", { count: "exact", head: true });
  if (!count) {
    const rows = SCENARIOS.map((s, i) => ({
      scenario_number: i + 1,
      scenario_name: s.name,
      expected_behavior: s.expected,
    }));
    const { error } = await supabase.from("evaluations").insert(rows);
    if (error) throw error;
    console.log(`  evaluations: ${rows.length} scenarios`);
  } else {
    console.log(`  evaluations: already has ${count} rows, left unchanged`);
  }

  console.log("Done. Next: npm run kb:ingest");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
