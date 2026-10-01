"use client";

import Vapi from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SupportPanel.module.css";

const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "";
const WEBHOOK_URL = (process.env.NEXT_PUBLIC_WEBHOOK_URL ?? "").replace(/\/+$/, "");
const START_TIMEOUT_MS = 20_000;

type CallState = "idle" | "connecting" | "active" | "ended" | "fallback";

interface JaneMessage {
  id: string;
  title: string;
  body: string;
  sentAt: string;
}

type ChatItem = ({ from: "jane" } & JaneMessage) | { from: "you"; id: string; body: string; sentAt: string };

const TYPED_PREFIX = "[Typed in chat] ";

function describeFailure(err: unknown): string {
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
    return "microphone permission denied";
  }
  if (err instanceof DOMException && err.name === "NotFoundError") return "no microphone found";
  if (err instanceof Error && err.message) return err.message.slice(0, 180);
  if (typeof err === "string") return err.slice(0, 180);
  return "voice service unavailable";
}

export function SupportPanel() {
  const [state, setState] = useState<CallState>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const vapiRef = useRef<Vapi | null>(null);
  const stateRef = useRef<CallState>("idle");
  const streamRef = useRef<EventSource | null>(null);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setCallState = (next: CallState) => {
    stateRef.current = next;
    setState(next);
  };

  const closeStream = () => {
    streamRef.current?.close();
    streamRef.current = null;
  };

  const fallBack = useCallback((reason: string) => {
    if (startTimer.current) clearTimeout(startTimer.current);
    closeStream();
    vapiRef.current?.stop().catch(() => undefined);
    setFailureReason(reason);
    setCallState("fallback");
  }, []);

  useEffect(() => {
    return () => {
      closeStream();
      vapiRef.current?.stop().catch(() => undefined);
    };
  }, []);

  const subscribeToJane = (callId: string) => {
    if (!WEBHOOK_URL) return;
    closeStream();
    const es = new EventSource(`${WEBHOOK_URL}/api/chat-stream/${encodeURIComponent(callId)}`);
    es.addEventListener("jane-message", (event) => {
      const push = JSON.parse((event as MessageEvent).data) as JaneMessage;
      setMessages((prev) => (prev.some((m) => m.id === push.id) ? prev : [...prev, { from: "jane", ...push }]));
    });
    streamRef.current = es;
  };

  const startCall = async () => {
    if (!VAPI_PUBLIC_KEY || !VAPI_ASSISTANT_ID) {
      fallBack("voice is not configured");
      return;
    }
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || !("RTCPeerConnection" in window)) {
      fallBack("this browser does not support voice calls");
      return;
    }

    setCallState("connecting");
    setMessages([]);

    try {
      // Ask for the microphone up front so a denial is detected clearly.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => t.stop());
    } catch (err) {
      fallBack(describeFailure(err));
      return;
    }

    if (!vapiRef.current) {
      const vapi = new Vapi(VAPI_PUBLIC_KEY);
      vapi.on("call-start", () => {
        if (startTimer.current) clearTimeout(startTimer.current);
        setCallState("active");
      });
      vapi.on("call-end", () => {
        setSpeaking(false);
        closeStream();
        if (stateRef.current !== "fallback") setCallState("ended");
      });
      vapi.on("speech-start", () => setSpeaking(true));
      vapi.on("speech-end", () => setSpeaking(false));
      vapi.on("call-start-failed", (event) => fallBack(describeFailure(event?.error ?? "call failed to start")));
      vapi.on("error", (err) => {
        // Errors before the call is live mean voice could not initialise.
        if (stateRef.current === "connecting") fallBack(describeFailure(err?.error?.message ?? err?.message ?? err));
        else console.error("Vapi error", err);
      });
      vapiRef.current = vapi;
    }

    startTimer.current = setTimeout(() => {
      if (stateRef.current === "connecting") fallBack("the voice service did not respond");
    }, START_TIMEOUT_MS);

    try {
      const call = await vapiRef.current.start(VAPI_ASSISTANT_ID);
      if (!call) {
        fallBack("the voice service could not start a call");
        return;
      }
      subscribeToJane(call.id);
    } catch (err) {
      fallBack(describeFailure(err));
    }
  };

  const endCall = () => {
    vapiRef.current?.stop().catch(() => undefined);
  };

  const sendTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || stateRef.current !== "active" || !vapiRef.current) return;
    vapiRef.current.send({ type: "add-message", message: { role: "user", content: TYPED_PREFIX + text } });
    setMessages((prev) => [...prev, { from: "you", id: crypto.randomUUID(), body: text, sentAt: new Date().toISOString() }]);
    setDraft("");
  };

  const inCall = state === "connecting" || state === "active";

  return (
    <div className={styles.grid}>
      <section className={`card ${styles.callCard}`} aria-labelledby="talk-heading">
        <h1 id="talk-heading" className={styles.title}>
          RelayPay Support
        </h1>
        <p className={styles.lede}>
          Jane is RelayPay&apos;s AI support assistant. She can help with payments, payouts, fees, and account questions.
        </p>

        <div className={styles.indicator} role="status" aria-live="polite">
          <span className={`${styles.dot} ${state === "active" ? styles.dotActive : state === "connecting" ? styles.dotConnecting : ""}`} />
          <span>
            {state === "active"
              ? speaking
                ? "Call active · Jane is speaking"
                : "Call active · listening"
              : state === "connecting"
                ? "Connecting…"
                : state === "ended"
                  ? "Call ended"
                  : state === "fallback"
                    ? "Voice unavailable"
                    : "Call inactive"}
          </span>
        </div>

        {state === "fallback" ? (
          <p className="muted small">Voice could not start ({failureReason}). You can leave a message instead.</p>
        ) : inCall ? (
          <button className="btn btn-danger" onClick={endCall}>
            End call
          </button>
        ) : (
          <button className="btn btn-primary" onClick={startCall}>
            {state === "ended" ? "Talk to Jane again" : "Talk to Jane"}
          </button>
        )}

        <p className={`muted small ${styles.disclosure}`}>
          Jane is an AI assistant. Calls are logged so our support team can review them. For account, compliance or
          dispute questions she will connect you with a specialist.
        </p>
      </section>

      <section className={`card ${styles.chatCard}`} aria-labelledby="chat-heading">
        {state === "fallback" ? (
          <FallbackForm reason={failureReason} />
        ) : (
          <>
            <div className={styles.chatHeader}>
              <h2 id="chat-heading" className={styles.chatTitle}>
                Chat
              </h2>
              <span className="muted small">{state === "active" ? "Type during the call" : "Available during a call"}</span>
            </div>
            <div className={styles.chatBody} aria-live="polite">
              {messages.length === 0 ? (
                <p className="muted small">
                  {inCall
                    ? "Type your email or other details here if they're hard to say. Reference numbers Jane shares will appear here instead of being read aloud."
                    : "Start a call with Jane. You can type details here during the call, and reference numbers she shares will appear here."}
                </p>
              ) : (
                messages.map((m) => {
                  const time = (
                    <time className="muted small" dateTime={m.sentAt}>
                      {new Date(m.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </time>
                  );
                  return m.from === "jane" ? (
                    <article key={m.id} className={styles.push}>
                      <div className={styles.pushTitle}>{m.title}</div>
                      <div className={styles.pushBody}>{m.body}</div>
                      {time}
                    </article>
                  ) : (
                    <article key={m.id} className={styles.typed}>
                      <div className={styles.pushTitle}>You typed</div>
                      <div className={styles.typedBody}>{m.body}</div>
                      {time}
                    </article>
                  );
                })
              )}
            </div>
            <form className={styles.composer} onSubmit={sendTyped}>
              <label htmlFor="chat-input" className="sr-only">
                Type a message to Jane
              </label>
              <input
                id="chat-input"
                className="input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={state === "active" ? "Type your email or a detail…" : "Start a call to type"}
                disabled={state !== "active"}
                maxLength={500}
                autoComplete="off"
              />
              <button className="btn btn-primary" type="submit" disabled={state !== "active" || !draft.trim()}>
                Send
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function FallbackForm({ reason }: { reason: string | null }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch(`${WEBHOOK_URL}/api/fallback-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, reason: reason ?? undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Something went wrong. Please try again.");
      }
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div className={styles.chatBody}>
        <h2 className={styles.chatTitle}>Message received</h2>
        <p>Thank you, {name.split(" ")[0] || "there"}. Our support team will get back to you at {email}.</p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <h2 id="chat-heading" className={styles.chatTitle}>
        Leave a message
      </h2>
      <p className="muted small">Voice is unavailable. Leave a message and our team will get back to you.</p>
      <div className="field">
        <label htmlFor="fb-name">Name</label>
        <input id="fb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="fb-email">Email</label>
        <input id="fb-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="fb-message">Message</label>
        <textarea id="fb-message" className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={4000} />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
