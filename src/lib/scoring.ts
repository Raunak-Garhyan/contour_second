/**
 * Scoring: compare user drawing against original contour.
 *
 * IMPORTANT: The Bezier editor renders the prompt centered into a 1024x1024
 * workspace, but the scoring crop is the center 512x512 region (OFFSET..OFFSET+512).
 * To score accurately we must apply the same framing to the reference prompt.
 */

const COMPARE_SIZE = 128;
const WORKSPACE_SIZE = 1024;
const VIEW_SIZE = 512;
const OFFSET = (WORKSPACE_SIZE - VIEW_SIZE) / 2;

function canvasToCompareCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = COMPARE_SIZE;
  c.height = COMPARE_SIZE;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, COMPARE_SIZE, COMPARE_SIZE);
  ctx.drawImage(src, 0, 0, COMPARE_SIZE, COMPARE_SIZE);
  return c;
}

function renderDrawingForScoring(drawImg: HTMLImageElement): HTMLCanvasElement {
  // The submitted drawing is already a 512x512 crop with black bg and white strokes.
  const c = document.createElement("canvas");
  c.width = VIEW_SIZE;
  c.height = VIEW_SIZE;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
  ctx.drawImage(drawImg, 0, 0, VIEW_SIZE, VIEW_SIZE);
  return c;
}

function renderPromptForScoring(origImg: HTMLImageElement): HTMLCanvasElement {
  // Match BezierCanvas: scale prompt into 1024, invert pixels, then crop center 512.
  const workspace = document.createElement("canvas");
  workspace.width = WORKSPACE_SIZE;
  workspace.height = WORKSPACE_SIZE;
  const wCtx = workspace.getContext("2d")!;
  wCtx.clearRect(0, 0, WORKSPACE_SIZE, WORKSPACE_SIZE);
  wCtx.drawImage(origImg, 0, 0, WORKSPACE_SIZE, WORKSPACE_SIZE);

  const imageData = wCtx.getImageData(0, 0, WORKSPACE_SIZE, WORKSPACE_SIZE);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];     // R
    data[i + 1] = 255 - data[i + 1]; // G
    data[i + 2] = 255 - data[i + 2]; // B
    // keep alpha
  }
  wCtx.putImageData(imageData, 0, 0);

  const view = document.createElement("canvas");
  view.width = VIEW_SIZE;
  view.height = VIEW_SIZE;
  const vCtx = view.getContext("2d")!;
  vCtx.fillStyle = "#000";
  vCtx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
  vCtx.drawImage(workspace, OFFSET, OFFSET, VIEW_SIZE, VIEW_SIZE, 0, 0, VIEW_SIZE, VIEW_SIZE);
  return view;
}

function getBinaryMask(canvas: HTMLCanvasElement, threshold = 40): Uint8Array {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, COMPARE_SIZE, COMPARE_SIZE).data;
  const mask = new Uint8Array(COMPARE_SIZE * COMPARE_SIZE);
  for (let i = 0; i < mask.length; i++) {
    const idx = i * 4;
    // Check if pixel is "on" (white)
    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    mask[i] = brightness > threshold ? 1 : 0;
  }
  return mask;
}

function dilateMask(mask: Uint8Array, radius = 1): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < COMPARE_SIZE; y++) {
    for (let x = 0; x < COMPARE_SIZE; x++) {
      let on = 0;
      for (let dy = -radius; dy <= radius && !on; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= COMPARE_SIZE || ny < 0 || ny >= COMPARE_SIZE) continue;
          if (mask[ny * COMPARE_SIZE + nx] === 1) {
            on = 1;
            break;
          }
        }
      }
      out[y * COMPARE_SIZE + x] = on;
    }
  }
  return out;
}

/**
 * Computes a simple distance field: for each pixel, distance to nearest 1 in the mask.
 * Capped at MAX_DIST for performance.
 */
function getDistanceField(mask: Uint8Array): Float32Array {
  const df = new Float32Array(mask.length);
  const MAX_DIST = 20;
  
  for (let y = 0; y < COMPARE_SIZE; y++) {
    for (let x = 0; x < COMPARE_SIZE; x++) {
      const idx = y * COMPARE_SIZE + x;
      if (mask[idx] === 1) {
        df[idx] = 0;
        continue;
      }
      
      let minDist = MAX_DIST;
      // Search local neighborhood for nearest 1
      const searchRange = 8; 
      for (let dy = -searchRange; dy <= searchRange; dy++) {
        for (let dx = -searchRange; dx <= searchRange; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < COMPARE_SIZE && ny >= 0 && ny < COMPARE_SIZE) {
            if (mask[ny * COMPARE_SIZE + nx] === 1) {
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < minDist) minDist = d;
            }
          }
        }
      }
      df[idx] = minDist;
    }
  }
  return df;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function scoreDrawing(
  originalSrc: string,
  drawingDataUrl: string
): Promise<number> {
  const [origImg, drawImg] = await Promise.all([
    loadImage(originalSrc),
    loadImage(drawingDataUrl),
  ]);

  const origView = renderPromptForScoring(origImg);
  const drawView = renderDrawingForScoring(drawImg);
  const origCanvas = canvasToCompareCanvas(origView);
  const drawCanvas = canvasToCompareCanvas(drawView);

  // Slightly higher threshold reduces anti-alias noise.
  const origMaskRaw = getBinaryMask(origCanvas, 55);
  const drawMaskRaw = getBinaryMask(drawCanvas, 55);

  // Small dilation makes scoring tolerant to stroke width differences and minor drift.
  const origMask = dilateMask(origMaskRaw, 1);
  const drawMask = dilateMask(drawMaskRaw, 1);

  let origOnCount = 0;
  for (let i = 0; i < origMask.length; i++) if (origMask[i] === 1) origOnCount++;

  let drawOnCount = 0;
  const drawOnIndices: number[] = [];
  for (let i = 0; i < drawMask.length; i++) {
    if (drawMask[i] === 1) {
      drawOnCount++;
      drawOnIndices.push(i);
    }
  }

  // Sanity checks
  if (drawOnCount < 10) return 0;
  if (origOnCount < 10) return 0;

  // 1. Coverage Score (how much of the original did we hit?)
  const origDF = getDistanceField(origMask);
  let totalError = 0;
  let farCount = 0;
  
  // Calculate average distance from user points to original contour
  for (const idx of drawOnIndices) {
    const d = origDF[idx];
    totalError += d;
    if (d > 4) farCount++;
  }
  
  const avgError = totalError / drawOnCount;
  
  // 2. Completeness Score (did we miss parts of the original?)
  const drawDF = getDistanceField(drawMask);
  let missingError = 0;
  let sampleCount = 0;
  for (let i = 0; i < origMask.length; i++) {
    if (origMask[i] === 1) {
      missingError += drawDF[i];
      sampleCount++;
    }
  }
  const avgMissing = missingError / sampleCount;

  // Combined score: Accuracy (staying close) + Completeness (covering path)
  // Distance error penalty: exponential decay. Error of 0 = 1.0, Error of 5 = 0.4
  const accuracy = Math.exp(-avgError / 3.0);
  const completeness = Math.exp(-avgMissing / 4.0);

  // Extra-stroke penalty: discourage scribbles far away from the contour.
  const farFrac = farCount / drawOnCount;
  const cleanliness = Math.max(0, 1 - farFrac * 1.25);
  
  // Final Score 0-10
  const combined = (accuracy * 0.55 + completeness * 0.35 + cleanliness * 0.10) * 10;
  
  // Round to 1 decimal place
  return Math.round(combined * 10) / 10;
}
