import { describe, expect, it } from 'vitest';
import { figureTopAbove, graphicsBoxes, type Box, type Ops } from '../../src/pdf/link-target';

const OPS: Ops = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
};

describe('graphicsBoxes', () => {
  it('places an image by the transform it is drawn with', () => {
    const boxes = graphicsBoxes(
      { fnArray: [10, 12, 85, 11], argsArray: [null, [200, 0, 0, 100, 72, 500], ['img1'], null] },
      OPS,
    );
    expect(boxes).toEqual([[72, 500, 272, 600]]);
  });

  it('places a PDF figure (form XObject) by its matrix and bbox, inside an outer transform', () => {
    const boxes = graphicsBoxes(
      {
        fnArray: [10, 12, 74, 75, 11],
        argsArray: [null, [1, 0, 0, 1, 100, 300], [[0.5, 0, 0, 0.5, 0, 0], [0, 0, 400, 200]], null, null],
      },
      OPS,
    );
    expect(boxes).toEqual([[100, 300, 300, 400]]);
  });

  it('restores the transform after a form ends', () => {
    const boxes = graphicsBoxes(
      {
        fnArray: [74, 75, 85],
        argsArray: [[[2, 0, 0, 2, 0, 0], [0, 0, 10, 10]], null, ['img']],
      },
      OPS,
    );
    expect(boxes[1]).toEqual([0, 0, 1, 1]); // identity again: the form's matrix is gone
  });
});

describe('figureTopAbove', () => {
  const page = 842;
  const figure: Box = [150, 420, 450, 700];

  it('finds the figure right above a caption target', () => {
    expect(figureTopAbove([figure], 405, page)).toBe(700);
  });

  it('ignores a figure when the target is far below it (another paragraph)', () => {
    expect(figureTopAbove([figure], 300, page)).toBeNull();
  });

  it('ignores a figure below the target (hypcap: the target is already at the top)', () => {
    expect(figureTopAbove([figure], 712, page)).toBeNull();
  });

  it('counts stacked subfigures as one figure', () => {
    const lower: Box = [150, 420, 450, 560];
    const upper: Box = [150, 572, 450, 720];
    expect(figureTopAbove([upper, lower], 405, page)).toBe(720);
  });

  it('skips tiny graphics and full-page backgrounds', () => {
    expect(figureTopAbove([[150, 410, 155, 415]], 405, page)).toBeNull();
    expect(figureTopAbove([[0, 0, 595, 842]], 0, page)).toBeNull();
  });
});
