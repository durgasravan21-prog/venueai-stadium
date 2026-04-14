const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

let db;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
  } else {
    // Local / Dev fallback or warning
    console.warn("⚠️ Firebase: No service account provided. Persistence disabled.");
  }
  
  if (admin.apps.length > 0) {
    db = admin.firestore();
    console.log("✅ Firebase Admin SDK Initialized");
  }
} catch (error) {
  console.error("❌ Firebase Initialization Error:", error.message);
}

module.exports = { admin, db };
