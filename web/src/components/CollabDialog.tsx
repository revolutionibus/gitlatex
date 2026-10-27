/**
 * Live collaboration for the open project: connect it to a room on a
 * GitLaTeX relay (collab-worker/), or stop sharing it. Off by default; each
 * project is shared on its own.
 */
import { useEffect, useState } from 'react';
import { Users, Unplug, Radio, UserRound } from 'lucide-react';
import { closeDialog, useStore } from '../state/store';
import { joinCollab, leaveCollab } from '../state/actions';
import * as server from '../storage/server';
import { PEER_COLORS, readCollabConfig, readCollabUser, roomName } from '../collab/config';
import { Button, Modal, TextInput, clsx } from './ui';

export function CollabDialog() {
  const project = useStore((s) => s.project);
  const collab = useStore((s) => s.collab);
  const [config] = useState(() => readCollabConfig(project?.id ?? ''));
  const [user] = useState(readCollabUser);
  const [host, setHost] = useState(config.host);
  const [room, setRoom] = useState(config.room);
  const [token, setToken] = useState(config.token);
  // Everyone is shown by their GitHub username (also on their cursor). It comes from the
  // GitHub CLI or `git config github.user`; only when neither knows it is it typed in.
  const [login, setLogin] = useState<string | null | undefined>(undefined);
  const [typed, setTyped] = useState(user.name);
  const [color, setColor] = useState(user.color);
  const [error, setError] = useState<string | null>(null);

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

  const name = (login ?? typed).trim().replace(/^@/, '');

  const join = async () => {
    const r = roomName(room);
    if (!host.trim()) return setError('Enter the address of your collaboration server.');
    if (!r) return setError('Enter a room name.');
    if (!token.trim()) return setError('Enter the server’s token.');
    if (!name) return setError('Enter your GitHub username, so others know who is typing.');
    await joinCollab({ enabled: true, host: host.trim(), room: r, token: token.trim() }, { name: name.slice(0, 39), color });
    closeDialog();
  };

  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <label className="block text-[13px] text-muted">
      {label}
      <div className="mt-1.5">{input}</div>
      {hint && <span className="mt-1 block text-[11.5px] text-faint">{hint}</span>}
    </label>
  );

  return (
    <Modal
      title="Live collaboration"
      icon={<Users className="size-4 text-accent" />}
      onClose={closeDialog}
      footer={
        collab ? (
          <>
            <Button variant="ghost" onClick={closeDialog}>
              Close
            </Button>
            <Button
              variant="danger"
              icon={<Unplug className="size-3.5" />}
              onClick={() => {
                leaveCollab();
                closeDialog();
              }}
            >
              Stop sharing
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button variant="primary" icon={<Radio className="size-3.5" />} onClick={() => void join()}>
              Share live
            </Button>
          </>
        )
      }
    >
      {collab ? (
        <div className="space-y-3 text-[13px]">
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
            <p className="text-faint">Nobody else is here yet. Share the room name and token with your co-authors.</p>
          )}
          <p className="text-xs text-faint">
            Everyone’s GitLaTeX writes the shared text to their own folder. Commit and push as usual; while the session runs,
            pull only after others have stopped editing, or let one person pull — their changes reach everyone.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            Edit this project together in real time. Each person keeps their own copy on disk and commits, pushes and compiles locally;
            the server only relays the text. Other projects are not affected.
          </p>
          {field('Server', <TextInput value={host} placeholder="gitlatex-collab.you.workers.dev" onChange={(e) => setHost(e.target.value)} />, 'Your deployed collab-worker (see collab-worker/README.md), or localhost:8787 for wrangler dev.')}
          <div className="grid grid-cols-2 gap-3">
            {field('Room', <TextInput value={room} onChange={(e) => setRoom(e.target.value)} onBlur={() => setRoom(roomName(room))} />)}
            {field('Token', <TextInput type="password" value={token} onChange={(e) => setToken(e.target.value)} />)}
          </div>
          {login ? (
            <p className="flex items-center gap-1.5 text-[13px] text-muted">
              <UserRound className="size-3.5" />
              Editing as <b className="text-fg">@{login}</b>
            </p>
          ) : login === null ? (
            field(
              'GitHub username',
              <TextInput value={typed} maxLength={39} placeholder="octocat" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void join()} />,
              'Could not read it from the GitHub CLI. Run `gh auth login` or `git config --global github.user <name>` to skip this.',
            )
          ) : (
            <p className="text-[13px] text-faint">Looking up your GitHub username…</p>
          )}
          <div className="flex items-center gap-1.5">
            {PEER_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={clsx('focus-ring size-5 rounded-full', color === c && 'ring-2 ring-fg ring-offset-2 ring-offset-panel')}
                style={{ background: c }}
              />
            ))}
          </div>
          <p className="rounded-md bg-panel-2 px-3 py-2 text-xs text-muted">
            When you join, files that differ from the room are replaced by the room’s version, and files only you have are added to it.
            Commit first if you want to keep your local version.
          </p>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
