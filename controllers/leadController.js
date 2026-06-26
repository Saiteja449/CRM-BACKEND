import Lead from "../models/Lead.js";
import User from "../models/User.js";
import AssignmentState from "../models/AssignmentState.js";

import Followup from "../models/Followup.js";
import Notification from "../models/Notification.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

export const getLeads = async (req, res) => {
  try {
    const leads = await Lead.find({});
    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPaginatedLeads = async (req, res) => {
  try {
    const {
      page = 0,
      limit = 10,
      search = "",
      service = "All",
      salesperson = "All",
      status = "All",
      leadTypeTab = "New",
      currentUserRole = "",
      currentUserName = "",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    let query = {};

    if (currentUserRole === "Sales Representative" && currentUserName) {
      query.assignedTo = {
        $regex: new RegExp("^" + currentUserName + "$", "i"),
      };
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { petName: searchRegex },
        { petBreed: searchRegex },
        { email: searchRegex },
      ];
    }

    if (service !== "All") query.service = service;
    if (salesperson !== "All") query.assignedTo = salesperson;
    if (status !== "All") query.status = status;

    const todayStr = new Date().toISOString().split("T")[0];

    const applyTabFilter = (q, tab) => {
      if (tab === "New") {
        q.status = { $regex: new RegExp("^new$", "i") };
      } else if (tab === "TodayFollowup") {
        q.status = { $regex: new RegExp("^follow up$", "i") };
        q.$or = [
          ...(q.$or || []),
          { nextFollowUp: null },
          { nextFollowUp: "" },
          { nextFollowUp: { $lte: todayStr } },
        ];
      } else if (tab === "UpcomingFollowup") {
        q.status = { $regex: new RegExp("^follow up$", "i") };
        q.nextFollowUp = { $gt: todayStr };
      } else if (tab === "JobPosted") {
        q.status = { $regex: new RegExp("^job posted$", "i") };
      } else if (tab === "Converted") {
        q.status = { $regex: new RegExp("^job assigned$", "i") };
      } else if (tab === "Joined") {
        q.status = { $regex: new RegExp("^joined$", "i") };
      } else if (tab === "Lost") {
        q.status = {
          $in: [
            new RegExp("^price issue$", "i"),
            new RegExp("^not answered$", "i"),
            new RegExp("^not interested$", "i"),
          ],
        };
      } else if (tab === "NotAttended") {
        q.status = { $regex: new RegExp("^not attended$", "i") };
      }
    };

    applyTabFilter(query, leadTypeTab);

    const totalCount = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .sort({ createdAt: -1 })
      .skip(pageNum * limitNum)
      .limit(limitNum);

    const baseCountQuery = {};
    if (currentUserRole === "Sales Representative" && currentUserName) {
      baseCountQuery.assignedTo = {
        $regex: new RegExp("^" + currentUserName + "$", "i"),
      };
    }
    if (search) {
      const searchRegex = new RegExp(search, "i");
      baseCountQuery.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { petName: searchRegex },
        { petBreed: searchRegex },
        { email: searchRegex },
      ];
    }
    if (service !== "All") baseCountQuery.service = service;
    if (salesperson !== "All") baseCountQuery.assignedTo = salesperson;
    if (status !== "All") baseCountQuery.status = status;

    const facetCounts = await Lead.aggregate([
      { $match: baseCountQuery },
      {
        $facet: {
          New: [
            { $match: { status: { $regex: new RegExp("^new$", "i") } } },
            { $count: "count" },
          ],
          TodayFollowup: [
            {
              $match: {
                status: { $regex: new RegExp("^follow up$", "i") },
                $or: [
                  { nextFollowUp: null },
                  { nextFollowUp: "" },
                  { nextFollowUp: { $lte: todayStr } },
                ],
              },
            },
            { $count: "count" },
          ],
          UpcomingFollowup: [
            {
              $match: {
                status: { $regex: new RegExp("^follow up$", "i") },
                nextFollowUp: { $gt: todayStr },
              },
            },
            { $count: "count" },
          ],
          NotAttended: [
            {
              $match: { status: { $regex: new RegExp("^not attended$", "i") } },
            },
            { $count: "count" },
          ],
          Joined: [
            { $match: { status: { $regex: new RegExp("^joined$", "i") } } },
            { $count: "count" },
          ],
          JobPosted: [
            { $match: { status: { $regex: new RegExp("^job posted$", "i") } } },
            { $count: "count" },
          ],
          Converted: [
            {
              $match: { status: { $regex: new RegExp("^job assigned$", "i") } },
            },
            { $count: "count" },
          ],
          Lost: [
            {
              $match: {
                status: {
                  $in: [
                    new RegExp("^price issue$", "i"),
                    new RegExp("^not answered$", "i"),
                    new RegExp("^not interested$", "i"),
                  ],
                },
              },
            },
            { $count: "count" },
          ],
        },
      },
    ]);

    const counts = {
      New: facetCounts[0].New[0]?.count || 0,
      TodayFollowup: facetCounts[0].TodayFollowup[0]?.count || 0,
      UpcomingFollowup: facetCounts[0].UpcomingFollowup[0]?.count || 0,
      NotAttended: facetCounts[0].NotAttended[0]?.count || 0,
      Joined: facetCounts[0].Joined[0]?.count || 0,
      JobPosted: facetCounts[0].JobPosted[0]?.count || 0,
      Converted: facetCounts[0].Converted[0]?.count || 0,
      Lost: facetCounts[0].Lost[0]?.count || 0,
    };

    res.json({
      leads,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      tabCounts: counts,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createLead = async (req, res) => {
  try {
    const leadData = req.body;

    if (leadData.phone) {
      const existingLead = await Lead.findOne({ phone: leadData.phone });
      if (existingLead) {
        return res
          .status(400)
          .json({ message: "A lead with this phone number already exists." });
      }
    }

    if (!leadData.assignedTo || leadData.assignedTo === "Unassigned") {
      const reps = await User.find({ role: "sales person" }).sort({ _id: 1 });
      if (reps && reps.length > 0) {
        let state = await AssignmentState.findOne({ key: "leadAssignment" });
        if (!state) {
          state = await AssignmentState.create({
            key: "leadAssignment",
            lastAssignedIndex: -1,
          });
        }

        let nextIndex = state.lastAssignedIndex + 1;
        if (nextIndex >= reps.length) {
          nextIndex = 0;
        }

        leadData.assignedTo = reps[nextIndex].name;
        state.lastAssignedIndex = nextIndex;
        await state.save();
      }
    }
    if (!leadData.joinedAt) {
      leadData.joinedAt = new Date();
    }

    const lead = await Lead.create(leadData);

    const assignedUser = await User.findOne({ name: lead.assignedTo });
    const targetUsers = assignedUser ? [assignedUser._id] : [];

    await Notification.create({
      title: "New Lead Added",
      message: `Lead ${lead.name} has been added and assigned to ${lead.assignedTo}.`,
      type: "new_lead",
      targetRoles: ["sales manager"],
      targetUsers: targetUsers,
    });

    res.status(201).json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const lead = await Lead.findByIdAndUpdate(id, updateData, { new: true });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (updateData.status) {
      await Notification.create({
        title: "Lead Status Updated",
        message: `Lead ${lead.name} status updated to ${lead.status}.`,
        type: "lead_update",
        targetRoles: ["sales manager"],
      });
    }

    res.json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findByIdAndDelete(id);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    await Followup.deleteMany({ leadId: id });
    await Conversation.deleteMany({ leadId: id });
    await Message.deleteMany({ leadId: id });

    res.json({ message: "Lead and associated conversation history removed successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
