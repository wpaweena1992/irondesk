// server/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = {
  query: async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows;
  }
};