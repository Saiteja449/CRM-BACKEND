import { GoogleGenerativeAI } from "@google/generative-ai";
import Lead from "../models/Lead.js";
import Message from "../models/Message.js";
import KnowledgeBase from "../models/KnowledgeBase.js";
import AILog from "../models/AILog.js";
import Followup from "../models/Followup.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";

export const generateAIResponse = async (leadId, incomingText) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is not configured in .env!");
      return "I'll connect you with one of our team members.";
    }
    const lead = await Lead.findById(leadId);
    if (!lead) {
      throw new Error(`Lead not found with ID: ${leadId}`);
    }

    // Auto-assign representative if currently Unassigned or not set
    let assignedRep = lead.assignedTo;
    if (!assignedRep || assignedRep === "Unassigned") {
      const representatives = await User.find({ role: "sales person" }).sort({ _id: 1 });
      if (representatives && representatives.length > 0) {
        let state = await AssignmentState.findOne({ key: "leadAssignment" });
        if (!state) {
          state = await AssignmentState.create({
            key: "leadAssignment",
            lastAssignedIndex: -1,
          });
        }
        let nextIndex = state.lastAssignedIndex + 1;
        if (nextIndex >= representatives.length) {
          nextIndex = 0;
        }
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

    const kbItems = await KnowledgeBase.find({ isActive: true });
    const kbContext = kbItems
      .map(
        (item) =>
          `[${item.type.toUpperCase()}] ${item.title}:\n${item.content}`,
      )
      .join("\n\n");

    const history = await Message.find({ leadId })
      .sort({ timestamp: 1 })
      .limit(15);

    const formattedHistory = history.map((msg) => ({
      role: msg.direction === "incoming" ? "user" : "model",
      text: msg.text,
    }));

    const chatHistoryLog = formattedHistory
      .map((h) => `${h.role === "user" ? "Customer" : "AI Agent"}: ${h.text}`)
      .join("\n");

    const agents = await User.find({ role: "sales person" }).select("name");
    const agentList = agents.map((a) => a.name).join(", ");

    const systemPrompt = `You are a friendly, warm, and professional Customer Success Manager for Petsfolio, a premium pet care and services company.
Your goal is to greet the customer naturally and collect the information we need to register their requirement.

COMPANY KNOWLEDGE BASE:
${kbContext}

SERVICES WE OFFER (with eligible pet types):
| Service        | Dog | Cat |
|----------------|-----|-----|
| Training       | ✅  | ❌  |
| Grooming       | ✅  | ✅  |
| Walking        | ✅  | ❌  |
| Pet Sitting    | ✅  | ❌  |
| Pet Insurance  | ✅  | ✅  |

PET TYPES WE SERVE:
We serve ONLY dogs and cats. We do NOT offer any services for any other animals (e.g. birds, rabbits, hamsters, etc.). If a customer mentions an unsupported pet type, politely explain that we only serve dogs and cats, and list the services we offer.

DATA COLLECTION RULES:
- If the customer wants Pet Insurance:
  We do NOT need to collect Pet Breed, Pet Age, City, or Health Issues. Once you know their service is Pet Insurance and their pet type is Dog or Cat, you have all required information and should proceed to COMPLETION immediately.
- If the customer wants Grooming, Walking, Training, or Pet Sitting (any service other than Pet Insurance):
  You MUST collect the following 5 details from the user:
  1. Pet Type (Dog / Cat)
  2. Pet Breed
  3. Pet Age
  4. City
  5. Health Issues (allergies, skin conditions, illnesses, special requirements, etc. If none, write "None").
  Do NOT consider collection complete until all these 5 details are collected.

LEAD CONTEXT:
- Name: ${lead.name}
- Phone: ${lead.phone}
- Assigned Representative: ${assignedRep}
- Status: ${lead.status || "New"}
- Already Collected Details (anything marked "Missing" still needs to be asked):
  * Service: ${lead.aiQualification?.intent || "Missing"}
  * City: ${lead.aiQualification?.city || "Missing"}
  * Pet Type: ${lead.aiQualification?.petType || "Missing"}
  * Breed: ${lead.aiQualification?.breed || "Missing"}
  * Pet Age: ${lead.aiQualification?.petAge || "Missing"}
  * Health Issues: ${lead.aiQualification?.specialRequirements || "Missing"}

CONVERSATION HISTORY:
${chatHistoryLog || "(No prior history)"}

LATEST CUSTOMER MESSAGE: 
"${incomingText}"

---

INSTRUCTIONS:

1. EXTRACT FIRST, THEN ASK (STRICT RULE):
   Before asking any question, scan the LATEST MESSAGE and the CONVERSATION HISTORY for any details the customer has already provided (service, pet type, city, breed, age, health issues). Populate them in the JSON output immediately. 
   - NEVER ask a question if the user has already provided that detail in their current or previous messages. For example, if you ask "What type of pet do you have?" and the user replies "I have a dog that is a German Shepherd", extract BOTH Pet Type ("Dog") and Breed ("German Shepherd") instantly and do NOT ask for the breed in the next turn.

2. SERVICE + PET TYPE VALIDATION:
   If the customer asks for a service we do not offer for cats (Training, Walking, or Pet Sitting), you MUST politely explain that we do not offer that service for cats. List the services we DO offer for cats (Grooming and Pet Insurance), and ask if they would like one of those instead.
   - Example: "We currently offer Training only for dogs 🐶. For cats, we offer Grooming and Pet Insurance! Would you like either of those?"
   If the combination of service and pet type is invalid, set the intent field to "" (empty) so they can choose a valid service.

3. STRICT RULE — ONE QUESTION PER MESSAGE:
   Your reply must contain exactly ONE question. Never combine two questions in the same message. For example, do NOT ask for both pet type and breed at the same time. Ask for "Pet Type" and "Pet Breed" as separate questions in separate turns.

4. CONVERSE NATURALLY:
   - Talk like a real human on WhatsApp — short, friendly, warm, polite, and natural. Use emojis naturally but sparingly.
   - React to what the customer says before asking the next question.
   - Do NOT mention you are an AI or a bot.

5. COMPLETION & CLOSING:
   Once all required details are collected (or immediately if the service is Pet Insurance and you know the pet type is Dog or Cat):
   - Send a warm, polite, and natural closing message that includes the Assigned Representative's name: ${assignedRep}. For example: "Thank you for all the details! 🎉 ${assignedRep} will reach out to you shortly to finalize everything. Have a wonderful day!"
   - Set "disableAI" to true in the returned JSON so that a human takes over.
   - Do NOT ask any more questions after this.

6. NO PRICING:
   Never discuss pricing. If the customer asks, reply: "I'll connect you with our team — they'll share the best options and pricing for you! 😊" and continue collecting missing details.

7. ANGRY / HUMAN REQUEST:
   If the customer is angry, asks for a human/agent/call, or you cannot help, set "disableAI" to true.

8. JSON FIELD RULES:
   - For any field NOT yet mentioned or collected, output an empty string "". Do NOT use placeholder text.
   - "intent" should contain one of: "Training", "Grooming", "Walking", "Pet Sitting", "Pet Insurance", or "" if not yet determined. Ensure this is updated instantly if the user mentions needing a service during the conversation.
   - "urgency" defaults to "Medium".
   - Calculate interestScore (0-10) based on engagement.
   - Generate tags (e.g. "Hot Lead", "Interested").
   - Generate a one-sentence summary.
   - If the customer asks for a callback or follow-up, set "createFollowUp" to true with date and notes.

You must respond in JSON format ONLY matching this schema:
{
  "reply": "Your warm reply text",
  "qualification": {
    "petType": "",
    "breed": "",
    "petAge": "",
    "city": "",
    "intent": "",
    "specialRequirements": "",
    "urgency": "Medium",
    "interestScore": 5
  },
  "tags": [],
  "disableAI": false,
  "summary": "",
  "sentiment": "Neutral",
  "probabilityOfConversion": 50,
  "nextAction": "",
  "triggerActions": {
    "createFollowUp": false,
    "followUpNotes": "",
    "followUpDate": "",
    "addNote": ""
  }
}`;

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
    });

    const rawResponse = result.response.text();
    console.log("Gemini Raw JSON Response:", rawResponse);

    let parsed;
    try {
      parsed = JSON.parse(rawResponse);
    } catch (parseError) {
      console.error(
        "Failed to parse Gemini JSON output. Attempting cleanup...",
        parseError,
      );
      parsed = {
        reply: "I'll connect you with one of our team members.",
        disableAI: true,
      };
    }

    await AILog.create({
      leadId,
      prompt: systemPrompt,
      response: rawResponse,
      model: "gemini-2.5-flash",
      tokensUsed: 0, // Free tier / approximate
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

      // Also update the top-level Lead fields from AI qualification
      const resolvedIntent = aiData.intent || prevQual.intent;
      if (resolvedIntent) {
        updatePayload.service = resolvedIntent;
      }
      const resolvedCity = aiData.city || prevQual.city;
      if (resolvedCity) {
        updatePayload.city = resolvedCity;
      }
    }

    if (parsed.tags && parsed.tags.length > 0) {
      const currentTags = lead.aiTags || [];
      const newTags = new Set([...currentTags, ...parsed.tags]);
      updatePayload.aiTags = Array.from(newTags);
    }

    if (parsed.summary) {
      updatePayload.conversationSummary = parsed.summary;
    }
    if (parsed.sentiment) {
      updatePayload.sentiment = parsed.sentiment;
    }
    if (parsed.probabilityOfConversion) {
      updatePayload.probabilityOfConversion = parsed.probabilityOfConversion;
    }
    if (parsed.nextAction) {
      updatePayload.nextAction = parsed.nextAction;
    }

    if (parsed.disableAI) {
      updatePayload.aiEnabled = false;
      await Notification.create({
        title: "AI Disabled - Human Takeover Needed",
        message: `AI has been disabled for ${lead.name} (${lead.phone}) because they requested human support or the AI reached its limit.`,
        type: "lead_update",
        targetRoles: ["sales manager", "sales person"],
      });
    }

    // Note: The AI chatbot is not authorized to update the lead status. Status should remain unchanged until human updates it.

    await Lead.findByIdAndUpdate(leadId, updatePayload);

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

    return parsed.reply || "I'll connect you with one of our team members.";
  } catch (error) {
    console.error("Error in AI Service generateAIResponse:", error);
    return "I'll connect you with one of our team members.";
  }
};

export const getReplySuggestions = async (leadId) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return [];

    const lead = await Lead.findById(leadId);
    if (!lead) return [];

    const kbItems = await KnowledgeBase.find({ isActive: true });
    const kbContext = kbItems
      .map(
        (item) =>
          `[${item.type.toUpperCase()}] ${item.title}:\n${item.content}`,
      )
      .join("\n\n");

    const history = await Message.find({ leadId })
      .sort({ timestamp: 1 })
      .limit(10);

    const chatHistoryLog = history
      .map(
        (h) =>
          `${h.direction === "incoming" ? "Customer" : "Agent"}: ${h.text}`,
      )
      .join("\n");

    const systemPrompt = `You are a helper backend agent for a human representative managing a pet care lead in the CRM.
Review the knowledge base and the conversation history.
Provide 3 helpful, distinct, and short reply suggestions (less than 20 words each) that the agent can choose to send next.

Company Knowledge Base:
${kbContext}

Lead Context:
- Name: ${lead.name}
- Status: ${lead.status}

Conversation History:
${chatHistoryLog}

You must return a JSON array containing exactly 3 strings:
["Suggestion 1", "Suggestion 2", "Suggestion 3"]`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
    });

    const rawResponse = result.response.text();
    return JSON.parse(rawResponse);
  } catch (err) {
    console.error("Failed to generate suggestions:", err);
    return [];
  }
};
