require('dotenv').config();
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER || 'localhost',
  port:     parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME || 'irondesk',
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    trustServerCertificate: true,
    enableArithAbort: true,
    encrypt: false,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

const pool = new sql.ConnectionPool(config);
const poolConnect = pool.connect();

poolConnect
  .then(() => console.log('✅ SQL Server Pool พร้อมใช้งาน'))
  .catch(err => console.error('❌ SQL Server เชื่อมต่อไม่ได้:', err.message));

async function q(sqlStr, params = {}) {
  await poolConnect;
  const req = pool.request();
  Object.entries(params).forEach(([k, { type, value }]) => req.input(k, type, value));
  const res = await req.query(sqlStr);
  return res.recordset;
}

async function ins(sqlStr, params = {}) {
  await poolConnect;
  const req = pool.request();
  Object.entries(params).forEach(([k, { type, value }]) => req.input(k, type, value));
  const res = await req.query(sqlStr + '; SELECT SCOPE_IDENTITY() AS id');
  return res.recordset[0]?.id;
}

module.exports = { pool, poolConnect, sql, q, ins };