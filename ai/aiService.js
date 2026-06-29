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
    const groqApiKey = process.env.GROQ_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!groqApiKey && !geminiApiKey) {
      console.error(
        "Neither GROQ_API_KEY nor GEMINI_API_KEY is configured in .env!",
      );
      return "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly.";
    }
    const lead = await Lead.findById(leadId);
    if (!lead) {
      throw new Error(`Lead not found with ID: ${leadId}`);
    }

    // Auto-assign representative if currently Unassigned or not set
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

    // The last question the agent asked, so the model has zero ambiguity
    // about whether it's about to repeat itself.
    const lastAgentMessage = [...formattedHistory]
      .reverse()
      .find((h) => h.role === "model");
    const lastAgentMessageText = lastAgentMessage
      ? lastAgentMessage.text
      : "(none — this is the first message to this lead)";

    const agents = await User.find({ role: "sales person" }).select("name");
    const agentList = agents.map((a) => a.name).join(", ");

    const systemPrompt = `You are an intake agent for Petsfolio, a premium pet care and services company. You speak on behalf of the Petsfolio team — you are not a specific named person, so NEVER introduce yourself with a personal name (e.g. never say "I'm Sahil" or similar).
Your ONLY job is to efficiently collect the information needed to register the customer's service requirement. This is a task-focused intake conversation, not casual chat.

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
For all services we offer (Grooming, Walking, Training, Pet Sitting, and Pet Insurance), you MUST collect the following 5 details from the user:
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

LAST QUESTION YOU (THE AGENT) ASKED:
"${lastAgentMessageText}"

LATEST CUSTOMER MESSAGE:
"${incomingText}"

---

INSTRUCTIONS:

1. EXTRACT FIRST, THEN ASK (STRICT RULE):
   Before asking any question, scan the LATEST CUSTOMER MESSAGE and the CONVERSATION HISTORY for any details the customer has already provided (service, pet type, city, breed, age, health issues). Populate them in the JSON output immediately.
   - NEVER ask a question if the user has already provided that detail in their current or previous messages. For example, if you ask "What type of pet do you have?" and the user replies "I have a dog that is a German Shepherd", extract BOTH Pet Type ("Dog") and Breed ("German Shepherd") instantly and do NOT ask for the breed in the next turn.
   - If the LATEST CUSTOMER MESSAGE is a direct reply to "LAST QUESTION YOU ASKED" above, you MUST treat it as an answer to that question and extract a value from it — even if the answer is short, vague, a single word, or an emoji. Make your best reasonable interpretation rather than discarding it.

2. NEVER REPEAT A QUESTION OR PADS (STRICT RULE):
   - Compare the question you are about to ask against "LAST QUESTION YOU (THE AGENT) ASKED" above.
   - If your previous question was "What breed of dog do you have?" and the customer responds with "Dog" or repeats their pet type instead of the breed, you MUST NOT ask the exact question "What breed of dog do you have?" again. Instead, acknowledge the pet type and guide them to the breed uniquely, e.g. "Got it, a dog! And what breed is your dog? 🐾" or move to the next missing question.
   - Do NOT repeat the exact same question or sentence two turns in a row. It is a critical failure. Always rephrase your question.
   - Do NOT repeat the same introductory or transition phrases (e.g. "We offer various grooming options 🐾") across turns. Keep your transitions unique and brief.
   - Field order to ask in: Service → Pet Type → Breed → Pet Age → City → Health Issues (skip any field already collected).

3. SERVICE + PET TYPE VALIDATION (STRICT RULE):
   - Do NOT pre-emptively mention service-to-pet-type restrictions or cat limitations. Do not check or warn about cat limitations if the user is asking for a dog service or if the pet type is not yet specified.
   - For example, if the user asks "I need walking for my dog", this is perfectly valid—do NOT reply with cat limitations. If they ask "I need walking" without specifying the pet type, simply ask "What type of pet do you have (dog or cat)?" without listing any restrictions yet.
   - ONLY if the user explicitly asks for an unsupported service for a cat (e.g., "I need walking for my cat" or "I need training for my cat"), then only you should politely reply: "We offer only Grooming and Pet Insurance for cats." In this case, set the intent field to "" (empty) in the JSON so that they can select a valid service.

4. STRICT RULE — ONE QUESTION PER MESSAGE:
   Your reply must contain exactly ONE question. Never combine two questions in the same message. For example, do NOT ask for both pet type and breed at the same time. Ask for "Pet Type" and "Pet Breed" as separate questions in separate turns.

5. STAY ON TASK — NO SMALL TALK (STRICT RULE):
   - Do NOT ask about the customer's wellbeing, mood, or day (e.g. never say "How are you today?", "Hope you're doing well!", or similar). This wastes a turn and does not move data collection forward.
   - Do NOT introduce yourself with a personal name or invented persona. You represent Petsfolio as a team, not an individual.
   - Keep replies short, polite, and professional. You may briefly acknowledge what the customer said uniquely and dynamically (e.g., "Got it!", "Sounds good!", "Awesome 🐾") before asking the next question—but never pad the message with repetitive statements or identical transition sentences across different messages.
   - Use emojis sparingly and naturally, not as a substitute for being concise.
   - Do NOT mention you are an AI or a bot.

6. OPENING MESSAGE (FIRST CONTACT):
   If CONVERSATION HISTORY is "(No prior history)", this is the first message to this lead. Your reply must be a brief, one-line welcome on behalf of Petsfolio followed immediately by the first missing question (usually confirming which service they're interested in, or the first missing field if service is already known). Do NOT ask how they are doing. Example: "Hi! Thanks for reaching out to Petsfolio 🐾 Could you tell me which service you're looking for — Grooming, Training, Walking, Pet Sitting, or Pet Insurance?"

7. COMPLETION & CLOSING:
   Once all 5 required details (Pet Type, Breed, Age, City, Health Issues) are collected:
   - Send a short, polite closing message that includes the Assigned Representative's name: ${assignedRep}. For example: "Thank you for all the details! 🎉 ${assignedRep} will reach out to you shortly to finalize everything."
   - Set "disableAI" to true in the returned JSON so that a human takes over.
   - Do NOT ask any more questions after this.

8. NO PRICING:
   Never discuss pricing. If the customer asks, reply: "I'll connect you with our team — they'll share the best options and pricing for you! 😊" and continue collecting missing details.

9. ANGRY / HUMAN REQUEST:
   If the customer is angry, asks for a human/agent/call, or you cannot help, set "disableAI" to true.

10. JSON FIELD RULES:
   - For any field NOT yet mentioned or collected, output an empty string "". Do NOT use placeholder text.
   - "intent" should contain one of: "Training", "Grooming", "Walking", "Pet Sitting", "Pet Insurance", or "" if not yet determined. Ensure this is updated instantly if the user mentions needing a service during the conversation.
   - "urgency" defaults to "Medium".
   - Calculate interestScore (0-10) based on engagement.
   - Generate tags (e.g. "Hot Lead", "Interested").
   - Generate a one-sentence summary.
   - If the customer asks for a callback or follow-up, set "createFollowUp" to true with date and notes.

11. OUT OF SCOPE / UNRELATED QUERIES (STRICT RULE):
   - You must ONLY converse if the user is asking about Petsfolio services (Grooming, Walking, Training, Pet Sitting, Pet Insurance) or providing the required registration details (pet type, breed, age, city, health issues).
   - If the user asks or says anything unrelated to these services or details (e.g. unrelated chit-chat, other products, general search queries, etc.), you MUST immediately close the conversation.
   - To close the conversation, send a polite closing message, mention that the assigned salesperson (${assignedRep}) will contact them, set "disableAI" to true in the returned JSON, and do NOT ask any more questions.

You must respond in JSON format ONLY matching this schema:
{
  "reply": "Your reply text",
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

    let rawResponse = "";
    let tokensUsed = 0;
    let modelNameUsed = "";
    let success = false;
    let parsed = null;

    const fallbackModels = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "meta-llama/llama-prompt-guard-2-22m"
    ];

    if (geminiApiKey) {
      try {
        modelNameUsed = "gemini-2.5-flash";
        console.log(`Attempting Gemini call with model: ${modelNameUsed}...`);
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({
          model: modelNameUsed,
          generationConfig: {
            responseMimeType: "application/json",
          },
        });
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
        });
        const content = result.response.text();
        try {
          parsed = JSON.parse(content);
          rawResponse = content;
          tokensUsed = result.response.usageMetadata?.totalTokenCount || 0;
          success = true;
          console.log(`Tokens used for Gemini (${modelNameUsed}): ${tokensUsed}`);
          console.log("Gemini call succeeded and returned valid JSON!");
        } catch (jsonErr) {
          console.warn(`Gemini returned invalid JSON: ${content}`);
        }
      } catch (geminiErr) {
        console.error("Gemini API call failed:", geminiErr);
      }
    }

    if (!success && groqApiKey && groqApiKey !== "your_groq_api_key_here") {
      for (const model of fallbackModels) {
        try {
          modelNameUsed = model;
          console.log(`Attempting Groq fallback call with model: ${modelNameUsed}...`);
          const response = await fetch(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${groqApiKey}`,
              },
              body: JSON.stringify({
                model: modelNameUsed,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: incomingText },
                ],
                response_format: { type: "json_object" },
              }),
            },
          );

          if (response.ok) {
            const resJson = await response.json();
            const content = resJson.choices[0].message.content;
            try {
              parsed = JSON.parse(content);
              rawResponse = content;
              tokensUsed = resJson.usage?.total_tokens || 0;
              success = true;
              console.log(`Tokens used for Groq (${modelNameUsed}): ${tokensUsed}`);
              console.log(`Groq fallback call succeeded with model: ${modelNameUsed} and returned valid JSON.`);
              break;
            } catch (jsonErr) {
              console.warn(`Groq model ${modelNameUsed} returned invalid JSON: ${content}. Trying next model...`);
            }
          } else {
            const errText = await response.text();
            console.warn(`Groq model ${modelNameUsed} failed (status ${response.status}): ${errText}`);
          }
        } catch (groqErr) {
          console.warn(`Groq model ${modelNameUsed} threw error:`, groqErr);
        }
      }
    }

    if (!success) {
      console.error("All AI models (Groq and Gemini) failed to generate response.");
      return "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly.";
    }

    console.log("AI Raw JSON Response:", rawResponse);

    if (!parsed) {
      parsed = {
        reply: "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly.",
        disableAI: true,
      };
    }

    await AILog.create({
      leadId,
      prompt: systemPrompt + "\n\nUser Message: " + incomingText,
      response: rawResponse,
      model: modelNameUsed,
      tokensUsed: tokensUsed,
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

    return parsed.reply || "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly.";
  } catch (error) {
    console.error("Error in AI Service generateAIResponse:", error);
    return "I'm sorry, but I'm unable to assist with this request right now. I'll connect you with one of our team members, who will continue assisting you shortly.";
  }
};

