/// <reference types="vite/client" />
import { GoogleGenAI } from "@google/genai";
import api from "./api";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts text from an image with prioritized model fallback, robust rate-limit/demand recovery, and live countdowns.
 * 1. Calls the server-side /api/transcribe endpoint (handles key protection, model routing, and error extraction).
 * 2. If a rate limit (429) or high demand spike (503) occurs, automatically counts down and retries up to 5 times.
 * 3. Falls back to direct client-side GoogleGenAI if the server endpoint is unreachable.
 */
export async function extractTextFromImage(
  base64Data: string,
  mimeType: string,
  onStatus?: (statusText: string) => void,
  retryCount = 0
): Promise<string> {
  const MAX_RETRIES = 5;

  // 1. Primary: Server-side proxy with multi-model fallback
  try {
    const res = await api.post(
      "/transcribe",
      {
        imageBase64: base64Data,
        mimeType: mimeType || "image/jpeg",
      },
      {
        timeout: 120000, // 2 minutes timeout for detailed OCR
      }
    );

    if (res.data?.text !== undefined && res.data?.text !== null) {
      return res.data.text;
    }
  } catch (serverErr: any) {
    const status = serverErr.response?.status;
    const errorData = serverErr.response?.data;
    const errorMsg = String(errorData?.error || serverErr.message || "");
    const isTransient =
      status === 429 ||
      status === 503 ||
      errorData?.isTransient ||
      errorMsg.includes("429") ||
      errorMsg.includes("503") ||
      errorMsg.includes("RESOURCE_EXHAUSTED") ||
      errorMsg.includes("high demand") ||
      errorMsg.includes("UNAVAILABLE") ||
      errorMsg.includes("temporarily unavailable");

    if (isTransient && retryCount < MAX_RETRIES) {
      // Free-tier tokens replenish over 20-45s
      let waitSeconds = errorData?.retryAfterSeconds || (15 + retryCount * 10);
      waitSeconds = Math.min(Math.max(waitSeconds, 12), 55);

      for (let s = waitSeconds; s > 0; s--) {
        onStatus?.(
          `AI service busy (Rate limit / High demand). Pausing for ${s}s to refresh (Attempt ${retryCount + 1}/${MAX_RETRIES})...`
        );
        await sleep(1000);
      }
      return extractTextFromImage(base64Data, mimeType, onStatus, retryCount + 1);
    }

    console.warn("Server transcribe route failed, attempting direct Gemini client fallback:", errorMsg);
  }

  // 2. Direct client-side Gemini fallback
  if (ai) {
    const candidateModels = ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-3.8-flash"];
    let lastClientError: any = null;

    for (let idx = 0; idx < candidateModels.length; idx++) {
      const model = candidateModels[idx];
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    data: base64Data,
                    mimeType: mimeType || "image/jpeg",
                  },
                },
                {
                  text: "Extract all the text from this book page or handwritten notes image. Maintain the original formatting as much as possible. If there is a page number visible, please include it at the very top as 'Page: [number]'. If no page number is visible, do not guess or add one.",
                },
              ],
            },
          ],
        });

        if (response.text !== undefined && response.text !== null) {
          return response.text;
        }
      } catch (err: any) {
        lastClientError = err;
        const errStr = JSON.stringify(err) + " " + (err.message || "");
        const isTransient =
          err.status === 429 ||
          err.status === 503 ||
          errStr.includes("429") ||
          errStr.includes("503") ||
          errStr.includes("RESOURCE_EXHAUSTED") ||
          errStr.includes("high demand") ||
          errStr.includes("UNAVAILABLE");

        if (isTransient) {
          console.warn(`Model ${model} hit transient limit on client (status: ${err.status}), switching model...`);
          if (idx < candidateModels.length - 1) {
            await sleep(1500);
          }
          continue;
        }
      }
    }

    // If all models hit rate limit or high demand, perform backoff countdown
    const errorString = JSON.stringify(lastClientError) + " " + (lastClientError?.message || "");
    const isTransient =
      lastClientError &&
      (lastClientError.status === 429 ||
        lastClientError.status === 503 ||
        errorString.includes("429") ||
        errorString.includes("503") ||
        errorString.includes("RESOURCE_EXHAUSTED") ||
        errorString.includes("high demand") ||
        errorString.includes("UNAVAILABLE"));

    if (isTransient && retryCount < MAX_RETRIES) {
      let waitSeconds = 20 + retryCount * 10;
      const match = errorString.match(/retry in ([\d\.]+)s/i);
      if (match && match[1]) {
        waitSeconds = Math.ceil(parseFloat(match[1]));
      }
      waitSeconds = Math.min(Math.max(waitSeconds, 12), 55);

      for (let s = waitSeconds; s > 0; s--) {
        onStatus?.(
          `AI quota reached. Pausing for ${s}s to refresh quota (Attempt ${retryCount + 1}/${MAX_RETRIES})...`
        );
        await sleep(1000);
      }
      return extractTextFromImage(base64Data, mimeType, onStatus, retryCount + 1);
    }

    if (lastClientError) {
      throw lastClientError;
    }
  }

  throw new Error("Unable to transcribe image. Please ensure your GEMINI_API_KEY is configured.");
}

export function parsePageNumber(text: string): number | null {
  const match = text.match(/Page:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}
