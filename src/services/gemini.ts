/// <reference types="vite/client" />
import { GoogleGenAI } from "@google/genai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function extractTextFromImage(base64Data: string, mimeType: string, retryCount = 0): Promise<string> {
  const model = "gemini-3-flash-preview";
  const MAX_RETRIES = 3;
  
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            {
              text: "Extract all the text from this book page image. Maintain the original formatting as much as possible. If there is a page number visible, please include it at the very top as 'Page: [number]'.",
            },
          ],
        },
      ],
    });

    return response.text || "No text extracted.";
  } catch (error: any) {
    // Check for rate limit error (429 / RESOURCE_EXHAUSTED)
    const isRateLimit = error.message?.includes("429") || 
                        error.message?.includes("RESOURCE_EXHAUSTED") ||
                        JSON.stringify(error).includes("429");

    if (isRateLimit && retryCount < MAX_RETRIES) {
      // Exponential backoff: 2s, 4s, 8s...
      const delay = Math.pow(2, retryCount + 1) * 1000;
      console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      return extractTextFromImage(base64Data, mimeType, retryCount + 1);
    }
    
    throw error;
  }
}

export function parsePageNumber(text: string): number | null {
  const match = text.match(/Page:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}
