// server/setup-db.js
// รัน: node server/setup-db.js
require('dotenv').config();
const { pool } = require('./db');

async function setup() {
  const client = await pool.connect();
  console.log('✅ เชื่อมต่อ PostgreSQL สำเร็จ');

  try {
    await client.query('BEGIN');

    // ── SCHEMA ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id            SERIAL PRIMARY KEY,
        name          VARCHAR(100) NOT NULL,
        type          VARCHAR(30)  NOT NULL CHECK (type IN ('PT_hours','monthly','class_sessions','bundle')),
        price         NUMERIC(10,2) NOT NULL,
        hours         NUMERIC(5,1) DEFAULT NULL,
        sessions      INT          DEFAULT NULL,
        validity_days INT          NOT NULL DEFAULT 30,
        description   VARCHAR(255) DEFAULT '',
        active        BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMP    DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trainers (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        specialty  VARCHAR(100) DEFAULT '',
        phone      VARCHAR(20)  DEFAULT '',
        active     BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP    DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        id           SERIAL PRIMARY KEY,
        fname        VARCHAR(100) NOT NULL,
        lname        VARCHAR(100) NOT NULL DEFAULT '',
        phone        VARCHAR(20)  NOT NULL,
        email        VARCHAR(150) DEFAULT NULL,
        goal         TEXT         DEFAULT NULL,
        trainer_id   INT          DEFAULT NULL REFERENCES trainers(id) ON DELETE SET NULL,
        color        VARCHAR(20)  DEFAULT 'orange',
        active       BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMP    DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS member_packages (
        id             SERIAL PRIMARY KEY,
        member_id      INT           NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        package_id     INT           NOT NULL REFERENCES packages(id),
        hours_total    NUMERIC(5,1)  DEFAULT NULL,
        hours_used     NUMERIC(5,1)  DEFAULT 0,
        sessions_total INT           DEFAULT NULL,
        sessions_used  INT           DEFAULT 0,
        start_date     DATE          NOT NULL,
        expiry_date    DATE          NOT NULL,
        paid           BOOLEAN       NOT NULL DEFAULT FALSE,
        status         VARCHAR(20)   DEFAULT 'active' CHECK (status IN ('active','expiring','expired')),
        created_at     TIMESTAMP     DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id             SERIAL PRIMARY KEY,
        member_id      INT          NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        member_pkg_id  INT          DEFAULT NULL REFERENCES member_packages(id) ON DELETE SET NULL,
        trainer_id     INT          DEFAULT NULL REFERENCES trainers(id) ON DELETE SET NULL,
        type           VARCHAR(20)  NOT NULL DEFAULT 'PT' CHECK (type IN ('PT','group_class','checkin')),
        topic          VARCHAR(150) DEFAULT '',
        session_date   DATE         NOT NULL,
        session_time   TIME         NOT NULL,
        hours_used     NUMERIC(4,1) DEFAULT 1.0,
        status         VARCHAR(20)  DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','done','cancelled')),
        notes          TEXT         DEFAULT '',
        created_at     TIMESTAMP    DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id            SERIAL PRIMARY KEY,
        member_id     INT         NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        trainer_id    INT         DEFAULT NULL REFERENCES trainers(id) ON DELETE SET NULL,
        booking_date  DATE        NOT NULL,
        booking_time  TIME        NOT NULL,
        type          VARCHAR(20) NOT NULL DEFAULT 'PT' CHECK (type IN ('PT','group_class')),
        status        VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed')),
        notes         TEXT        DEFAULT '',
        created_at    TIMESTAMP   DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id             SERIAL PRIMARY KEY,
        member_id      INT           NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        member_pkg_id  INT           DEFAULT NULL REFERENCES member_packages(id) ON DELETE SET NULL,
        amount         NUMERIC(10,2) NOT NULL,
        method         VARCHAR(20)   DEFAULT 'transfer' CHECK (method IN ('transfer','cash','credit_card','qr')),
        payment_date   DATE          NOT NULL,
        note           VARCHAR(255)  DEFAULT '',
        created_at     TIMESTAMP     DEFAULT NOW()
      )
    `);

    console.log('✅ สร้างตารางทั้งหมดแล้ว');

    // ── SEED DATA ──────────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];

    // Packages
    const pkgCount = await client.query('SELECT COUNT(*) FROM packages');
    if (parseInt(pkgCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO packages (name,type,price,hours,sessions,validity_days,description) VALUES
        ('PT รายชั่วโมง 10 ชม.','PT_hours',5000,10,NULL,60,'500 บาท/ชั่วโมง'),
        ('PT รายชั่วโมง 20 ชม.','PT_hours',8000,20,NULL,90,'400 บาท/ชั่วโมง'),
        ('รายเดือน (ไม่จำกัด)','monthly',1200,NULL,NULL,30,'เข้าได้ไม่จำกัด'),
        ('คลาสกลุ่ม 10 ครั้ง','class_sessions',1800,NULL,10,60,'180 บาท/ครั้ง'),
        ('3 เดือน (ประหยัด)','bundle',3000,NULL,NULL,90,'1,000 บาท/เดือน')
      `);
    }

    // Trainers
    const trCount = await client.query('SELECT COUNT(*) FROM trainers');
    if (parseInt(trCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO trainers (name,specialty,phone) VALUES
        ('อ.แดง','Weight Training, Functional','091-111-0001'),
        ('อ.ขาว','Cardio, Muay Thai','091-111-0002'),
        ('อ.นก','Yoga, Pilates, Group Class','091-111-0003')
      `);
    }

    // Members
    const memCount = await client.query('SELECT COUNT(*) FROM members');
    if (parseInt(memCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO members (fname,lname,phone,email,trainer_id,color) VALUES
        ('สมหมาย','กาญจนา','081-234-5678','sommai@email.com',1,'blue'),
        ('รัตนา','บุญมี','082-345-6789','rattana@email.com',2,'green'),
        ('ธนวัฒน์','มณีรัตน์','083-456-7890','tanawat@email.com',1,'amber'),
        ('สมพร','วงศ์ศรี','084-567-8901','somporn@email.com',1,'orange'),
        ('วิชัย','ปัญญา','085-678-9012','wichai@email.com',NULL,'purple'),
        ('นภา','คำแหง','086-789-0123','napa@email.com',1,'orange'),
        ('อนันต์','รักไทย','087-890-1234','anan@email.com',3,'blue'),
        ('มาลี','สุขใจ','088-901-2345','malee@email.com',NULL,'green')
      `);

      await client.query(`
        INSERT INTO member_packages (member_id,package_id,hours_total,hours_used,sessions_total,sessions_used,start_date,expiry_date,paid,status) VALUES
        (1,1,10,4,NULL,NULL,'2026-05-15','2026-07-15',TRUE,'active'),
        (2,1,10,6,NULL,NULL,'2026-05-02','2026-07-02',TRUE,'active'),
        (3,3,NULL,NULL,NULL,NULL,'2026-06-01','2026-06-30',TRUE,'expiring'),
        (4,1,10,9,NULL,NULL,'2026-05-20','2026-07-20',TRUE,'expiring'),
        (5,3,NULL,NULL,NULL,NULL,'2026-06-01','${today}',FALSE,'expired'),
        (6,2,20,18,NULL,NULL,'2026-05-10','2026-08-10',TRUE,'active'),
        (7,4,NULL,NULL,10,3,'2026-05-25','2026-07-25',TRUE,'active'),
        (8,5,NULL,NULL,NULL,NULL,'2026-06-01','2026-09-01',TRUE,'active')
      `);

      await client.query(`
        INSERT INTO sessions (member_id,member_pkg_id,trainer_id,type,topic,session_date,session_time,hours_used,status) VALUES
        (1,1,1,'PT','ยกน้ำหนัก','${today}','08:00:00',1.0,'done'),
        (2,2,2,'PT','คาร์ดิโอ','${today}','09:30:00',1.0,'done'),
        (3,3,1,'PT','Full Body','${today}','11:00:00',1.0,'active'),
        (7,7,3,'group_class','Yoga','${today}','13:00:00',1.0,'upcoming'),
        (4,4,1,'PT','Functional','${today}','15:00:00',1.0,'upcoming'),
        (6,6,2,'PT','Strength','${today}','17:00:00',1.5,'upcoming'),
        (7,7,3,'group_class','Muay Thai','${today}','18:30:00',1.0,'upcoming')
      `);

      await client.query(`
        INSERT INTO payments (member_id,member_pkg_id,amount,method,payment_date,note) VALUES
        (4,4,5000,'transfer','2026-06-11','PT 10 ชม.'),
        (7,7,1800,'cash','2026-06-10','คลาส 10 ครั้ง'),
        (3,3,1200,'transfer','2026-06-09','รายเดือน'),
        (6,6,8000,'credit_card','2026-06-08','PT 20 ชม.'),
        (8,8,3000,'qr','2026-06-07','3 เดือน'),
        (1,1,5000,'transfer','2026-05-15','PT 10 ชม.'),
        (2,2,5000,'transfer','2026-05-02','PT 10 ชม.')
      `);
    }

    await client.query('COMMIT');
    console.log('✅ ใส่ข้อมูลตัวอย่างแล้ว');
    console.log('\n🎉 Setup เสร็จสมบูรณ์! รัน: npm start');
  } catch(e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

setup().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
