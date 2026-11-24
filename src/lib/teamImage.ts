import { teamBadgeImage } from './bracketAppearance';

export const TEAM_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';

function imageData(canvas: HTMLCanvasElement, quality: number) {
  const webp = canvas.toDataURL('image/webp', quality);
  return webp.startsWith('data:image/webp;') ? webp : canvas.toDataURL('image/jpeg', quality);
}

/** Fit the original image on a square without distorting or cutting off the source. */
export async function prepareTeamImage(file: File) {
  if (!TEAM_IMAGE_TYPES.split(',').includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image under 15 MB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be opened.'); });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the team image.');
    for (const [size, quality] of [[80, .82], [64, .75], [52, .66], [42, .6], [36, .5]]) {
      canvas.width = canvas.height = size;
      // Stay inside the inscribed square, so the circular edge never clips the artwork.
      const frame = size * .71;
      const scale = Math.min(frame / bitmap.width, frame / bitmap.height);
      const width = bitmap.width * scale, height = bitmap.height * scale;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
      const image = teamBadgeImage(imageData(canvas, quality));
      if (image) return image;
    }
    throw new Error('This image could not be reduced to a team badge. Choose a smaller image.');
  } finally {
    bitmap.close();
  }
}
