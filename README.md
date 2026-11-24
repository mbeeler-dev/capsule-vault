# Capsule Vault

A collection tracker for Dragon Ball S.H.Figuarts. Track what you own, log what you paid and what it's worth, keep a wishlist with deal alerts, earn badges, share a public shelf, and use AI to identify figures from a photo, spot bootleg listings and answer questions about your collection.

## How it's built

```
Browser (index.html + js/app.js)
   │
   ├── Supabase Auth ........ email sign-in links (no passwords)
   ├── Supabase Database .... vaults (private, one per user) + showcases (public)
   ├── Supabase Storage ..... photos/<user id>/... (public read, owner-only write)
   └── Edge Function "ai" ... checks sign-in, adds the secret API key, calls Claude
```

| File | What it does |
|---|---|
| `index.html` | Page structure |
| `css/styles.css` | All three themes (Retro, Light, Dark) via CSS variables |
| `js/catalog.js` | All 236 Dragon Ball S.H.Figuarts releases |
| `js/config.js` | Your Supabase URL and public key |
| `js/app.js` | Everything else: state, saving, stats, badges, showcase, AI Lab |
| `supabase/schema.sql` | Tables and security rules |
| `supabase/functions/ai/index.ts` | The AI server function |

The site works with **no setup at all** in local-only mode: open `index.html` through any local web server and it saves on that device. Accounts, sync, photos, showcases and the AI Lab turn on once Supabase is connected.

## Setup checklist

Plan on about an hour the first time. Everything here has a free tier except the Anthropic API, which is pay-as-you-go.

### 1. Run it locally (5 min)
1. Install [Node.js](https://nodejs.org) if you don't have it.
2. In this folder, run `npx serve .` and open the address it prints.
   (Opening `index.html` by double-clicking won't work, because browsers block JavaScript modules from `file://` pages.)
3. You should see the full roster, saving on your device only.

### 2. Put it on GitHub (10 min)
1. Create a GitHub account and a new repository called `capsule-vault`.
2. Upload this folder (or use `git init`, `git add .`, `git commit -m "First version"`, `git push`).
3. From now on, commit after each change with a clear message. Interviewers look at this history.

### 3. Create the Supabase project (15 min)
1. Sign up at [supabase.com](https://supabase.com) and create a new project. Save the database password somewhere safe.
2. Go to **SQL Editor > New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. Go to **Project Settings > API**. Copy the **Project URL** and the **anon public** key into `js/config.js`.
4. Go to **Authentication > URL Configuration**. Set **Site URL** to your local address for now (like `http://localhost:3000`). You'll add your live address in step 5.
5. Reload the site, click **SIGN IN**, enter your email and click the link you receive. Your vault now syncs.

### 4. Turn on the AI Lab (15 min)
1. Get an API key at [console.anthropic.com](https://console.anthropic.com). Add a few dollars of credit and **set a monthly spend limit** under Billing.
2. Install the Supabase CLI ([guide](https://supabase.com/docs/guides/cli)), then in this folder run:
   ```
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key
   supabase functions deploy ai
   ```
   Your project ref is the part of your Supabase URL before `.supabase.co`.
3. Reload the site, sign in, and try the AI Lab.

**Never** put the Anthropic key in `config.js` or commit it to GitHub. It only lives in Supabase secrets.

### 5. Go live on Netlify (10 min)
1. Sign up at [netlify.com](https://netlify.com) and choose **Add new site > Import from GitHub**, then pick your repository. No build command is needed; the publish directory is the repository root.
2. Netlify gives you an address like `capsule-vault.netlify.app`.
3. Back in Supabase, **Authentication > URL Configuration**: set **Site URL** to that address and add it under **Redirect URLs** too.
4. Optional: buy a domain and connect it in Netlify under **Domain management**.

### 6. Before sharing it widely
- [ ] Get the trademark clearance check on the name
- [ ] Add a privacy policy page (you store emails and photos)
- [ ] In `supabase/functions/ai/index.ts`, change `Access-Control-Allow-Origin` from `*` to your live address
- [ ] Set up custom email (Supabase's built-in email has low hourly limits): **Authentication > Emails > SMTP Settings**, with a free provider like Resend
- [ ] Add a daily AI limit per user (see "Next steps")

## Costs, roughly
- **Netlify, GitHub, Supabase:** free tiers cover a hobby project with hundreds of users.
- **Anthropic API:** you pay per request. A photo ID costs more than a chat question because images use more tokens. Check current prices on Anthropic's pricing page, and watch real usage in the Supabase function logs, which record tokens per request.

## How the key parts work (interview prep)

**State and rendering.** All of a user's data lives in one `state` object. Every action calls `upd()`, which changes `state` and calls `persist()`. The screen is rebuilt from `state` by `render()`. Undo, backups, badges and stats all build on that single source of truth.

**Saving.** `persist()` writes to `localStorage` instantly, then waits 0.7 s (debouncing) before `flush()` upserts the `vaults` row. A `writing` flag makes sure only one save runs at a time.

**Security.** The browser talks to the database directly, so the rules in `schema.sql` (Row Level Security) are the real protection: each user can only read and write their own vault and their own photo folder. Showcases are a filtered copy, so private fields like prices paid are never exposed.

**AI: grounding and validation.** Snap to ID sends the photo plus the whole catalog, so Claude picks from real figures instead of inventing names. The reply is JSON, and the app drops any ID that isn't in the catalog and clamps confidence to 0-100 before showing it. You confirm before anything is saved.

**AI: tool use.** In Ask Your Vault, Claude can't see your data. It replies with a "tool_use" request (like `find_figures {"text":"vegeta","status":"own"}`), the browser runs that function on your real data, sends back the result, and Claude repeats until it can answer. The "How I answered" link under each reply shows the lookups it made.

**Secrets.** The API key lives only in the edge function. The function checks the user is signed in and sets the model and token limits on the server, so a visitor can't use your key for anything else.

## Next steps (good portfolio upgrades)
1. **Evals for Snap to ID:** photograph 50+ of your figures, record the correct ID for each, and measure accuracy. Then improve the prompt and measure again. Put the before and after numbers in this README.
2. **Daily AI limit per user:** add an `ai_usage` table and have the function refuse requests over, say, 50 a day.
3. **Live price data** from a licensed sold-listings source.
4. **PWA:** add a web manifest and icon so people can install it on their home screen.
5. **Batch photo upload** to add many figure photos at once.

## Credits
Catalog compiled from the Kanzenshuu S.H.Figuarts list and Tamashii Web announcements. S.H.Figuarts and Dragon Ball are trademarks of their respective owners; this is an unofficial fan project.
