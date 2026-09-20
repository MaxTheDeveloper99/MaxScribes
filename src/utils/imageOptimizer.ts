/**
 * Optimizes an image file for OCR transcription and fast upload.
 * - Resizes large dimensions to max 1600px (optimal for OCR clarity while avoiding token bloat)
 * - Compresses to high-quality JPEG (0.85)
 * - Drastically reduces token usage and network payload from 8-12MB down to ~200-400KB
 */
export async function optimizeImageForOcr(
  file: File,
  maxDimension = 1600
): Promise<{
  base64Data: string;
  mimeType: string;
  optimizedFile: File;
}> {
  return new Promise((resolve, reject) => {
    // Basic verification
    if (!file || file.size === 0) {
      return reject(new Error("Selected file is empty or missing."));
    }

    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error(`Failed to read file "${file.name}".`));
    };

    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl) {
        return reject(new Error("Could not read file data."));
      }

      const img = new Image();

      img.onerror = () => {
        // If image decoding fails, fallback to raw file data
        console.warn(`Could not decode image for optimization, falling back to raw data.`);
        const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        resolve({
          base64Data: rawBase64,
          mimeType: file.type || 'image/jpeg',
          optimizedFile: file,
        });
      };

      img.onload = () => {
        try {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;

          // If image is already smaller than maxDimension and file size is < 500KB and already JPEG, no need to re-encode
          if (
            width <= maxDimension &&
            height <= maxDimension &&
            file.size < 500 * 1024 &&
            (file.type === 'image/jpeg' || file.type === 'image/jpg')
          ) {
            const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            return resolve({
              base64Data: rawBase64,
              mimeType: file.type,
              optimizedFile: file,
            });
          }

          // Calculate aspect-ratio-preserving scaled dimensions
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            // Fallback to original if canvas context cannot be created
            const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            return resolve({
              base64Data: rawBase64,
              mimeType: file.type || 'image/jpeg',
              optimizedFile: file,
            });
          }

          // High quality image smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                return resolve({
                  base64Data: rawBase64,
                  mimeType: file.type || 'image/jpeg',
                  optimizedFile: file,
                });
              }

              // Create clean optimized File object
              const newFileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
              const optimizedFile = new File([blob], newFileName, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });

              const blobReader = new FileReader();
              blobReader.onloadend = () => {
                const result = blobReader.result as string;
                const base64Data = result.includes(',') ? result.split(',')[1] : result;
                resolve({
                  base64Data,
                  mimeType: 'image/jpeg',
                  optimizedFile,
                });
              };
              blobReader.onerror = () => {
                const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                resolve({
                  base64Data: rawBase64,
                  mimeType: file.type || 'image/jpeg',
                  optimizedFile: file,
                });
              };
              blobReader.readAsDataURL(blob);
            },
            'image/jpeg',
            0.85
          );
        } catch (canvasErr) {
          console.warn("Canvas optimization error:", canvasErr);
          const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          resolve({
            base64Data: rawBase64,
            mimeType: file.type || 'image/jpeg',
            optimizedFile: file,
          });
        }
      };

      img.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}
