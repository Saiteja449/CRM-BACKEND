import axios from 'axios';

export const syncToJobs = async (doc) => {
  try {
    const apiUrl = process.env.JOBS_CRM_API_URL;
    
    if (!apiUrl) {
      console.warn("JOBS_CRM_API_URL is not set in .env. Skipping sync.");
      return;
    }
    
    await axios.post(apiUrl, {
      name: doc.name,
      phone: doc.phone,
      email: doc.email,
      city: doc.city,
      source: doc.source || "Petsfolio CRM",
      notes: doc.notes,
    });
    
    // Update the doc to mark as synced using updateOne to avoid triggering hooks again
    await doc.constructor.updateOne({ _id: doc._id }, { $set: { syncedToJobs: true } });
    console.log(`Successfully synced lead ${doc._id} to Jobs CRM`);
  } catch (error) {
    console.error(`Failed to sync lead ${doc._id} to Jobs CRM:`, error.message);
  }
};
