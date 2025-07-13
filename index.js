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
    // DB 컬럼명을 "camelCase"로 수정
    const noticeResult = await pool.query('SELECT id, title, "createdAt" FROM notices ORDER BY "createdAt" DESC LIMIT 5');
    const consultationResult = await pool.query('SELECT id, title, author, "createdAt" FROM consultations ORDER BY "createdAt" DESC LIMIT 5');
    
    res.json({ notices: noticeResult.rows, consultations: consultationResult.rows });
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
        const result = await pool.query('SELECT id, title, "createdAt" FROM notices ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2', [limit, offset]);
        res.json({ notices: result.rows, totalPages });
    } catch (err) {
        console.error('Error fetching notices:', err.stack);
        res.status(500).json({ error: 'Server error while fetching notices' });
    }
});
app.get('/api/notices/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, content, "createdAt", "updatedAt" FROM notices WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Notice not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(`Error fetching notice ${req.params.id}:`, err.stack);
    res.status(500).json({ error: 'Server error' });
  }
});
app.post('/api/notices', authenticateToken, async (req, res) => {
    const { title, content } = req.body;
    try {
        const result = await pool.query('INSERT INTO notices (title, content) VALUES ($1, $2) RETURNING *', [title, content]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating notice:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.put('/api/notices/:id', authenticateToken, async (req, res) => {
    const { title, content } = req.body;
    try {
        const result = await pool.query('UPDATE notices SET title = $1, content = $2, "updatedAt" = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error updating notice ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.delete('/api/notices/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM notices WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting notice ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- 온라인 상담 API ---
app.get('/api/consultations', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM consultations');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query(`
            SELECT c.id, c.title, c.author, c."isSecret", c."createdAt", r.id AS "replyId"
            FROM consultations c
            LEFT JOIN replies r ON c.id = r."consultationId"
            ORDER BY c."createdAt" DESC LIMIT $1 OFFSET $2
        `, [limit, offset]);
        res.json({ consultations: result.rows, totalPages });
    } catch (err) {
        console.error('Error fetching consultations:', err.stack);
        res.status(500).json({ error: 'Server error while fetching consultations' });
    }
});
app.post('/api/consultations', async (req, res) => {
    const { title, author, password, content, isSecret } = req.body;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    try {
        await pool.query('INSERT INTO consultations (title, author, password, content, "isSecret") VALUES ($1, $2, $3, $4, $5)', [title, author, hashedPassword, content, isSecret]);
        res.status(201).send('Consultation created');
    } catch (err) {
        console.error('Error creating consultation:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.get('/api/consultations/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.id, c.title, c.author, c.content, c."createdAt", c."isSecret", r.id as "replyId", r.content as "replyContent", r."createdAt" as "replyCreatedAt"
            FROM consultations c
            LEFT JOIN replies r ON c.id = r."consultationId"
            WHERE c.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Consultation not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error fetching consultation ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.delete('/api/consultations/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM replies WHERE "consultationId" = $1', [req.params.id]);
        await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting consultation ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.post('/api/consultations/:id/reply', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        await pool.query('INSERT INTO replies (content, "consultationId") VALUES ($1, $2)', [content, req.params.id]);
        res.status(201).send('Reply created');
    } catch (err) {
        console.error(`Error creating reply for consultation ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.put('/api/consultations/replies/:replyId', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        await pool.query('UPDATE replies SET content = $1, "updatedAt" = NOW() WHERE id = $2', [content, req.params.replyId]);
        res.send('Reply updated');
    } catch (err) {
        console.error(`Error updating reply ${req.params.replyId}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});


// --- 자유게시판 API (관리자 전용 추가) ---
app.get('/api/posts', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    try {
        const totalResult = await pool.query('SELECT COUNT(*) FROM posts');
        const totalPages = Math.ceil(totalResult.rows[0].count / limit);
        const result = await pool.query('SELECT id, title, author, "createdAt" FROM posts ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2', [limit, offset]);
        res.json({ posts: result.rows, totalPages });
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
        const result = await pool.query('SELECT id, title, author, "createdAt" FROM posts ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2', [limit, offset]);
        res.json({ posts: result.rows, totalPages });
    } catch (err) {
        console.error('Error fetching posts for admin:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting post ${req.params.id}:`, err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});
// (이하 다른 게시판 API들은 이전과 동일)


// 서버를 시작합니다.
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});

