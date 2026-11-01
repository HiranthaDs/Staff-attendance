export const PROFILE_PHOTO_SIZE = 192;
export const PROFILE_PHOTO_MAX_BYTES = 95 * 1024;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}
export async function compressProfilePhoto(source: File) {
  if (!source.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (source.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MB.");

  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = PROFILE_PHOTO_SIZE;
    canvas.height = PROFILE_PHOTO_SIZE;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare the image.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#e8eee8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const crop = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.max(0, (bitmap.width - crop) / 2);
    const sourceY = Math.max(0, (bitmap.height - crop) / 2);
    context.drawImage(bitmap, sourceX, sourceY, crop, crop, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.68, 0.56, 0.44, 0.34]) {
      const blob = await canvasBlob(canvas, "image/webp", quality);
      if (blob && blob.size <= PROFILE_PHOTO_MAX_BYTES) return new File([blob], "profile.webp", { type: "image/webp" });
    }
    for (const quality of [0.55, 0.42, 0.3]) {
      const blob = await canvasBlob(canvas, "image/jpeg", quality);
      if (blob && blob.size <= PROFILE_PHOTO_MAX_BYTES) return new File([blob], "profile.jpg", { type: "image/jpeg" });
    }
    throw new Error("The image could not be compressed enough. Try a simpler photo.");
  } finally {
    bitmap.close();
  }
}
