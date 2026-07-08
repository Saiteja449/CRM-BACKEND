import TelecallerAnalytics from '../models/TelecallerAnalytics.js';

// Logs a single call and increments daily analytics
export const logCall = async (req, res) => {
  try {
    const { salesperson, date, duration, callType, status } = req.body;

    if (!salesperson || !date) {
      return res.status(400).json({ success: false, message: 'Salesperson and date are required.' });
    }

    const durationNum = parseInt(duration) || 0;
    
    const update = {
      $inc: {
        totalCalls: 1,
        talkTime: durationNum,
      },
      $max: {
        longestCall: durationNum,
      }
    };

    if (callType === 'incoming') update.$inc.incoming = 1;
    if (callType === 'outgoing') update.$inc.outgoing = 1;

    if (status === 'missed') update.$inc.missed = 1;
    if (status === 'connected') update.$inc.connected = 1;
    if (status === 'rejected') update.$inc.rejected = 1;
    if (status === 'not-connected') update.$inc.notConnected = 1;

    // Use upsert to create the document if it doesn't exist
    const analytics = await TelecallerAnalytics.findOneAndUpdate(
      { salesperson, date },
      update,
      { new: true, upsert: true }
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
