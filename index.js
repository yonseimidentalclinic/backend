('dotenv').config(); require// .env 파일의 환경 변수를 불러옵니다. (코드 최상단에 위치)

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3001;

// --- Middleware 설정 ---
app.use(cors());
app.use(express.json());

// --- 데이터베이스 연결 설정 ---
// 이제 process.env.DATABASE_URL은 로컬에서는 .env 파일을 통해,
// Render 서버에서는 Render의 환경 변수를 통해 값을 가져옵니다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- 데이터베이스 테이블 생성 함수 ---
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

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  console.log('클라이언트로부터 받은 데이터:', { name, email, message });

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' });
  }

  // --- 데이터베이스에 데이터 저장 ---
  const queryText = 'INSERT INTO contacts(name, email, message) VALUES($1, $2, $3) RETURNING *';
  const values = [name, email, message];

  try {
    await pool.query(queryText, values);
    res.status(201).json({ success: true, message: '문의가 성공적으로 접수되어 데이터베이스에 저장되었습니다.' });
  } catch (err) {
    console.error('데이터베이스 저장 중 오류 발생:', err);
    res.status(500).json({ success: false, message: '서버 내부 오류로 문의 접수에 실패했습니다.' });
  }
});

// --- 서버 실행 및 테이블 생성 ---
app.listen(port, () => {
  console.log(`백엔드 서버가 ${port}번 포트에서 실행 중입니다.`);
  createTable();
});
