export interface Conversation {
  conversation_id: string;
  vapi_call_id: string | null;
  channel: string;
  customer_id: string | null;
  customer_email: string | null;
  start_time: string;
  end_time: string | null;
  status: "active" | "resolved" | "escalated" | "error";
  turn_count: number;
  summary: string | null;
  error_message: string | null;
  ended_reason: string | null;
}

export interface Turn {
  turn_id: string;
  conversation_id: string;
  turn_number: number;
  role: "user" | "assistant";
  content: string;
  answer_type: string | null;
  status: "success" | "error";
  error_message: string | null;
  token_count_input: number | null;
  token_count_output: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  model_used: string | null;
  created_at: string;
}

export interface ToolCall {
  tool_call_id: string;
  conversation_id: string;
  turn_number: number | null;
  tool_name: string;
  input: unknown;
  output: unknown;
  status: "success" | "error";
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface RetrievalLog {
  retrieval_id: string;
  conversation_id: string | null;
  turn_number: number | null;
  query: string;
  chunks_returned: { chunk_id: string; source_title: string; similarity: number; content: string }[];
  source_titles: string[];
  similarity_scores: number[];
  source_summary: string | null;
  above_threshold: boolean;
  created_at: string;
}

export interface Ticket {
  ticket_id: string;
  conversation_id: string | null;
  customer_id: string | null;
  source: string;
  user_name: string;
  user_email: string;
  subject: string;
  description: string;
  category: string | null;
  priority: string;
  status: "open" | "processing" | "resolved" | "closed";
  created_at: string;
  urgent?: boolean;
  escalations?: { escalation_id: string; category: string; status: string; preferred_time: string | null }[];
}

export interface Escalation {
  escalation_id: string;
  ticket_id: string;
  conversation_id: string | null;
  customer_id: string | null;
  user_name: string;
  user_email: string;
  category: string;
  reason: string;
  preferred_time: string | null;
  call_booked: boolean;
  status: string;
  notified_at: string | null;
  created_at: string;
}

export interface ConversationEvent {
  event_id: string;
  turn_number: number | null;
  event_type: string;
  summary: string;
  metadata: unknown;
  created_at: string;
}

export interface Evaluation {
  evaluation_id: string;
  scenario_number: number | null;
  scenario_name: string;
  tester_name: string | null;
  date_run: string | null;
  conversation_id: string | null;
  expected_behavior: string;
  actual_behavior: string | null;
  result: "pass" | "fail" | null;
  notes: string | null;
  created_at: string;
}

export interface Metrics {
  total_conversations: number;
  active: number;
  resolved: number;
  escalated: number;
  errors: number;
  resolution_rate: number;
  escalation_rate: number;
  error_rate: number;
  avg_turns: number;
  avg_duration_seconds: number;
  total_tickets: number;
  total_escalations: number;
}
