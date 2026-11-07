/**
 * Where to land a link in the PDF so its target makes sense.
 *
 * With plain hyperref, \ref{fig:x} points at the figure's caption, so a viewer
 * that scrolls the target to the top shows the caption with the figure cut
 * off above it. Here we look at what is drawn just above the target: if it is
 * an image or embedded graphic (\includegraphics), the jump shows the whole
 * figure instead. (With the caption package, or hypcap, the target is already
 * at the top of the figure, nothing is drawn right above it, and the jump is
 * unchanged.)
 *
 * All coordinates are PDF user space: points, y pointing up.
 */

/** [x0, y0, x1, y1] with x0 < x1 and y0 < y1. */
export type Box = [number, number, number, number];

type Matrix = [number, number, number, number, number, number];

/** The operator codes this needs, from pdf.js's OPS. */
export interface Ops {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function boundsOf([x0, y0, x1, y1]: number[], m: Matrix): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Bounding boxes of the images and embedded graphics (form XObjects, which is
 * what \includegraphics of a PDF becomes) in a page's operator list.
 */
export function graphicsBoxes(opList: { fnArray: number[]; argsArray: unknown[] }, ops: Ops): Box[] {
  const boxes: Box[] = [];
  const stack: Matrix[] = [];
  let ctm = IDENTITY;
  opList.fnArray.forEach((fn, i) => {
    const args = (opList.argsArray[i] ?? []) as unknown[];
    switch (fn) {
      case ops.save:
        stack.push(ctm);
        break;
      case ops.restore:
      case ops.paintFormXObjectEnd:
        ctm = stack.pop() ?? IDENTITY;
        break;
      case ops.transform:
        ctm = multiply(ctm, args as Matrix);
        break;
      case ops.paintFormXObjectBegin: {
        stack.push(ctm);
        const [matrix, bbox] = args as [ArrayLike<number> | null, ArrayLike<number> | null];
        if (matrix) ctm = multiply(ctm, Array.from(matrix) as Matrix);
        if (bbox) boxes.push(boundsOf(Array.from(bbox), ctm));
        break;
      }
      case ops.paintImageXObject:
      case ops.paintInlineImageXObject:
      case ops.paintImageMaskXObject:
        // Images are drawn into the unit square of the current transform.
        boxes.push(boundsOf([0, 0, 1, 1], ctm));
        break;
    }
  });
  return boxes;
}

/** Caption skip, plus a little slack: how far below a figure its caption can start. */
const MAX_GAP = 36;
/** Below this (in points) a graphic is a bullet, icon or rule, not a figure. */
const MIN_SIZE = 12;

/**
 * The top (PDF y) of the figure drawn right above `targetY`, or null when
 * nothing is. Graphics stacked above each other (subfigures) count as one.
 */
export function figureTopAbove(boxes: Box[], targetY: number, pageHeight: number): number | null {
  const figures = boxes.filter(([x0, y0, x1, y1]) => x1 - x0 >= MIN_SIZE && y1 - y0 >= MIN_SIZE && y1 - y0 < pageHeight * 0.9);
  // The target sits just under the figure: its bottom edge is at most MAX_GAP above.
  let group = figures.filter(([, y0]) => y0 >= targetY - 4 && y0 <= targetY + MAX_GAP);
  if (!group.length) return null;
  let top = Math.max(...group.map((b) => b[3]));
  for (;;) {
    const more = figures.filter((b) => !group.includes(b) && b[1] >= top - 4 && b[1] <= top + MAX_GAP);
    if (!more.length) return top;
    group = [...group, ...more];
    top = Math.max(top, ...more.map((b) => b[3]));
  }
}
