import {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { VoyageAIClient } from "voyageai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import AILog from "../models/AILog.js";
import Followup from "../models/Followup.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

// Initialize Qdrant Vector Store Lazily
let qdrantVectorStore = null;

const initVectorStore = async () => {
  if (qdrantVectorStore) return qdrantVectorStore;

  try {
    const qdrantUrl = process.env.CLUSTER_ENDPOINT;
    const qdrantApiKey = process.env.QDRANT_API_KEY;

    if (!qdrantUrl || !qdrantApiKey) {
      console.warn(
        "QDRANT_URL or QDRANT_API_KEY not found in .env. RAG context will be empty.",
      );
      return null;
    }

    const client = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });

    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "gemini-embedding-2",
    });

    qdrantVectorStore = new QdrantVectorStore(embeddings, {
      client,
      collectionName: "petsfolio_kb",
    });

    return qdrantVectorStore;
  } catch (e) {
    console.warn("Qdrant Vector store initialization failed:", e.message);
    return null;
  }
};

// Define Structured Output Schema
const qualificationSchema = z.object({
  reply: z
    .string()
    .describe(
      "Your reply text to the user. Provide comprehensive answers and guide the user naturally without forcing unnecessary questions.",
    ),
  qualification: z
    .object({
      petType: z
        .string()
        .default("")
        .describe(
          "Type of pet (e.g., Dog, Cat). Return empty string if not mentioned in the current input.",
        ),
      breed: z
        .string()
        .default("")
        .describe(
          "Breed of the pet. Return empty string if not mentioned in the current input.",
        ),
      petAge: z
        .string()
        .default("")
        .describe(
          "Age of the pet. Return empty string if not mentioned in the current input.",
        ),
      city: z
        .string()
        .default("")
        .describe(
          "City of the user. Return empty string if not mentioned in the current input.",
        ),
      intent: z
        .string()
        .default("")
        .describe(
          "Service user is interested in (Training, Grooming, Walking, Pet Sitting, Pet Insurance, Job Inquiry, Cow Services). Return empty string if not mentioned in the current input.",
        ),
      specialRequirements: z
        .string()
        .default("")
        .describe(
          "Health issues, allergies, etc. 'None' if specified none, empty string if not mentioned.",
        ),
      urgency: z
        .string()
        .default("Medium")
        .describe("High, Medium, or Low urgency based on context."),
      interestScore: z
        .number()
        .default(5)
        .describe("1 to 10 interest score based on engagement."),
    })
    .default({
      petType: "",
      breed: "",
      petAge: "",
      city: "",
      intent: "",
      specialRequirements: "",
      urgency: "Medium",
      interestScore: 5,
    }),
  tags: z
    .array(z.string())
    .default([])
    .describe("Relevant tags (e.g., 'Hot Lead', 'Interested')."),
  disableAI: z
    .boolean()
    .default(false)
    .describe(
      "Set to true if user asks for human/support, confirms 'yes' to support team offer, or if AI cannot answer.",
    ),
  summary: z
    .string()
    .default("")
    .describe("One sentence summary of the conversation so far."),
  sentiment: z
    .string()
    .default("Neutral")
    .describe("Positive, Neutral, or Negative."),
  probabilityOfConversion: z
    .number()
    .default(50)
    .describe("0 to 100 estimated probability."),
  nextAction: z.string().default("").describe("Next step for the sales team."),
  triggerActions: z
    .object({
      createFollowUp: z
        .boolean()
        .default(false)
        .describe("Set true if user asked for a callback."),
      followUpNotes: z.string().default("").describe("Notes for the callback."),
      followUpDate: z
        .string()
        .default("")
        .describe("Date string for follow up if requested."),
      addNote: z
        .string()
        .default("")
        .describe("Any specific notes for the CRM lead record."),
    })
    .default({
      createFollowUp: false,
      followUpNotes: "",
      followUpDate: "",
      addNote: "",
    }),
});

// Define Lightweight Extraction Schema (No Reply Required)
export const leadExtractionSchema = z.object({
  qualification: z
    .object({
      petType: z
        .string()
        .default("")
        .describe(
          "Type of pet (e.g., Dog, Cat, Cow). Return empty string if not mentioned in the conversation.",
        ),
      breed: z
        .string()
        .default("")
        .describe(
          "Breed of the pet (e.g., Golden Retriever, Labrador, Persian). Return empty string if not mentioned in the conversation.",
        ),
      petAge: z
        .string()
        .default("")
        .describe(
          "Age of the pet (e.g., 2 years, 6 months). Return empty string if not mentioned in the conversation.",
        ),
      city: z
        .string()
        .default("")
        .describe(
          "City or locality of the user (e.g., Bangalore, Hyderabad, Whitefield). Return empty string if not mentioned.",
        ),
      intent: z
        .string()
        .default("")
        .describe(
          "Service user is interested in (Training, Grooming, Walking, Pet Sitting, Pet Insurance, Job Inquiry, Cow Services). Return empty string if not mentioned.",
        ),
      specialRequirements: z
        .string()
        .default("")
        .describe(
          "Health issues, allergies, behavioral notes, etc. 'None' if specified none, empty string if not mentioned.",
        ),
      urgency: z
        .string()
        .default("Medium")
        .describe("High, Medium, or Low urgency based on context."),
      interestScore: z
        .number()
        .default(5)
        .describe("1 to 10 interest score based on engagement."),
    })
    .default({
      petType: "",
      breed: "",
      petAge: "",
      city: "",
      intent: "",
      specialRequirements: "",
      urgency: "Medium",
      interestScore: 5,
    }),
  tags: z
    .array(z.string())
    .default([])
    .describe("Relevant tags (e.g., 'Hot Lead', 'Grooming Inquiry', 'Interested')."),
  summary: z
    .string()
    .default("")
    .describe("One sentence summary of the conversation and customer intent."),
  sentiment: z
    .string()
    .default("Neutral")
    .describe("Positive, Neutral, or Negative."),
  probabilityOfConversion: z
    .number()
    .default(50)
    .describe("0 to 100 estimated probability."),
  nextAction: z
    .string()
    .default("")
    .describe("Next step recommendation for the sales representative."),
  triggerActions: z
    .object({
      createFollowUp: z
        .boolean()
        .default(false)
        .describe("Set true if user requested a callback or follow-up contact."),
      followUpNotes: z.string().default("").describe("Notes for the callback."),
      followUpDate: z
        .string()
        .default("")
        .describe("Date string for follow up if requested (e.g. YYYY-MM-DD)."),
      addNote: z
        .string()
        .default("")
        .describe("Any specific internal notes for the CRM lead record."),
    })
    .default({
      createFollowUp: false,
      followUpNotes: "",
      followUpDate: "",
      addNote: "",
    }),
});

/**
 * Auto-assign representative if currently Unassigned or not set
 */
const autoAssignRepresentative = async (lead) => {
  let assignedRep = lead.assignedTo;
  if (!assignedRep || assignedRep === "Unassigned") {
    const representatives = await User.find({ role: "sales person" }).sort({
      _id: 1,
    });
    if (representatives && representatives.length > 0) {
      let state = await AssignmentState.findOne({ key: "leadAssignment" });
      if (!state) {
        state = await AssignmentState.create({
          key: "leadAssignment",
          lastAssignedIndex: -1,
        });
      }
      let nextIndex = state.lastAssignedIndex + 1;
      if (nextIndex >= representatives.length) nextIndex = 0;

      assignedRep = representatives[nextIndex].name;
      state.lastAssignedIndex = nextIndex;
      await state.save();

      lead.assignedTo = assignedRep;
      await lead.save();

      // Create Lead Notification
      const assignedAgent = await User.findOne({ name: assignedRep });
      const targetUsers = assignedAgent ? [assignedAgent._id] : [];
      await Notification.create({
        title: "Lead Assigned by AI",
        message: `Lead ${lead.name} has been assigned to ${assignedRep}.`,
        type: "lead_update",
        targetRoles: ["sales manager"],
        targetUsers: targetUsers,
      });
    } else {
      assignedRep = "Our team";
    }
  }
  return assignedRep;
};

export const generateAIResponse = async (leadId, incomingText) => {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      console.error(
        "GEMINI_API_KEY is not defined in the environment variables.",
      );
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      throw new Error(`Lead not found with ID: ${leadId}`);
    }

    // Auto-assign representative if currently Unassigned or not set
    const assignedRep = await autoAssignRepresentative(lead);

    const modelGeminiPrimary = new ChatGoogleGenerativeAI({
      model: "gemini-3.1-flash-lite",
      temperature: 0,
      maxOutputTokens: 1500,
      apiKey: process.env.GEMINI_API_KEY,
    });

    // History
    const totalMessagesCount = await Message.countDocuments({ leadId });
    const historyDocs = await Message.find({ leadId })
      .sort({ timestamp: -1 })
      .limit(8);
    const history = historyDocs.reverse();
    const formattedHistory = history.map((msg) => ({
      role: msg.direction === "incoming" ? "user" : "model",
      text: msg.text,
    }));
    const chatHistoryLog = formattedHistory
      .map((h) => `${h.role === "user" ? "Customer" : "AI Agent"}: ${h.text}`)
      .join("\n");

    const lastAgentMessage = [...formattedHistory]
      .reverse()
      .find((h) => h.role === "model");
    const lastAgentMessageText = lastAgentMessage
      ? lastAgentMessage.text
      : "(none — this is the first message to this lead)";

    // LLM Query Rewriting for Better RAG
    let optimizedSearchQuery = incomingText.trim();
    if (chatHistoryLog && incomingText.split(" ").length < 6) {
      try {
        const rewritePrompt = `Given the following conversation history and the latest user message, rewrite the latest message into a standalone, detailed search query that can be used to search a vector database. Only return the search query and nothing else. Do not answer the question.
History:
${chatHistoryLog}
Latest Message: ${incomingText}`;
        const rewriteRes = await modelGeminiPrimary.invoke([
          ["user", rewritePrompt],
        ]);
        if (rewriteRes && rewriteRes.content) {
          optimizedSearchQuery = rewriteRes.content.trim();
        }
      } catch (err) {
        console.warn(
          "Query rewrite failed, falling back to original text.",
          err.message,
        );
      }
    }

    // RAG Context Retrieval from Qdrant
    const vs = await initVectorStore();
    let ragContext = "";
    if (vs) {
      const userIntent = lead.aiQualification?.intent || (lead.services && lead.services.join(", ")) || "";
      const finalSearchQuery = userIntent
        ? `${userIntent} ${optimizedSearchQuery}`
        : optimizedSearchQuery;

      const results = await vs.similaritySearch(finalSearchQuery, 15);
      const documents = results.map((r) => r.pageContent);

      if (documents.length > 0 && process.env.VOYAGE_API_KEY) {
        try {
          const voyageClient = new VoyageAIClient({
            apiKey: process.env.VOYAGE_API_KEY,
          });
          const rerankRes = await voyageClient.rerank({
            query: finalSearchQuery,
            documents: documents,
            model: "rerank-2.5",
            topK: 5,
          });
          console.log("rerankRes.data", rerankRes.data);
          if (rerankRes.data) {
            ragContext = rerankRes.data
              .map((item) => item.document || documents[item.index])
              .join("\n\n");
          } else {
            ragContext = documents.slice(0, 5).join("\n\n");
          }
        } catch (rerankError) {
          console.warn("Voyage reranking failed:", rerankError.message);
          ragContext = documents.slice(0, 5).join("\n\n");
        }
      } else if (documents.length > 0) {
        ragContext = documents.slice(0, 5).join("\n\n");
      }
    }

    const systemPrompt = `You are a friendly, human representative working at Petsfolio. Your goal is to convert leads, assist customers, provide support, and answer inquiries from potential service partners or job seekers. NEVER mention that you are an AI or a bot. Act completely human.

KNOWLEDGE BASE:
${ragContext || "(No relevant information found in Knowledge Base)"}

APP DOWNLOAD LINKS:
- Android (Google Play): https://play.google.com/store/apps/details?id=com.petsfolio.customer&hl=en
- iOS (App Store): https://apps.apple.com/in/app/petsfolio-pet-parent/id6746559723

LEAD CONTEXT:
Name: ${lead.name} | Phone: ${lead.phone} | Rep: ${assignedRep}
Total Conversation Turns: ${totalMessagesCount}
Already Collected:
- Lead Service Interest: ${(lead.services && lead.services.join(", ")) || "Missing"}
- AI Extracted Intent: ${lead.aiQualification?.intent || "Missing"}
- City: ${lead.aiQualification?.city || "Missing"}
- Pet Type: ${lead.aiQualification?.petType || "Missing"}

HISTORY:
${chatHistoryLog || "(None)"}

LAST AGENT MSG: "${lastAgentMessageText}"
USER MSG: "${incomingText}"

CRITICAL RULES:
1. HUMAN TONE: Communicate EXACTLY like a real human. Be warm, empathetic, and casual (e.g., use "Hey", "Sure thing", "Got it"). DO NOT sound robotic, overly formal, or like an AI assistant.
2. INITIATE & CONVERT (PACING): Actively initiate the conversation to convert the lead. If information is missing (service needed, pet type, breed, age, city), gently ask for it. CRITICAL: Instead of asking one by one, you can ask for multiple missing fields (like pet details and city) at once. Ask at most 3 questions per message to gather data efficiently without overwhelming the user. If this is the first interaction (Total Conversation Turns is 1 or 0) and the user has not mentioned a specific service, you MUST provide a bulleted list of all our available services (Training, Grooming, Walking, Pet Sitting, Pet Insurance) for them to choose from.
3. STRICT KNOWLEDGE BASE ONLY: You MUST answer their questions ONLY using the information provided in the KNOWLEDGE BASE. Do NOT use outside knowledge. Answer anything related to our application based on the document.
4. SHORT & BULLETED RESPONSES: All your replies MUST be short (maximum 50 words). You MUST format your responses using bullet points. Do NOT write large paragraphs.
5. MISSING INFO / FALLBACK: If you DO NOT have the proper information in the KNOWLEDGE BASE to answer, politely inform the user. ONLY share the APP DOWNLOAD LINKS if the 'Total Conversation Turns' is 5 or more. Do NOT mention any sales representative names and do NOT tell them that someone will contact them. NEVER use your own knowledge to answer.
6. CONTEXT AWARENESS: Always use the LEAD CONTEXT and HISTORY to understand what the user is asking.
7. GUIDANCE: Direct the user to download and use the Petsfolio Client Application to book their service ONLY IF the 'Total Conversation Turns' is 5 or more. Do NOT share the app links in early messages.
8. PASSIVE EXTRACTION: Always extract 'Pet Type', 'Breed', 'Age', 'City', and 'Intent' into the corresponding JSON fields if mentioned.
9. MEDIA ATTACHMENTS: If the user sends an image/video/attachment, respond with: "I noticed you sent media! I can only read text messages right now. Could you please describe your query in text?"
10. COMPLETION & HUMAN HANDOFF: If the user explicitly asks for a human, says 'yes' to support, or if the question is completely off-topic (NOTE: inquiries about service providers, jobs, walkers, or cows are NOT off-topic), politely inform them that you are transferring them to human support and set disableAI=true. Do NOT mention any sales representative names and do NOT say that someone will contact them.
11. WHATSAPP FORMATTING (CRITICAL): Your response MUST be formatted for WhatsApp. Use short, punchy sentences, bullet points, double line breaks, and emojis.
12. RESTRICTIONS: NEVER ask if the pet is already registered in our app. NEVER ask for Pet Name, Gender, Address, Dates/Times, Packages, Payment, Phone, Email, or OTP. If the enquiry is related to a service provider, job, or cow, do NOT ask for or collect any pet details. Instead, just ask for their City and exact requirement.
13. OUTPUT: Respond purely via the structured JSON schema.`;

    let parsed = null;
    let lastError = null;

    console.log("Generating AI response with Gemini...");

    try {
      const structuredModel =
        modelGeminiPrimary.withStructuredOutput(qualificationSchema);
      parsed = await structuredModel.invoke([
        ["system", systemPrompt],
        ["user", incomingText],
      ]);
      console.log("Success with model: Gemini");
    } catch (e) {
      lastError = e;
      console.warn("Model Gemini failed. Error message:", e.message);
    }

    if (!parsed) {
      console.error(
        "All AI models failed. Using hard fallback.",
        lastError?.message,
      );
      parsed = {
        reply:
          "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly.",
        disableAI: true,
        summary: "System failure. Handoff to human.",
        qualification: {},
        tags: [],
        sentiment: "Neutral",
        probabilityOfConversion: 50,
        nextAction: "Contact lead manually due to AI failure",
        triggerActions: {
          createFollowUp: false,
          followUpNotes: "",
          followUpDate: "",
          addNote: "",
        },
      };
    }

    await saveExtractedLeadData(
      lead,
      parsed,
      incomingText,
      systemPrompt + "\n\nUser Message: " + incomingText,
      "openrouter/auto (OpenRouter + Qdrant)",
    );

    return (
      parsed.reply ||
      "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly."
    );
  } catch (error) {
    console.error("Error in AI Service generateAIResponse:", error);
    return "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly.";
  }
};

/**
 * Shared helper to apply structured extraction updates to the Lead document,
 * create follow-ups, append notes, and log AI activity.
 */
export const saveExtractedLeadData = async (
  lead,
  parsed,
  incomingText,
  promptText,
  modelName = "gemini-3.1-flash-lite",
) => {
  const leadId = lead._id;

  await AILog.create({
    leadId,
    prompt: promptText,
    response: JSON.stringify(parsed, null, 2),
    model: modelName,
    tokensUsed: 0,
  });

  const updatePayload = {};

  if (parsed.qualification) {
    const aiData = parsed.qualification || {};
    const prevQual = lead.aiQualification || {};

    updatePayload.lastMessage = incomingText;
    updatePayload.lastActivity = new Date();
    updatePayload.aiQualification = {
      petType: aiData.petType || prevQual.petType || "",
      breed: aiData.breed || prevQual.breed || "",
      petAge: aiData.petAge || prevQual.petAge || "",
      city: aiData.city || prevQual.city || "",
      intent: aiData.intent || prevQual.intent || "",
      specialRequirements:
        aiData.specialRequirements || prevQual.specialRequirements || "",
      urgency: aiData.urgency || prevQual.urgency || "Medium",
      interestScore: aiData.interestScore ?? prevQual.interestScore ?? 0,
    };

    const validServices = [
      "Grooming",
      "Training",
      "Walking",
      "Pet Sitting",
      "Pet Insurance",
      "Job Inquiry",
      "Cow Services",
      "General Enquiry",
    ];
    const rawIntent = aiData.intent || "";

    let matchedService = validServices.find(
      (s) => s.toLowerCase() === rawIntent.toLowerCase(),
    );
    if (!matchedService) {
      const combinedText = `${rawIntent} ${incomingText}`.toLowerCase();
      if (combinedText.includes("groom")) matchedService = "Grooming";
      else if (combinedText.includes("train")) matchedService = "Training";
      else if (combinedText.includes("walk")) matchedService = "Walking";
      else if (combinedText.includes("sit")) matchedService = "Pet Sitting";
      else if (combinedText.includes("insur")) matchedService = "Pet Insurance";
      else if (
        combinedText.includes("job") ||
        combinedText.includes("work") ||
        combinedText.includes("provider") ||
        combinedText.includes("partner")
      )
        matchedService = "Job Inquiry";
      else if (
        combinedText.includes("cow") ||
        combinedText.includes("cattle")
      )
        matchedService = "Cow Services";
    }

    if (matchedService) {
      if (!lead.services || !lead.services.includes(matchedService)) {
        updatePayload.services = [...(lead.services || []), matchedService];
      }
    }

    const resolvedCity = aiData.city || prevQual.city;
    if (resolvedCity) updatePayload.city = resolvedCity;
  }

  if (parsed.tags && parsed.tags.length > 0) {
    const currentTags = lead.aiTags || [];
    const newTags = new Set([...currentTags, ...parsed.tags]);
    updatePayload.aiTags = Array.from(newTags);
  }

  if (parsed.summary) updatePayload.conversationSummary = parsed.summary;
  if (parsed.sentiment) updatePayload.sentiment = parsed.sentiment;
  if (parsed.probabilityOfConversion)
    updatePayload.probabilityOfConversion = parsed.probabilityOfConversion;
  if (parsed.nextAction) updatePayload.nextAction = parsed.nextAction;

  if (parsed.disableAI) {
    updatePayload.aiEnabled = false;
    await Notification.create({
      title: "AI Disabled - Human Takeover Needed",
      message: `AI has been disabled for ${lead.name} (${lead.phone}) because they requested human support or the AI reached its limit.`,
      type: "lead_update",
      targetRoles: ["sales manager", "sales person"],
    });
  }

  const updatedLead = await Lead.findByIdAndUpdate(leadId, updatePayload, {
    new: true,
  });

  if (
    parsed.triggerActions?.createFollowUp &&
    parsed.triggerActions?.followUpDate
  ) {
    const existingFollowUp = await Followup.findOne({
      leadId,
      date: parsed.triggerActions.followUpDate,
    });

    if (!existingFollowUp) {
      await Followup.create({
        leadId,
        leadName: lead.name,
        type: "WhatsApp",
        date: parsed.triggerActions.followUpDate,
        time: "10:00 AM",
        priority:
          parsed.qualification?.urgency === "High" ? "High" : "Medium",
        notes:
          parsed.triggerActions.followUpNotes ||
          "Follow-up scheduled by AI Agent",
        author: "AI Agent",
      });

      await Notification.create({
        title: "Followup Created by AI",
        message: `AI Agent created a follow-up task for lead ${lead.name} on ${parsed.triggerActions.followUpDate}.`,
        type: "lead_update",
        targetRoles: ["sales manager", "sales person"],
      });
    }
  }

  if (parsed.triggerActions?.addNote) {
    await Lead.findByIdAndUpdate(leadId, {
      $set: {
        notes:
          (lead.notes || "") +
          "\n\n[AI Note]: " +
          parsed.triggerActions.addNote,
      },
    });
  }

  return updatedLead;
};

/**
 * Silent AI Lead Data Extraction
 * Extracts structured lead data from the customer's message and chat history,
 * saves all extracted fields to the database, but DOES NOT generate any user reply.
 */
export const extractAndStoreLeadData = async (leadId, incomingText) => {
  try {
    const lead = await Lead.findById(leadId);
    if (!lead) {
      console.warn(`[AI EXTRACTION] Lead not found with ID: ${leadId}`);
      return null;
    }

    const assignedRep = await autoAssignRepresentative(lead);

    const modelGeminiPrimary = new ChatGoogleGenerativeAI({
      model: "gemini-3.1-flash-lite",
      temperature: 0,
      maxOutputTokens: 1000,
      apiKey: process.env.GEMINI_API_KEY,
    });

    // History
    const historyDocs = await Message.find({ leadId })
      .sort({ timestamp: -1 })
      .limit(8);
    const history = historyDocs.reverse();
    const formattedHistory = history.map((msg) => ({
      role: msg.direction === "incoming" ? "user" : "model",
      text: msg.text,
    }));
    const chatHistoryLog = formattedHistory
      .map((h) => `${h.role === "user" ? "Customer" : "Representative"}: ${h.text}`)
      .join("\n");

    const extractionPrompt = `You are a specialized CRM lead data extraction agent for Petsfolio.
Analyze the customer's incoming message and conversation history, and extract structured data to update our CRM records.
DO NOT generate any chat reply for the customer. Strictly extract the fields according to the schema.

LEAD CONTEXT:
Name: ${lead.name} | Phone: ${lead.phone} | Assigned Rep: ${assignedRep}
Current Services: ${(lead.services && lead.services.join(", ")) || "None"}
Current Intent: ${lead.aiQualification?.intent || "None"}
Current City: ${lead.city || lead.aiQualification?.city || "None"}
Current Pet Type: ${lead.aiQualification?.petType || "None"}
Current Breed: ${lead.aiQualification?.breed || "None"}

CONVERSATION HISTORY:
${chatHistoryLog || "(None)"}

LATEST CUSTOMER MESSAGE:
"${incomingText}"

EXTRACTION RULES:
1. Passive Extraction: Extract 'Pet Type' (Dog, Cat, etc.), 'Breed', 'Pet Age', 'City'/'Locality', and 'Intent' (service needed) from the message and history.
2. Valid Services: Grooming, Training, Walking, Pet Sitting, Pet Insurance, Job Inquiry, Cow Services, General Enquiry.
3. Special Requirements: Note any mentions of aggression, allergies, vaccinations, specific dates, or special handling.
4. Follow-up: If the customer asks for a callback or specifies when to reach out, set createFollowUp=true with followUpDate and followUpNotes.
5. Accuracy: If a field is not mentioned or cannot be inferred, leave it as empty string. Do not hallucinate details.
6. Output: Respond purely via the structured JSON schema.`;

    let parsed = null;
    try {
      const structuredModel =
        modelGeminiPrimary.withStructuredOutput(leadExtractionSchema);
      parsed = await structuredModel.invoke([
        ["system", extractionPrompt],
        ["user", incomingText],
      ]);
      console.log(
        `[AI EXTRACTION] Successfully extracted lead data for ${lead.name} (${lead.phone})`,
      );
    } catch (e) {
      console.warn("[AI EXTRACTION] Gemini extraction failed:", e.message);
    }

    if (!parsed) {
      parsed = {
        qualification: {},
        tags: [],
        summary: incomingText.substring(0, 100),
        sentiment: "Neutral",
        probabilityOfConversion: 50,
        nextAction: "Review lead manually",
        triggerActions: {
          createFollowUp: false,
          followUpNotes: "",
          followUpDate: "",
          addNote: "",
        },
      };
    }

    const updatedLead = await saveExtractedLeadData(
      lead,
      parsed,
      incomingText,
      extractionPrompt + "\n\nUser Message: " + incomingText,
      "gemini-3.1-flash-lite (silent extraction)",
    );

    return updatedLead;
  } catch (err) {
    console.error("Error in extractAndStoreLeadData:", err);
    return null;
  }
};
