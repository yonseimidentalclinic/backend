// 필요한 모듈들을 가져옵니다.
require('dotenv').config(); // .env 파일의 환경 변수를 process.env로 로드
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Express 앱을 생성합니다.
const app = express();
const saltRounds = 10; // 비밀번호 해싱을 위한 솔트 라운드

// 미들웨어를 설정합니다.
app.use(cors()); // CORS 허용으로 프론트엔드와 통신 가능하게 설정
app.use(express.json()); // 요청 본문을 JSON으로 파싱

// 데이터베이스 연결 풀(Pool)을 생성합니다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Render DB 연결에 필요
  },
});

// JWT 토큰을 검증하기 위한 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN" 형식

  if (token == null) return res.sendStatus(401); // 토큰이 없음

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // 토큰이 유효하지 않음
    req.user = user;
    next();
  });
};


// --- API 라우트 설정 ---

// 서버 상태 확인용 루트 경로
app.get('/', (req, res) => {
  res.send('연세미치과 백엔드 서버가 정상적으로 작동 중입니다.');
});

// 1. 관리자 로그인
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

// 2. 공지사항(Notices) API
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
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.get('/api/notices/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.post('/api/notices', authenticateToken, async (req, res) => {
  const { title, content } = req.body;
  try {
    const result = await pool.query('INSERT INTO notices (title, content) VALUES ($1, $2) RETURNING *', [title, content]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.put('/api/notices/:id', authenticateToken, async (req, res) => {
    const { title, content } = req.body;
    try {
        const result = await pool.query('UPDATE notices SET title = $1, content = $2, "updatedAt" = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.delete('/api/notices/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM notices WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});


// 3. 온라인 상담(Consultations) API
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
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.post('/api/consultations', async (req, res) => {
    const { title, author, password, content, isSecret } = req.body;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    try {
        const result = await pool.query(
            'INSERT INTO consultations (title, author, password, content, "isSecret") VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, author, hashedPassword, content, isSecret]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.get('/api/consultations/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, r.id as "replyId", r.content as "replyContent", r."createdAt" as "replyCreatedAt"
            FROM consultations c
            LEFT JOIN replies r ON c.id = r."consultationId"
            WHERE c.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Consultation not found');
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.post('/api/consultations/:id/verify', async (req, res) => {
    const { password } = req.body;
    try {
        const result = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Post not found');
        const match = await bcrypt.compare(password, result.rows[0].password);
        if (match) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.delete('/api/consultations/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.post('/api/consultations/:id/reply', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO replies (content, "consultationId") VALUES ($1, $2) RETURNING *',
            [content, req.params.id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.put('/api/consultations/replies/:replyId', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        const result = await pool.query(
            'UPDATE replies SET content = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING *',
            [content, req.params.replyId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});


// 4. 자유 게시판(Posts) API
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
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.post('/api/posts', async (req, res) => {
    const { title, author, password, content } = req.body;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    try {
        const result = await pool.query(
            'INSERT INTO posts (title, author, password, content) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, author, hashedPassword, content]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.get('/api/posts/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Post not found');
        const post = result.rows[0];
        delete post.password; // 비밀번호 정보는 응답에서 제외
        res.json(post);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.post('/api/posts/:id/verify', async (req, res) => {
    const { password } = req.body;
    try {
        const result = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Post not found');
        const match = await bcrypt.compare(password, result.rows[0].password);
        if (match) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.put('/api/posts/:id', async (req, res) => {
    const { title, content, password } = req.body;
    try {
        const result = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Post not found');
        const match = await bcrypt.compare(password, result.rows[0].password);
        if (!match) return res.status(401).send('비밀번호가 일치하지 않습니다.');
        
        const updateResult = await pool.query(
            'UPDATE posts SET title = $1, content = $2, "updatedAt" = NOW() WHERE id = $3 RETURNING *',
            [title, content, req.params.id]
        );
        res.json(updateResult.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
    // 관리자 전용 삭제
    try {
        await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
        res.status(204).send();
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// 서버를 시작합니다.
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});
