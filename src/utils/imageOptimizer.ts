/**
 * High-performance, robust image optimizer for mobile browsers and large bulk uploads:
 * 1. Multi-tier reading: uses file.arrayBuffer() -> blob -> createImageBitmap or Image.
 * 2. Instant preloading: caches file bytes immediately upon user selection so mobile OS
 *    temporary file handles never expire during long batch OCR queues.
 * 3. Scaled down to max 1600px & high-quality JPEG (0.85) to optimize Gemini token payload.
 */

export interface PreparedImage {
  originalFile: File;
  optimizedFile: File;
  base64Data: string;
  mimeType: string;
  error?: string;
}

/**
 * Safely extracts raw ArrayBuffer from File/Blob across all mobile and desktop browsers
 */
async function getFileBlob(file: File): Promise<Blob> {
  // Method 1: file.arrayBuffer() creates a detached in-memory buffer
  if (typeof file.arrayBuffer === "function") {
    try {
      const buffer = await file.arrayBuffer();
      return new Blob([buffer], { type: file.type || "image/jpeg" });
    } catch {
      // fallback to next method
    }
  }

  // Method 2: file.slice() creates an independent blob reference
  if (typeof file.slice === "function") {
    try {
      const sliced = file.slice(0, file.size, file.type || "image/jpeg");
      if (sliced && sliced.size > 0) return sliced;
    } catch {
      // fallback to next method
    }
  }

  // Method 3: FileReader with readAsArrayBuffer
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Blob([reader.result], { type: file.type || "image/jpeg" }));
      } else {
        reject(new Error(`Could not read file data for ${file.name}`));
      }
    };
    reader.onerror = () => {
      reject(new Error(`Could not read file ${file.name} from device storage.`));
    };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Converts a Blob to a base64 string (without the data URL prefix)
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      if (!res) {
        return reject(new Error("Failed to encode blob to base64."));
      }
      const base64 = res.includes(",") ? res.split(",")[1] : res;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("FileReader error converting blob to base64."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Optimizes a single image file for OCR transcription.
 */
export async function optimizeImageForOcr(
  file: File,
  maxDimension = 1600
): Promise<{
  base64Data: string;
  mimeType: string;
  optimizedFile: File;
}> {
  if (!file || file.size === 0) {
    throw new Error(`File "${file?.name || 'unknown'}" is empty or missing.`);
  }

  // 1. Immediately read bytes into a stable in-memory Blob
  const blob = await getFileBlob(file);

  // 2. Decode image using ImageBitmap (fastest on modern browsers) or Image fallback
  let width = 0;
  let height = 0;
  let source: ImageBitmap | HTMLImageElement | null = null;
  let objectUrlToRevoke: string | null = null;

  try {
    if (typeof createImageBitmap === "function") {
      try {
        const bmp = await createImageBitmap(blob);
        width = bmp.width;
        height = bmp.height;
        source = bmp;
      } catch {
        source = null;
      }
    }

    if (!source) {
      objectUrlToRevoke = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image decoding failed"));
        img.src = objectUrlToRevoke!;
      });
      width = img.naturalWidth || img.width;
      height = img.naturalHeight || img.height;
      source = img;
    }

    // If image is already smaller than maxDimension and file size is < 500KB and already JPEG, keep it
    if (
      width <= maxDimension &&
      height <= maxDimension &&
      blob.size < 500 * 1024 &&
      (file.type === "image/jpeg" || file.type === "image/jpg")
    ) {
      const base64Data = await blobToBase64(blob);
      return {
        base64Data,
        mimeType: file.type || "image/jpeg",
        optimizedFile: file,
      };
    }

    // Calculate aspect-ratio-preserving dimensions
    let targetWidth = width;
    let targetHeight = height;
    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      if (targetWidth > targetHeight) {
        targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
        targetWidth = maxDimension;
      } else {
        targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
        targetHeight = maxDimension;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, targetWidth);
    canvas.height = Math.max(1, targetHeight);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      const base64Data = await blobToBase64(blob);
      return {
        base64Data,
        mimeType: file.type || "image/jpeg",
        optimizedFile: file,
      };
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    const optimizedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    });

    if (!optimizedBlob) {
      const base64Data = await blobToBase64(blob);
      return {
        base64Data,
        mimeType: file.type || "image/jpeg",
        optimizedFile: file,
      };
    }

    const newFileName = (file.name || "image").replace(/\.[^/.]+$/, "") + ".jpg";
    const optimizedFile = new File([optimizedBlob], newFileName, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    const base64Data = await blobToBase64(optimizedBlob);

    return {
      base64Data,
      mimeType: "image/jpeg",
      optimizedFile,
    };
  } finally {
    if (source && "close" in source && typeof source.close === "function") {
      source.close();
    }
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}

/**
 * Pre-reads and optimizes all selected files in parallel/batch immediately.
 * This ensures that on mobile devices, temporary file descriptor handles
 * are read before the mobile OS can close or revoke them.
 */
export async function preloadAndOptimizeAllFiles(
  files: File[],
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<PreparedImage[]> {
  const results: PreparedImage[] = [];
  const BATCH_SIZE = 3; // Process 3 images at a time for optimal CPU and memory balance

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const chunk = files.slice(i, i + BATCH_SIZE);
    const chunkPromises = chunk.map(async (file, chunkIdx) => {
      const overallIndex = i + chunkIdx + 1;
      onProgress?.(overallIndex, files.length, file.name);

      try {
        const { base64Data, mimeType, optimizedFile } = await optimizeImageForOcr(file, 1600);
        return {
          originalFile: file,
          optimizedFile,
          base64Data,
          mimeType,
        };
      } catch (err: any) {
        console.warn(`Error preloading image ${file.name}:`, err);
        return {
          originalFile: file,
          optimizedFile: file,
          base64Data: "",
          mimeType: file.type || "image/jpeg",
          error: err.message || `Could not read file ${file.name}`,
        };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return results;
}
