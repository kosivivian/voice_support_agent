"use client";

import Vapi from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SupportPanel.module.css";
import { VoiceOrb, type OrbMode } from "./VoiceOrb";

const VAPI_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";
const VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID ?? "";
const WEBHOOK_URL = (process.env.NEXT_PUBLIC_WEBHOOK_URL ?? "").replace(/\/+$/, "");
const START_TIMEOUT_MS = 20_000;
const TYPED_PREFIX = "[Typed in chat] ";

type CallState = "idle" | "connecting" | "active" | "ended" | "fallback";
type Speaker = "you" | "jane";

interface JaneMessage {
  id: string;
  title: string;
  body: string;
  sentAt: string;
}

type ConversationItem =
  | { kind: "line"; id: string; speaker: Speaker; text: string }
  | { kind: "typed"; id: string; text: string }
  | ({ kind: "card" } & JaneMessage);

interface TranscriptEvent {
  type?: string;
  role?: "assistant" | "user";
  transcriptType?: "partial" | "final";
  transcript?: string;
}

const HELP_TOPICS = [
  "Payment and payout status",
  "Fees, limits and timelines",
  "Invoices and account questions",
  "Connecting you with a specialist",
];

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
  const [muted, setMuted] = useState(false);
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [partial, setPartial] = useState<Partial<Record<Speaker, string>>>({});
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const vapiRef = useRef<Vapi | null>(null);
  const stateRef = useRef<CallState>("idle");
  const streamRef = useRef<EventSource | null>(null);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const janeLevel = useRef(0);
  const callerLevel = useRef(0);
  const orbLevel = useRef(0);
  const speakingRef = useRef(false);
  const mutedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  // The orb follows whoever is talking; a muted caller contributes nothing.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      orbLevel.current = speakingRef.current ? janeLevel.current : mutedRef.current ? 0 : callerLevel.current;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, partial]);

  const subscribeToJane = (callId: string) => {
    if (!WEBHOOK_URL) return;
    closeStream();
    const es = new EventSource(`${WEBHOOK_URL}/api/chat-stream/${encodeURIComponent(callId)}`);
    es.addEventListener("jane-message", (event) => {
      const push = JSON.parse((event as MessageEvent).data) as JaneMessage;
      setItems((prev) => (prev.some((m) => m.id === push.id) ? prev : [...prev, { kind: "card", ...push }]));
    });
    streamRef.current = es;
  };

  const onTranscript = (m: TranscriptEvent) => {
    if (!m.type?.startsWith("transcript") || !m.role || !m.transcript) return;
    const speaker: Speaker = m.role === "user" ? "you" : "jane";
    // Typed messages show up in the transcript too; they are already listed as typed.
    if (m.transcript.startsWith(TYPED_PREFIX.trim())) return;
    if (m.transcriptType === "final") {
      const text = m.transcript.trim();
      setPartial((p) => ({ ...p, [speaker]: undefined }));
      setItems((prev) => [...prev, { kind: "line", id: crypto.randomUUID(), speaker, text }]);
    } else {
      setPartial((p) => ({ ...p, [speaker]: m.transcript }));
    }
  };

  const resetCallUi = () => {
    setSpeaking(false);
    speakingRef.current = false;
    setMuted(false);
    mutedRef.current = false;
    setPartial({});
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
    setItems([]);
    resetCallUi();

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
        resetCallUi();
        closeStream();
        if (stateRef.current !== "fallback") setCallState("ended");
      });
      vapi.on("speech-start", () => {
        speakingRef.current = true;
        setSpeaking(true);
      });
      vapi.on("speech-end", () => {
        speakingRef.current = false;
        setSpeaking(false);
      });
      vapi.on("volume-level", (v) => {
        janeLevel.current = v;
      });
      vapi.on("local-volume-level", (v) => {
        callerLevel.current = v;
      });
      vapi.on("message", (m) => onTranscript(m as TranscriptEvent));
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

  const toggleMute = () => {
    if (!vapiRef.current || stateRef.current !== "active") return;
    const next = !mutedRef.current;
    vapiRef.current.setMuted(next);
    mutedRef.current = next;
    setMuted(next);
  };

  const sendTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || stateRef.current !== "active" || !vapiRef.current) return;
    vapiRef.current.send({ type: "add-message", message: { role: "user", content: TYPED_PREFIX + text } });
    setItems((prev) => [...prev, { kind: "typed", id: crypto.randomUUID(), text }]);
    setDraft("");
  };

  const inCall = state === "connecting" || state === "active";
  const orbMode: OrbMode =
    state === "connecting" ? "connecting" : state !== "active" ? "idle" : speaking ? "speaking" : muted ? "muted" : "listening";
  const statusText =
    state === "active"
      ? speaking
        ? "Jane is speaking"
        : muted
          ? "You're muted. Jane can't hear you."
          : "Listening"
      : state === "connecting"
        ? "Connecting…"
        : state === "ended"
          ? "Call ended"
          : state === "fallback"
            ? "Voice unavailable"
            : "Tap the mic to talk";

  return (
    <div className={styles.layout}>
      <section className={styles.intro} aria-labelledby="talk-heading">
        <h1 id="talk-heading" className={styles.title}>
          Talk to Jane, RelayPay&apos;s support assistant
        </h1>
        <p className={styles.lede}>
          Ask about your payments, payouts, fees or account. Jane answers from RelayPay&apos;s approved help content and
          connects you with a specialist when you need one.
        </p>
        <ul className={styles.topics}>
          {HELP_TOPICS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className={`muted small ${styles.disclosure}`}>
          Jane is an AI assistant. Calls are logged so our support team can review them. Never share passwords or full
          card numbers.
        </p>
      </section>

      <section className={`card ${styles.callCard}`} aria-label="Voice call">
        <VoiceOrb mode={orbMode} level={orbLevel} />
        <p className={styles.status} role="status" aria-live="polite">
          {statusText}
        </p>
        {state === "fallback" ? (
          <p className="muted small" style={{ textAlign: "center", margin: 0 }}>
            Voice could not start ({failureReason}). You can leave a message instead.
          </p>
        ) : inCall ? (
          <div className={styles.controls}>
            <button
              className={`btn ${muted ? "btn-primary" : "btn-secondary"}`}
              onClick={toggleMute}
              disabled={state !== "active"}
              aria-pressed={muted}
            >
              {muted ? <MicIcon /> : <MicOffIcon />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button className="btn btn-danger" onClick={endCall}>
              <PhoneIcon />
              End call
            </button>
          </div>
        ) : (
          <button className={styles.micButton} onClick={startCall} aria-label={state === "ended" ? "Talk to Jane again" : "Talk to Jane"}>
            <MicIcon size={26} />
          </button>
        )}
        {state === "ended" ? <p className="muted small" style={{ margin: 0 }}>Tap the mic to start a new call.</p> : null}
      </section>

      <section className={`card ${styles.chatCard}`} aria-labelledby="chat-heading">
        {state === "fallback" ? (
          <FallbackForm reason={failureReason} />
        ) : (
          <>
            <div className={styles.chatHeader}>
              <h2 id="chat-heading" className={styles.chatTitle}>
                Conversation
              </h2>
              <span className="muted small">{state === "active" ? "Live transcript" : "Shown during a call"}</span>
            </div>
            <div className={styles.chatBody} ref={scrollRef} aria-live="polite">
              {items.length === 0 && !partial.you && !partial.jane ? (
                <p className="muted small">
                  {inCall
                    ? "What you and Jane say appears here. If something is hard to say, like an email address, type it below."
                    : "Start a call to see the live transcript. You can also type details here during the call."}
                </p>
              ) : null}
              {items.map((item) =>
                item.kind === "card" ? (
                  <article key={item.id} className={styles.push}>
                    <div className={styles.pushTitle}>{item.title}</div>
                    <div className={styles.pushBody}>{item.body}</div>
                  </article>
                ) : (
                  <div key={item.id} className={styles.line}>
                    <span className={`${styles.speaker} ${item.kind === "line" && item.speaker === "jane" ? styles.speakerJane : ""}`}>
                      {item.kind === "typed" ? "You (typed)" : item.speaker === "jane" ? "Jane" : "You"}
                    </span>
                    <span>{item.text}</span>
                  </div>
                ),
              )}
              {(["you", "jane"] as const).map((s) =>
                partial[s] ? (
                  <div key={s} className={`${styles.line} ${styles.partial}`}>
                    <span className={`${styles.speaker} ${s === "jane" ? styles.speakerJane : ""}`}>{s === "jane" ? "Jane" : "You"}</span>
                    <span>{partial[s]}</span>
                  </div>
                ) : null,
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

function MicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.6 6M12 18v3M3 3l18 18" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15.5c4.7-3.3 11.3-3.3 16 0l-1.6 2.6a1 1 0 0 1-1.3.4l-2.4-1.1a1 1 0 0 1-.6-.9v-1.6a12 12 0 0 0-4.2 0v1.6a1 1 0 0 1-.6.9l-2.4 1.1a1 1 0 0 1-1.3-.4z" />
    </svg>
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
