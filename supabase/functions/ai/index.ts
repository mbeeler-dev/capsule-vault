// Capsule Vault AI function (Supabase Edge Function, runs on Deno).
//
// Why this exists: the Anthropic API key must stay secret. If it were in the
// website's JavaScript, anyone could copy it and run up your bill. So the
// browser sends requests here; this function checks the person is signed in,
// limits what they can ask for, adds the key and forwards the request to Claude.
//
// Deploy:  supabase functions deploy ai --no-verify-jwt   (this function checks sign-in itself)
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Optional model overrides: AI_MODEL_FAST, AI_MODEL_SMART

const MODEL_FAST = Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-5-5";   // chat + tool use: quick and cheap
const MODEL_SMART = Deno.env.get("AI_MODEL_SMART") ?? "claude-sonnet-5-5"; // photo ID + bootleg check: stronger vision
const MAX_TOKENS_CAP = 2048;
const MAX_BODY_BYTES = 5_000_000; // roughly 4 shrunk photos plus text

const cors = {
  "Access-Control-Allow-Origin": "*", // tighten to your site's address once it's live
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Only signed-in users may spend AI credits. The anon key alone is not enough:
// we ask Supabase Auth who this token belongs to.
async function signedInUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    // The browser sends the project's publishable key as "apikey"; fall back to the built-in env value.
    headers: { Authorization: auth, apikey: req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI is not set up yet (missing ANTHROPIC_API_KEY)." }, 500);

  const userId = await signedInUser(req);
  if (!userId) return json({ error: "Sign in to use AI features." }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Request too large. Use fewer or smaller photos." }, 413);

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "Bad request" }, 400); }

  const { tier, system, messages, tools, max_tokens } = body ?? {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
    return json({ error: "Bad request: messages" }, 400);
  }

  // The server decides the model and the spending limits, never the browser.
  const payload: Record<string, unknown> = {
    model: tier === "smart" ? MODEL_SMART : MODEL_FAST,
    max_tokens: Math.min(Number(max_tokens) || 1024, MAX_TOKENS_CAP),
    messages,
  };
  if (typeof system === "string") payload.system = system.slice(0, 20_000);
  if (Array.isArray(tools) && tools.length) {
    payload.tools = tools.slice(0, 8).map((t: any) => ({
      name: String(t.name),
      description: String(t.description ?? ""),
      input_schema: t.input_schema ?? { type: "object", properties: {} },
    }));
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("Anthropic error", res.status, data?.error?.message);
    return json({ error: data?.error?.message ?? "The AI request failed." }, res.status === 429 ? 429 : 502);
  }

  // Log usage so you can watch costs per user in the Supabase function logs.
  console.log(JSON.stringify({ user: userId, model: payload.model, usage: data.usage }));
  return json({ content: data.content, stop_reason: data.stop_reason });
});
