# Live collaboration

GitLaTeX can let a few people (3–5 is the sweet spot) edit the same project in
real time, with shared cursors like Overleaf, while everyone keeps their own
folder and their own Git.

It is **optional and off by default for every project**. Nothing changes for
projects you don't share.

```
 GitLaTeX (Ada) ──WebSocket──▶ Cloudflare Worker ─▶ Durable Object "thesis" ◀──WebSocket── GitLaTeX (Bob)
   saves, commits, compiles                          (shared text, cursors,                 saves, commits, compiles
   on Ada's machine                                   who is online)                        on Bob's machine
```

Cloudflare only relays the text. Each person's GitLaTeX writes the shared text
to their own disk, and compiling, committing and pushing to GitHub happen
locally, exactly as before.

---

## Setting it up

There are two roles:

- **The owner** deploys the relay once and picks an **admin token** that only
  they know. For each project they want to share, they create a **room**; the
  relay generates that room's own token, and the owner sends co-authors an
  **invite**: one line, `gitlatex-invite:…`, holding the server, room and token.
- **Co-authors** paste the invite into their copy of the project. They never
  see the admin token, and an invite only opens the room it was made for.

Everyone's cursor is labelled with their **GitHub username**, read from the
GitHub CLI (`gh auth login`) or `git config --global github.user`; only if
neither is set do you type it in.

### 1. Deploy the relay (the owner, once, in the browser)

The relay is a small Cloudflare Worker that lives in its own repository,
[gitlatex-collab](https://github.com/abdussamiakanda/gitlatex-collab). You
need a Cloudflare account (the free plan is enough) and a GitHub account, but
nothing to install and no terminal. The same steps are in GitLaTeX under
**Live collaboration → Host**, with a button that generates the admin token.

1. **Connect GitHub to Cloudflare first.** In the
   [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create),
   go to **Workers & Pages → Create application → Connect to Git**, click
   **+ Add account**, and **Install & Authorize** the *Cloudflare Workers and
   Pages* GitHub app.
2. **Generate an admin token**: a long random string that only you know.
   **Generate admin token** in GitLaTeX makes one and copies it.
3. **Deploy:** open
   [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/abdussamiakanda/gitlatex-collab),
   paste the token as **ADMIN_TOKEN**, and click **Create and deploy**.
4. **Turn on the workers.dev address.** Open **Workers & Pages**, select the
   Worker (`gitlatex-collab`), go to **Settings → Domains & Routes**, and enable
   **workers.dev**. The address it shows, e.g.
   `https://gitlatex-collab.<your-subdomain>.workers.dev`, is your relay.

To change the admin token later: the Worker's **Settings → Variables and
Secrets**.

### 2. Host a project (the owner)

1. Open the project and click the **people** icon in the side panel (above
   Compiler), or **Live collaboration…** in the command palette
   (`Cmd/Ctrl+Shift+P`). Choose **Host**.
2. Enter the relay address and your admin token, and click **Connect**. The
   login is remembered in this browser for every project; **Sign out** forgets it.
3. The room name defaults to the project's folder name. Click **Create room &
   go live**. If the room already exists, it is reused with its token, so
   invites you sent before still work.
4. Copy the **invite** from the panel and send it to your co-authors.

The Host tab lists every room on your relay. For each one you can copy its
invite again, **issue a new token** (everyone in the room is disconnected and
the old invite stops working; you stay live with the new token and the new
invite is copied), or **delete** it (its shared text is removed from the relay;
everyone's files stay on disk).

### 3. Join (co-authors)

1. Open your copy of the project, usually cloned from the same GitHub
   repository.
2. Click the **people** icon → **Join**, paste the invite, and
   click **Join**.

You can also type the server, room and room token by hand (**Enter the server,
room and token by hand**).

From then on the project reconnects automatically whenever it's opened. The
top bar shows the initials of everyone in the room. Click them to open the panel and see who is
editing which file, copy the invite, or **Stop sharing**.

### Trying it locally

```bash
git clone https://github.com/abdussamiakanda/gitlatex-collab.git
cd gitlatex-collab
npm install
echo "ADMIN_TOKEN=dev-admin" > .dev.vars
npx wrangler dev                         # serves on localhost:8787
```

Use `localhost:8787` as the relay address and `dev-admin` as the admin token.

### The older single-token relay (`collab-worker/`)

`collab-worker/` in this repository is the earlier relay: one shared
`ROOM_TOKEN` for every room and no admin API, so **Host** does not work with
it. To use it anyway, join by hand with any room name and the `ROOM_TOKEN` as
the room token.

---

## How it behaves

| | |
| --- | --- |
| **Per project** | Each project is shared on its own. Opening another project disconnects; reopening the shared one reconnects. The setting is stored in your browser and follows the project if you rename it. |
| **What is shared** | The text files of the project: `.tex`, `.bib`, `.sty`, etc. Edits, new files, renames and deletions reach everyone. |
| **What is not shared** | Binary files (images, PDFs), TeX build output (`.aux`, `.log`, …), and Git itself. Share images through Git as usual. |
| **Cursors** | Everyone's cursor and selection show in their colour with their name. |
| **Offline** | If the connection drops, keep typing. Edits are merged when it comes back. After a few failed attempts a warning appears; GitLaTeX keeps retrying. |
| **Saving** | Each person's GitLaTeX writes the shared text to their own folder, just like normal editing. |

### Rules to agree on

1. **The room wins when you join.** If your copy of a file differs from the
   room's, yours is replaced by the room's version. Files only you have are
   added to the room. **Commit first** if you want to keep your local version.
2. **Let one person pull during a session.** A pull changes files on that
   person's disk, and those changes then reach everyone through the room. The
   others' files will show as modified until they pull too, and then they're
   clean again.
3. **Commit from anywhere.** Everyone's files are identical, so anyone can
   commit and push. Agree on who does, or commit often.
4. **One token per deployment.** Anyone with the token can join any room on
   that Worker. To keep two groups apart, deploy a second Worker with a
   different `name` in `wrangler.toml` and its own token.

To start a room fresh, use a new room name.

---

## Cost

The relay runs on Cloudflare Workers and Durable Objects. On the **free plan**
you can never be charged. A small group (3–5 people) should stay well within
its daily limits.

### Prices

Figures from Cloudflare's docs as of October 2026. Check the
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)
and [Workers](https://developers.cloudflare.com/workers/platform/pricing/)
pricing pages for current numbers.

| | Free | Paid ($5/month Workers plan) |
| --- | --- | --- |
| Worker requests | 100,000 / day | 10 million / month, then $0.30 per million |
| Worker CPU time | 10 ms per request | 30 million ms / month, then $0.02 per million ms |
| Durable Object requests | 100,000 / day | 1 million / month, then $0.15 per million |
| Durable Object duration (time it is awake) | 13,000 GB-s / day | 400,000 GB-s / month, then $12.50 per million GB-s |
| Storage rows read | 5 million / day | 25 billion / month included |
| Storage rows written | 100,000 / day | 50 million / month, then $1.00 per million |
| Stored data | 5 GB total | 5 GB-month, then $0.20 per GB-month |

Three details matter for this setup:

- **Messages are discounted 20:1.** Each keystroke is a WebSocket message sent
  to the Durable Object, but 20 incoming messages count as 1 billed request.
  Messages the Durable Object sends out are not billed.
- **The Worker is only used at connect time.** A Worker request is counted when
  someone connects or reconnects, and for the JSON status endpoint. Everything
  after that goes to the Durable Object.
- **Idle rooms don't use duration.** The relay enables hibernation, and
  Cloudflare doesn't bill duration while a room hibernates. `y-partyserver`
  stops its server-side timer so the room can actually hibernate.

### Rough estimate: 5 people writing 4 hours a day

These are estimates, not measurements.

| Usage | Approx. per day | Free limit | Share of limit |
| --- | --- | --- | --- |
| Edit and cursor messages: about 144,000, billed at 20:1 | ~7,200 requests | 100,000 | ~7% |
| Presence heartbeats (each client every ~15 s while connected) | ~500 requests | — | small |
| Worker requests (connects and reconnects) | a few dozen | 100,000 | ~0% |
| Room saves: at most one every 2–10 s while typing, about 2–5 rows each | ~10,000 rows | 100,000 | ~10% |
| Duration, worst case of a room awake all day | ≤ 10,800 GB-s | 13,000 | under the limit |

You would need roughly 10× this usage to reach a limit. The most likely way is
many rooms kept open around the clock, which uses up the duration allowance.

### What happens when a free limit runs out

Cloudflare's rule is that "further operations of that type will fail with an
error", until the limits reset at **00:00 UTC**.

| Limit reached | Effect |
| --- | --- |
| Worker requests | New connections get Cloudflare error 1027. Live editing in GitLaTeX stops. |
| Durable Object requests or duration | The room stops answering. Everyone's top-bar dot turns red ("Offline — retrying"), and after three failed attempts a warning appears. |
| Rows written | Live editing keeps working, but the room stops saving to storage. If the room restarts before the reset, it comes back empty. The next client to connect re-uploads the full document, so nothing is lost. |

You don't lose work in any of these cases, because each person's GitLaTeX
keeps writing to their own disk. While offline:

- Keep typing; you can still save, commit and push.
- Edits made offline are merged when the connection comes back after the reset.
- If two people edit the same files while disconnected, their changes are
  combined automatically when they reconnect, so expect some cleanup if both
  rewrote the same paragraph.

### On the paid plan

The $5/month plan has no daily cutoff: you pay for usage beyond the monthly
allowance. A group of 5 would fit inside the allowance, so the bill would stay
at $5. There is no hard spending cap that we know of, so rely on Cloudflare's
usage notifications. Stay on the free plan if you never want a bill.

---

## The API

The relay speaks the standard [Yjs](https://yjs.dev) protocols, so any Yjs
client can join a room. Room requests need `?token=` with the room's token (or
the admin token); anything else gets `401 Unauthorized`.

| Request | What it does |
| --- | --- |
| `wss://<host>/parties/collab/<room>?token=…` | WebSocket for Yjs sync and awareness. |
| `GET https://<host>/parties/collab/<room>?token=…` | JSON summary: `{ room, files: [{ path, length }], peers: [name] }`. Handy for checking a deployment. |
| `GET /admin/rooms` | The owner's rooms: `{ rooms: [{ room, token, createdAt }] }`. |
| `POST /admin/rooms/<room>` | Create the room with a fresh token, or return it if it exists (`created: false`). |
| `POST /admin/rooms/<room>/token` | Issue a new token; everyone connected is disconnected. |
| `DELETE /admin/rooms/<room>` | Delete the room and its shared text. |

`/admin` requests need `Authorization: Bearer <ADMIN_TOKEN>`.

**Invites** are `gitlatex-invite:` followed by base64url of
`{"h": host, "r": room, "t": token}`. The host keeps an `http://` prefix only
for a plain-HTTP relay such as `localhost:8787`.

**Document shape:** one root map, `files`, from project-relative path to
`Y.Text`.

**Awareness (presence):** each client publishes
`user: { name, color }` and `cursor: { path, anchor, head }`, where `anchor`
and `head` are Yjs relative positions in that file's `Y.Text`.

Example client:

```ts
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';

const doc = new Y.Doc();
const provider = new YProvider('gitlatex-collab.you.workers.dev', 'thesis', doc, {
  party: 'collab',
  params: { token: 'your-token' },
});
provider.on('sync', (synced: boolean) => {
  if (synced) console.log(doc.getMap<Y.Text>('files').get('main.tex')?.toString());
});
```

---

## How it's built

### Relay: [gitlatex-collab](https://github.com/abdussamiakanda/gitlatex-collab)

| File | What it does |
| --- | --- |
| `src/index.ts` | The Worker. Routes each room to its own Durable Object (`Collab`, built on `y-partyserver`) after checking the room's token, and serves the `/admin` API. A second Durable Object, `Registry`, holds the rooms and their tokens. `Collab` holds the room's Yjs document, relays updates and presence, saves the document a couple of seconds after edits (in chunks, so large projects fit), and loads it again after a restart. Idle connections hibernate. |
| `wrangler.toml` | The Worker and its two SQLite-backed Durable Object classes. |

### Editor: `web/src/collab/`

| File | What it does |
| --- | --- |
| `config.ts` | Per-project settings (on/off, server, room, room token), your GitHub username and colour, and the owner's admin login, in `localStorage`. Encodes and decodes invites. |
| `admin.ts` | The relay's owner API: list, create, re-token and delete rooms. |
| `session.ts` | One live session for the open project. On joining, it merges the file sets and takes the room's text. After that it mirrors local changes into the room and the room's changes into the Workspace, and so onto disk. It also tracks who is online. |
| `binding.ts` | Two-way binding between a Monaco model and a `Y.Text`. Remote edits are applied as one batch so your cursor stays put. It also draws other people's cursors and selections. |

Small hooks into existing code:

- `editor/models.ts` (`watchModels`): tells the session when an editor model is opened or closed, so open files are bound live.
- `state/actions.ts`:
  - `joinCollab` and `leaveCollab`; for the owner, `setCollabAdmin`, `hostCollab`, `rotateCollabRoom` and `deleteCollabRoom`.
  - Connects when a project opens and disconnects when it closes.
  - Moves the setting when a project is renamed and removes it when the project is deleted.
- `state/store.ts`: `collab` state (status, room, peers), the owner's `collabAdmin` login, and the `collab` sidebar view.
- `components/CollabPanel.tsx` (the sidebar panel: Join / Host, room list), `components/Sidebar.tsx`, `components/TopBar.tsx` (`CollabButton`), and a command palette entry.
- `index.css`: styles for remote carets and their name labels.

---

## Tests

- **Unit tests:** `web/tests/unit/collab-config.test.ts` covers room names,
  server address parsing, per-project settings, invites and admin tokens.
- **End to end:** `web/tests/e2e/collab.mjs` runs two separate GitLaTeX servers
  with separate folders on disk through one room:

  ```bash
  (cd gitlatex-collab && echo ADMIN_TOKEN=test-admin > .dev.vars && npx wrangler dev --port 8787)
  gitlatex --no-browser --port 5101 --repos /tmp/gl-a
  gitlatex --no-browser --port 5102 --repos /tmp/gl-b
  cd web && npm run e2e:collab -- http://127.0.0.1:5101 /tmp/gl-a http://127.0.0.1:5102 /tmp/gl-b localhost:8787 test-admin
  ```

  It checks that:
  - projects are unshared until asked;
  - the owner signs in, creates the room and gets an invite;
  - a co-author joins by pasting the invite (and a non-invite is rejected);
  - the room wins on join;
  - files only one side has are merged;
  - typing reaches the other editor;
  - simultaneous typing converges to the same text on both disks;
  - cursors are visible;
  - file creation and deletion travel;
  - another project opens unshared;
  - the shared project reconnects when reopened;
  - stopping sharing works;
  - a new room token keeps the owner live and locks out the old invite;
  - deleting the room stops sharing it.

---

## Limits

- Made for small groups. Every edit to a room goes through one Durable Object,
  which is plenty for a handful of people typing.
- Undo (`Cmd/Ctrl+Z`) is Monaco's own and can behave oddly right after someone
  else edited nearby.
- Review comments (`.gitlatex/comments/`) are shared through Git, not live.
