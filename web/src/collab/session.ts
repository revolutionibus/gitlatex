/**
 * Live collaboration (optional, per project).
 *
 * When a project has it switched on, its text files are mirrored into a Yjs
 * document held by a GitLaTeX relay (see collab-worker/, a Cloudflare Worker).
 * Everyone in the same room edits the same text; each person's GitLaTeX still
 * writes the files to their own disk, so commits, pushes and compiles stay
 * local.
 *
 * Open files are bound to the shared text through their Monaco models
 * (TextBinding); files without a model are synced through the Workspace.
 * While a session is live, the room is the source of truth: on joining,
 * files that differ locally are replaced by the room's version, and files
 * only one side has are added to the other.
 */
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { monaco } from '../editor/monaco';
import { disposeModel, openModels, watchModels } from '../editor/models';
import { BUILD_OUTPUT, KEEP, type Workspace } from '../state/workspace';
import { setState, toast } from '../state/store';
import { basename } from '../utils/paths';
import { LOCAL, TextBinding, replaceText, type PeerState } from './binding';
import { splitHost, type CollabConfig, type CollabUser } from './config';

export type CollabStatus = 'connecting' | 'connected' | 'offline';

export interface CollabPeer {
  id: number;
  name: string;
  color: string;
  /** The file they are looking at. */
  path: string | null;
}

export interface CollabState {
  status: CollabStatus;
  room: string;
  host: string;
  /** Everyone else in the room. */
  peers: CollabPeer[];
}

/** Text files that are shared: not build output, not folder placeholders. */
function isShared(path: string) {
  return basename(path) !== KEEP && !BUILD_OUTPUT.test(path) && !path.startsWith('.git/');
}

const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

class Session {
  readonly doc = new Y.Doc();
  readonly files = this.doc.getMap<Y.Text>('files');
  readonly provider: YProvider;
  private readonly bindings = new Map<string, TextBinding>();
  private readonly cleanup: (() => void)[] = [];
  private ready = false;
  /** Set while remote changes are written into the Workspace, so they are not echoed back. */
  private applyingRemote = false;
  private failures = 0;
  private warned = false;
  private state: CollabState;

  constructor(
    readonly ws: Workspace,
    readonly config: CollabConfig,
    user: CollabUser,
  ) {
    const { host, secure } = splitHost(config.host);
    this.state = { status: 'connecting', room: config.room, host, peers: [] };
    this.provider = new YProvider(host, config.room, this.doc, {
      party: 'collab',
      params: { token: config.token },
      protocol: secure ? 'wss' : 'ws',
    });
    const awareness = this.provider.awareness;
    awareness.setLocalStateField('user', { name: user.name, color: SAFE_COLOR.test(user.color) ? user.color : '#4f8cff' });

    const onStatus = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      if (status === 'connected') {
        this.failures = 0;
        this.warned = false;
      }
      this.patch({ status: status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline' });
    };
    const onError = () => {
      this.failures++;
      if (this.failures >= 3 && !this.warned) {
        this.warned = true;
        toast({
          kind: 'warning',
          title: 'Cannot reach the collaboration server',
          message: `Check the server address and token for room “${config.room}”. Still retrying; your edits are kept locally.`,
          timeout: 0,
        });
      }
    };
    const onSync = (synced: boolean) => {
      if (synced && !this.ready) this.join();
    };
    this.provider.on('status', onStatus);
    this.provider.on('connection-error', onError);
    this.provider.on('sync', onSync);
    awareness.on('change', this.onAwareness);
    this.cleanup.push(() => {
      this.provider.off('status', onStatus);
      this.provider.off('connection-error', onError);
      this.provider.off('sync', onSync);
      awareness.off('change', this.onAwareness);
    });
    this.publish();
  }

  destroy() {
    for (const c of this.cleanup.splice(0)) c();
    for (const b of this.bindings.values()) b.dispose();
    this.bindings.clear();
    this.provider.awareness.setLocalState(null);
    this.provider.destroy();
    this.doc.destroy();
    peerStyles.textContent = '';
  }

  // ---- joining ---------------------------------------------------------------

  /** First sync with the room: merge file sets, take the room's text, bind open editors. */
  private join() {
    const ws = this.ws;
    let replaced = 0;
    let added = 0;
    this.doc.transact(() => {
      for (const { path, text } of ws.textFiles()) {
        if (isShared(path) && !this.files.has(path)) this.files.set(path, new Y.Text(text));
      }
    }, LOCAL);
    this.files.forEach((ytext, path) => {
      const local = ws.get(path);
      if (local && local.kind !== 'text') return;
      const text = ytext.toString();
      if (!local) added++;
      else if (local.text !== text) replaced++;
      else return;
      this.applyRemote(path, text);
    });
    for (const [path, model] of openModels()) this.bind(path, model);

    this.cleanup.push(watchModels((path, model) => (model ? this.bind(path, model) : this.unbind(path))));
    this.cleanup.push(ws.subscribe(this.onLocalChange));
    this.files.observeDeep(this.onRemoteChange);
    this.cleanup.push(() => this.files.unobserveDeep(this.onRemoteChange));
    this.ready = true;

    if (replaced || added) {
      const parts = [replaced && `${replaced} updated`, added && `${added} added`].filter(Boolean).join(', ');
      toast({ kind: 'info', title: `Joined “${this.config.room}”`, message: `Files from the live session: ${parts}.` });
    } else toast({ kind: 'success', title: `Joined “${this.config.room}”` });
  }

  // ---- open editors ------------------------------------------------------------

  private bind(path: string, model: monaco.editor.ITextModel) {
    this.unbind(path);
    const ytext = this.files.get(path);
    if (!ytext || !isShared(path)) return;
    this.bindings.set(path, new TextBinding(path, ytext, model, this.provider.awareness));
    publishCursor();
  }

  /** Bind `path` if it has an open model but no binding yet (a file that just appeared). */
  private bindIfOpen(path: string) {
    if (this.bindings.has(path)) return;
    const model = openModels().find(([p]) => p === path)?.[1];
    if (model) this.bind(path, model);
  }

  private unbind(path: string) {
    this.bindings.get(path)?.dispose();
    this.bindings.delete(path);
  }

  bindingFor(model: monaco.editor.ITextModel | null) {
    if (!model) return undefined;
    for (const b of this.bindings.values()) if (b.model === model) return b;
    return undefined;
  }

  // ---- local → room ------------------------------------------------------------

  private onLocalChange = (kind: 'tree' | 'content' | 'meta', path?: string) => {
    if (this.applyingRemote || kind === 'meta') return;
    this.doc.transact(() => {
      if (kind === 'content' && path) {
        this.pushPath(path);
        return;
      }
      // Structural change or a re-read from disk (pull, discard, branch switch): reconcile everything.
      const ws = this.ws;
      for (const p of ws.paths()) this.pushPath(p);
      for (const p of [...this.files.keys()]) if (!ws.get(p)) this.files.delete(p);
    }, LOCAL);
  };

  private pushPath(path: string) {
    if (!isShared(path)) return;
    const text = this.ws.getText(path);
    if (text === undefined) return;
    const ytext = this.files.get(path);
    if (!ytext) {
      this.files.set(path, new Y.Text(text));
      this.bindIfOpen(path);
    } else if (!this.bindings.has(path)) replaceText(ytext, text);
  }

  // ---- room → local ------------------------------------------------------------

  private onRemoteChange = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    if (tr.origin === LOCAL) return;
    const changed = new Set<string>();
    const deleted = new Set<string>();
    for (const event of events) {
      if (event.target === this.files) {
        event.changes.keys.forEach((change, path) => {
          if (change.action === 'delete') deleted.add(path);
          else {
            // A different Y.Text under the same path (two people added it at once): rebind.
            const model = this.bindings.get(path)?.model;
            if (model && this.bindings.get(path)?.ytext !== this.files.get(path)) this.bind(path, model);
            changed.add(path);
          }
        });
      } else {
        const path = event.path[0];
        if (typeof path === 'string' && !this.bindings.has(path)) changed.add(path);
      }
    }
    for (const path of changed) {
      const ytext = this.files.get(path);
      if (ytext && !deleted.has(path) && !this.bindings.has(path)) {
        this.applyRemote(path, ytext.toString());
        this.bindIfOpen(path);
      }
    }
    if (deleted.size) this.applyRemoteDeletes(deleted);
  };

  /** Write the room's text for `path` into the Workspace (and so to disk). */
  private applyRemote(path: string, text: string) {
    const local = this.ws.get(path);
    if (local && local.kind !== 'text') return;
    if (local?.text === text) return;
    this.applyingRemote = true;
    try {
      if (local) this.ws.setText(path, text);
      else this.ws.writeFile(path, text);
    } catch (err) {
      console.warn(`collab: could not write ${path}`, err);
    } finally {
      this.applyingRemote = false;
    }
  }

  private applyRemoteDeletes(paths: Set<string>) {
    const removed = new Set<string>();
    this.applyingRemote = true;
    try {
      for (const p of paths) {
        if (this.files.has(p) || !this.ws.get(p)) continue;
        this.unbind(p);
        for (const r of this.ws.delete(p)) removed.add(r);
      }
    } finally {
      this.applyingRemote = false;
    }
    if (!removed.size) return;
    for (const p of removed) disposeModel(p);
    setState((s) => {
      const openTabs = s.openTabs.filter((p) => !removed.has(p));
      return { openTabs, activePath: s.activePath && removed.has(s.activePath) ? (openTabs[0] ?? null) : s.activePath };
    });
  }

  // ---- presence ----------------------------------------------------------------

  private onAwareness = () => {
    const peers: CollabPeer[] = [];
    const css: string[] = [];
    this.provider.awareness.getStates().forEach((raw, id) => {
      if (id === this.doc.clientID) return;
      const s = raw as PeerState;
      if (!s.user) return;
      const color = SAFE_COLOR.test(s.user.color) ? s.user.color : '#4f8cff';
      const name = cleanName(s.user.name) || 'Collaborator';
      peers.push({ id, name, color, path: s.cursor?.path ?? null });
      css.push(
        `.collab-sel-${id}{background-color:${color}40}`,
        `.collab-caret-${id}{border-left-color:${color}}`,
        `.collab-caret-${id}::after{content:${JSON.stringify(name)};background:${color}}`,
      );
    });
    peerStyles.textContent = css.join('\n');
    this.patch({ peers });
  };

  private patch(p: Partial<CollabState>) {
    this.state = { ...this.state, ...p };
    this.publish();
  }

  publish() {
    if (current === this) setState({ collab: this.state });
  }
}

/** Names go into a CSS string: keep them short and free of control characters. */
function cleanName(name: unknown) {
  return typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f\\]/g, '').trim().slice(0, 32) : '';
}

const peerStyles = (() => {
  const el = document.createElement('style');
  el.id = 'gitlatex-collab-peers';
  document.head.appendChild(el);
  return el;
})();

// ---------------------------------------------------------------------------

let current: Session | null = null;
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

function publishCursor() {
  if (!current) return;
  const binding = current.bindingFor(editor?.getModel() ?? null);
  const selection = editor?.getSelection();
  if (binding && selection) binding.publishSelection(selection);
  else current.provider.awareness.setLocalStateField('cursor', null);
}

/** Connect the open project to a room. Replaces any running session. */
export function startCollab(ws: Workspace, config: CollabConfig, user: CollabUser) {
  stopCollab();
  current = new Session(ws, config, user);
  current.publish();
}

export function stopCollab() {
  if (!current) return;
  const s = current;
  current = null;
  s.destroy();
  setState({ collab: null });
}

/** Follow the editor's selection so others see where you are. Call once with the editor. */
export function attachCollabEditor(e: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  editor = e;
  const subs = [e.onDidChangeCursorSelection(publishCursor), e.onDidChangeModel(publishCursor)];
  return {
    dispose() {
      for (const s of subs) s.dispose();
      if (editor === e) editor = null;
    },
  };
}
