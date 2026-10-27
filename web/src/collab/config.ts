/**
 * Live collaboration settings. Each project decides on its own whether it is
 * shared (and in which room); your name (GitHub username) and colour are global.
 * Everything lives in this browser's localStorage.
 */

export interface CollabConfig {
  /** Connect automatically when the project is opened. */
  enabled: boolean;
  /** The relay, e.g. `gitlatex-collab.you.workers.dev` (or `localhost:8787` for `wrangler dev`). */
  host: string;
  /** Everyone who enters the same room edits together. */
  room: string;
  /** The relay's shared secret (ROOM_TOKEN). */
  token: string;
}

export interface CollabUser {
  name: string;
  color: string;
}

export const PEER_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];

const projectKey = (projectId: string) => `gitlatex.collab.${projectId}`;
const USER_KEY = 'gitlatex.collab.user';
/** The last relay used, offered for the next project. */
const LAST_KEY = 'gitlatex.collab.last';

/** Room names go into the URL path: keep them to a safe alphabet. */
export function roomName(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** `https://x.workers.dev/` → host `x.workers.dev`, secure. Plain `localhost:8787` is not secure. */
export function splitHost(input: string): { host: string; secure: boolean } {
  const raw = input.trim();
  const m = /^(wss?|https?):\/\//i.exec(raw);
  const host = raw.replace(/^(wss?|https?):\/\//i, '').replace(/\/+$/, '');
  if (m) return { host, secure: /^(wss|https)$/i.test(m[1]) };
  return { host, secure: !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) };
}

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / disabled */
  }
}

export function readCollabConfig(projectId: string): CollabConfig {
  const saved = read<CollabConfig>(projectKey(projectId));
  const last = read<Pick<CollabConfig, 'host' | 'token'>>(LAST_KEY);
  return {
    enabled: saved?.enabled ?? false,
    host: saved?.host ?? last?.host ?? '',
    room: saved?.room ?? roomName(projectId),
    token: saved?.token ?? last?.token ?? '',
  };
}

export function writeCollabConfig(projectId: string, config: CollabConfig) {
  write(projectKey(projectId), config);
  if (config.host) write(LAST_KEY, { host: config.host, token: config.token });
}

/** Carry the setting over when the project folder is renamed or deleted. */
export function moveCollabConfig(from: string, to: string | null) {
  const saved = read<CollabConfig>(projectKey(from));
  write(projectKey(from), null);
  if (saved && to) write(projectKey(to), saved);
}

export function readCollabUser(): CollabUser {
  const saved = read<CollabUser>(USER_KEY);
  return {
    name: saved?.name ?? '',
    color: saved?.color ?? PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)],
  };
}

export function writeCollabUser(user: CollabUser) {
  write(USER_KEY, user);
}
