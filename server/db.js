// server/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // 🔥 เปิด SSL สำหรับต่อฐานข้อมูล Neon DB บน Cloud
  }
});

module.exports = {
  query: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows; // คืนค่าเป็น Array เพื่อให้แมตช์กับ [tm], [am] ใน index.js ของคุณครับ
  }
};