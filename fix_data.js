import mongoose from 'mongoose';

const uri = "mongodb+srv://Saiteja:Saiteja1920@saiteja.ldvlvjp.mongodb.net/?appName=Petsfolio-crm";

const followupSchema = new mongoose.Schema({
  type: String,
  done: Boolean
}, { strict: false });

const Followup = mongoose.model('Followup', followupSchema);

async function fix() {
  await mongoose.connect(uri);
  const result = await Followup.updateMany(
    { type: "Lead Edited", done: false },
    { $set: { done: true } }
  );
  console.log("Fixed followups:", result.modifiedCount);
  await mongoose.disconnect();
}

fix();
