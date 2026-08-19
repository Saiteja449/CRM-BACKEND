import mongoose from "mongoose";
import { syncToMinicow } from "../utils/minicowSync.js";
import { syncToJobs } from "../utils/jobsSync.js";

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
    email: {
      type: String,
    },
    source: {
      type: String,
      enum: [
        "Email",
        "WhatsApp",
        "Meta Ads",
        "Website Form",
        "Call",
        "Manual Entry",
      ],
      default: "Manual Entry",
    },
    service: {
      type: String,
      // deprecated
    },
    services: {
      type: [String],
      enum: [
        "Grooming",
        "Training",
        "Walking",
        "Pet Sitting",
        "Pet Insurance",
        "Job Inquiry",
        "Cow Services",
        "General Enquiry",
      ],
      default: ["Grooming"],
    },

    assignedTo: {
      type: String,
      default: "Unassigned",
    },
    joinedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: [
        "New",
        "Follow Up",
        "Not Interested",
        "Not Responding",
        "Not Attended",
        "Price Issue",
        "Joined",
        "Job Posted",
        "Job Assigned",
        "Active",
        "Closed Won",
        "Policy Active",
      ],
      default: "New",
    },
    leadType: {
      type: String,
      default: "Client",
    },
    providerService: {
      type: String,
    },
    nextFollowUp: {
      type: String, // Kept as string to easily map to HTML date input format "YYYY-MM-DD"
    },
    followupTime: {
      type: String,
    },
    notes: {
      type: String,
      default: "No message provided",
    },
    city: {
      type: String,
    },
    petType: {
      type: String,
    },
    petAge: {
      type: String,
    },
    pincode: {
      type: String,
    },
    preferredContactMethod: {
      type: String,
      enum: ["Email", "SMS", "WhatsApp", "Phone", ""],
      default: "",
    },
    importantLead: {
      type: Boolean,
      default: false,
    },
    appointmentDate: {
      type: String,
    },
    appointmentTime: {
      type: String,
    },
    lastMessage: {
      type: String,
    },
    lastActivity: {
      type: Date,
    },
    aiEnabled: {
      type: Boolean,
      default: true,
    },
    aiQualification: {
      petType: { type: String, default: "" },
      breed: { type: String, default: "" },
      petAge: { type: String, default: "" },
      city: { type: String, default: "" },
      intent: { type: String, default: "" },
      budget: { type: String, default: "" },
      specialRequirements: { type: String, default: "" },
      urgency: { type: String, default: "" },
      interestScore: { type: Number, default: 0 },
    },
    aiTags: {
      type: [String],
      default: [],
    },
    isOldLead: {
      type: Boolean,
      default: false,
    },
    conversationSummary: {
      type: String,
    },
    sentiment: {
      type: String,
    },
    probabilityOfConversion: {
      type: Number,
    },
    nextAction: {
      type: String,
    },
    followUpCount: {
      type: Number,
      default: 0,
    },
    lastFollowUpSentAt: {
      type: Date,
    },
    automatedFollowUpsActive: {
      type: Boolean,
      default: true,
    },
    recordings: [
      {
        name: String,
        url: String,
        analysis: String,
        analysisStatus: { type: String, default: "pending" }, // pending, completed, failed
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    syncedToMinicow: {
      type: Boolean,
      default: false,
    },
    syncedToJobs: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Cascade delete associated records when a lead is deleted
leadSchema.pre("findOneAndDelete", async function () {
  const doc = await this.model.findOne(this.getQuery());
  if (doc) {
    const id = doc._id;
    await mongoose.model("Followup").deleteMany({ leadId: id });
    await mongoose.model("Conversation").deleteMany({ leadId: id });
    await mongoose.model("Message").deleteMany({ leadId: id });
    await mongoose.model("AILog").deleteMany({ leadId: id });
  }
});

leadSchema.pre("deleteOne", { document: true, query: true }, async function () {
  const id =
    this._id ||
    (this.getQuery && (await this.model.findOne(this.getQuery()))?._id);
  if (id) {
    await mongoose.model("Followup").deleteMany({ leadId: id });
    await mongoose.model("Conversation").deleteMany({ leadId: id });
    await mongoose.model("Message").deleteMany({ leadId: id });
    await mongoose.model("AILog").deleteMany({ leadId: id });
  }
});

// Convert _id to id for frontend compatibility
leadSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
  },
});

// Minicow Sync Hooks
leadSchema.post("save", function (doc) {
  if (doc.services && doc.services.includes("Cow Services") && !doc.syncedToMinicow) {
    syncToMinicow(doc);
  }
});

leadSchema.post("findOneAndUpdate", async function (doc) {
  // Fetch the latest document from DB to guarantee we check the updated state
  const updatedDoc = await this.model.findOne(this.getQuery());
  if (updatedDoc && updatedDoc.services && updatedDoc.services.includes("Cow Services") && !updatedDoc.syncedToMinicow) {
    syncToMinicow(updatedDoc);
  }
});

// Jobs Sync Hooks
leadSchema.post("save", function (doc) {
  if (doc.services && doc.services.includes("Job Inquiry") && !doc.syncedToJobs) {
    syncToJobs(doc);
  }
});

leadSchema.post("findOneAndUpdate", async function (doc) {
  const updatedDoc = await this.model.findOne(this.getQuery());
  if (updatedDoc && updatedDoc.services && updatedDoc.services.includes("Job Inquiry") && !updatedDoc.syncedToJobs) {
    syncToJobs(updatedDoc);
  }
});

const Lead = mongoose.model("Lead", leadSchema);
export default Lead;
