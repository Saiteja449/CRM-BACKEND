import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  author: {
    type: String,
  },
  date: {
    type: Date,
    default: Date.now,
  }
}, { timestamps: true });

activitySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    ret.id = ret._id.toString();
    // Also convert leadId to string to match frontend expectations
    ret.leadId = ret.leadId.toString();
    delete ret._id;
  }
});

const Activity = mongoose.model('Activity', activitySchema);
export default Activity;
