// End-to-end check of live collaboration: two GitLaTeX servers (two people,
// two folders on disk) share one project through a local collab relay. A hosts
// (signs in with the relay's admin token and creates the room); B joins with the
// invite A copies from the Live collaboration panel.
//
//   git clone https://github.com/abdussamiakanda/gitlatex-collab.git && cd gitlatex-collab && npm install
//   echo ADMIN_TOKEN=test-admin > .dev.vars && npx wrangler dev --port 8787
//   gitlatex --no-browser --port 5101 --repos /tmp/gl-a
//   gitlatex --no-browser --port 5102 --repos /tmp/gl-b
//   node tests/e2e/collab.mjs http://127.0.0.1:5101 /tmp/gl-a http://127.0.0.1:5102 /tmp/gl-b localhost:8787 test-admin
//
// Each repos folder needs a project named "paper" with a main.tex; the test
// writes them itself.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [baseA, dirA, baseB, dirB, relay = 'localhost:8787', adminToken = 'test-admin'] = process.argv.slice(2);
if (!dirB) {
  console.error('usage: node tests/e2e/collab.mjs <url A> <repos A> <url B> <repos B> [relay host] [admin token]');
  process.exit(2);
}

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`);
  if (!ok) failures++;
};
const read = (dir, file) => (fs.existsSync(path.join(dir, 'paper', file)) ? fs.readFileSync(path.join(dir, 'paper', file), 'utf8') : null);
const until = async (fn, what, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`    (timed out waiting for: ${what})`);
  return false;
};

const ROOM = `e2e-${Date.now().toString(36)}`;
for (const [dir, text] of [
  [dirA, '\\documentclass{article}\n\\begin{document}\nFrom A.\n\\end{document}\n'],
  [dirB, '\\documentclass{article}\n\\begin{document}\nStale copy on B.\n\\end{document}\n'],
]) {
  fs.rmSync(path.join(dir, 'paper'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'paper'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'paper', 'main.tex'), text);
}
fs.writeFileSync(path.join(dirB, 'paper', 'only-b.tex'), '\\section{Only on B}\n');
fs.mkdirSync(path.join(dirA, 'other'), { recursive: true });
fs.writeFileSync(path.join(dirA, 'other', 'main.tex'), '\\documentclass{article}\n');

const browser = await chromium.launch();
const errors = [];

async function person(base, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.addInitScript(() => {
    localStorage.setItem('gitlatex.settings', JSON.stringify({ autoCompile: false, compiler: 'browser', beginnerMode: false }));
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__GITLATEX__ && !window.__GITLATEX__.store.getState().booting);
  await page.evaluate(() => window.__GITLATEX__.actions.openProject('paper'));
  await page.waitForFunction(() => window.__GITLATEX__.store.getState().project?.id === 'paper');
  const app = (fn, arg) => page.evaluate(fn, arg);
  const state = () => app(() => window.__GITLATEX__.store.getState().collab);
  const text = (p) => app((p) => window.__GITLATEX__.actions.workspace().getText(p), p);
  const flush = () => app(() => window.__GITLATEX__.actions.workspace().flush());
  return { page, app, state, text, flush, name };
}

const connected = (p) => until(async () => (await p.state())?.status === 'connected', `${p.name} connected`);

// Both people run on this machine, so give each their own GitHub username.
const asUser = (p) => p.page.route('**/api/scm/github-user', (r) => r.fulfill({ json: { login: p.name } }));

/** The owner: sign in to the relay, create the room, go live. Returns the invite shown in the panel. */
async function host(p) {
  await asUser(p);
  await p.page.getByRole('button', { name: 'Live collaboration' }).click();
  await p.page.getByRole('tab', { name: 'Host' }).click();
  await p.page.getByLabel('Relay address').fill(relay);
  await p.page.getByLabel('Admin token').fill(adminToken);
  await p.page.getByRole('button', { name: 'Connect' }).click();
  await p.page.getByLabel('Room for this project').fill(ROOM);
  await p.page.getByRole('button', { name: 'Create room & go live' }).click();
  const ok = await connected(p);
  const invite = await p.page.locator('code[title^="gitlatex-invite:"]').getAttribute('title', { timeout: 5000 }).catch(() => null);
  return { ok, invite };
}

/** A co-author: paste the invite and join. */
async function join(p, invite) {
  await asUser(p);
  await p.page.getByRole('button', { name: 'Live collaboration' }).click();
  const box = p.page.getByPlaceholder('Paste the invite');
  await box.fill('not an invite');
  check(await p.page.getByText('This is not a GitLaTeX invite.').isVisible(), 'a pasted non-invite is rejected');
  await box.fill(invite);
  check(await p.page.getByText(`Room ${ROOM} on`).isVisible(), 'the pasted invite names the room');
  await p.page.getByRole('button', { name: 'Join', exact: true }).click();
  return connected(p);
}

try {
  const a = await person(baseA, 'Ada');
  const b = await person(baseB, 'Bob');
  check((await a.state()) === null && (await b.state()) === null, 'projects are not shared until asked');

  const hosted = await host(a);
  check(hosted.ok, 'A creates the room and goes live');
  check(!!hosted.invite, 'A gets an invite to send');
  check(await join(b, hosted.invite ?? ''), 'B joins with the invite');

  check(await until(async () => (await b.text('main.tex'))?.includes('From A.'), 'B gets main.tex'), 'B’s differing main.tex is replaced by the room’s');
  await b.flush();
  check(read(dirB, 'main.tex')?.includes('From A.'), '… and written to B’s disk');
  check(await until(async () => (await a.text('only-b.tex')) !== undefined, 'only-b.tex on A'), 'a file only B had reaches A');
  await a.flush();
  check(read(dirA, 'only-b.tex')?.includes('Only on B'), '… and A’s disk');

  check(await until(async () => (await a.state())?.peers.some((p) => p.name === 'Bob'), 'A sees Bob'), 'A sees Bob in the room');

  // Typing in A's editor shows up in B's editor.
  await a.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  await b.app(() => window.__GITLATEX__.actions.openFile('main.tex'));
  const editorA = a.page.getByTestId('editor');
  await editorA.click();
  await a.page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
  await a.page.keyboard.type('% typed by Ada\n');
  check(await until(async () => (await b.text('main.tex'))?.includes('% typed by Ada'), 'B sees typing'), 'typing in A appears in B');
  const modelB = await b.app(() => window.__GITLATEX__.editor.get()?.getModel()?.getValue() ?? null);
  check(modelB?.includes('% typed by Ada'), 'B’s open editor shows it');

  // Concurrent edits from both sides converge.
  await b.page.getByTestId('editor').click();
  await b.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
  await Promise.all([a.page.keyboard.type('AAAA'), b.page.keyboard.type('BBBB')]);
  const converged = await until(async () => {
    const [ta, tb] = await Promise.all([a.text('main.tex'), b.text('main.tex')]);
    return ta === tb && ta.includes('AAAA') && ta.includes('BBBB');
  }, 'convergence');
  check(converged, 'simultaneous typing converges to the same text on both sides');
  await Promise.all([a.flush(), b.flush()]);
  check(read(dirA, 'main.tex') === read(dirB, 'main.tex'), 'both disks hold the same main.tex');

  check(await until(() => b.page.locator('.collab-caret').count().then((n) => n > 0), 'caret'), 'B sees A’s cursor');

  // Structural changes travel too.
  await a.app(() => window.__GITLATEX__.actions.workspace().writeFile('chapters/intro.tex', '\\section{Intro}\n'));
  check(await until(async () => (await b.text('chapters/intro.tex')) !== undefined, 'new file on B'), 'a new file in A appears in B');
  await b.app(() => window.__GITLATEX__.actions.workspace().delete('only-b.tex'));
  check(await until(async () => (await a.text('only-b.tex')) === undefined, 'delete on A'), 'a deletion in B removes the file in A');
  await a.flush();
  check(read(dirA, 'only-b.tex') === null, '… and from A’s disk');

  // Another project is not shared; going back reconnects.
  await a.app(() => window.__GITLATEX__.actions.openProject('other'));
  check((await a.state()) === null, 'another project opens unshared');
  await a.app(() => window.__GITLATEX__.actions.openProject('paper'));
  check(await until(async () => (await a.state())?.status === 'connected', 'reconnect'), 'reopening the shared project reconnects automatically');

  await b.page.getByRole('button', { name: 'Live collaboration', exact: true }).click();
  await b.page.getByRole('button', { name: 'Stop sharing' }).click();
  check((await b.state()) === null, 'B can stop sharing');
  check(await until(async () => !(await a.state())?.peers.length, 'Bob gone'), 'A sees Bob leave');

  // A new room token: A (the owner) reconnects with it; the old invite no longer opens the room.
  const adminLogin = { host: relay, token: adminToken };
  const rotated = await a.app(([admin, room]) => window.__GITLATEX__.actions.rotateCollabRoom(admin, room), [adminLogin, ROOM]);
  check(await until(async () => (await a.state())?.status === 'connected', 'A back'), 'after a new token, the owner is live again');
  const old = (await b.page.evaluate(() => JSON.parse(localStorage.getItem('gitlatex.collab.paper') ?? '{}'))).token;
  check(!!old && old !== rotated.token, 'the room has a new token');
  const res = await fetch(`http://${relay}/parties/collab/${ROOM}?token=${encodeURIComponent(old)}`);
  check(res.status === 401, 'the old invite’s token is refused');

  await a.app(([admin, room]) => window.__GITLATEX__.actions.deleteCollabRoom(admin, room), [adminLogin, ROOM]);
  check((await a.state()) === null, 'deleting the room stops sharing it');
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
}

if (errors.length) {
  console.log('page errors:\n  ' + errors.join('\n  '));
  failures++;
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall collaboration checks passed');
process.exit(failures ? 1 : 0);
