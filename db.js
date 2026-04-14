const { db } = require('./firebase');

async function initDB(staffArray, ordersArray) {
  if (!db) {
    console.log('Firebase not initialized. Running with ephemeral in-memory storage.');
    return;
  }
  try {
    // Load Staff from Firebase
    const staffRef = db.collection('staff');
    const staffSnap = await staffRef.get();
    if (!staffSnap.empty) {
      staffArray.length = 0;
      staffSnap.forEach(doc => staffArray.push(doc.data()));
      console.log(`✅ Loaded ${staffArray.length} staff from Firebase.`);
    }

    // Load Orders from Firebase
    const ordersRef = db.collection('orders');
    const ordersSnap = await ordersRef.get();
    if (!ordersSnap.empty) {
      ordersArray.length = 0;
      ordersSnap.forEach(doc => ordersArray.push(doc.data()));
      console.log(`✅ Loaded ${ordersArray.length} orders from Firebase.`);
    }
  } catch (e) {
    console.error('Firebase DB Init Error:', e.message);
  }
}

async function syncStaff(s, del = false) {
  if (!db) return;
  try {
    const docRef = db.collection('staff').doc(s.id);
    if (del) {
      await docRef.delete();
    } else {
      await docRef.set(s, { merge: true });
    }
  } catch (e) {
    console.error('syncStaff Firebase error:', e.message);
  }
}

async function syncOrder(o) {
  if (!db) return;
  try {
    const docRef = db.collection('orders').doc(o.id);
    await docRef.set(o, { merge: true });
  } catch (e) {
    console.error('syncOrder Firebase error:', e.message);
  }
}

module.exports = { initDB, syncStaff, syncOrder };
