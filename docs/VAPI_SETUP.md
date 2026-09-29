# Vapi assistant setup (manual)

Jane's reasoning runs on the webhook server (Claude Agent SDK). Vapi handles only speech-to-text, text-to-speech and the call session. You connect them through Vapi's **Custom LLM** provider.

You need the webhook server's public HTTPS URL first: your Railway URL, or an ngrok URL for local testing (`ngrok http 8787`). Below it is written as `https://WEBHOOK`.

## 1. Create the assistant

In the Vapi dashboard, go to **Assistants → Create Assistant → Blank template**, name it `Jane – RelayPay`.

### Model tab
| Setting | Value |
| --- | --- |
| Provider | **Custom LLM** |
| Custom LLM URL | `https://WEBHOOK/vapi` (Vapi appends `/chat/completions`) |
| Model | `claude-sonnet-4-6` (a label only; the server uses `AGENT_MODEL`) |
| First message mode | Assistant speaks first |
| First message | `Hi, this is Jane, an AI assistant for RelayPay. How may I help you?` |
| System prompt | Leave empty. Jane's prompt lives on the server and Vapi's system message is ignored. |
| Max tokens / temperature | Defaults (ignored by the server) |

If you set `VAPI_WEBHOOK_SECRET`, add it in **Provider Keys → Custom LLM** as the API key. Vapi then sends it as `Authorization: Bearer <secret>`.

### Voice / Transcriber tabs
Choose any English voice and transcriber. A calm, neutral voice fits the brand. Language: English.

### Advanced tab
| Setting | Value |
| --- | --- |
| Max duration (seconds) | `480` (hard 8-minute stop; the server starts wrap-up at 7 minutes) |
| End call phrases | `Thank you for contacting RelayPay. Goodbye` |
| Silence timeout | 30 s |
| Server URL | `https://WEBHOOK/vapi/events` |
| Server URL secret | Same value as `VAPI_WEBHOOK_SECRET`, if set (sent as `x-vapi-secret`) |
| Server messages | Enable at least **end-of-call-report** and **status-update** |

Jane always ends a finished call with exactly `Thank you for contacting RelayPay. Goodbye.` The end-call phrase makes Vapi hang up when she says it.

Publish the assistant and copy its **Assistant ID**.

## 2. Web app keys

From **Organization → API Keys**, copy the **Public key**. Set these on Vercel (or in `web/.env.local`):

```
NEXT_PUBLIC_VAPI_PUBLIC_KEY=<public key>
NEXT_PUBLIC_VAPI_ASSISTANT_ID=<assistant id>
```

## 3. Check it works

1. Open the site and click **Talk to Jane**. You should hear the greeting.
2. Ask "What fees does RelayPay charge for international payments?"
3. In `/admin → Conversations`, the call appears with its turns, a `retrieve_knowledge` tool call and a retrieval log.
4. When you hang up, the conversation gets an end time, final status and summary (from the end-of-call report).

If Jane is silent, open **Vapi → Call Logs** for the call. A Custom LLM error there usually means a wrong URL, a secret mismatch, or the webhook server being unreachable.
