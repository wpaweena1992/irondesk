// server/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // 🔥 ใส่เฉพาะใน db.js เพื่อให้เชื่อมต่อ Neon DB บน Render ได้
  }
});

module.exports = {
  query: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows; // ส่งค่ากลับเป็น Array เพื่อให้ index.js นำไปใช้งานต่อได้ทันที
  }
};