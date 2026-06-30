import Lead from "../models/Lead.js";
import { sendAutomatedFollowup } from "../whatsapp/whatsappService.js";
import { petServices } from "../data/petServices.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const runFollowupCheck = async () => {
  console.log("[CRON] Running 24-hour automated follow-up check...");

  try {
    const eligibleLeads = await Lead.find({
      status: { $in: ["New", "Follow Up", "Not Responding"] },
      source: { $nin: ["Email", "Call", "Meta Ads", "Website Form"] },
      automatedFollowUpsActive: true,
      followUpCount: { $lt: 4 },
    });

    const now = new Date();
    let messagesSent = 0;

    for (const lead of eligibleLeads) {
      if (!lead.phone) continue;

      const referenceDate = lead.joinedAt || lead.createdAt;
      if (!referenceDate) continue;

      // Calculate hours since reference date
      const hoursSince = (now - referenceDate) / (1000 * 60 * 60);

      // We want to send at 24h, 48h, 72h, 96h.
      // If they are at count 0, send if hours > 24
      // If they are at count 1, send if hours > 48
      const targetHours = (lead.followUpCount + 1) * 24;

      if (hoursSince >= targetHours) {
        try {
          console.log(
            `[CRON] Sending follow-up ${lead.followUpCount + 1} to lead ${lead.phone}`,
          );

          // Disable AI if not already disabled
          if (lead.aiEnabled) {
            lead.aiEnabled = false;
          }

          // Determine service content
          let serviceObj = null;
          const requestedService =
            lead.service ||
            (lead.aiQualification && lead.aiQualification.intent);

          if (
            requestedService &&
            requestedService.trim() !== "" &&
            requestedService !== "General Enquiry"
          ) {
            serviceObj = petServices.find(
              (s) => s.title.toLowerCase() === requestedService.toLowerCase(),
            );
          }

          // If not found or general enquiry, use a rotated default based on followUpCount
          if (!serviceObj) {
            const rotatedIndex = lead.followUpCount % petServices.length;
            serviceObj = petServices[rotatedIndex];
          }

          // Pick the image and description based on followUpCount
          // Ensure we don't exceed the array length
          const index = Math.min(
            lead.followUpCount,
            serviceObj.images.length - 1,
          );
          const imageUrl = serviceObj.images[index];
          const text = serviceObj.descriptions[index];

          await sendAutomatedFollowup(lead, imageUrl, text);

          lead.followUpCount += 1;
          lead.lastFollowUpSentAt = now;
          await lead.save();
          messagesSent++;

          // Wait 10 seconds between messages to avoid WhatsApp spam flagging
          await sleep(10000);
        } catch (err) {
          console.error(
            `[CRON] Failed to send follow-up to ${lead.phone}:`,
            err,
          );
        }
      }
    }

    console.log(
      `[CRON] Automated follow-up check complete. Sent ${messagesSent} messages.`,
    );
  } catch (error) {
    console.error("[CRON] Error in follow-up cron job:", error);
  }
};
