// server/index.js — IronDesk API (PostgreSQL)
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── AUTO UPDATE STATUS ────────────────────────────────
async function refreshMemberStatus() {
  try {
    // หมดอายุตามวันที่
    await db.query(`
      UPDATE member_packages SET status='expired'
      WHERE status IN ('active','expiring')
      AND expiry_date < CURRENT_DATE
    `);
    // ใช้ชั่วโมงหมดแล้ว (เหลือ 0 หรือน้อยกว่า)
    await db.query(`
      UPDATE member_packages SET status='expired'
      WHERE status IN ('active','expiring')
      AND hours_total IS NOT NULL
      AND (hours_total - hours_used) <= 0
    `);
    // ใกล้หมด = เหลือ <= 2 ชม. และยังไม่หมดอายุ
    await db.query(`
      UPDATE member_packages SET status='expiring'
      WHERE status='active'
      AND expiry_date >= CURRENT_DATE
      AND hours_total IS NOT NULL
      AND (hours_total - hours_used) > 0
      AND (hours_total - hours_used) <= 2
    `);
  } catch(e) { console.error('refreshMemberStatus error:', e.message); }
}

// ── HEALTH ────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, db: 'connected', time: new Date() });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── DASHBOARD ─────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    await refreshMemberStatus();

    const [tm]  = await db.query(`SELECT COUNT(*) AS n FROM members WHERE active=TRUE`);
    const [am]  = await db.query(`SELECT COUNT(*) AS n FROM member_packages WHERE status='active'`);
    const [em]  = await db.query(`SELECT COUNT(*) AS n FROM member_packages WHERE status='expiring'`);
    const [st]  = await db.query(`SELECT COUNT(*) AS n FROM sessions WHERE session_date=CURRENT_DATE`);
    const [dt]  = await db.query(`SELECT COUNT(*) AS n FROM sessions WHERE session_date=CURRENT_DATE AND status='done'`);
    const [rm]  = await db.query(`SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE DATE_TRUNC('month',payment_date)=DATE_TRUNC('month',CURRENT_DATE)`);
    const [pa]  = await db.query(`SELECT COALESCE(SUM(p.amount),0) AS n FROM payments p JOIN member_packages mp ON p.member_pkg_id=mp.id WHERE mp.paid=FALSE`);

    const rev7 = await db.query(`
      SELECT payment_date::date AS day, SUM(amount) AS total
      FROM payments
      WHERE payment_date >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY payment_date::date ORDER BY day ASC
    `);

    const alerts = await db.query(`
      SELECT m.fname, m.lname, p.name AS pkg_name,
             mp.hours_total - mp.hours_used AS hours_left,
             mp.expiry_date::text AS expiry_date, mp.status
      FROM member_packages mp
      JOIN members m  ON m.id  = mp.member_id
      JOIN packages p ON p.id  = mp.package_id
      WHERE mp.status IN ('expiring','expired')
      ORDER BY mp.expiry_date ASC LIMIT 5
    `);

    const pkgDist = await db.query(`
      SELECT p.type, COUNT(*) AS count
      FROM member_packages mp
      JOIN packages p ON p.id = mp.package_id
      WHERE mp.status='active'
      GROUP BY p.type
    `);

    res.json({
      total_members: tm.n, active_members: am.n, expiring_members: em.n,
      sessions_today: st.n, done_today: dt.n,
      revenue_month: rm.n, pending_amount: pa.n,
      revenue7: rev7, alerts, pkgDist
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MEMBERS ───────────────────────────────────────────
app.get('/api/members', async (req, res) => {
  try {
    await refreshMemberStatus();

    const { q, status } = req.query;
    let sql = `
      SELECT m.id, m.fname, m.lname, m.phone, m.email, m.color, m.goal,
             m.trainer_id, m.created_at,
             t.name AS trainer_name,
             mp.id AS mp_id, mp.package_id, p.name AS pkg_name, p.type AS pkg_type,
             mp.hours_total, mp.hours_used, mp.sessions_total, mp.sessions_used,
             mp.start_date::text AS start_date,
             mp.expiry_date::text AS expiry_date, mp.status, mp.paid
      FROM members m
      LEFT JOIN trainers t ON t.id = m.trainer_id
      LEFT JOIN member_packages mp ON mp.id = (
        SELECT id FROM member_packages WHERE member_id=m.id ORDER BY created_at DESC LIMIT 1
      )
      LEFT JOIN packages p ON p.id = mp.package_id
      WHERE m.active=TRUE
    `;
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (m.fname ILIKE $${params.length} OR m.lname ILIKE $${params.length} OR m.phone ILIKE $${params.length})`;
    }
    if (status) {
      params.push(status);
      sql += ` AND mp.status = $${params.length}`;
    }
    sql += ` ORDER BY m.created_at DESC`;
    res.json(await db.query(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/members', async (req, res) => {
  try {
    const { fname, lname, phone, email, trainer_id, color, package_id, start_date, goal } = req.body;
    if (!fname || !phone) return res.status(400).json({ error: 'fname และ phone จำเป็น' });

    const [member] = await db.query(
      `INSERT INTO members (fname,lname,phone,email,trainer_id,color,goal) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [fname, lname||'', phone, email||null, trainer_id||null, color||'orange', goal||null]
    );
    const memberId = member.id;

    if (package_id && start_date) {
      const [pkg] = await db.query(`SELECT * FROM packages WHERE id=$1`, [package_id]);
      if (pkg) {
        const expiry = new Date(start_date);
        expiry.setDate(expiry.getDate() + pkg.validity_days);
        await db.query(
          `INSERT INTO member_packages (member_id,package_id,hours_total,hours_used,sessions_total,sessions_used,start_date,expiry_date,paid,status) VALUES ($1,$2,$3,0,$4,0,$5,$6,FALSE,'active')`,
          [memberId, package_id, pkg.hours||null, pkg.sessions||null, start_date, expiry.toISOString().split('T')[0]]
        );
      }
    }
    res.json({ id: memberId, message: 'เพิ่มสมาชิกสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/members/:id', async (req, res) => {
  try {
    const { fname, lname, phone, email, trainer_id, package_id, start_date, goal } = req.body;
    if (!fname || !phone) return res.status(400).json({ error: 'fname และ phone จำเป็น' });

    await db.query(
      `UPDATE members SET fname=$1, lname=$2, phone=$3, email=$4, trainer_id=$5, goal=$6 WHERE id=$7`,
      [fname, lname||'', phone, email||null, trainer_id||null, goal||null, req.params.id]
    );

    if (package_id && start_date) {
      const [pkg] = await db.query(`SELECT * FROM packages WHERE id=$1`, [package_id]);
      if (pkg) {
        const expiry = new Date(start_date);
        expiry.setDate(expiry.getDate() + pkg.validity_days);
        const [existing] = await db.query(
          `SELECT id FROM member_packages WHERE member_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [req.params.id]
        );
        if (existing) {
          await db.query(
            `UPDATE member_packages SET package_id=$1, hours_total=$2, sessions_total=$3, start_date=$4, expiry_date=$5, status='active' WHERE id=$6`,
            [package_id, pkg.hours||null, pkg.sessions||null, start_date, expiry.toISOString().split('T')[0], existing.id]
          );
        } else {
          await db.query(
            `INSERT INTO member_packages (member_id,package_id,hours_total,hours_used,sessions_total,sessions_used,start_date,expiry_date,paid,status) VALUES ($1,$2,$3,0,$4,0,$5,$6,FALSE,'active')`,
            [req.params.id, package_id, pkg.hours||null, pkg.sessions||null, start_date, expiry.toISOString().split('T')[0]]
          );
        }
      }
    }
    res.json({ message: 'แก้ไขสมาชิกสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/members/:id', async (req, res) => {
  try {
    await db.query(`UPDATE members SET active=FALSE WHERE id=$1`, [req.params.id]);
    res.json({ message: 'ลบสมาชิกแล้ว' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PACKAGES ──────────────────────────────────────────
app.get('/api/packages', async (req, res) => {
  try {
    res.json(await db.query(`
      SELECT p.*, COUNT(mp.id) AS member_count
      FROM packages p
      LEFT JOIN member_packages mp ON mp.package_id=p.id AND mp.status='active'
      WHERE p.active=TRUE
      GROUP BY p.id ORDER BY p.price ASC
    `));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/packages', async (req, res) => {
  try {
    const { name, type, price, hours, sessions, validity_days, description } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'name และ price จำเป็น' });
    const [r] = await db.query(
      `INSERT INTO packages (name,type,price,hours,sessions,validity_days,description) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, type||'monthly', price, hours||null, sessions||null, validity_days||30, description||'']
    );
    res.json({ id: r.id, message: 'เพิ่มแพ็กเกจสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/packages/:id', async (req, res) => {
  try {
    const { name, type, price, hours, sessions, validity_days, description } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'name และ price จำเป็น' });
    await db.query(
      `UPDATE packages SET name=$1, type=$2, price=$3, hours=$4, sessions=$5, validity_days=$6, description=$7 WHERE id=$8`,
      [name, type||'monthly', price, hours||null, sessions||null, validity_days||30, description||'', req.params.id]
    );
    res.json({ message: 'แก้ไขแพ็กเกจสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/packages/:id', async (req, res) => {
  try {
    await db.query(`UPDATE packages SET active=FALSE WHERE id=$1`, [req.params.id]);
    res.json({ message: 'ลบแพ็กเกจแล้ว' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SESSIONS ──────────────────────────────────────────
app.get('/api/sessions', async (req, res) => {
  try {
    const { date, member_id } = req.query;
    let sql = `
      SELECT s.id, s.type, s.topic, s.hours_used, s.status, s.member_pkg_id,
             s.session_date::text AS session_date,
             s.session_time::text AS session_time,
             m.fname, m.lname, t.name AS trainer_name
      FROM sessions s
      JOIN members m ON m.id = s.member_id
      LEFT JOIN trainers t ON t.id = s.trainer_id
      WHERE 1=1
    `;
    const params = [];
    if (date)      { params.push(date);      sql += ` AND s.session_date = $${params.length}`; }
    if (member_id) { params.push(member_id); sql += ` AND s.member_id = $${params.length}`; }
    sql += ` ORDER BY s.session_time ASC`;
    res.json(await db.query(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { member_id, trainer_id, type, topic, session_date, session_time, hours_used } = req.body;
    if (!member_id || !session_date || !session_time) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    const [mp] = await db.query(
      `SELECT id FROM member_packages WHERE member_id=$1 AND status IN ('active','expiring') ORDER BY created_at DESC LIMIT 1`,
      [member_id]
    );
    const [r] = await db.query(
      `INSERT INTO sessions (member_id,member_pkg_id,trainer_id,type,topic,session_date,session_time,hours_used,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'upcoming') RETURNING id`,
      [member_id, mp?.id||null, trainer_id||null, type||'PT', topic||'', session_date, session_time, hours_used||1.0]
    );
    res.json({ id: r.id, message: 'บันทึกเซสชั่นสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/sessions/:id/done', async (req, res) => {
  try {
    const [s] = await db.query(`SELECT * FROM sessions WHERE id=$1`, [req.params.id]);
    if (!s) return res.status(404).json({ error: 'ไม่พบเซสชั่น' });
    await db.query(`UPDATE sessions SET status='done' WHERE id=$1`, [req.params.id]);
    if (s.member_pkg_id && s.hours_used) {
      await db.query(
        `UPDATE member_packages SET hours_used = hours_used + $1 WHERE id=$2`,
        [s.hours_used, s.member_pkg_id]
      );
      // อัปเดต status หลังหักชั่วโมง
      await db.query(`
        UPDATE member_packages SET status =
          CASE
            WHEN (hours_total - hours_used) <= 0 THEN 'expired'
            WHEN expiry_date < CURRENT_DATE THEN 'expired'
            WHEN (hours_total - hours_used) <= 2 THEN 'expiring'
            ELSE status
          END
        WHERE id=$1
      `, [s.member_pkg_id]);
    }
    res.json({ message: 'บันทึกเซสชั่นเสร็จสิ้น' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BOOKINGS ──────────────────────────────────────────
app.get('/api/bookings', async (req, res) => {
  try {
    const m = req.query.month || new Date().getMonth() + 1;
    const y = req.query.year  || new Date().getFullYear();
    res.json(await db.query(`
      SELECT b.id, b.type, b.status,
             b.booking_date::text AS booking_date,
             b.booking_time::text AS booking_time,
             m.fname, m.lname, t.name AS trainer_name
      FROM bookings b
      JOIN members m ON m.id = b.member_id
      LEFT JOIN trainers t ON t.id = b.trainer_id
      WHERE EXTRACT(MONTH FROM b.booking_date)=$1 AND EXTRACT(YEAR FROM b.booking_date)=$2
      ORDER BY b.booking_date ASC, b.booking_time ASC
    `, [m, y]));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const { member_id, trainer_id, booking_date, booking_time, type, notes } = req.body;
    if (!member_id || !booking_date || !booking_time) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    const [r] = await db.query(
      `INSERT INTO bookings (member_id,trainer_id,booking_date,booking_time,type,notes,status) VALUES ($1,$2,$3,$4,$5,$6,'confirmed') RETURNING id`,
      [member_id, trainer_id||null, booking_date, booking_time, type||'PT', notes||'']
    );
    res.json({ id: r.id, message: 'จองนัดสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await db.query(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [req.params.id]);
    res.json({ message: 'ยกเลิกการจองแล้ว' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PAYMENTS ──────────────────────────────────────────
app.get('/api/payments', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT pay.id, pay.amount, pay.method, pay.note,
             pay.payment_date::text AS payment_date,
             m.fname, m.lname, p.name AS pkg_name
      FROM payments pay
      JOIN members m ON m.id = pay.member_id
      LEFT JOIN member_packages mp ON mp.id = pay.member_pkg_id
      LEFT JOIN packages p ON p.id = mp.package_id
      ORDER BY pay.payment_date DESC, pay.created_at DESC LIMIT 50
    `);
    const [mt] = await db.query(`SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE DATE_TRUNC('month',payment_date)=DATE_TRUNC('month',CURRENT_DATE)`);
    const [pt] = await db.query(`SELECT COALESCE(SUM(p.amount),0) AS n FROM payments p JOIN member_packages mp ON p.member_pkg_id=mp.id WHERE mp.paid=FALSE`);
    const m30 = await db.query(`
      SELECT payment_date::date AS day, SUM(amount) AS total
      FROM payments WHERE payment_date >= CURRENT_DATE - INTERVAL '29 days'
      GROUP BY payment_date::date ORDER BY day ASC
    `);
    res.json({ rows, month_total: mt.n, pending_total: pt.n, monthly30: m30 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/payments', async (req, res) => {
  try {
    const { member_id, member_pkg_id, amount, method, payment_date, note } = req.body;
    if (!member_id || !amount) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    const today = new Date().toISOString().split('T')[0];
    const [r] = await db.query(
      `INSERT INTO payments (member_id,member_pkg_id,amount,method,payment_date,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [member_id, member_pkg_id||null, amount, method||'transfer', payment_date||today, note||'']
    );
    if (member_pkg_id) await db.query(`UPDATE member_packages SET paid=TRUE WHERE id=$1`, [member_pkg_id]);
    res.json({ id: r.id, message: 'บันทึกรายรับสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TRAINERS ──────────────────────────────────────────
app.get('/api/trainers', async (req, res) => {
  try {
    res.json(await db.query(`SELECT * FROM trainers WHERE active=TRUE ORDER BY name`));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FRONTEND ──────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.listen(PORT, () => {
  console.log(`\n🏋️  IronDesk รันที่ http://localhost:${PORT}`);
  console.log(`🐘  PostgreSQL: ${process.env.DATABASE_URL?.split('@')[1] || 'local'}\n`);
});