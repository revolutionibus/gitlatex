/**
 * The Live collaboration panel (left sidebar), for the open project. Off by
 * default; each project is shared on its own.
 *
 * Two roles:
 *   - The owner deploys a relay (github.com/abdussamiakanda/gitlatex-collab),
 *     signs in to it with its admin token, and creates a room per project. The
 *     relay generates the room's token; the owner sends co-authors an invite
 *     (server + room + token in one string).
 *   - Co-authors paste the invite into their copy of the project and join.
 * Everyone appears under their GitHub username.
 */
import { useCallback, useEffect, useState } from 'react';
import { Cloud, Copy, ExternalLink, KeyRound, LogIn, Radio, RefreshCw, Trash2, Unplug, UserRound } from 'lucide-react';
import { openDialog, toast, useStore } from '../state/store';
import { deleteCollabRoom, hostCollab, joinCollab, leaveCollab, rotateCollabRoom, setCollabAdmin } from '../state/actions';
import * as server from '../storage/server';
import { listRooms, type RoomRecord } from '../collab/admin';
import {
  CLOUDFLARE_CREATE_URL, PEER_COLORS, RELAY_DEPLOY_URL, RELAY_REPO, decodeInvite, encodeInvite, newAdminToken, readCollabConfig, readCollabUser, roomName, sameHost,
  type CollabAdmin, type CollabUser,
} from '../collab/config';
import type { CollabState } from '../collab/session';
import { Button, IconButton, SectionTitle, TextInput, clsx } from './ui';

const label = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function copyInvite(invite: string, room: string) {
  void navigator.clipboard?.writeText(invite).then(
    () => toast({ kind: 'success', title: 'Invite copied', message: `Send it to the people who should edit “${room}”.` }),
    () => toast({ kind: 'error', title: 'Could not copy the invite' }),
  );
}

export function CollabPanel() {
  const project = useStore((s) => s.project);
  const collab = useStore((s) => s.collab);
  return (
    <div className="flex h-full flex-col">
      <SectionTitle>Live collaboration</SectionTitle>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 text-[13px]">
        {!project ? null : collab ? <LiveView collab={collab} /> : <SetupView projectId={project.id} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// While shared

function LiveView({ collab }: { collab: CollabState }) {
  const project = useStore((s) => s.project);
  const admin = useStore((s) => s.collabAdmin);
  const config = project ? readCollabConfig(project.id) : null;
  const invite = config?.token ? encodeInvite({ host: config.host, room: config.room, token: config.token }) : '';
  const isOwner = !!admin && sameHost(admin.host, collab.host);
  return (
    <>
      <p className="text-muted">
        <span className={clsx('mr-1.5 inline-block size-2 rounded-full', collab.status === 'connected' ? 'bg-ok' : collab.status === 'connecting' ? 'bg-warn' : 'bg-danger')} />
        {collab.status === 'connected' ? 'Connected to' : collab.status === 'connecting' ? 'Connecting to' : 'Offline — retrying'} room <b className="text-fg">{collab.room}</b> on {collab.host}
      </p>
      {collab.peers.length ? (
        <ul className="space-y-1">
          {collab.peers.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: p.color }} />
              <span className="text-fg">{p.name}</span>
              {p.path && <span className="truncate text-xs text-faint">{p.path}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-faint">Nobody else is here yet. Send your co-authors the invite below.</p>
      )}

      {invite && (
        <div>
          <span className={label}>Invite co-authors</span>
          <p className="mb-2 text-xs text-muted">They paste it under Live collaboration → Join, in their copy of this project.</p>
          <div className="flex items-stretch gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel-2 px-2 py-1.5 font-mono text-[11px] text-muted" title={invite}>
              {invite}
            </code>
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copyInvite(invite, collab.room)}>
              Copy
            </Button>
          </div>
        </div>
      )}

      {isOwner && admin && <RoomList admin={admin} only={collab.room} />}

      <p className="text-xs text-faint">
        Everyone’s GitLaTeX writes the shared text to their own folder. Commit and push as usual; while the session runs,
        pull only after others have stopped editing, or let one person pull — their changes reach everyone.
      </p>

      <Button size="sm" variant="danger" icon={<Unplug className="size-3.5" />} onClick={() => leaveCollab()}>
        Stop sharing this project
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Not shared yet

/**
 * Everyone is shown by their GitHub username (also on their cursor). It comes from the
 * GitHub CLI or `git config github.user`; only when neither knows it is it typed in.
 */
function useCollabUser() {
  const [saved] = useState(readCollabUser);
  const [login, setLogin] = useState<string | null | undefined>(undefined);
  const [typed, setTyped] = useState(saved.name);
  const [color, setColor] = useState(saved.color);
  useEffect(() => {
    let live = true;
    server.scm
      .githubUser()
      .then((r) => live && setLogin(r.login))
      .catch(() => live && setLogin(null));
    return () => {
      live = false;
    };
  }, []);
  const name = (login ?? typed).trim().replace(/^@/, '').slice(0, 39);
  return { login, typed, setTyped, color, setColor, user: name ? ({ name, color } as CollabUser) : null };
}

type UserForm = ReturnType<typeof useCollabUser>;

function Identity({ u }: { u: UserForm }) {
  return (
    <div className="space-y-2">
      {u.login ? (
        <p className="flex items-center gap-1.5 text-muted">
          <UserRound className="size-3.5" />
          Editing as <b className="text-fg">@{u.login}</b>
        </p>
      ) : u.login === null ? (
        <label className="block text-muted">
          GitHub username
          <TextInput className="mt-1.5" value={u.typed} maxLength={39} placeholder="octocat" onChange={(e) => u.setTyped(e.target.value)} />
          <span className="mt-1 block text-[11.5px] text-faint">
            Could not read it from the GitHub CLI. Run `gh auth login` or `git config --global github.user &lt;name&gt;` to skip this.
          </span>
        </label>
      ) : (
        <p className="text-faint">Looking up your GitHub username…</p>
      )}
      <div className="flex items-center gap-1.5">
        {PEER_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Colour ${c}`}
            aria-pressed={u.color === c}
            onClick={() => u.setColor(c)}
            className={clsx('focus-ring size-5 rounded-full', u.color === c && 'ring-2 ring-fg ring-offset-2 ring-offset-panel')}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

function SetupView({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<'join' | 'host'>(() => (useStore.getState().collabAdmin ? 'host' : 'join'));
  const u = useCollabUser();
  return (
    <>
      <p className="text-muted">
        Edit this project together in real time. Each person keeps their own copy on disk and commits, pushes and compiles locally;
        the relay only passes the text along. Other projects are not affected.
      </p>
      <div className="flex rounded-lg border border-line p-0.5" role="tablist">
        {([
          ['join', 'Join'],
          ['host', 'Host'],
        ] as const).map(([id, text]) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={clsx('flex-1 rounded-md px-2 py-1 text-[12px] font-medium', mode === id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
          >
            {text}
          </button>
        ))}
      </div>
      <Identity u={u} />
      {mode === 'join' ? <JoinForm projectId={projectId} user={u.user} /> : <HostForm projectId={projectId} user={u.user} />}
      <p className="rounded-md bg-panel-2 px-3 py-2 text-xs text-muted">
        When you join, files that differ from the room are replaced by the room’s version, and files only you have are added to it.
        Commit first if you want to keep your local version.
      </p>
    </>
  );
}

const NO_NAME = 'Enter your GitHub username, so others know who is typing.';

function JoinForm({ projectId, user }: { projectId: string; user: CollabUser | null }) {
  const saved = readCollabConfig(projectId);
  const [text, setText] = useState('');
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState(saved.host);
  const [room, setRoom] = useState(saved.room);
  const [token, setToken] = useState(saved.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invite = decodeInvite(text);
  const ready = manual ? !!(host.trim() && roomName(room) && token.trim()) : !!invite;

  const join = async () => {
    const target = manual ? { host: host.trim(), room: roomName(room), token: token.trim() } : invite;
    if (!target) return;
    if (!user) return setError(NO_NAME);
    setBusy(true);
    try {
      await joinCollab({ enabled: true, ...target }, user);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {!manual ? (
        <label className="block">
          <span className={label}>Invite</span>
          <textarea
            rows={3}
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the invite the project's owner sent you"
            className="focus-ring w-full resize-none rounded-md border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11.5px] text-fg placeholder:font-sans placeholder:text-faint"
          />
          {text.trim() && (
            <span className={clsx('mt-1 block text-[11.5px]', invite ? 'text-muted' : 'text-danger')}>
              {invite ? (
                <>
                  Room <b className="text-fg">{invite.room}</b> on {invite.host.replace(/^https?:\/\//, '')}
                </>
              ) : (
                'This is not a GitLaTeX invite.'
              )}
            </span>
          )}
        </label>
      ) : (
        <div className="space-y-2">
          <label className="block text-muted">
            Server
            <TextInput className="mt-1" value={host} placeholder="gitlatex-collab.you.workers.dev" onChange={(e) => setHost(e.target.value)} />
          </label>
          <div className="space-y-2">
            <label className="block text-muted">
              Room
              <TextInput className="mt-1" value={room} onChange={(e) => setRoom(e.target.value)} onBlur={() => setRoom(roomName(room))} />
            </label>
            <label className="block text-muted">
              Room token
              <TextInput className="mt-1" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button className="text-[11.5px] text-accent hover:underline" onClick={() => setManual((m) => !m)}>
          {manual ? 'Paste an invite instead' : 'Enter the server, room and token by hand'}
        </button>
        <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} disabled={!ready} loading={busy} onClick={() => void join()}>
          Join
        </Button>
      </div>
    </div>
  );
}

function HostForm({ projectId, user }: { projectId: string; user: CollabUser | null }) {
  const admin = useStore((s) => s.collabAdmin);
  // This project's room: the one it was shared in before, or one named after the project.
  const [room, setRoom] = useState(() => readCollabConfig(projectId).room);
  const [rooms, setRooms] = useState<RoomRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!admin) return <AdminLogin />;
  const name = roomName(room);
  const exists = !!rooms?.some((r) => r.room === name);

  const host = async () => {
    if (!name) return setError('Enter a room name.');
    if (!user) return setError(NO_NAME);
    setBusy(true);
    setError(null);
    try {
      const rec = await hostCollab(admin, name, user);
      toast({ kind: 'success', title: rec.created ? `Room “${rec.room}” created` : `Sharing in “${rec.room}”`, message: 'Copy the invite from this panel and send it to your co-authors.' });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <KeyRound className="size-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">
          Owner of <b className="text-fg">{admin.host.replace(/^https?:\/\//, '')}</b>
        </span>
        <button className="shrink-0 text-[11.5px] text-accent hover:underline" onClick={() => setCollabAdmin(null)}>
          Sign out
        </button>
      </div>
      <div className="space-y-2">
        <label className="block text-muted">
          Room for this project
          <TextInput className="mt-1" value={room} onChange={(e) => setRoom(e.target.value)} onBlur={() => setRoom(roomName(room))} onKeyDown={(e) => e.key === 'Enter' && void host()} />
        </label>
        <p className="text-[11.5px] text-faint">
          {exists
            ? 'This room already exists on your relay. Going live reuses it and its token, so invites you sent before still work.'
            : 'The relay makes a token for this room. You then send an invite to your co-authors; they never see your admin token.'}
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button size="sm" variant="primary" icon={<Radio className="size-3.5" />} loading={busy} onClick={() => void host()}>
            {exists ? `Go live in “${name}”` : 'Create room & go live'}
          </Button>
        </div>
      </div>
      <RoomList admin={admin} onRooms={setRooms} />
    </div>
  );
}

/** Where a new owner starts: the Cloudflare steps, with a generated admin token to paste. */
function DeployBox({ onToken }: { onToken: (token: string) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const step = 'flex size-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent';
  const generate = () => {
    const t = newAdminToken();
    setToken(t);
    onToken(t);
    void navigator.clipboard?.writeText(t).catch(() => undefined);
  };
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3 text-[11.5px] text-muted">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
        <Cloud className="size-4 shrink-0 text-accent" /> No relay yet? Deploy a free one
      </div>
      <ol className="mt-2.5 space-y-2.5">
        <li className="flex gap-2">
          <span className={step}>1</span>
          <span className="min-w-0">
            In Cloudflare, connect your GitHub account first: <b className="text-fg">Workers &amp; Pages → Create application → Connect to Git → + Add account</b>, then{' '}
            <b className="text-fg">Install &amp; Authorize</b>.{' '}
            <a href={CLOUDFLARE_CREATE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              Open Cloudflare <ExternalLink className="size-3" />
            </a>
          </span>
        </li>
        <li className="flex gap-2">
          <span className={step}>2</span>
          <span className="min-w-0 flex-1">
            Generate an admin token. Keep it to yourself; you paste it into Cloudflare and below.
            <span className="mt-1.5 flex items-stretch gap-1.5">
              {token ? (
                <>
                  <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11px] text-fg" title={token}>
                    {token}
                  </code>
                  <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard?.writeText(token)}>
                    Copy
                  </Button>
                </>
              ) : (
                <Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={generate}>
                  Generate admin token
                </Button>
              )}
            </span>
          </span>
        </li>
        <li className="flex gap-2">
          <span className={step}>3</span>
          <span className="min-w-0">
            Click Deploy to Cloudflare, paste the token as <b className="text-fg">ADMIN_TOKEN</b>, and deploy.
            <a
              href={RELAY_DEPLOY_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring mt-1.5 flex h-7 w-fit items-center gap-1.5 rounded-md bg-[#f38020] px-2.5 text-xs font-semibold text-white hover:brightness-95"
            >
              Deploy to Cloudflare <ExternalLink className="size-3" />
            </a>
          </span>
        </li>
        <li className="flex gap-2">
          <span className={step}>4</span>
          <span className="min-w-0">
            When it’s deployed, open the Worker’s <b className="text-fg">Settings → Domains &amp; Routes</b> and enable <b className="text-fg">workers.dev</b>. That address
            (e.g. gitlatex-collab.you.workers.dev) is your relay; enter it below.
          </span>
        </li>
      </ol>
      <a href={RELAY_REPO} target="_blank" rel="noreferrer" className="mt-2.5 inline-flex items-center gap-1 text-accent hover:underline">
        How the relay works <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

/** Sign in to the relay as its owner (the login is global, shared by every project). */
function AdminLogin() {
  const [host, setHost] = useState(() => readCollabConfig('').host);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const admin = { host: host.trim(), token: token.trim() };
    if (!admin.host) return setError('Enter your relay’s address.');
    if (!admin.token) return setError('Enter the admin token you chose when deploying.');
    setBusy(true);
    setError(null);
    try {
      await listRooms(admin);
      setCollabAdmin(admin);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <DeployBox onToken={setToken} />
      <div className="space-y-2">
        <label className="block text-muted">
          Relay address
          <TextInput className="mt-1" value={host} placeholder="gitlatex-collab.you.workers.dev" onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="block text-muted">
          Admin token
          <TextInput className="mt-1" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void connect()} />
        </label>
        <p className="text-[11.5px] text-faint">Only the relay’s owner needs this. It is kept in this browser and never sent to co-authors.</p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button size="sm" variant="primary" icon={<KeyRound className="size-3.5" />} loading={busy} onClick={() => void connect()}>
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The owner's rooms on the relay: copy an invite, issue a new token, delete. With `only`, just that room. */
function RoomList({ admin, only, onRooms }: { admin: CollabAdmin; only?: string; onRooms?: (rooms: RoomRecord[]) => void }) {
  const project = useStore((s) => s.project);
  const collab = useStore((s) => s.collab);
  const [rooms, setRooms] = useState<RoomRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thisRoom = project ? readCollabConfig(project.id).room : null;

  const load = useCallback(() => {
    setError(null);
    listRooms(admin).then(
      (all) => {
        setRooms(all);
        onRooms?.(all);
      },
      (err) => setError(errorText(err)),
    );
  }, [admin, onRooms]);
  const shown = rooms && only !== undefined ? rooms.filter((r) => r.room === only) : rooms;
  // Reload when this project starts or stops sharing (a room may have been created).
  useEffect(load, [load, collab?.room]);

  const rotate = (room: string) =>
    openDialog({
      type: 'confirm',
      title: `New token for “${room}”?`,
      message: 'Everyone in the room is disconnected, and the old invite stops working. Send the new invite to the people who should keep editing.',
      confirm: 'Issue new token',
      onConfirm: async () => {
        const rec = await rotateCollabRoom(admin, room);
        copyInvite(encodeInvite({ host: admin.host, room, token: rec.token }), room);
      },
    });

  const remove = (room: string) =>
    openDialog({
      type: 'confirm',
      title: `Delete room “${room}”?`,
      message: 'Everyone is disconnected and the room’s shared text is deleted from the relay. Everyone’s files stay on their own disks.',
      confirm: 'Delete room',
      danger: true,
      onConfirm: async () => {
        await deleteCollabRoom(admin, room);
        toast({ kind: 'success', title: `Deleted room “${room}”` });
      },
    });

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className={clsx(label, 'mb-0')}>{only !== undefined ? 'This project’s room' : 'Your rooms'}</span>
        <IconButton size="sm" label="Refresh rooms" onClick={load}>
          <RefreshCw className="size-3.5" />
        </IconButton>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {shown && shown.length === 0 && <p className="text-[11.5px] text-faint">{only !== undefined ? 'No room for this project yet.' : 'No rooms yet.'}</p>}
      {shown && shown.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {shown.map((r) => (
            <li key={r.room} className="flex items-center gap-1 py-1 pl-2.5 pr-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-fg">{r.room}</span>
                <span className="block text-[10.5px] text-faint">
                  {r.room === thisRoom ? 'this project · ' : ''}created {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </span>
              <IconButton size="sm" label="Copy invite" onClick={() => copyInvite(encodeInvite({ host: admin.host, room: r.room, token: r.token }), r.room)}>
                <Copy className="size-3.5" />
              </IconButton>
              <IconButton size="sm" label="Issue a new token" onClick={() => rotate(r.room)}>
                <KeyRound className="size-3.5" />
              </IconButton>
              <IconButton size="sm" label="Delete room" className="hover:!text-danger" onClick={() => remove(r.room)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
