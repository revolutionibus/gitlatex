import { beforeEach, describe, expect, it } from 'vitest';
import { decodeInvite, encodeInvite, moveCollabConfig, newAdminToken, readCollabConfig, roomName, sameHost, splitHost, writeCollabConfig } from '../../src/collab/config';

describe('collab config', () => {
  beforeEach(() => localStorage.clear());

  it('makes URL-safe room names', () => {
    expect(roomName('  My Thesis (v2) ')).toBe('my-thesis-v2');
    expect(roomName('a/b\\c')).toBe('a-b-c');
    expect(roomName('ok_name-1.2')).toBe('ok_name-1.2');
  });

  it('splits a pasted server address into host and protocol', () => {
    expect(splitHost('https://gitlatex-collab.me.workers.dev/')).toEqual({ host: 'gitlatex-collab.me.workers.dev', secure: true });
    expect(splitHost('gitlatex-collab.me.workers.dev')).toEqual({ host: 'gitlatex-collab.me.workers.dev', secure: true });
    expect(splitHost('localhost:8787')).toEqual({ host: 'localhost:8787', secure: false });
    expect(splitHost('http://192.168.1.5:8787')).toEqual({ host: '192.168.1.5:8787', secure: false });
  });

  it('is off per project by default and remembers the last server', () => {
    expect(readCollabConfig('thesis')).toMatchObject({ enabled: false, host: '', room: 'thesis' });
    writeCollabConfig('thesis', { enabled: true, host: 'relay.example', room: 'thesis', token: 't' });
    expect(readCollabConfig('thesis').enabled).toBe(true);
    // Another project is not shared; the relay is offered again, but tokens are per room.
    expect(readCollabConfig('notes')).toMatchObject({ enabled: false, host: 'relay.example', token: '', room: 'notes' });
  });

  it('follows a project rename and forgets a deleted one', () => {
    writeCollabConfig('old', { enabled: true, host: 'h', room: 'r', token: 't' });
    moveCollabConfig('old', 'new');
    expect(readCollabConfig('new')).toMatchObject({ enabled: true, room: 'r' });
    expect(readCollabConfig('old').enabled).toBe(false);
    moveCollabConfig('new', null);
    expect(readCollabConfig('new').enabled).toBe(false);
  });

  it('packs server, room and token into one invite and reads it back', () => {
    const invite = encodeInvite({ host: 'https://gitlatex-collab.me.workers.dev/', room: 'thesis', token: 'abc-123_XYZ' });
    expect(invite.startsWith('gitlatex-invite:')).toBe(true);
    expect(decodeInvite(invite)).toEqual({ host: 'gitlatex-collab.me.workers.dev', room: 'thesis', token: 'abc-123_XYZ' });
    // Pasted with line breaks and spaces (e.g. from an email).
    expect(decodeInvite(`  ${invite.slice(0, 20)}\n${invite.slice(20)} `)).not.toBeNull();
    // A plain-http relay keeps its scheme, so it is not upgraded to wss.
    const local = decodeInvite(encodeInvite({ host: 'localhost:8787', room: 'r', token: 't' }));
    expect(local && splitHost(local.host)).toEqual({ host: 'localhost:8787', secure: false });
  });

  it('rejects anything that is not an invite', () => {
    expect(decodeInvite('')).toBeNull();
    expect(decodeInvite('hello')).toBeNull();
    expect(decodeInvite('gitlatex-invite:not-base64!')).toBeNull();
    expect(decodeInvite('gitlatex-invite:' + btoa(JSON.stringify({ h: 'x', r: 'room' })))).toBeNull();
  });

  it('makes strong admin tokens and compares relay addresses loosely', () => {
    const t = newAdminToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newAdminToken()).not.toBe(t);
    expect(sameHost('https://Relay.example/', 'relay.example')).toBe(true);
    expect(sameHost('relay.example', 'other.example')).toBe(false);
  });
});
