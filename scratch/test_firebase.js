const { db } = require('../firebase');

async function testFirebase() {
  console.log("Testing Firestore Write...");
  try {
    const res = await db.collection('test').doc('hello').set({
      message: "Firebase is connected!",
      timestamp: new Date()
    });
    console.log("✅ Successfully wrote to Firestore:", res);
  } catch (e) {
    console.error("❌ Firestore Write Failed:", e.message);
  }
}

testFirebase();
