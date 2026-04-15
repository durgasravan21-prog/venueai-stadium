const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';

const endpoints = [
  { path: '/', method: 'GET', type: 'html' },
  { path: '/api/stadiums', method: 'GET', type: 'json' },
  { path: '/api/stadium/hyderabad_stadium', method: 'GET', type: 'json' },
  { path: '/api/menu', method: 'GET', type: 'json' },
  { path: '/api/slots', method: 'GET', type: 'json' },
  { path: '/api/health', method: 'GET', type: 'json' },
  { path: '/security.txt', method: 'GET', type: 'text' }
];

async function runAudit() {
  console.log("🔍 STARTING FULL STACK WHITE-BOX AUDIT...");
  let errors = 0;

  for (const ep of endpoints) {
    try {
      const start = Date.now();
      const res = await fetch(`${BASE_URL}${ep.path}`);
      const duration = Date.now() - start;
      
      if (res.ok) {
        console.log(`✅ [${res.status}] ${ep.path} - ${duration}ms`);
      } else {
        console.error(`❌ [${res.status}] ${ep.path} - FAILED`);
        errors++;
      }
    } catch (err) {
      console.error(`💥 [ERROR] ${ep.path} - ${err.message}`);
      errors++;
    }
  }

  if (errors === 0) {
    console.log("\n✨ ALL CORE SERVICES ARE OPERATIONAL (100% PASS RATE).");
  } else {
    console.log(`\n⚠️ AUDIT COMPLETED WITH ${errors} ERRORS.`);
  }
}

runAudit();
