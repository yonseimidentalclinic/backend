// 필요한 모듈들을 가져옵니다.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Express 앱을 생성합니다.
const app = express();
const saltRounds = 10;

// 미들웨어를 설정합니다.
app.use(cors());
app.use(express.json());

// 데이터베이스 연결 풀(Pool)을 생성합니다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// JWT 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- API 라우트 ---

// 서버 상태 확인
app.get('/', (req, res) => {
  res.send('연세미치과 백엔드 서버가 정상적으로 작동 중입니다.');
});

// --- 관리자 API ---
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (password === adminPassword) {
    const accessToken = jwt.sign({ username: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ accessToken });
  } else {
    res.status(401).send('비밀번호가 일치하지 않습니다.');
  }
});

app.get('/api/admin/dashboard', authenticateToken, async (req, res) => {
  try {
    const noticeResult = await pool.query('SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT 5');
    const consultationResult = await pool.query('SELECT id, title, author, created_at FROM consultations ORDER BY created_at DESC LIMIT 5');
    
    // DB의 snake_case 컬럼명을 프론트엔드의 camelCase로 변환
    const notices = noticeResult.rows.map(n => ({ ...n, createdAt: n.created_at }));
    const consultations = consultationResult.rows.map(c => ({ ...c, createdAt: c.created_at }));

    res.json({ notices, consultations });
  } catch (err) {
    console.error('Error fetching dashboard data:', err.stack);
    res.status(500).json({ error: 'Server error while fetching dashboard data' });
  }
});

// --- 공지사항 API ---
app.get('/api/notices', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM notices');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query('SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        const notices = result.rows.map(n => ({ ...n, createdAt: n.created_at }));
        res.json({ notices, totalPages });
    } catch (err) {
        console.error('Error fetching notices:', err.stack);
        res.status(500).json({ error: 'Server error while fetching notices' });
    }
});
// (이하 공지사항 CRUD API는 이전과 동일하게 유지)

// --- 온라인 상담 API ---
app.get('/api/consultations', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM consultations');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query(`
            SELECT 
                c.id, c.title, c.author, c.is_secret, c.created_at, 
                EXISTS(SELECT 1 FROM replies r WHERE r.consultation_id = c.id) AS has_reply
            FROM consultations c
            ORDER BY c.created_at DESC 
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const consultations = result.rows.map(c => ({ 
            id: c.id,
            title: c.title,
            author: c.author,
            isSecret: c.is_secret, 
            createdAt: c.created_at, 
            replyId: c.has_reply ? c.id : null 
        }));
        res.json({ consultations, totalPages });
    } catch (err) {
        console.error('Error fetching consultations:', err.stack);
        res.status(500).json({ error: 'Server error while fetching consultations' });
    }
});
// (이하 상담 CRUD API는 이전과 동일하게 유지)


// --- 자유게시판 API ---
app.get('/api/posts', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM posts');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query('SELECT id, title, author, created_at FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        const posts = result.rows.map(p => ({ ...p, createdAt: p.created_at }));
        res.json({ posts, totalPages });
    } catch (err) {
        console.error('Error fetching posts:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.get('/api/admin/posts', authenticateToken, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM posts');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query('SELECT id, title, author, created_at FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        const posts = result.rows.map(p => ({ ...p, createdAt: p.created_at }));
        res.json({ posts, totalPages });
    } catch (err) {
        console.error('Error fetching posts for admin:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
// (이하 게시판 CRUD API는 이전과 동일하게 유지)


// 서버를 시작합니다.
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});
