require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const createContactsTable = async () => {
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

const createNoticesTable = async () => {
  const tableQuery = `
    CREATE TABLE IF NOT EXISTS notices (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(tableQuery);
    console.log("'notices' 테이블이 성공적으로 준비되었습니다.");

    const res = await pool.query('SELECT COUNT(*) FROM notices');
    if (res.rows[0].count === '0') {
      console.log("'notices' 테이블에 초기 데이터를 추가합니다.");
      const seedQuery = `
        INSERT INTO notices (title, content) VALUES
        ('여름맞이 치아미백 이벤트 안내', '안녕하세요, 연세미치과입니다. 시원한 여름을 맞아 치아미백 이벤트를 진행합니다. 자세한 내용은 문의해주세요.'),
        ('새로운 3D CT 장비 도입 안내', '더욱 정확하고 안전한 진단을 위해 최신 3D CT 장비를 도입하였습니다. 환자분들께 더 나은 의료 서비스를 제공하기 위해 항상 노력하겠습니다.'),
        ('홈페이지 리뉴얼 오픈!', '연세미치과 홈페이지가 새롭게 단장했습니다. 앞으로 다양한 소식과 유용한 정보로 찾아뵙겠습니다. 감사합니다.');
      `;
      await pool.query(seedQuery);
    }
  } catch (err) {
    console.error("'notices' 테이블 준비 중 오류 발생:", err);
  }
};


// --- API 라우트(경로) 설정 ---
app.get('/', (req, res) => {
  res.send('연세미치과 백엔드 서버가 정상적으로 동작 중입니다.');
});

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
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

// --- 공지사항 목록을 가져오는 API ---
app.get('/api/notices', async (req, res) => {
  try {
    const queryText = 'SELECT * FROM notices ORDER BY created_at DESC';
    const result = await pool.query(queryText);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('공지사항 조회 중 오류 발생:', err);
    res.status(500).json({ success: false, message: '공지사항을 불러오는 데 실패했습니다.' });
  }
});

// --- 단일 공지사항을 가져오는 API (새로 추가) ---
app.get('/api/notices/:id', async (req, res) => {
  const { id } = req.params; // URL에서 id 파라미터 추출
  try {
    const queryText = 'SELECT * FROM notices WHERE id = $1';
    const { rows } = await pool.query(queryText, [id]);
    if (rows.length > 0) {
      res.status(200).json(rows[0]);
    } else {
      res.status(404).json({ success: false, message: '해당 공지사항을 찾을 수 없습니다.' });
    }
  } catch (err) {
    console.error('단일 공지사항 조회 중 오류 발생:', err);
    res.status(500).json({ success: false, message: '공지사항을 불러오는 데 실패했습니다.' });
  }
});


// --- 서버 실행 및 테이블 생성 ---
app.listen(port, () => {
  console.log(`백엔드 서버가 ${port}번 포트에서 실행 중입니다.`);
  createContactsTable();
  createNoticesTable();
});
