const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // 1. pg 라이브러리에서 Pool을 가져옵니다.

const app = express();
const port = process.env.PORT || 3001;

// --- Middleware 설정 ---
app.use(cors());
app.use(express.json());

// --- 데이터베이스 연결 설정 ---
// Render에 설정한 DATABASE_URL 환경 변수를 사용해 연결 풀(Pool)을 생성합니다.
// SSL/TLS 연결을 필수로 설정합니다. Render 데이터베이스는 보안 연결이 필요합니다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- 데이터베이스 테이블 생성 함수 ---
// 서버가 시작될 때 'contacts' 테이블이 없으면 자동으로 생성합니다.
const createTable = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(queryText);
    console.log("'contacts' 테이블이 성공적으로 준비되었습니다.");
  } catch (err) {
    console.error("'contacts' 테이블 생성 중 오류 발생:", err);
  }
};

// --- API 라우트(경로) 설정 ---
app.get('/', (req, res) => {
  res.send('연세미치과 백엔드 서버가 정상적으로 동작 중입니다.');
});

app.post('/api/contact', async (req, res) => { // async 키워드 추가
  const { name, email, message } = req.body;
  console.log('클라이언트로부터 받은 데이터:', { name, email, message });

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
  }

  // --- 데이터베이스에 데이터 저장 ---
  const queryText = 'INSERT INTO contacts(name, email, message) VALUES($1, $2, $3) RETURNING *';
  const values = [name, email, message];

  try {
    await pool.query(queryText, values); // 쿼리 실행
    res.status(201).json({ success: true, message: '문의가 성공적으로 접수되어 데이터베이스에 저장되었습니다.' });
  } catch (err) {
    console.error('데이터베이스 저장 중 오류 발생:', err);
    res.status(500).json({ success: false, message: '서버 내부 오류로 문의 접수에 실패했습니다.' });
  }
});

// --- 서버 실행 및 테이블 생성 ---
app.listen(port, () => {
  console.log(`백엔드 서버가 ${port}번 포트에서 실행 중입니다.`);
  // 서버가 켜지면 테이블 생성 함수를 실행합니다.
  createTable();
});
