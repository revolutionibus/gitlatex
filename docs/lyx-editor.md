# The LyX-style editor

gitlatex can edit `.tex` files the way [LyX](https://www.lyx.org) does: you
see headings, lists, theorems and formulas as they will look, not the LaTeX
that makes them. This is **WYSIWYM**, *what you see is what you mean*: you
say what a paragraph *is* (a section, a list item, a theorem), and LaTeX
decides how it looks in the PDF.

- **Turn it on:** **Settings → Appearance → Editor style for .tex files →
  LyX style**, or click **LyX** in the **Source | LyX** switch on the right of
  the editor's tab bar. Click **Source** to go back to the LaTeX source.
- **It edits your `.tex` file directly.** There is no `.lyx` file. Compiling,
  Git, history and live collaboration work exactly as with the source editor.
- **You never have to write LaTeX**, but you always can: anything the editor
  cannot show visually appears as a red **TeX code** box, and you can type
  LaTeX into one at any time (<kbd>Ctrl</kbd>+<kbd>L</kbd>).
- **Your file stays yours.** Paragraphs you do not touch are written back
  exactly as they were, with their comments, line breaks and spacing, so a
  Git diff shows only what you changed.

On a Mac, <kbd>Ctrl</kbd> in this guide also means <kbd>Cmd</kbd>, and
<kbd>Alt</kbd> means <kbd>Option</kbd>.

## Contents

- [The screen](#the-screen)
- [Writing text](#writing-text)
- [Paragraph layouts](#paragraph-layouts)
- [Math](#math)
- [Insets: footnotes, notes, labels, TeX code…](#insets)
- [Citations and Zotero](#citations-and-zotero)
- [Figures, graphics and tables](#figures-graphics-and-tables)
- [TeX code boxes and the preamble](#tex-code-boxes-and-the-preamble)
- [Compiling and the PDF](#compiling-and-the-pdf)
- [Switching between LyX and Source](#switching-between-lyx-and-source)
- [Finding your way around](#finding-your-way-around)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Menus](#menus)
- [Preferences](#preferences)
- [How your file is saved](#how-your-file-is-saved)
- [Limitations](#limitations)
- [For developers](#for-developers)

## The screen

From top to bottom:

| Part | What it does |
| --- | --- |
| **Menubar** | File, Edit, View, Insert, Navigate, Document, Tools, Help: the same menus as LyX. Open one with the mouse, or with <kbd>Alt</kbd> + its underlined letter (hold <kbd>Alt</kbd> to see the letters). |
| **Layout box** | The drop-down at the top left shows the current paragraph's layout (Standard, Section, Itemize, Theorem…). Pick another to change it. |
| **Toolbars** | Two rows of buttons. Hover over one to see what it does and its shortcut. |
| **Document** | Your text. Click anywhere and type. |
| **Math toolbars** | Two rows of symbols and structures that appear at the bottom while the cursor is in a formula. View → Toolbars → Math keeps them visible. |
| **Status bar** | Messages, the next keys of a shortcut you have started (e.g. after <kbd>Alt</kbd>+<kbd>P</kbd>), and on the right the layout and zoom. |

### Toolbar buttons

First row:

| Button | Does |
| --- | --- |
| Layout box | Paragraph layout |
| 💾 | Save and compile (<kbd>Ctrl</kbd>+<kbd>S</kbd>) |
| ↶ ↷ | Undo, redo |
| ✂ ⧉ 📋 | Cut, copy, paste |
| 🔍 | Find and replace (<kbd>Ctrl</kbd>+<kbd>F</kbd>) |
| ← | Go back to where you were before the last jump |
| *I* Aa **B** | Emphasize, small caps (noun), bold |
| Σ | Insert a formula (<kbd>Ctrl</kbd>+<kbd>M</kbd>) |
| 🖼 | Insert graphics |
| 🖼+ | Insert a figure float (with a caption) |
| ▦ | Insert a table |
| ◎ | Show in PDF (jump to this spot in the PDF) |
| ⌗ | Always show the math toolbars |

Second row:

| Button | Does |
| --- | --- |
| 👁 ⟳ | View / Update: compile and show the PDF |
| • 1. | Bulleted list, numbered list |
| ⇤ ⇥ | Decrease / increase depth (un-nest / nest a list item or paragraph) |
| x² | Footnote |
| ▥ | Margin note |
| 🗒 | LyX note (a comment that is not printed) |
| 🏷 | Label (for cross-references) |
| ➜ | Cross-reference |
| ❝ | Citation from the project's bibliography |
| **Z** | Citation from your Zotero library |
| 🔗 | URL |
| **TeX** | TeX code box (<kbd>Ctrl</kbd>+<kbd>L</kbd>) |
| ≡ | Align left, center, right |
| ✓abc | Spell checking on/off (your browser's checker) |
| ⚙ | Document settings (class and preamble) |

The outline and the file list are in gitlatex's own sidebar, and the LaTeX
source is one click away with the **Source | LyX** switch.

## Writing text

Writing in LyX feels like a word processor, with a few rules that keep your
document clean. LaTeX handles spacing, so:

- **Enter starts a new paragraph.** It never adds empty lines. An empty
  paragraph disappears when you leave it.
- **Two spaces in a row are ignored**, and so is a space at the start of a
  paragraph. The status bar tells you why. Use
  <kbd>Ctrl</kbd>+<kbd>Space</kbd> for a protected (non-breaking) space.
- **Tab does not indent.** Indentation comes from the layout and from the
  depth (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>→</kbd>).
- **A line break inside a paragraph** is <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
  (LaTeX's `\\`).
- **Quotes become typographic quotes:** typing `"` gives “ or ” depending on
  the position.
- **Emphasis, bold, small caps:** select text and press
  <kbd>Ctrl</kbd>+<kbd>E</kbd>, <kbd>Ctrl</kbd>+<kbd>B</kbd> or use
  **Edit → Text Style**. With nothing selected, the style applies to what you
  type next.

## Paragraph layouts

Every paragraph has a layout. Change it with the layout box, the
<kbd>Alt</kbd>+<kbd>P</kbd> shortcuts, or the list buttons.

| Group | Layouts | LaTeX |
| --- | --- | --- |
| Text | Standard, Quote, Quotation, Verse, LyX-Code | paragraph, `quote`, `quotation`, `verse` |
| Sectioning | Part, Chapter, Section, Subsection, Subsubsection, Paragraph, Subparagraph | `\section{…}` and friends |
| Unnumbered | The same with `*` (Section*…) | `\section*{…}` |
| Lists | Itemize, Enumerate, Description | `itemize`, `enumerate`, `description` |
| Front matter | Title, Author, Date, Abstract | `\title`, `\author`, `\date`, `abstract` |
| Reasoning | Theorem, Lemma, Corollary, Proposition, Conjecture, Claim, Definition, Example, Exercise, Problem, Remark, Proof | theorem environments (`amsthm`) |

How layouts behave:

- **Enter keeps lists and theorems going.** Press Enter at the end of a list
  item and the new paragraph is another item. Press Enter on an *empty* item
  to end the list (or to step out one level of nesting).
- **After a heading, Enter gives a Standard paragraph.**
- **Nesting:** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>→</kbd> nests the current
  paragraph under the one above: a sub-list, or a plain paragraph that belongs
  to a list item or theorem. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>←</kbd>
  un-nests it.
- **Numbering is live:** sections, theorems, equations, list items, figures
  and footnotes are numbered as they will be in the PDF, and
  cross-references show the number they point to.
- **Your own theorem names work:** if the preamble defines
  `\newtheorem{hyp}{Hypothesis}`, *Hypothesis* appears in the layout box, and
  `\begin{thm}` is shown as a Theorem when `thm` is defined as one.
- **A theorem title** (`\begin{theorem}[Fundamental]`) is shown after the
  number: *Theorem 1 (Fundamental).*
- **Moving whole sections:** with the cursor in a section,
  <kbd>Alt</kbd>+<kbd>P</kbd> then <kbd>↑</kbd>/<kbd>↓</kbd> moves the
  section with everything in it up or down. <kbd>Alt</kbd>+<kbd>P</kbd> then
  <kbd>←</kbd>/<kbd>→</kbd> promotes or demotes it (section ↔ subsection).
  <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> moves just the current paragraph.

If a layout needs something in the preamble (a theorem environment, a
package), the editor adds it when you first use the layout. See
[How your file is saved](#how-your-file-is-saved).

## Math

Formulas are edited visually with [MathLive](https://cortexjs.io/mathlive/):
what you type is shown as math straight away.

| To insert | Do |
| --- | --- |
| Inline formula (`$…$`) | <kbd>Ctrl</kbd>+<kbd>M</kbd>, the Σ button, or type `$` |
| Display formula (`\[…\]`) | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> |
| Numbered equation (`equation`) | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>, or Insert → Math → Numbered Formula |
| `align`, `gather`, `multline`, `flalign`, `alignat`, `eqnarray` | Insert → Math → AMS … Environment |
| Cases, aligned, gathered, split, matrices, delimiters | Insert → Math, or the math toolbars |

Typing inside a formula:

- `/` makes a fraction, `^` a superscript, `_` a subscript.
- Type a command name such as `\alpha`, `\int`, `\sum`, `\sqrt` and press
  <kbd>Space</kbd>, or use the math toolbars or the
  <kbd>Alt</kbd>+<kbd>M</kbd> shortcuts below.
- <kbd>Tab</kbd> and the arrow keys move between the parts of a fraction,
  root, matrix…
- **Leave the formula** with <kbd>Esc</kbd>, or by moving past its edge with
  <kbd>←</kbd>/<kbd>→</kbd>. Arrow keys also move *into* a formula from the
  text.
- In a display formula, **Enter** continues with text below it.
- <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>N</kbd> numbers (or un-numbers) a display
  formula. **Insert → Label…** inside a display formula gives it a label,
  shown under the number.
- <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> inside an inline formula
  turns it into a display formula. **Edit → Math → Change Formula Type**
  converts between all the kinds.
- **Your macros work:** `\newcommand`, `\renewcommand`, `\def` and
  `\DeclareMathOperator` from the preamble are shown rendered (for example
  `\R` as ℝ).

A formula you do not edit is written back exactly as it was in the file.

## Insets

Insets are boxes inside the text. Click an inset's label (e.g. *foot 1*) to
collapse or expand it; <kbd>Ctrl</kbd>+<kbd>I</kbd> does the same at the
cursor. **Edit → Dissolve Inset** removes the box and keeps its text.

| Inset | How | LaTeX |
| --- | --- | --- |
| Footnote | Toolbar x², or Insert → Footnote | `\footnote{…}` |
| Margin note | Toolbar, or Insert → Marginal Note | `\marginpar{…}` |
| LyX note | Insert → Note → LyX Note. Not printed. | (nothing) |
| Comment / Greyed out | Insert → Note → Comment / Greyed Out | (nothing) / grey text |
| TeX code | <kbd>Ctrl</kbd>+<kbd>L</kbd>, or the **TeX** button | written as typed |
| URL | Insert → URL | `\url{…}` |
| Hyperlink | Insert → Hyperlink… (double-click one to edit it) | `\href{…}{…}` |
| Label | Insert → Label… (a name is suggested, like `sec:intro`) | `\label{…}` |
| Cross-reference | Insert → Cross-Reference… (pick a label and a format) | `\ref`, `\eqref`, `\pageref` |
| Citation | See [Citations and Zotero](#citations-and-zotero) | `\cite{…}` |
| Graphics, figure, table | See [Figures](#figures-graphics-and-tables) | `\includegraphics`, `figure`, `tabular` |
| Table of contents | Insert → List / TOC → Table of Contents | `\tableofcontents` |
| New page / page break | Insert → Formatting → New Page, Page Break, Clear Page… | `\newpage`… |
| Horizontal line | Insert → Formatting → Horizontal Line | a rule |
| Special characters | Insert → Special Character / Formatting: ellipsis, protected space, thin space, hyphenation point, ligature break, end of sentence… | `\ldots`, `~`, `\,`, `\-`… |
| BibTeX bibliography | Insert → List / TOC → BibTeX Bibliography… | `\bibliographystyle` + `\bibliography` |
| Child document | Insert → File → Child Document… | `\input{…}` |

Double-click a **cross-reference** to jump to its label, a **label** to rename
it (the references to it follow), a **citation** to change it, and a
**graphic** to change the file or its size.

## Citations and Zotero

**From the project's bibliography:** put the cursor where the citation goes,
then the ❝ button or **Insert → Citation…**. Search, pick one or more entries
(<kbd>Ctrl</kbd>/<kbd>Shift</kbd>+click), choose the command (`\cite`,
`\citep`, `\citet`, `\parencite`, `\textcite`, `\autocite`, `\nocite`) and
optional text before and after (*see*, *p.~3*). The default command follows
your preamble: `\autocite` with biblatex, `\citep` with natbib, otherwise
`\cite`. The citation appears as a box like **[knuth1984]**; double-click it
to change it.

**From Zotero:** the red **Z** button, **Insert → Citation from Zotero…**, or
the **Zotero…** button in the citation dialog.

1. Search your Zotero library by title, author or year.
2. Tick one or more items.
3. Click **Import & cite**.

The items are added to the project's `.bib` file (`references.bib` is created
if there is none), and the citation is inserted at the cursor. Next time they
are also in Insert → Citation. Opened from an existing citation (double-click
it, then **Zotero…**), the chosen items are added to that citation.

Zotero must be running on the same computer as gitlatex. With the
[Better BibTeX](https://retorque.re/zotero-better-bibtex/) plugin the
citation keys are stable; without it, Zotero's built-in local API is used. If
the document has no bibliography yet, a message reminds you to add one with
**Insert → List / TOC → BibTeX Bibliography** (or `\printbibliography` for
biblatex).

## Figures, graphics and tables

- **Graphics:** the 🖼 button or **Insert → Graphics…**. Pick an image of the
  project (drop image files on the file tree to add them), a width in percent
  of the line, and optionally more `\includegraphics` options. Images are
  shown in the document at that width. PDF and EPS images are shown by name.
- **Figure float:** the 🖼+ button or **Insert → Float → Figure**. You get a
  *Figure* box with a caption to type into; insert the graphic inside it.
  Figures and their captions are numbered (*Figure 1:*), and a label inside
  the float is what cross-references point to.
- **Table float:** **Insert → Float → Table**, then put a table inside.
- **Tables:** the ▦ button or **Insert → Table…** inserts a `tabular` with
  the rows and columns you ask for, as a TeX code box to fill in. (A visual
  table editor like LyX's is not available yet.)

## TeX code boxes and the preamble

The red boxes are LaTeX the editor keeps exactly as written. They appear for:

- comments (`% …`),
- commands and environments the editor has no visual form for: `\maketitle`,
  `\bibliography{…}`, `tabular`, `tikzpicture`, `verbatim`, custom macros
  such as `\inst{1}` or `\and`, and so on,
- anything you type into one with <kbd>Ctrl</kbd>+<kbd>L</kbd>.

Click into a box to edit its LaTeX; <kbd>Enter</kbd> adds a new line inside
it. View → Outline Pane → *TeX Code* lists them all.

**The preamble** (everything between `\documentclass` and
`\begin{document}`) is not shown in the document. Edit it in
**Document → Settings…**: the document class, its options (`11pt, a4paper`)
and the LaTeX preamble (packages, macros, theorem definitions). A file that
is `\input` into another one has no preamble; open the main file for that.

**For anything else, switch to Source** with the **Source | LyX** switch
(or File → Edit LaTeX Source). The cursor goes with you.

## Compiling and the PDF

| To | Do |
| --- | --- |
| Save and compile | <kbd>Ctrl</kbd>+<kbd>S</kbd>, the 💾 button, the 👁 / ⟳ buttons, or gitlatex's **Compile** button |
| See a spot in the PDF | <kbd>Ctrl</kbd>+click in the text, the ◎ button, or Navigate → Forward Search |
| Go from the PDF to the text | Click in the PDF (as in the source editor) |

After a compile you start (the button or a shortcut), the PDF scrolls to
where your cursor is and briefly highlights it. Automatic compiles while you
type leave the PDF where it is. Errors appear in gitlatex's Problems panel;
clicking one takes you to the paragraph.

## Switching between LyX and Source

Switch any time with the **Source | LyX** switch on the tab bar. The cursor
lands on the same word in the other editor, in both directions. The choice
applies to every `.tex` file; other files (`.bib`, `.sty`, `.md`…) always
open in the source editor.

## Finding your way around

- **Outline:** gitlatex's sidebar outline lists the sections; click one to
  go there. **View → Outline Pane** has more lists: labels and references,
  equations, footnotes, notes and TeX code boxes.
- **Navigate menu:** go to a label, next cross-reference, next note,
  bookmarks (save up to five, then jump back to them), and **Navigate Back**
  (the ← button) to return to where you were before a jump. The bottom of
  the menu lists the document's sections.
- **Find and replace:** <kbd>Ctrl</kbd>+<kbd>F</kbd> opens the find bar.
  <kbd>F3</kbd> / <kbd>Shift</kbd>+<kbd>F3</kbd> find the next / previous
  match.
- **Command buffer:** <kbd>Alt</kbd>+<kbd>X</kbd> lets you type any LyX
  function by name (`layout Section`, `math-insert \alpha`,
  `font-typewriter`…), with completion.
- **Statistics:** Tools → Statistics… counts words, characters and formulas
  (in the selection, or the whole document).

## Keyboard shortcuts

The editor uses LyX's own key bindings (its standard *CUA* scheme). The full
list, searchable, is in **Help → Shortcuts**; functions the web version does
not have are marked there.

Some shortcuts are sequences: press <kbd>Alt</kbd>+<kbd>P</kbd>, release,
then press the next key. The status bar shows what you have typed so far.

### General

| Keys | Does |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>, <kbd>F2</kbd> | Save and compile |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Ctrl</kbd>+<kbd>Y</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Redo |
| <kbd>Ctrl</kbd>+<kbd>X</kbd> / <kbd>C</kbd> / <kbd>V</kbd> | Cut / copy / paste |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> | Find and replace |
| <kbd>F3</kbd> | Find next |
| <kbd>Alt</kbd>+<kbd>X</kbd> | Command buffer |
| <kbd>Alt</kbd>+<kbd>=</kbd> / <kbd>Alt</kbd>+<kbd>-</kbd> | Zoom in / out |
| <kbd>F7</kbd> | Spell checking on/off |
| <kbd>F11</kbd> | Full screen |
| <kbd>Esc</kbd> | Leave a formula or inset; cancel a selection |
| <kbd>Alt</kbd>+letter, <kbd>F10</kbd> | Open a menu |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | gitlatex's command palette (LyX prints with it; here print from the PDF viewer) |

### Text style

| Keys | Does |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> | Emphasize |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> | Bold |
| <kbd>Ctrl</kbd>+<kbd>U</kbd> | Underline |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Typewriter |
| <kbd>Alt</kbd>+<kbd>C</kbd> <kbd>C</kbd> | Small caps (noun) |
| <kbd>Alt</kbd>+<kbd>C</kbd> <kbd>S</kbd> / <kbd>R</kbd> | Sans serif / roman |
| <kbd>Alt</kbd>+<kbd>C</kbd> <kbd>Space</kbd> | Back to the default font |

### Paragraphs

| Keys | Layout or action |
| --- | --- |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>S</kbd> | Standard |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>0</kbd>…<kbd>6</kbd> | Part, Chapter, Section, Subsection, Subsubsection, Paragraph, Subparagraph |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>*</kbd> then <kbd>0</kbd>…<kbd>6</kbd> | The unnumbered versions |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>I</kbd> (or <kbd>B</kbd>) | Itemize |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>E</kbd> (or <kbd>N</kbd>) | Enumerate |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>D</kbd> | Description |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>T</kbd> / <kbd>Shift</kbd>+<kbd>A</kbd> / <kbd>Shift</kbd>+<kbd>D</kbd> / <kbd>A</kbd> | Title / Author / Date / Abstract |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>Q</kbd> / <kbd>Shift</kbd>+<kbd>Q</kbd> / <kbd>V</kbd> | Quote / Quotation / Verse |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>Space</kbd> | Open the layout box |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>↑</kbd> / <kbd>↓</kbd> | Move the section up / down |
| <kbd>Alt</kbd>+<kbd>P</kbd> <kbd>←</kbd> / <kbd>→</kbd> | Promote / demote the section |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>→</kbd> / <kbd>←</kbd> | Nest deeper / less deep |
| <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd> | Move the paragraph up / down |
| <kbd>Alt</kbd>+<kbd>Enter</kbd> | New paragraph with the *other* layout (e.g. leave a list in one step) |
| <kbd>Alt</kbd>+<kbd>A</kbd> <kbd>L</kbd> / <kbd>C</kbd> / <kbd>R</kbd> / <kbd>J</kbd> / <kbd>E</kbd> | Align left / center / right / justified / default |
| <kbd>Alt</kbd>+<kbd>A</kbd> <kbd>I</kbd> | Indent on/off |

The theorem layouts have no shortcut; pick them in the layout box.

### Math

| Keys | Does |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>M</kbd> | Inline formula |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> | Display formula |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> | Numbered formula |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>N</kbd> | Number / un-number the formula |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>F</kbd> | Fraction |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>S</kbd> / <kbd>R</kbd> | Square root / n-th root |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>U</kbd> / <kbd>I</kbd> | Sum / integral |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>X</kbd> / <kbd>E</kbd> | Subscript / superscript |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>(</kbd> / <kbd>[</kbd> / <kbd>{</kbd> / <kbd>&lt;</kbd> / <kbd>\|</kbd> | Delimiters ( ), [ ], { }, ⟨ ⟩, \| \| |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>G</kbd> then a letter | Greek letter: <kbd>A</kbd> α, <kbd>B</kbd> β, <kbd>P</kbd> π…; with <kbd>Shift</kbd> for capitals (Σ, Ω…) |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>T</kbd> <kbd>A</kbd> | Make it an `align` environment |
| <kbd>Alt</kbd>+<kbd>M</kbd> <kbd>Space</kbd> | Thin space in math |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> | Bold symbol |

### Inserting

| Keys | Inserts |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>L</kbd> | TeX code box |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Line break (`\\`) |
| <kbd>Ctrl</kbd>+<kbd>Space</kbd> | Protected space (`~`) |
| <kbd>Alt</kbd>+<kbd>.</kbd> | Ellipsis (…) |
| <kbd>Ctrl</kbd>+<kbd>.</kbd> | End-of-sentence period |
| <kbd>Ctrl</kbd>+<kbd>-</kbd> | Hyphenation point |
| <kbd>Alt</kbd>+<kbd>I</kbd> then the underlined letter | Anything in the Insert menu: <kbd>F</kbd> footnote, <kbd>L</kbd> label, <kbd>R</kbd> cross-reference, <kbd>C</kbd> citation, <kbd>Z</kbd> citation from Zotero, <kbd>G</kbd> graphics, <kbd>T</kbd> table, <kbd>X</kbd> TeX code… |

### Moving and selecting

The usual keys work: arrows, <kbd>Home</kbd>/<kbd>End</kbd>,
<kbd>Ctrl</kbd>+arrows by word, <kbd>Shift</kbd> to select,
<kbd>Ctrl</kbd>+<kbd>Home</kbd>/<kbd>End</kbd> for the start/end of the
document. <kbd>Ctrl</kbd>+<kbd>K</kbd> deletes to the end of the paragraph.

## Menus

| Menu | What is in it |
| --- | --- |
| **File** | Save (and compile), View PDF, Edit LaTeX Source, Import a LyX document or plain text into the document, Export as LaTeX, LyX 2.3, LyXHTML or plain text |
| **Edit** | Undo/redo, clipboard, paste as plain text, select all, find and replace, move paragraphs, text styles, paragraph settings (alignment, indent), math editing (numbering, formula type, math fonts, rows and columns), depth, dissolve inset, capitalize/uppercase/lowercase |
| **View** | Open/close all insets, outline pane, source pane (a read-only view of the LaTeX the editor writes), Edit LaTeX Source, toolbars, zoom, full screen |
| **Insert** | Math, special characters, formatting (spaces, line and page breaks, horizontal line), lists and TOC, floats, notes, file, citation, citation from Zotero, cross-reference, label, caption, table, graphics, URL, hyperlink, footnote, margin note, TeX code, date |
| **Navigate** | Bookmarks, next note, next cross-reference, go to label, forward search (to the PDF), and the list of sections |
| **Document** | Start appendix here, View/Update (compile), Settings (class, options, preamble) |
| **Tools** | Spell checking, statistics, command buffer, preferences |
| **Help** | Shortcuts (every key binding, searchable), About |

Menu items the web version does not have yet are shown greyed out.

## Preferences

**Tools → Preferences…**:

- **Screen zoom** of the document (also <kbd>Alt</kbd>+<kbd>=</kbd> /
  <kbd>Alt</kbd>+<kbd>-</kbd>).
- **Typing $ starts a formula** (on by default; LyX itself types a literal
  `$`). Turn it off to type dollar signs as text.
- **Typing \ starts a TeX code box** (off by default), for when you know the
  command you want.

The colors follow gitlatex's light/dark theme. Preferences are saved in this
browser.

## How your file is saved

- Edits are written into the `.tex` file a moment after you type, as small
  ordinary text edits: undo history, Git, collaborators and the source editor
  all see them.
- **Untouched parts are kept byte for byte.** The editor remembers the
  original text of every paragraph, list, theorem and formula, and writes
  only what you changed. Opening a file and closing it again changes nothing.
- **Changed parts are written as clean LaTeX:** one line per paragraph,
  `\emph{…}`, `\textbf{…}`, `\item …`, `\begin{theorem}…`.
- **The preamble gets what new content needs:** the first time you use a
  theorem layout the file did not define, `\usepackage{amsthm}` and
  `\newtheorem{theorem}{Theorem}` are added; a hyperlink adds `hyperref`, a
  graphic `graphicx`, an `align` environment `amsmath`, and so on. Packages
  already loaded are not added again, and classes that define theorems
  themselves (`llncs`, Springer's `svjour`) get no `\newtheorem`.
- **Changes from elsewhere** (a pull, a collaborator, the source editor) are
  read back in, keeping your place. If someone changes the same paragraph
  while you are typing in it, their version is kept and you are told.

## Limitations

- **`\title`, `\author` and `\date` in the preamble** are not shown as
  Title/Author/Date paragraphs (only those after `\begin{document}` are); the
  `\maketitle` box shows where the title goes. Change them in **Document →
  Settings…**, or move them below `\begin{document}`.
- **Tables** are TeX code boxes; there is no visual table editor yet.
- Not available yet: change tracking, branches, boxes, index and
  nomenclature entries, program listings, the advanced find and replace,
  split view.
- Editing a formula writes it as MathLive serializes it (for example
  `\frac12` becomes `\frac{1}{2}`). The PDF is the same.
- PDF and EPS images are shown by name, not as a picture.

## For developers

The code is in `web/src/lyx/`:

| File | What it is |
| --- | --- |
| `LyxPane.tsx` | The React pane: loads MathLive, moves text between the editor and the file's Monaco model, merges outside changes, Zotero and image access |
| `engine.ts` | The editor itself (menus, toolbars, key bindings, layouts, insets, dialogs), ported from the `lyx-web.html` prototype |
| `tex-import.ts` | LaTeX → blocks, cut into source chunks |
| `tex-export.ts` | Blocks → LaTeX, reusing each untouched chunk's source; preamble additions |
| `model.ts` | Layouts, special characters and the DOM factories shared by the three above |
| `bindings.ts` | LyX's key bindings, verbatim from its bind files |
| `lyx.css` | Styles, scoped to `.lyx-root` |

The round trip is tested in `web/tests/unit/lyx-tex.test.ts`.
