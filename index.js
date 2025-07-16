// =================================================================
// 연세미치과 홈페이지 백엔드 최종 코드 (진단 기능 포함)
// 주요 기능:
// 1. 서버가 연결된 DB의 테이블 구조를 직접 확인할 수 있는 /api/debug/check-db 엔드포인트 추가
// =================================================================

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const multer = require('multer'); // [핵심 추가] 파일 업로드 라이브러리


const app = express();
app.use(cors());
// JSON과 URL-encoded 요청 본문을 처리합니다. 크기 제한은 여기서는 기본값으로 둡니다.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// [핵심 추가] Multer 설정: 파일을 메모리에 버퍼 형태로 저장합니다.
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('데이터베이스에 성공적으로 연결되었습니다.');
    console.log('필수 테이블의 존재 여부를 확인하고, 없으면 자동 생성을 시작합니다...');
    
    const createNoticesTable = `CREATE TABLE IF NOT EXISTS notices (id SERIAL PRIMARY KEY, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createPostsTable = `CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createConsultationsTable = `CREATE TABLE IF NOT EXISTS consultations (id SERIAL PRIMARY KEY, author VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, is_secret BOOLEAN DEFAULT TRUE, is_answered BOOLEAN DEFAULT FALSE, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createRepliesTable = `CREATE TABLE IF NOT EXISTS replies (id SERIAL PRIMARY KEY, consultation_id INTEGER NOT NULL REFERENCES consultations(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW());`;
    const createDoctorsTable = `
      CREATE TABLE IF NOT EXISTS doctors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        position VARCHAR(100) NOT NULL,
        history TEXT,
        image_data TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;

    await client.query(createNoticesTable);
    await client.query(createPostsTable);
    await client.query(createConsultationsTable);
    await client.query(createRepliesTable);
    await client.query(createDoctorsTable);
    console.log('모든 테이블이 준비되었습니다.');

  } catch (err) {
    console.error('데이터베이스 초기화 중 오류가 발생했습니다:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

const toCamelCase = (rows) => { return rows.map(row => { const newRow = {}; for (let key in row) { const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase()); newRow[camelKey] = row[key]; } return newRow; }); };
const authenticateToken = (req, res, next) => { const authHeader = req.headers['authorization']; const token = authHeader && authHeader.split(' ')[1]; if (token == null) return res.sendStatus(401); jwt.verify(token, process.env.JWT_SECRET, (err, user) => { if (err) return res.sendStatus(403); req.user = user; next(); }); };

// =================================================================
// API 라우트 (Routes)
// =================================================================
app.all('/', (req, res) => { res.send('연세미치과 백엔드 서버가 정상적으로 작동 중입니다.'); });

// [핵심 추가] --- DB 상태 진단용 API ---
app.get('/api/debug/check-db', async (req, res) => {
  console.log('DB 상태 확인 요청을 받았습니다.');
  const client = await pool.connect();
  try {
    const tables = ['notices', 'posts', 'consultations', 'replies', 'doctors'];
    const schemaInfo = {};
    for (const table of tables) {
      const result = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = '${table}';
      `);
      schemaInfo[table] = result.rows;
    }
    console.log('현재 DB 스키마 정보:', schemaInfo);
    res.status(200).json(schemaInfo);
  } catch (err) {
    console.error('DB 상태 확인 중 오류 발생:', err);
    res.status(500).json({ error: 'DB 스키마 정보를 가져오는 데 실패했습니다.', details: err.message });
  } finally {
    client.release();
  }
});

// --- 기존 API 들 ---
/* 모든 기존 API는 여기에 그대로 유지됩니다... */
// 관리자 로그인
app.post('/api/admin/login', (req, res) => { const { password } = req.body; if (password === process.env.ADMIN_PASSWORD) { const user = { name: 'admin' }; const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' }); res.json({ accessToken }); } else { res.status(401).send('비밀번호가 올바르지 않습니다.'); } });
// 공지사항
app.get('/api/notices', async (req, res) => { try { const result = await pool.query('SELECT * FROM notices ORDER BY created_at DESC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.get('/api/notices/:id', async (req, res) => { try { const result = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/admin/notices', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('INSERT INTO notices (title, content) VALUES ($1, $2) RETURNING *', [title, content]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.put('/api/admin/notices/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE notices SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/notices/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM notices WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
// 자유게시판
app.get('/api/posts', async (req, res) => { try { const result = await pool.query('SELECT id, title, author, created_at, updated_at FROM posts ORDER BY created_at DESC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.get('/api/posts/:id', async (req, res) => { try { const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/posts', async (req, res) => { const { author, password, title, content } = req.body; try { const result = await pool.query('INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4) RETURNING *', [author, password, title, content]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.put('/api/admin/posts/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE posts SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/posts/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
// 온라인 상담
app.get('/api/consultations', async (req, res) => { try { const result = await pool.query('SELECT id, title, author, created_at, is_secret, is_answered FROM consultations ORDER BY created_at DESC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.get('/api/consultations/:id', async (req, res) => { try { const consultationResult = await pool.query('SELECT * FROM consultations WHERE id = $1', [req.params.id]); if (consultationResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); const replyResult = await pool.query('SELECT * FROM replies WHERE consultation_id = $1 ORDER BY created_at DESC', [req.params.id]); const consultation = toCamelCase(consultationResult.rows)[0]; const replies = toCamelCase(replyResult.rows); res.json({ ...consultation, replies }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/consultations', async (req, res) => { const { author, password, title, content, isSecret } = req.body; try { const result = await pool.query('INSERT INTO consultations (author, password, title, content, is_secret) VALUES ($1, $2, $3, $4, $5) RETURNING *', [author, password, title, content, isSecret]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.put('/api/admin/consultations/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE consultations SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/consultations/:id/verify', async (req, res) => { try { const { password } = req.body; const result = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); if (result.rows[0].password === password) { res.json({ success: true }); } else { res.json({ success: false }); } } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/consultations/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
// 상담 답변
app.post('/api/admin/consultations/:id/replies', authenticateToken, async (req, res) => { const consultationId = req.params.id; const { content } = req.body; const client = await pool.connect(); try { await client.query('BEGIN'); const replyResult = await client.query('INSERT INTO replies (consultation_id, content) VALUES ($1, $2) RETURNING *', [consultationId, content]); await client.query('UPDATE consultations SET is_answered = TRUE, updated_at = NOW() WHERE id = $1', [consultationId]); await client.query('COMMIT'); res.status(201).json(toCamelCase(replyResult.rows)[0]); } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).send('서버 오류'); } finally { client.release(); } });
app.put('/api/admin/replies/:id', authenticateToken, async (req, res) => { const { content } = req.body; try { const result = await pool.query('UPDATE replies SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('답변을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/replies/:id', authenticateToken, async (req, res) => { const client = await pool.connect(); try { await client.query('BEGIN'); const reply = await client.query('SELECT consultation_id FROM replies WHERE id = $1', [req.params.id]); if (reply.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).send('답변을 찾을 수 없습니다.'); } const { consultation_id } = reply.rows[0]; await client.query('DELETE FROM replies WHERE id = $1', [req.params.id]); const remainingReplies = await client.query('SELECT id FROM replies WHERE consultation_id = $1', [consultation_id]); if (remainingReplies.rows.length === 0) { await client.query('UPDATE consultations SET is_answered = FALSE WHERE id = $1', [consultation_id]); } await client.query('COMMIT'); res.status(204).send(); } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).send('서버 오류'); } finally { client.release(); } });
// 의료진
app.get('/api/doctors', async (req, res) => { try { const result = await pool.query('SELECT * FROM doctors ORDER BY id ASC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.post('/api/admin/doctors', authenticateToken,upload.single('image'), async (req, res) => { const { name, position, history } = req.body; try { const result = await pool.query('INSERT INTO doctors (name, position, history, image_data) VALUES ($1, $2, $3, $4) RETURNING *', [name, position, history, imageData]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.put('/api/admin/doctors/:id', authenticateToken, upload.single('image'),async (req, res) => { const { name, position, history, imageData } = req.body; try { const result = await pool.query('UPDATE doctors SET name = $1, position = $2, history = $3, image_data = $4, updated_at = NOW() WHERE id = $5 RETURNING *', [name, position, history, imageData, req.params.id]); if (result.rows.length === 0) return res.status(404).send('의료진 정보를 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
app.delete('/api/admin/doctors/:id', authenticateToken, upload.single('image'),async (req, res) => { try { const result = await pool.query('DELETE FROM doctors WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('의료진 정보를 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// =================================================================
// 서버 실행
// =================================================================
const PORT = process.env.PORT || 3001;
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`백엔드 서버가 포트 ${PORT}에서 성공적으로 실행되었습니다.`);
  });
}).catch(err => {
  console.error('서버 시작 실패:', err);
});
