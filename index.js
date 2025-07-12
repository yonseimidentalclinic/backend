require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3001;
const saltRounds = 10;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- 테이블 생성 함수들 ---
const createTables = async () => {
    // ... (기존 테이블 생성 쿼리는 동일)
    const contactsTableQuery = `CREATE TABLE IF NOT EXISTS contacts (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(100) NOT NULL, message TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`;
    const noticesTableQuery = `CREATE TABLE IF NOT EXISTS notices (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`;
    // 'reply'와 'replied_at' 컬럼 추가
    const consultationsTableQuery = `
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        author VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        is_secret BOOLEAN DEFAULT false,
        reply TEXT,
        replied_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    try {
        await pool.query(contactsTableQuery);
        await pool.query(noticesTableQuery);
        await pool.query(consultationsTableQuery);
        console.log("모든 테이블이 성공적으로 준비되었습니다.");
    } catch (err) {
        console.error("테이블 생성 중 오류 발생:", err);
    }
};


// --- 관리자 인증 미들웨어 ---
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};


// --- API 라우트(경로) 설정 ---
// ... (기존 사용자 API 및 관리자 로그인/대시보드 API는 동일) ...
app.get('/', (req, res) => { res.send('연세미치과 백엔드 서버가 정상적으로 동작 중입니다.'); });
app.post('/api/contact', async (req, res) => { const { name, email, message } = req.body; const queryText = 'INSERT INTO contacts(name, email, message) VALUES($1, $2, $3) RETURNING *'; const values = [name, email, message]; try { await pool.query(queryText, values); res.status(201).json({ success: true, message: '문의가 성공적으로 접수되어 데이터베이스에 저장되었습니다.' }); } catch (err) { console.error('데이터베이스 저장 중 오류 발생:', err); res.status(500).json({ success: false, message: '서버 내부 오류로 문의 접수에 실패했습니다.' }); } });
app.get('/api/notices', async (req, res) => { try { const queryText = 'SELECT * FROM notices ORDER BY created_at DESC'; const result = await pool.query(queryText); res.status(200).json(result.rows); } catch (err) { console.error('공지사항 조회 중 오류 발생:', err); res.status(500).json({ success: false, message: '공지사항을 불러오는 데 실패했습니다.' }); } });
app.get('/api/notices/:id', async (req, res) => { const { id } = req.params; try { const queryText = 'SELECT * FROM notices WHERE id = $1'; const { rows } = await pool.query(queryText, [id]); if (rows.length > 0) { res.status(200).json(rows[0]); } else { res.status(404).json({ success: false, message: '해당 공지사항을 찾을 수 없습니다.' }); } } catch (err) { console.error('단일 공지사항 조회 중 오류 발생:', err); res.status(500).json({ success: false, message: '공지사항을 불러오는 데 실패했습니다.' }); } });
app.post('/api/consultations', async (req, res) => { const { author, password, title, content, is_secret } = req.body; if (!author || !password || !title || !content) { return res.status(400).json({ success: false, message: '모든 필수 항목을 입력해주세요.' }); } try { const hashedPassword = await bcrypt.hash(password, saltRounds); const queryText = 'INSERT INTO consultations(author, password, title, content, is_secret) VALUES($1, $2, $3, $4, $5) RETURNING id'; const values = [author, hashedPassword, title, content, is_secret]; const result = await pool.query(queryText, values); res.status(201).json({ success: true, message: '상담 글이 성공적으로 등록되었습니다.', consultationId: result.rows[0].id }); } catch (err) { console.error('상담 글 작성 중 오류 발생:', err); res.status(500).json({ success: false, message: '서버 오류로 글 등록에 실패했습니다.' }); } });
app.get('/api/consultations', async (req, res) => { try { const queryText = 'SELECT id, author, title, is_secret, created_at FROM consultations ORDER BY created_at DESC'; const { rows } = await pool.query(queryText); res.status(200).json(rows); } catch (err) { console.error('상담 목록 조회 중 오류 발생:', err); res.status(500).json({ success: false, message: '목록을 불러오는 데 실패했습니다.' }); } });
app.get('/api/consultations/:id', async (req, res) => { const { id } = req.params; try { const queryText = 'SELECT id, author, title, is_secret, created_at FROM consultations WHERE id = $1'; const { rows } = await pool.query(queryText, [id]); if (rows.length > 0) { res.status(200).json(rows[0]); } else { res.status(404).json({ success: false, message: '해당 글을 찾을 수 없습니다.' }); } } catch (err) { console.error('상담 상세 조회 중 오류 발생:', err); res.status(500).json({ success: false, message: '글을 불러오는 데 실패했습니다.' }); } });
app.post('/api/consultations/:id/verify', async (req, res) => { const { id } = req.params; const { password } = req.body; try { const queryText = 'SELECT * FROM consultations WHERE id = $1'; const { rows } = await pool.query(queryText, [id]); if (rows.length === 0) { return res.status(404).json({ success: false, message: '해당 글을 찾을 수 없습니다.' }); } const consultation = rows[0]; const match = await bcrypt.compare(password, consultation.password); if (match) { res.status(200).json({ success: true, consultation }); } else { res.status(401).json({ success: false, message: '비밀번호가 일치하지 않습니다.' }); } } catch (err) { console.error('비밀번호 확인 중 오류 발생:', err); res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' }); } });
app.post('/api/admin/login', (req, res) => { const { password } = req.body; if (password === process.env.ADMIN_PASSWORD) { const token = jwt.sign({ isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '3h' }); res.status(200).json({ success: true, token }); } else { res.status(401).json({ success: false, message: '비밀번호가 올바르지 않습니다.' }); } });
app.get('/api/admin/dashboard', verifyToken, async (req, res) => { try { const consultationQuery = 'SELECT id, title, author, created_at FROM consultations ORDER BY created_at DESC LIMIT 5'; const noticeQuery = 'SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT 5'; const [consultationResult, noticeResult] = await Promise.all([ pool.query(consultationQuery), pool.query(noticeQuery) ]); res.status(200).json({ latestConsultations: consultationResult.rows, latestNotices: noticeResult.rows, }); } catch (err) { console.error('대시보드 데이터 조회 중 오류 발생:', err); res.status(500).json({ success: false, message: '데이터를 불러오는 데 실패했습니다.' }); } });


// --- 관리자 상담 관리 API (새로 추가) ---

// 1. 모든 상담 목록 가져오기 (관리자용)
app.get('/api/admin/consultations', verifyToken, async (req, res) => {
  try {
    const queryText = 'SELECT id, title, author, is_secret, reply, created_at FROM consultations ORDER BY created_at DESC';
    const { rows } = await pool.query(queryText);
    res.status(200).json(rows);
  } catch (err) {
    console.error('관리자 상담 목록 조회 중 오류 발생:', err);
    res.status(500).json({ success: false, message: '목록 조회에 실패했습니다.' });
  }
});

// 2. 특정 상담 상세 내용 가져오기 (관리자용, 비밀번호 필요 없음)
app.get('/api/admin/consultations/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const queryText = 'SELECT * FROM consultations WHERE id = $1';
    const { rows } = await pool.query(queryText, [id]);
    if (rows.length > 0) {
      res.status(200).json(rows[0]);
    } else {
      res.status(404).json({ success: false, message: '해당 글을 찾을 수 없습니다.' });
    }
  } catch (err) {
    console.error('관리자 상담 상세 조회 중 오류 발생:', err);
    res.status(500).json({ success: false, message: '상세 내용 조회에 실패했습니다.' });
  }
});

// 3. 답변 등록 및 수정하기
app.post('/api/admin/consultations/:id/reply', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { reply } = req.body;
  try {
    const queryText = 'UPDATE consultations SET reply = $1, replied_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *';
    const { rows } = await pool.query(queryText, [reply, id]);
    res.status(200).json({ success: true, message: '답변이 성공적으로 등록되었습니다.', updatedConsultation: rows[0] });
  } catch (err) {
    console.error('답변 등록 중 오류 발생:', err);
    res.status(500).json({ success: false, message: '답변 등록에 실패했습니다.' });
  }
});


// --- 서버 실행 ---
app.listen(port, () => {
  console.log(`백엔드 서버가 ${port}번 포트에서 실행 중입니다.`);
  createTables();
});
