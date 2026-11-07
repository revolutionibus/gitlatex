/**
 * LyX's Document → Settings for the LyX-style editor: the document class,
 * its options, and the LaTeX preamble (everything between \documentclass and
 * \begin{document}), edited in one dialog and written back into the file.
 */
import { useState } from 'react';
import { FileCog } from 'lucide-react';
import { Button, Modal, TextInput } from '../components/ui';
import { matchBrace, matchBracket, skipSpace } from './scan';

export interface DocumentHead {
  docClass: string;
  options: string;
  preamble: string;
}

const COMMON_CLASSES = ['article', 'report', 'book', 'amsart', 'amsbook', 'memoir', 'scrartcl', 'scrreprt', 'scrbook', 'beamer', 'letter', 'revtex4-2', 'IEEEtran', 'llncs', 'elsarticle'];

/** Where \documentclass and \begin{document} are, and what is between. */
function locate(text: string) {
  const dc = /^[^%\n]*?(\\documentclass)/m.exec(text);
  const begin = text.indexOf('\\begin{document}');
  if (!dc || begin < 0) return null;
  const start = dc.index + dc[0].length - dc[1].length;
  let i = skipSpace(text, start + dc[1].length);
  let options = '';
  if (text[i] === '[') {
    const e = matchBracket(text, i);
    if (e < 0) return null;
    options = text.slice(i + 1, e - 1);
    i = skipSpace(text, e);
  }
  if (text[i] !== '{') return null;
  const e = matchBrace(text, i);
  if (e < 0 || e > begin) return null;
  return { start, end: e, begin, docClass: text.slice(i + 1, e - 1).trim(), options };
}

/** The class, options and preamble of a .tex file; null for one without (an \input chapter). */
export function readHead(text: string): DocumentHead | null {
  const at = locate(text);
  if (!at) return null;
  return { docClass: at.docClass, options: at.options, preamble: text.slice(at.end, at.begin).replace(/^\r?\n/, '').replace(/\r?\n$/, '') };
}

/** `text` with its class, options and preamble replaced (the rest of the file as it was). */
export function writeHead(text: string, head: DocumentHead): string {
  const at = locate(text);
  if (!at) return text;
  const cls = `\\documentclass${head.options.trim() ? `[${head.options.trim()}]` : ''}{${head.docClass.trim() || 'article'}}`;
  const preamble = head.preamble.replace(/\s+$/, '');
  return text.slice(0, at.start) + cls + '\n' + (preamble ? `${preamble}\n` : '') + text.slice(at.begin);
}

export function DocumentSettings({ text, onSave, onClose }: { text: string; onSave(text: string): void; onClose(): void }) {
  const initial = readHead(text);
  const [head, setHead] = useState<DocumentHead>(initial ?? { docClass: '', options: '', preamble: '' });
  const set = (patch: Partial<DocumentHead>) => setHead((h) => ({ ...h, ...patch }));
  const label = 'mb-1 block text-[12px] font-medium text-muted';
  return (
    <Modal
      title="Document settings"
      icon={<FileCog className="size-4 text-accent" />}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!initial} onClick={() => (JSON.stringify(head) !== JSON.stringify(initial) && onSave(writeHead(text, head)), onClose())}>Save</Button>
        </>
      }
    >
      {!initial ? (
        <p className="text-[13px] text-muted">
          This file has no <code>\documentclass</code> and <code>\begin{'{document}'}</code>: it is part of a larger document. Open the main file to change the document's settings.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <label className="w-56">
              <span className={label}>Document class</span>
              <TextInput list="lyx-classes" value={head.docClass} onChange={(e) => set({ docClass: e.target.value })} aria-label="Document class" />
              <datalist id="lyx-classes">
                {COMMON_CLASSES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="flex-1">
              <span className={label}>Class options</span>
              <TextInput value={head.options} onChange={(e) => set({ options: e.target.value })} placeholder="11pt, a4paper, twocolumn" aria-label="Class options" />
            </label>
          </div>
          <label>
            <span className={label}>LaTeX preamble (packages, macros, \title…)</span>
            <textarea
              value={head.preamble}
              onChange={(e) => set({ preamble: e.target.value })}
              spellCheck={false}
              aria-label="LaTeX preamble"
              className="focus-ring h-72 w-full resize-y rounded-md border border-line bg-panel-2 p-2 font-mono text-[12.5px] leading-5 text-fg"
            />
          </label>
        </div>
      )}
    </Modal>
  );
}
