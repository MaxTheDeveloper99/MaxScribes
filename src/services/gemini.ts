/// <reference types="vite/client" />
import { GoogleGenAI } from "@google/genai";
import api from "./api";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts text from an image with multi-model fallback and progressive rate-limit backoff.
 * 1. Tries server-side /api/transcribe proxy (safe, fast, handles model fallback).
 * 2. Falls back to direct client-side GoogleGenAI if server route is unavailable.
 * 3. Handles 429/quota limits by notifying onStatus and counting down for quota replenishment.
 */
export async function extractTextFromImage(
  base64Data: string,
  mimeType: string,
  onStatus?: (statusText: string) => void,
  retryCount = 0
): Promise<string> {
  const MAX_RETRIES = 4;

  // 1. First attempt: Use the server-side proxy
  try {
    const res = await api.post("/transcribe", {
      imageBase64: base64Data,
      mimeType: mimeType || "image/jpeg",
    }, {
      timeout: 45000,
    });

    if (res.data?.text && res.data.text !== "No text extracted.") {
      return res.data.text;
    }
  } catch (serverErr: any) {
    const isRateLimit =
      serverErr.response?.status === 429 ||
      serverErr.message?.includes("429") ||
      serverErr.message?.includes("RESOURCE_EXHAUSTED") ||
      serverErr.response?.data?.error?.includes("429") ||
      serverErr.response?.data?.error?.includes("RESOURCE_EXHAUSTED");

    if (isRateLimit && retryCount < MAX_RETRIES) {
      // Free-tier quotas reset over 10-30 seconds
      const waitSeconds = 10 + retryCount * 8; // 10s, 18s, 26s, 34s
      for (let s = waitSeconds; s > 0; s--) {
        onStatus?.(`AI busy (Rate Limit). Pausing for ${s}s to refresh quota (Attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await sleep(1000);
      }
      return extractTextFromImage(base64Data, mimeType, onStatus, retryCount + 1);
    }

    console.warn("Server transcribe route failed, attempting direct Gemini client:", serverErr.message);
  }

  // 2. Direct client-side Gemini fallback
  if (ai) {
    const candidateModels = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview"];
    let lastClientError: any = null;

    for (const model of candidateModels) {
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
                  text: "Extract all the text from this book page image. Maintain the original formatting as much as possible. If there is a page number visible, please include it at the very top as 'Page: [number]'.",
                },
              ],
            },
          ],
        });

        if (response.text) {
          return response.text;
        }
      } catch (err: any) {
        lastClientError = err;
        const is429 = err.message?.includes("429") || 
                      err.message?.includes("RESOURCE_EXHAUSTED") ||
                      JSON.stringify(err).includes("429");
        
        if (is429) {
          console.warn(`Model ${model} hit rate limit on client, trying next model or backoff...`);
          // Continue to next model
          continue;
        }
      }
    }

    // If all models hit rate limit, retry with countdown
    const isRateLimit = lastClientError && (
      lastClientError.message?.includes("429") || 
      lastClientError.message?.includes("RESOURCE_EXHAUSTED") ||
      JSON.stringify(lastClientError).includes("429")
    );

    if (isRateLimit && retryCount < MAX_RETRIES) {
      const waitSeconds = 12 + retryCount * 8;
      for (let s = waitSeconds; s > 0; s--) {
        onStatus?.(`AI quota limit reached. Pausing for ${s}s to refresh quota (Attempt ${retryCount + 1}/${MAX_RETRIES})...`);
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
