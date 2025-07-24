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
    
    // 테이블 생성 및 수정 쿼리 배열
    // 순서가 중요합니다. (users -> posts/consultations 등)
    const queries = [
      // 1. users 테이블 (사용자 정보)
      // 다른 테이블들이 참조해야 하므로 가장 먼저 생성합니다.
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );`,

      // 2. notices 테이블 (공지사항)
      `CREATE TABLE IF NOT EXISTS notices (
        id SERIAL PRIMARY KEY, 
        title VARCHAR(255) NOT NULL, 
        category VARCHAR(100), 
        content TEXT NOT NULL, 
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), 
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        image_data TEXT
      );`,

      // 3. posts 테이블 (자유게시판)
      // user_id 와 image_data를 생성 시점에 포함합니다.
      `CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY, 
        author VARCHAR(100) NOT NULL, 
        password VARCHAR(255) NOT NULL, 
        title VARCHAR(255) NOT NULL, 
        content TEXT NOT NULL, 
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), 
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        image_data TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      );`,

      // 4. consultations 테이블 (온라인 상담)
      // user_id 와 image_data를 생성 시점에 포함합니다.
      `CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY, 
        author VARCHAR(100) NOT NULL, 
        password VARCHAR(255), 
        title VARCHAR(255) NOT NULL, 
        content TEXT NOT NULL, 
        is_secret BOOLEAN DEFAULT TRUE, 
        is_answered BOOLEAN DEFAULT FALSE, 
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), 
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        image_data TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      );`,
      
      // 5. post_comments 테이블 (자유게시판 댓글)
      `CREATE TABLE IF NOT EXISTS post_comments (
        id SERIAL PRIMARY KEY, 
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, 
        author VARCHAR(100) NOT NULL, 
        password VARCHAR(255) NOT NULL, 
        content TEXT NOT NULL, 
        likes INTEGER DEFAULT 0, 
        tags TEXT, 
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );`,
      
      // 6. reservations 테이블 (예약)
      `CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY, 
        patient_name VARCHAR(100) NOT NULL, 
        phone_number VARCHAR(100) NOT NULL, 
        desired_date DATE NOT NULL, 
        desired_time VARCHAR(50) NOT NULL, 
        notes TEXT, 
        status VARCHAR(50) DEFAULT 'pending', 
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      );`,

      // 7. reviews 테이블 (치료 후기)
      `CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY, 
        patient_name VARCHAR(100) NOT NULL, 
        rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5), 
        content TEXT NOT NULL, 
        is_approved BOOLEAN DEFAULT FALSE, 
        admin_reply TEXT, 
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        image_data TEXT
      );`,
      
      // 8. 기타 테이블들
      `CREATE TABLE IF NOT EXISTS replies (id SERIAL PRIMARY KEY, consultation_id INTEGER NOT NULL REFERENCES consultations(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS doctors (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, position VARCHAR(100) NOT NULL, history TEXT, image_data TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS about_content (id INT PRIMARY KEY DEFAULT 1, title TEXT, subtitle TEXT, content TEXT, image_data TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS clinic_photos (id SERIAL PRIMARY KEY, caption VARCHAR(255), image_data TEXT NOT NULL, display_order SERIAL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS case_photos (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, category VARCHAR(100), description TEXT, before_image_data TEXT, after_image_data TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,
      `CREATE TABLE IF NOT EXISTS faqs (id SERIAL PRIMARY KEY, category VARCHAR(100) NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), image_data TEXT);`,
      `CREATE TABLE IF NOT EXISTS blocked_slots (id SERIAL PRIMARY KEY, slot_date DATE NOT NULL, slot_time VARCHAR(50) NOT NULL, UNIQUE(slot_date, slot_time));`,
      `CREATE TABLE IF NOT EXISTS admin_logs (id SERIAL PRIMARY KEY, action VARCHAR(100) NOT NULL, ip_address VARCHAR(100), created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`,

      // 9. 테이블 구조 변경 (ALTER TABLE)
      // 이미 테이블이 생성된 경우를 대비해, 누락된 컬럼들을 추가합니다.
      // [핵심 수정] posts 테이블에 user_id 컬럼 추가 (가장 중요했던 부분)
      `ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`,
      `ALTER TABLE consultations ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`,
      `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`,

      // 10. about_content 기본 데이터 삽입
      `INSERT INTO about_content (id, title, subtitle, content) VALUES (1, '연세미치과 이야기', '환자 한 분 한 분의 건강한 미소를 위해, 저희는 보이지 않는 곳까지 정성을 다합니다.', '연세미치과는 단순히 아픈 곳을 치료하는 것을 넘어, 환자분들의 삶의 질을 높이는 것을 목표로 합니다.') ON CONFLICT (id) DO NOTHING;`
    ];

    // 모든 쿼리를 순차적으로 실행
    for (const query of queries) {
      // 각 쿼리 실행 전후로 로그를 남겨 디버깅을 용이하게 할 수 있습니다.
      // console.log(`Executing query: ${query.substring(0, 100)}...`);
      await client.query(query);
    }
    
    console.log('모든 테이블이 성공적으로 준비되었습니다.');

  } catch (err) {
    console.error('데이터베이스 초기화 중 오류가 발생했습니다:', err);
    process.exit(1); // 초기화 실패 시 프로세스 종료
  } finally {
    client.release(); // 항상 연결을 반환
  }
}

module.exports = { pool, initializeDatabase };
