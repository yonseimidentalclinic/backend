// /config/db.js

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/**
 * 서버 시작 시 모든 데이터베이스 테이블이 존재하는지 확인하고 없으면 생성합니다.
 */
const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    console.log('데이터베이스에 성공적으로 연결되었습니다.');
    
    // 테이블 생성 쿼리들
    const queries = [
      `CREATE TABLE IF NOT EXISTS notices (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100), content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `ALTER TABLE notices ADD COLUMN IF NOT EXISTS category VARCHAR(100);`,
      `CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS consultations (id SERIAL PRIMARY KEY, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, is_secret BOOLEAN DEFAULT TRUE, is_answered BOOLEAN DEFAULT FALSE, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      
      // --- 핵심 수정: posts와 consultations 테이블에 이미지 데이터 컬럼을 추가합니다. ---
      `ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_data TEXT;`,
      `ALTER TABLE consultations ADD COLUMN IF NOT EXISTS image_data TEXT;`,

      `CREATE TABLE IF NOT EXISTS replies (id SERIAL PRIMARY KEY, consultation_id INTEGER NOT NULL REFERENCES consultations(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS doctors (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, position VARCHAR(100) NOT NULL, history TEXT, image_data TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS about_content (id INT PRIMARY KEY DEFAULT 1, title TEXT, subtitle TEXT, content TEXT, image_data TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `INSERT INTO about_content (id, title, subtitle, content) VALUES (1, '연세미치과 이야기', '환자 한 분 한 분의 건강한 미소를 위해, 저희는 보이지 않는 곳까지 정성을 다합니다.', '연세미치과는 단순히 아픈 곳을 치료하는 것을 넘어, 환자분들의 삶의 질을 높이는 것을 목표로 합니다.') ON CONFLICT (id) DO NOTHING;`,
      `CREATE TABLE IF NOT EXISTS clinic_photos (id SERIAL PRIMARY KEY, caption VARCHAR(255), image_data TEXT NOT NULL, display_order SERIAL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS post_comments (id SERIAL PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, content TEXT NOT NULL, likes INTEGER DEFAULT 0, tags TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;`,
      `ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS tags TEXT;`,
      `CREATE TABLE IF NOT EXISTS reservations (id SERIAL PRIMARY KEY, patient_name VARCHAR(100) NOT NULL, phone_number VARCHAR(100) NOT NULL, desired_date DATE NOT NULL, desired_time VARCHAR(50) NOT NULL, notes TEXT, status VARCHAR(50) DEFAULT 'pending', created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS case_photos (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100), description TEXT, before_image_data TEXT, after_image_data TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS faqs (id SERIAL PRIMARY KEY, category VARCHAR(100) NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS blocked_slots (id SERIAL PRIMARY KEY, slot_date DATE NOT NULL, slot_time VARCHAR(50) NOT NULL, UNIQUE(slot_date, slot_time));`,
      `CREATE TABLE IF NOT EXISTS reviews (id SERIAL PRIMARY KEY, patient_name VARCHAR(100) NOT NULL, rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5), content TEXT NOT NULL, is_approved BOOLEAN DEFAULT FALSE, admin_reply TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS admin_logs (id SERIAL PRIMARY KEY, action VARCHAR(100) NOT NULL, ip_address VARCHAR(100), created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`
    ];

    for (const query of queries) {
      await client.query(query);
    }
    
    console.log('모든 테이블이 준비되었습니다.');

  } catch (err) {
    console.error('데이터베이스 초기화 중 오류가 발생했습니다:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

module.exports = { pool, initializeDatabase };
