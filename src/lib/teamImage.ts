import { teamBadgeImage } from './bracketAppearance';
import { safePhoto } from './teamRoster';

export const TEAM_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';

function imageData(canvas: HTMLCanvasElement, quality: number) {
  const webp = canvas.toDataURL('image/webp', quality);
  return webp.startsWith('data:image/webp;') ? webp : canvas.toDataURL('image/jpeg', quality);
}

/** Draw `source` at `size`, halving in steps first: one big downscale in a canvas looks soft and jagged. */
function sharpResize(source: CanvasImageSource & { width: number; height: number }, width: number, height: number) {
  let current: CanvasImageSource = source, w = source.width, h = source.height;
  while (w / 2 >= width && h / 2 >= height) {
    const step = document.createElement('canvas');
    step.width = w = Math.round(w / 2); step.height = h = Math.round(h / 2);
    const ctx = step.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, w, h);
    current = step;
  }
  return { current, w, h };
}

/**
 * A team logo: the whole picture, fitted edge to edge on a square (transparent where it is not square), kept
 * sharp at up to 512 px. The crests show it filling the circle, so nothing extra is shrunk in here.
 */
export async function prepareTeamImage(file: File) {
  if (!TEAM_IMAGE_TYPES.split(',').includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image under 15 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be opened.'); });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the team image.');
    const largest = Math.max(bitmap.width, bitmap.height);
    for (const [target, quality] of [[512, .92], [512, .85], [448, .85], [384, .85], [384, .75], [320, .75], [256, .7]]) {
      // Never blow a small logo up past its own size: that only adds blur.
      const size = Math.min(target, largest);
      canvas.width = canvas.height = size;
      const scale = size / largest;
      const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
      const { current, w, h } = sharpResize(bitmap, width, height);
      context.clearRect(0, 0, size, size);
      context.imageSmoothingQuality = 'high';
      context.drawImage(current, 0, 0, w, h, (size - width) / 2, (size - height) / 2, width, height);
      const image = teamBadgeImage(imageData(canvas, quality));
      if (image) return image;
    }
    throw new Error('This image could not be reduced to a team badge. Choose a smaller image.');
  } finally {
    bitmap.close();
  }
}

/** Player photos: centre-cropped to a square and shrunk until they fit inline in the public roster. */
export async function preparePlayerPhoto(file: File) {
  if (!TEAM_IMAGE_TYPES.split(',').includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP photo.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a photo under 15 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This photo could not be opened.'); });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the photo.');
    const side = Math.min(bitmap.width, bitmap.height);
    // Faces sit in the upper part of most portraits, so a tall picture is cropped from near the top.
    const sx = (bitmap.width - side) / 2, sy = bitmap.height > bitmap.width ? (bitmap.height - side) * .2 : 0;
    for (const [size, quality] of [[112, .8], [96, .72], [80, .66], [64, .6], [52, .55]]) {
      canvas.width = canvas.height = size;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
      const image = safePhoto(imageData(canvas, quality));
      if (image) return image;
    }
    throw new Error('This photo could not be made small enough. Choose another one.');
  } finally {
    bitmap.close();
  }
}
