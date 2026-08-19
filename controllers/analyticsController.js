import TelecallerAnalytics from "../models/TelecallerAnalytics.js";
import Lead from "../models/Lead.js";
import TargetAssignment from "../models/TargetAssignment.js";

// Logs a single call and increments daily analytics
export const logCall = async (req, res) => {
  try {
    const { salesperson, date, duration, callType, status } = req.body;

    if (!salesperson || !date) {
      return res.status(400).json({
        success: false,
        message: "Salesperson and date are required.",
      });
    }

    const durationNum = parseInt(duration) || 0;

    const update = {
      $inc: {
        totalCalls: 1,
        talkTime: durationNum,
      },
      $max: {
        longestCall: durationNum,
      },
    };

    if (callType === "incoming") update.$inc.incoming = 1;
    if (callType === "outgoing") update.$inc.outgoing = 1;

    if (status === "missed") update.$inc.missed = 1;
    if (status === "connected") update.$inc.connected = 1;
    if (status === "rejected") update.$inc.rejected = 1;
    if (status === "not-connected") update.$inc.notConnected = 1;

    // Use upsert to create the document if it doesn't exist
    const analytics = await TelecallerAnalytics.findOneAndUpdate(
      { salesperson, date },
      update,
      { new: true, upsert: true },
    );

    res.status(200).json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Gets daily analytics for a salesperson
export const getAnalyticsBySalesperson = async (req, res) => {
  try {
    const { salesperson } = req.params;

    // Fetch last 7 days of records sorted by date descending
    const analytics = await TelecallerAnalytics.find({ salesperson })
      .sort({ date: -1 })
      .limit(7);

    res.status(200).json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Gets today's analytics for all salespeople
export const getTodayAnalyticsForAll = async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const analytics = await TelecallerAnalytics.find({ date: today });
    res.status(200).json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

import AILimit from "../models/AILimit.js";

// Gets current AI (Groq) rate limits from database
export const getAILimits = async (req, res) => {
  try {
    const limit = await AILimit.findOne().sort({ lastUpdated: -1 });
    if (!limit) {
      return res.status(200).json({
        success: true,
        data: {
          remainingRequests: "N/A",
          remainingTokens: "N/A",
          resetRequests: "N/A",
          resetTokens: "N/A",
        },
      });
    }
    res.status(200).json({ success: true, data: limit });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Fetches limits from API, saves to MongoDB, and returns them
export const refreshAILimits = async (req, res) => {
  try {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return res
        .status(200)
        .json({ success: false, message: "No Groq API Key found" });
    }

    // Call the Groq API to get headers
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({
        success: false,
        message: `Failed to fetch limits: ${response.status} ${errText}`,
      });
    }

    const remainingRequests =
      response.headers.get("x-ratelimit-remaining-requests") || "N/A";
    const remainingTokens =
      response.headers.get("x-ratelimit-remaining-tokens") || "N/A";
    const resetRequests =
      response.headers.get("x-ratelimit-reset-requests") || "N/A";
    const resetTokens =
      response.headers.get("x-ratelimit-reset-tokens") || "N/A";

    let limit = await AILimit.findOne();
    if (!limit) {
      limit = new AILimit();
    }

    limit.remainingRequests = remainingRequests;
    limit.remainingTokens = remainingTokens;
    limit.resetRequests = resetRequests;
    limit.resetTokens = resetTokens;
    limit.lastUpdated = new Date();

    await limit.save();

    res.status(200).json({
      success: true,
      data: limit,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Calculates monthly performance including historical data for the month
export const getMonthlyPerformance = async (req, res) => {
  try {
    const { month } = req.query; // format: "YYYY-MM", defaults to current month
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    
    // 1. Get all assignments for this month
    const assignments = await TargetAssignment.find({ assignedMonth: targetMonth });
    
    // 2. Fetch leads assigned this month to these reps
    const monthStart = new Date(`${targetMonth}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    
    const leads = await Lead.find({
      joinedAt: { $gte: monthStart, $lt: monthEnd }
    });

    // 3. Fetch call analytics for this month
    const callAnalytics = await TelecallerAnalytics.find({
      date: { $regex: `^${targetMonth}` }
    });

    const performanceData = assignments.map((assignment) => {
      const repName = assignment.repName;
      
      // Filter leads for this rep
      const repLeads = leads.filter(l => l.assignedTo === repName);
      const assignedLeadsCount = repLeads.length;
      
      // Calculate actual closures
      const actualClosures = repLeads.filter(l => 
        l.status === "Joined" || 
        l.status === "Policy Active" || 
        l.status === "Closed Won"
      ).length;

      // Extract target tiers
      const targetTier = assignment.tiers.target || {};
      const expectedConversionPct = targetTier.expectedConversionPct || targetTier.conversionPct || 0;
      const targetCallsPerDay = targetTier.callsPerDay || 0;
      
      // Calculate expected closures
      const expectedClosures = Math.round(assignedLeadsCount * (expectedConversionPct / 100));
      const closingPerformance = expectedClosures > 0 ? Math.round((actualClosures / expectedClosures) * 100) : 0;
      const actualConversionPct = assignedLeadsCount > 0 ? Math.round((actualClosures / assignedLeadsCount) * 100) : 0;

      // Calculate Call Adherence
      const repCalls = callAnalytics.filter(a => a.salesperson === repName);
      let totalConnected = 0;
      let totalCallsMade = 0;
      let daysWithCalls = 0;
      repCalls.forEach(log => {
        totalConnected += (log.connected || 0);
        totalCallsMade += (log.totalCalls || 0);
        if (log.totalCalls > 0) daysWithCalls++;
      });
      
      // Average daily connected against target
      const avgDailyConnected = daysWithCalls > 0 ? Math.round(totalConnected / daysWithCalls) : 0;
      const callAdherence = targetCallsPerDay > 0 ? Math.min(100, Math.round((avgDailyConnected / targetCallsPerDay) * 100)) : 0;

      // Overall Score (50% closing, 30% calls, 20% followup/other proxy - we use 50% closing, 50% calls for simplicity if followup not tracked deeply)
      // Cap individual adherence at 150% for score calculation
      const cappedClosing = Math.min(150, closingPerformance);
      const score = Math.round((cappedClosing * 0.6) + (callAdherence * 0.4));
      
      // Convert to 1.0 - 5.0 Star Rating
      let starRating = 0;
      if (score >= 110) starRating = 5.0;
      else if (score >= 90) starRating = 4.0;
      else if (score >= 70) starRating = 3.0;
      else if (score >= 50) starRating = 2.0;
      else if (score > 0) starRating = 1.0;

      return {
        repName,
        repId: assignment.repId,
        assignedLeadsCount,
        actualClosures,
        expectedClosures,
        expectedConversionPct,
        actualConversionPct,
        closingPerformance,
        totalCallsMade,
        avgDailyConnected,
        targetCallsPerDay,
        callAdherence,
        overallScore: score,
        starRating
      };
    });

    res.status(200).json({ success: true, data: performanceData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
