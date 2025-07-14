// =================================================================
// 연세미치과 홈페이지 백엔드 최종 안정화 코드 (index.js)
// 최종 업데이트: 2025년 7월 14일
// 주요 기능:
// 1. 서버 시작 시 DB 테이블 자동 생성 (오류 원천 차단)
// 2. DB 컬럼명 불일치 문제 해결 (snake_case 사용)
// 3. 관리자 인증(JWT) 및 모든 API 엔드포인트 구현
// =================================================================

// 1. 모듈 임포트
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// 2. Express 앱 및 기본 미들웨어 설정
const app = express();
app.use(cors()); // CORS 허용
app.use(express.json()); // 요청 본문의 JSON 파싱

// 3. 데이터베이스 연결 풀 설정
// Render.com의 PostgreSQL 연결 시 SSL 옵션이 필요합니다.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// 4. (핵심) 데이터베이스 자동 초기화 함수
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('데이터베이스에 성공적으로 연결되었습니다.');
    console.log('필수 테이블의 존재 여부를 확인하고, 없으면 자동 생성을 시작합니다...');

    // 테이블 생성 쿼리 (IF NOT EXISTS 구문으로 중복 생성 방지)
    // 모든 컬럼명은 데이터베이스 표준인 snake_case로 작성합니다.
    const createNoticesTable = `
      CREATE TABLE IF NOT EXISTS notices (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    const createPostsTable = `
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        author VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    const createConsultationsTable = `
      CREATE TABLE IF NOT EXISTS consultations (
        id SERIAL PRIMARY KEY,
        author VARCHAR(100) NOT NULL,
        password VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        is_secret BOOLEAN DEFAULT TRUE,
        is_answered BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // (결정적 원인이었던) replies 테이블 생성
    const createRepliesTable = `
      CREATE TABLE IF NOT EXISTS replies (
        id SERIAL PRIMARY KEY,
        consultation_id INTEGER NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    // 각 테이블 생성 쿼리 실행
    await client.query(createNoticesTable);
    console.log('- "notices" 테이블이 준비되었습니다.');

    await client.query(createPostsTable);
    console.log('- "posts" 테이블이 준비되었습니다.');

    await client.query(createConsultationsTable);
    console.log('- "consultations" 테이블이 준비되었습니다.');

    await client.query(createRepliesTable);
    console.log('- "replies" 테이블이 준비되었습니다.');

    console.log('데이터베이스 자동 초기화가 성공적으로 완료되었습니다.');
  } catch (err) {
    console.error('데이터베이스 초기화 중 심각한 오류가 발생했습니다:', err);
    // 초기화 실패 시, 불완전한 상태로 서버가 실행되는 것을 막기 위해 프로세스 종료
    process.exit(1);
  } finally {
    // 사용한 클라이언트 연결 반환
    client.release();
  }
}

// 5. 유틸리티 함수
// DB에서 가져온 snake_case 키를 프론트엔드에서 사용할 camelCase로 변환
const toCamelCase = (rows) => {
  return rows.map(row => {
    const newRow = {};
    for (let key in row) {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      newRow[camelKey] = row[key];
    }
    return newRow;
  });
};

// 6. 관리자 인증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) return res.sendStatus(401); // 토큰이 없음

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // 토큰이 유효하지 않음
    req.user = user;
    next();
  });
};

// =================================================================
// API 라우트 (Routes)
// =================================================================
// Render/UptimeRobot Health Check를 위한 루트 경로 핸들러
// app.all은 GET, HEAD 등 모든 요청 방식에 응답합니다.
app.all('/', (req, res) => {
  res.send('연세미치과 백엔드 서버가 정상적으로 작동 중입니다.');
});

// --- 관리자 로그인 ---
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    const user = { name: 'admin' };
    const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ accessToken });
  } else {
    res.status(401).send('비밀번호가 올바르지 않습니다.');
  }
});

// --- 공지사항 (Notices) API ---
// GET (All) - Public
app.get('/api/notices', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notices ORDER BY created_at DESC');
    res.json(toCamelCase(result.rows));
  } catch (err) {
    console.error(err);
    res.status(500).send('서버 오류');
  }
});
// GET (One) - Public
app.get('/api/notices/:id', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.');
      res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
      console.error(err);
      res.status(500).send('서버 오류');
    }
});
// POST (Admin)
app.post('/api/admin/notices', authenticateToken, async (req, res) => {
    const { title, content } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO notices (title, content) VALUES ($1, $2) RETURNING *',
            [title, content]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// PUT (Admin)
app.put('/api/admin/notices/:id', authenticateToken, async (req, res) => {
    const { title, content } = req.body;
    try {
        const result = await pool.query(
            'UPDATE notices SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
            [title, content, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// DELETE (Admin)
app.delete('/api/admin/notices/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM notices WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.');
        res.status(204).send(); // No Content
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});

// --- 자유게시판 (Posts) API ---
// GET (All) - Public
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, title, author, created_at, updated_at FROM posts ORDER BY created_at DESC');
        res.json(toCamelCase(result.rows));
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// GET (One) - Public
app.get('/api/posts/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// POST - Public
app.post('/api/posts', async (req, res) => {
    const { author, password, title, content } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4) RETURNING *',
            [author, password, title, content]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// DELETE (Admin)
app.delete('/api/admin/posts/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).send('게시글을 찾을 수 없습니다.');
        res.status(204).send();
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});


// --- 온라인 상담 (Consultations) API ---
// GET (All) - Public (답변 여부, 비밀글 여부 포함)
app.get('/api/consultations', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, title, author, created_at, is_secret, is_answered FROM consultations ORDER BY created_at DESC');
        res.json(toCamelCase(result.rows));
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// GET (One) - Public (관리자는 비밀글도 바로 볼 수 있음)
app.get('/api/consultations/:id', async (req, res) => {
    try {
        const consultationResult = await pool.query('SELECT * FROM consultations WHERE id = $1', [req.params.id]);
        if (consultationResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.');
        
        const replyResult = await pool.query('SELECT * FROM replies WHERE consultation_id = $1 ORDER BY created_at DESC', [req.params.id]);

        const consultation = toCamelCase(consultationResult.rows)[0];
        const replies = toCamelCase(replyResult.rows);

        res.json({ ...consultation, replies });
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// POST - Public
app.post('/api/consultations', async (req, res) => {
    const { author, password, title, content, isSecret } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO consultations (author, password, title, content, is_secret) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [author, password, title, content, isSecret]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// 비밀글 비밀번호 확인
app.post('/api/consultations/:id/verify', async (req, res) => {
    try {
        const { password } = req.body;
        const result = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.');
        
        if (result.rows[0].password === password) {
            res.json({ success: true });
        } else {
            res.json({ success: false });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// DELETE (Admin)
app.delete('/api/admin/consultations/:id', authenticateToken, async (req, res) => {
    try {
        // ON DELETE CASCADE 옵션 덕분에 상담글을 지우면 답변글도 함께 지워집니다.
        const result = await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).send('상담글을 찾을 수 없습니다.');
        res.status(204).send();
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});


// --- 상담 답변 (Replies) API ---
// POST (Admin)
app.post('/api/admin/consultations/:id/replies', authenticateToken, async (req, res) => {
    const consultationId = req.params.id;
    const { content } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // 트랜잭션 시작
        
        const replyResult = await client.query(
            'INSERT INTO replies (consultation_id, content) VALUES ($1, $2) RETURNING *',
            [consultationId, content]
        );

        // 답변이 달리면 is_answered 상태를 true로 변경
        await client.query(
            'UPDATE consultations SET is_answered = TRUE, updated_at = NOW() WHERE id = $1',
            [consultationId]
        );

        await client.query('COMMIT'); // 트랜잭션 커밋
        res.status(201).json(toCamelCase(replyResult.rows)[0]);
    } catch (err) {
        await client.query('ROLLBACK'); // 오류 발생 시 롤백
        console.error(err);
        res.status(500).send('서버 오류');
    } finally {
        client.release();
    }
});
// PUT (Admin)
app.put('/api/admin/replies/:id', authenticateToken, async (req, res) => {
    const { content } = req.body;
    try {
        const result = await pool.query(
            'UPDATE replies SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [content, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('답변을 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('서버 오류');
    }
});
// DELETE (Admin)
app.delete('/api/admin/replies/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 먼저 어떤 상담글에 속한 답변인지 찾음
        const reply = await client.query('SELECT consultation_id FROM replies WHERE id = $1', [req.params.id]);
        if (reply.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).send('답변을 찾을 수 없습니다.');
        }
        const { consultation_id } = reply.rows[0];

        // 답변 삭제
        await client.query('DELETE FROM replies WHERE id = $1', [req.params.id]);
        
        // 해당 상담글에 다른 답변이 남아있는지 확인
        const remainingReplies = await client.query('SELECT id FROM replies WHERE consultation_id = $1', [consultation_id]);
        
        // 다른 답변이 없으면 is_answered 상태를 false로 되돌림
        if (remainingReplies.rows.length === 0) {
            await client.query('UPDATE consultations SET is_answered = FALSE WHERE id = $1', [consultation_id]);
        }
        
        await client.query('COMMIT');
        res.status(204).send();
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).send('서버 오류');
    } finally {
        client.release();
    }
});


// =================================================================
// 서버 실행
// =================================================================
const PORT = process.env.PORT || 3001;

// 서버 시작 전, 반드시 데이터베이스 초기화 함수를 먼저 실행합니다.
initializeDatabase()
  .then(() => {
    // DB 초기화가 성공하면 서버를 시작합니다.
    app.listen(PORT, () => {
      console.log(`백엔드 서버가 포트 ${PORT}에서 성공적으로 실행되었습니다.`);
      console.log('UptimeRobot 등을 이용해 이 주소로 주기적인 요청을 보내면 Cold Start를 방지할 수 있습니다.');
    });
  })
  .catch(err => {
    // DB 초기화가 실패하면 서버를 시작하지 않습니다.
    console.error('서버 시작에 실패했습니다. 데이터베이스 연결 및 설정 정보를 확인해주세요.', err);
  });
