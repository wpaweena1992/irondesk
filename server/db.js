// server/db.js — PostgreSQL connection pool
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL เชื่อมต่อสำเร็จ');
    client.release();
  })
  .catch(err => console.error('❌ PostgreSQL เชื่อมต่อไม่ได้:', err.message));

// Helper: query with params
// Usage: await db.query('SELECT * FROM members WHERE id=$1', [id])
async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Helper: insert and return new row
async function insert(text, params = []) {
  const res = await pool.query(text + ' RETURNING id', params);
  return res.rows[0]?.id;
}

module.exports = { pool, query, insert };
