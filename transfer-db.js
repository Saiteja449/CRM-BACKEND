import { MongoClient } from "mongodb";

const SOURCE_URI =
  "mongodb+srv://saiteja:Saiteja1920@task-management.rzoshdy.mongodb.net/crm-petsfolio-beta?appName=crm-petsfolio-beta";
const TARGET_URI =
  "mongodb://crmuser:PetsfolioCRM%402026@127.0.0.1:27017/crm?authSource=admin";

async function migrate() {
  console.log("Connecting to Source Database (Atlas)...");
  const sourceClient = new MongoClient(SOURCE_URI);
  await sourceClient.connect();
  const sourceDb = sourceClient.db(); // uses default db from uri
  console.log(`Connected to Source DB: ${sourceDb.databaseName}`);

  console.log("Connecting to Target Database (Local VPS)...");
  const targetClient = new MongoClient(TARGET_URI);
  await targetClient.connect();
  const targetDb = targetClient.db();
  console.log(`Connected to Target DB: ${targetDb.databaseName}`);

  try {
    const collections = await sourceDb.listCollections().toArray();
    console.log(`Found ${collections.length} collections to transfer.\n`);

    for (const collectionInfo of collections) {
      const collName = collectionInfo.name;

      // Skip system collections
      if (collName.startsWith("system.")) {
        continue;
      }

      console.log(`Processing collection: ${collName}`);
      const sourceColl = sourceDb.collection(collName);
      const targetColl = targetDb.collection(collName);

      // Empty target collection first
      console.log(`  - Emptying target collection...`);
      await targetColl.deleteMany({});

      // Fetch all documents from source
      const docs = await sourceColl.find({}).toArray();

      if (docs.length === 0) {
        console.log(`  - No documents found, skipping.\n`);
        continue;
      }

      console.log(
        `  - Found ${docs.length} documents. Inserting into target...`,
      );

      // Insert documents into target
      try {
        // Using unordered bulk insert to skip duplicates if any exist, but target should be empty
        await targetColl.insertMany(docs, { ordered: false });
        console.log(`  - Successfully inserted ${docs.length} documents.\n`);
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate key error
          console.log(
            `  - Warning: Duplicate key error encountered. Some documents may already exist.`,
          );
        } else {
          console.error(`  - Error inserting documents: ${err.message}`);
        }
      }
    }

    console.log("Migration completed successfully!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    console.log("Closing database connections...");
    await sourceClient.close();
    await targetClient.close();
    process.exit(0);
  }
}

migrate();
