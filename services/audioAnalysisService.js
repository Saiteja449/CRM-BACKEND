import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not defined in environment variables.");
}

const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = new GoogleAIFileManager(apiKey);

/**
 * Analyzes an audio file using Gemini 1.5 Flash.
 * @param {string} filePath - The local path to the audio file.
 * @param {string} mimeType - The mime type of the audio file.
 * @returns {Promise<string>} - The generated analysis summary in Markdown format.
 */
export const analyzeAudioFile = async (filePath, mimeType) => {
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  // Resolve absolute file path
  let targetPath = path.resolve(filePath);
  if (!fs.existsSync(targetPath)) {
    const cwdPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(cwdPath)) {
      targetPath = cwdPath;
    } else {
      throw new Error(`Audio file not found at path: ${filePath}`);
    }
  }

  // Resolve proper audio MIME type (Android / React Native often sends generic octet-stream)
  let finalMimeType = mimeType;
  if (!finalMimeType || finalMimeType === "application/octet-stream") {
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === ".m4a") finalMimeType = "audio/m4a";
    else if (ext === ".mp3") finalMimeType = "audio/mp3";
    else if (ext === ".wav") finalMimeType = "audio/wav";
    else if (ext === ".ogg" || ext === ".oga") finalMimeType = "audio/ogg";
    else if (ext === ".aac") finalMimeType = "audio/aac";
    else finalMimeType = "audio/mp4";
  }

  try {
    console.log(`[AudioAnalysis] Uploading file to Gemini: ${targetPath} (MIME: ${finalMimeType})`);

    // Upload the file to Gemini's File API
    const uploadResponse = await fileManager.uploadFile(targetPath, {
      mimeType: finalMimeType,
      displayName: "Sales Call Recording",
    });

    console.log(
      `[AudioAnalysis] Upload complete. File URI: ${uploadResponse.file.uri}`,
    );

    // Wait until file is actively processed by Gemini
    let file = await fileManager.getFile(uploadResponse.file.name);
    let attempts = 0;
    while (file.state === "PROCESSING" && attempts < 15) {
      console.log(`[AudioAnalysis] File is processing, waiting 2s... (attempt ${attempts + 1})`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = await fileManager.getFile(uploadResponse.file.name);
      attempts++;
    }

    if (file.state === "FAILED") {
      throw new Error("Gemini audio file processing failed in File API.");
    }

    // Initialize the model - gemini-1.5-flash is stable and fast for audio analysis
    let model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

    // Generate the summary
    const prompt = `
You are an AI sales call analyzer.

The conversation is between a sales representative and a customer about pet services.

Analyze the audio and return ONLY Markdown in the following format.

## Short Summary
Maximum 2 sentences.

## Rating
Give a rating out of 5.

Reason:
Explain the rating in exactly 6 words.

## Suggestions
Provide 3 short bullet points (maximum 8 words each) to help the salesperson improve.

Rules:
- Keep the entire response under 120 words.
- Be concise.
- Base the rating on customer interest, salesperson communication, objection handling, and closing.
- If the audio is silent, corrupted, or not understandable, reply:
"The audio could not be analyzed."
`;

    console.log(`[AudioAnalysis] Requesting content generation from Gemini...`);
    let result;
    try {
      result = await model.generateContent([
        {
          fileData: {
            mimeType: uploadResponse.file.mimeType,
            fileUri: uploadResponse.file.uri,
          },
        },
        { text: prompt },
      ]);
    } catch (genErr) {
      console.warn(`[AudioAnalysis] gemini-3.5-flash failed, trying gemini-2.5-flash fallback...`, genErr.message);
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      result = await fallbackModel.generateContent([
        {
          fileData: {
            mimeType: uploadResponse.file.mimeType,
            fileUri: uploadResponse.file.uri,
          },
        },
        { text: prompt },
      ]);
    }

    const analysis = result.response.text();
    console.log(`[AudioAnalysis] Analysis complete for ${targetPath}`);

    // Cleanup file from Gemini storage
    try {
      await fileManager.deleteFile(uploadResponse.file.name);
      console.log(
        `[AudioAnalysis] Cleaned up file from Gemini storage: ${uploadResponse.file.name}`,
      );
    } catch (cleanupErr) {
      console.error(
        `[AudioAnalysis] Failed to cleanup file ${uploadResponse.file.name}:`,
        cleanupErr.message,
      );
    }

    return analysis;
  } catch (error) {
    console.error("[AudioAnalysis] Error analyzing audio file:", error);
    throw error;
  }
};
