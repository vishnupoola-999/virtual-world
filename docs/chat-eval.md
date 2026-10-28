# Owner chat eval: before vs after

**Status: not run yet.** The Gemini key isn't in the build box environment. It lives only on the deployed proxy. To fill this file with real before/after replies, run this with the key in the environment (the key is sent only as a request header and is never printed):

```
GEMINI_API_KEY=... node proxy/chat-eval.js
```

The script first checks which chat model the key can actually use (`gemini-3.8-flash`, then `gemini-flash-latest`, then `gemini-flash-lite-latest`). It then runs each conversation twice and rewrites this file with every reply, its finishReason, and its output and thinking token counts.

- **Before:** `gemini-flash-lite-latest`, maxOutputTokens 1024, temperature 0.9, no thinking limit, memory only.
- **After:** the first usable Flash model, maxOutputTokens 2048, thinkingLevel low, plus the owner's profile, interests and today's diary.

| # | Conversation | What it checks |
|---|---|---|
| 1 | "Explain how black holes form, step by step…" | Long answers no longer end in MAX_TOKENS |
| 2 | "Give me a 5-day study plan for React Native…" | Multi-part list finishes all 5 days |
| 3 | "What should I do this weekend?" | Uses profile and interests (tech, space, music, Hyderabad) |
| 4 | "Who did you meet today and what did you do?" | Uses today's diary (met Arjun, Hussain Sagar) |
| 5 | OS exam, then "quiz me with 3 questions on deadlocks" | Multi-turn follow-up stays on topic |
