import { beforeEach, describe, expect, it } from 'vitest';
import { moveCollabConfig, readCollabConfig, roomName, splitHost, writeCollabConfig } from '../../src/collab/config';

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
    // Another project is not shared, but the form is prefilled.
    expect(readCollabConfig('notes')).toMatchObject({ enabled: false, host: 'relay.example', token: 't', room: 'notes' });
  });

  it('follows a project rename and forgets a deleted one', () => {
    writeCollabConfig('old', { enabled: true, host: 'h', room: 'r', token: 't' });
    moveCollabConfig('old', 'new');
    expect(readCollabConfig('new')).toMatchObject({ enabled: true, room: 'r' });
    expect(readCollabConfig('old').enabled).toBe(false);
    moveCollabConfig('new', null);
    expect(readCollabConfig('new').enabled).toBe(false);
  });
});
