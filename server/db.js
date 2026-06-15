// server/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // จำเป็นต้องมีสำหรับต่อ Neon DB บน Render
  }
});

module.exports = {
  query: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows; // คืนค่าเฉพาะแถวข้อมูลกลับไปให้ index.js
  }
};