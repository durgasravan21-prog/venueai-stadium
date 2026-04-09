const { Pool } = require('pg');

const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

async function initDB(staffArray, ordersArray) {
  if (!pool) {
    console.log('No DATABASE_URL found. Running with ephemeral in-memory storage.');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100),
        role VARCHAR(50),
        zone VARCHAR(50),
        status VARCHAR(50),
        "currentTask" TEXT
      );
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(50) PRIMARY KEY,
        items JSONB,
        total INTEGER,
        zone VARCHAR(50),
        seat VARCHAR(50),
        concession VARCHAR(100),
        "concessionId" VARCHAR(50),
        status VARCHAR(50),
        "estimatedTime" INTEGER,
        "remainingTime" INTEGER,
        "createdAt" TIMESTAMP
      );
    `);
    
    // Sync Staff
    const staffRes = await pool.query('SELECT * FROM staff');
    if (staffRes.rows.length > 0) {
      staffArray.length = 0;
      staffArray.push(...staffRes.rows);
    } else {
      for (const s of staffArray) {
         await syncStaff(s);
      }
    }

    // Sync Orders
    const orderRes = await pool.query('SELECT * FROM orders');
    if (orderRes.rows.length > 0) {
      ordersArray.length = 0;
      ordersArray.push(...orderRes.rows);
    }
    console.log('✅ PostgreSQL connected and synced. Persistent storage active.');
  } catch(e) {
    console.error('DB Init Error:', e.message);
  }
}

async function syncStaff(s, del = false) {
  if (!pool) return;
  try {
    if (del) await pool.query('DELETE FROM staff WHERE id = $1', [s.id]);
    else {
      await pool.query(`
        INSERT INTO staff (id, name, role, zone, status, "currentTask") 
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET 
        name=EXCLUDED.name, role=EXCLUDED.role, zone=EXCLUDED.zone, status=EXCLUDED.status, "currentTask"=EXCLUDED."currentTask"
      `, [s.id, s.name, s.role, s.zone, s.status, s.currentTask]);
    }
  } catch(e) { console.error('syncStaff error:', e.message); }
}

async function syncOrder(o) {
  if (!pool) return;
  try {
    await pool.query(`
      INSERT INTO orders (id, items, total, zone, seat, concession, "concessionId", status, "estimatedTime", "remainingTime", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET 
      status=EXCLUDED.status, "remainingTime"=EXCLUDED."remainingTime"
    `, [o.id, JSON.stringify(o.items), o.total, o.zone, o.seat, o.concession, o.concessionId, o.status, o.estimatedTime, o.remainingTime, new Date(o.createdAt)]);
  } catch(e) { console.error('syncOrder error:', e.message); }
}

module.exports = { pool, initDB, syncStaff, syncOrder };
