// /routes/publicRoutes.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // 예약 관리를 위한 JWT 추가
const { pool } = require('../config/db');
const { toCamelCase } = require('../utils/helpers');
const saltRounds = 10;

// --- [새 기능] 예약 확인 및 관리를 위한 미들웨어 ---
const authenticateReservationToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, reservation) => {
    if (err) return res.sendStatus(403);
    // 토큰의 ID와 URL 파라미터의 ID가 일치하는지 확인
    if (reservation.id !== parseInt(req.params.id, 10)) {
      return res.sendStatus(403);
    }
    req.reservation = reservation;
    next();
  });
};





// --- 공지사항 ---
router.get('/notices', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = req.query.search || '';
  const category = req.query.category || '';
  try {
    let baseQuery = 'FROM notices';
    let whereClauses = [];
    const queryParams = [];
    let paramIndex = 1;
    if (searchTerm) {
      whereClauses.push(`(title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`);
      queryParams.push(`%${searchTerm}%`);
      paramIndex++;
    }
    if (category && category !== '전체') {
      whereClauses.push(`category = $${paramIndex}`);
      queryParams.push(category);
      paramIndex++;
    }
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    const itemsQuery = `SELECT * ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page, totalItems });
  } catch (err) {
    console.error('공지사항 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/notices/:id', async (req, res) => { try { const result = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]); if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// --- 자유게시판 ---
router.get('/posts', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = req.query.search || '';
  try {
    let baseQuery = 'FROM posts';
    let whereClause = '';
    const queryParams = [];
    if (searchTerm) {
      whereClause = 'WHERE title ILIKE $1 OR content ILIKE $1 OR author ILIKE $1';
      queryParams.push(`%${searchTerm}%`);
    }
    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    const itemsQuery = `SELECT id, title, author, created_at, updated_at ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page, totalItems });
  } catch (err) {
    console.error('자유게시판 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/posts/:id', async (req, res) => { try { const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]); if (postResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); const commentsResult = await pool.query('SELECT * FROM post_comments WHERE post_id = $1 ORDER BY created_at ASC', [req.params.id]); const post = toCamelCase(postResult.rows)[0]; const comments = toCamelCase(commentsResult.rows); res.json({ ...post, comments }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); }});
router.post('/posts', async (req, res) => { const { author, password, title, content } = req.body; try { const hashedPassword = await bcrypt.hash(password, saltRounds); const result = await pool.query('INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4) RETURNING *', [author, hashedPassword, title, content]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// *** 핵심 수정: 누락된 비밀번호 확인 API를 추가했습니다. ***
router.post('/posts/:id/verify', async (req, res) => { 
    try { 
        const { password } = req.body; 
        const result = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]); 
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' }); 
        const match = await bcrypt.compare(password, result.rows[0].password); 
        res.json({ success: match }); 
    } catch (err) { 
        console.error(err); 
        res.status(500).json({ success: false, message: '서버 오류' }); 
    } 
});

router.put('/posts/:id', async (req, res) => { const { title, content, password } = req.body; try { const verifyResult = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]); if (verifyResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); const match = await bcrypt.compare(password, verifyResult.rows[0].password); if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.'); const result = await pool.query('UPDATE posts SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.delete('/posts/:id', async (req, res) => { const { password } = req.body; try { const verifyResult = await pool.query('SELECT password FROM posts WHERE id = $1', [req.params.id]); if (verifyResult.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); const match = await bcrypt.compare(password, verifyResult.rows[0].password); if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.'); await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// --- 자유게시판 댓글 ---
router.post('/posts/:id/comments', async (req, res) => { const { author, password, content } = req.body; const postId = req.params.id; try { const hashedPassword = await bcrypt.hash(password, saltRounds); const result = await pool.query('INSERT INTO post_comments (post_id, author, password, content) VALUES ($1, $2, $3, $4) RETURNING *', [postId, author, hashedPassword, content]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error('댓글 작성 중 오류:', err); res.status(500).send('서버 오류'); } });
router.post('/posts/comments/:commentId/like', async (req, res) => { const { commentId } = req.params; try { const result = await pool.query('UPDATE post_comments SET likes = likes + 1 WHERE id = $1 RETURNING likes', [commentId]); if (result.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.'); res.status(200).json(result.rows[0]); } catch (err) { console.error('좋아요 처리 중 오류:', err); res.status(500).send('서버 오류'); } });
router.post('/posts/comments/:commentId/tags', async (req, res) => { const { tag } = req.body; const { commentId } = req.params; if (!tag || !tag.trim()) return res.status(400).send('태그 내용이 없습니다.'); try { const currentTagsResult = await pool.query('SELECT tags FROM post_comments WHERE id = $1', [commentId]); if (currentTagsResult.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.'); const currentTags = currentTagsResult.rows[0].tags ? currentTagsResult.rows[0].tags.split(',') : []; if (!currentTags.includes(tag.trim())) { currentTags.push(tag.trim()); } const newTags = currentTags.join(','); const result = await pool.query('UPDATE post_comments SET tags = $1 WHERE id = $2 RETURNING tags', [newTags, commentId]); res.status(200).json(result.rows[0]); } catch (err) { console.error('태그 추가 중 오류:', err); res.status(500).send('서버 오류'); } });
router.delete('/posts/comments/:commentId', async (req, res) => { const { password } = req.body; const { commentId } = req.params; try { const result = await pool.query('SELECT password FROM post_comments WHERE id = $1', [commentId]); if (result.rows.length === 0) return res.status(404).send('댓글을 찾을 수 없습니다.'); const match = await bcrypt.compare(password, result.rows[0].password); if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.'); await pool.query('DELETE FROM post_comments WHERE id = $1', [commentId]); res.status(204).send(); } catch (err) { console.error('댓글 삭제 중 오류:', err); res.status(500).send('서버 오류'); } });

// [핵심 수정] 자유게시판 글 작성: 이미지 업로드 기능 추가
router.post('/posts', upload.single('image'), async (req, res) => { 
    const { author, password, title, content } = req.body; 
    // multer가 req.file에 이미지 정보를 담아줍니다.
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    
    try { 
        const hashedPassword = await bcrypt.hash(password, saltRounds); 
        const result = await pool.query(
            'INSERT INTO posts (author, password, title, content, image_data) VALUES ($1, $2, $3, $4, $5) RETURNING *', 
            [author, hashedPassword, title, content, imageData]
        ); 
        res.status(201).json(toCamelCase(result.rows)[0]); 
    } catch (err) { 
        console.error(err); 
        res.status(500).send('서버 오류'); 
    } 
});





// --- 온라인 상담 ---
router.get('/consultations', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = req.query.search || '';
  try {
    let baseQuery = 'FROM consultations';
    let whereClause = 'WHERE is_secret = false';
    const queryParams = [];
    if (searchTerm) {
      whereClause += ' AND (title ILIKE $1 OR content ILIKE $1 OR author ILIKE $1)';
      queryParams.push(`%${searchTerm}%`);
    }
    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    const itemsQuery = `SELECT id, title, author, created_at, is_secret, is_answered ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page, totalItems });
  } catch (err) {
    console.error('온라인상담 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/consultations/:id', async (req, res) => { try { const consultationResult = await pool.query('SELECT * FROM consultations WHERE id = $1', [req.params.id]); if (consultationResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); const replyResult = await pool.query('SELECT * FROM replies WHERE consultation_id = $1 ORDER BY created_at DESC', [req.params.id]); const consultation = toCamelCase(consultationResult.rows)[0]; const replies = toCamelCase(replyResult.rows); res.json({ ...consultation, replies }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.post('/consultations', async (req, res) => { const { author, password, title, content, isSecret } = req.body; try { const hashedPassword = await bcrypt.hash(password, saltRounds); const result = await pool.query('INSERT INTO consultations (author, password, title, content, is_secret) VALUES ($1, $2, $3, $4, $5) RETURNING *', [author, hashedPassword, title, content, isSecret]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// *** 핵심 수정: 누락된 비밀번호 확인 API를 추가했습니다. ***
router.post('/consultations/:id/verify', async (req, res) => { 
    try { 
        const { password } = req.body; 
        const result = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]); 
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: '상담글을 찾을 수 없습니다.' }); 
        const match = await bcrypt.compare(password, result.rows[0].password); 
        res.json({ success: match }); 
    } catch (err) { 
        console.error(err); 
        res.status(500).json({ success: false, message: '서버 오류' }); 
    } 
});

router.put('/consultations/:id', async (req, res) => { const { title, content, password } = req.body; try { const verifyResult = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]); if (verifyResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); const match = await bcrypt.compare(password, verifyResult.rows[0].password); if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.'); const result = await pool.query('UPDATE consultations SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.delete('/consultations/:id', async (req, res) => { const { password } = req.body; try { const verifyResult = await pool.query('SELECT password FROM consultations WHERE id = $1', [req.params.id]); if (verifyResult.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); const match = await bcrypt.compare(password, verifyResult.rows[0].password); if (!match) return res.status(403).send('비밀번호가 올바르지 않습니다.'); await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// [핵심 수정] 온라인상담 글 작성: 이미지 업로드 기능 추가
router.post('/consultations', upload.single('image'), async (req, res) => { 
    const { author, password, title, content, isSecret } = req.body; 
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;

    try { 
        const hashedPassword = await bcrypt.hash(password, saltRounds); 
        const result = await pool.query(
            'INSERT INTO consultations (author, password, title, content, is_secret, image_data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', 
            [author, hashedPassword, title, content, isSecret, imageData]
        ); 
        res.status(201).json(toCamelCase(result.rows)[0]); 
    } catch (err) { 
        console.error(err); 
        res.status(500).send('서버 오류'); 
    } 
});







// --- 기타 공개 정보 ---
router.get('/doctors', async (req, res) => { try { const result = await pool.query('SELECT * FROM doctors ORDER BY id ASC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.get('/about', async (req, res) => { try { const result = await pool.query('SELECT * FROM about_content WHERE id = 1'); res.json(toCamelCase(result.rows)[0] || {}); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.get('/clinic-photos', async (req, res) => { const page = parseInt(req.query.page, 10) || 1; const limit = parseInt(req.query.limit, 10) || 8; const offset = (page - 1) * limit; try { const photosPromise = pool.query('SELECT * FROM clinic_photos ORDER BY display_order ASC, id ASC LIMIT $1 OFFSET $2', [limit, offset]); const countPromise = pool.query('SELECT COUNT(*) FROM clinic_photos'); const [photosResult, countResult] = await Promise.all([photosPromise, countPromise]); const totalPhotos = parseInt(countResult.rows[0].count, 10); const totalPages = Math.ceil(totalPhotos / limit); res.json({ photos: toCamelCase(photosResult.rows), totalPages: totalPages, currentPage: page }); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.get('/cases', async (req, res) => {
  const category = req.query.category || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 9;
  const offset = (page - 1) * limit;
  try {
    let baseQuery = 'FROM case_photos';
    let whereClause = '';
    const queryParams = [];
    if (category) {
      whereClause = 'WHERE category = $1';
      queryParams.push(category);
    }
    const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
    const countResult = await pool.query(countQuery, queryParams);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    const itemsQuery = `SELECT * ${baseQuery} ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);
    const itemsResult = await pool.query(itemsQuery, queryParams);
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page });
  } catch (err) {
    console.error('치료 사례 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/faqs', async (req, res) => {
  const searchTerm = req.query.search || '';
  try {
    let query = 'SELECT * FROM faqs';
    const queryParams = [];
    if (searchTerm) {
      query += ' WHERE (question ILIKE $1 OR answer ILIKE $1)';
      queryParams.push(`%${searchTerm}%`);
    }
    query += ' ORDER BY category, id ASC';
    const result = await pool.query(query, queryParams);
    res.json(toCamelCase(result.rows));
  } catch (err) {
    console.error('FAQ 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});
router.get('/schedule', async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).send('Year and month are required.');
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    try {
        const reservationsPromise = pool.query("SELECT desired_date, desired_time, status FROM reservations WHERE desired_date >= $1 AND desired_date < $2", [startDate, endDate]);
        const blockedSlotsPromise = pool.query("SELECT slot_date, slot_time FROM blocked_slots WHERE slot_date >= $1 AND slot_date < $2", [startDate, endDate]);
        const [reservationsResult, blockedSlotsResult] = await Promise.all([reservationsPromise, blockedSlotsPromise]);
        const schedule = {};
        reservationsResult.rows.forEach(row => {
            const date = new Date(row.desired_date).toISOString().split('T')[0];
            if (!schedule[date]) schedule[date] = {};
            if (!schedule[date][row.desired_time]) { schedule[date][row.desired_time] = { pending: 0, confirmed: 0, blocked: false }; }
            if (row.status === 'pending') schedule[date][row.desired_time].pending++;
            if (row.status === 'confirmed') schedule[date][row.desired_time].confirmed++;
        });
        blockedSlotsResult.rows.forEach(row => {
            const date = new Date(row.slot_date).toISOString().split('T')[0];
            if (!schedule[date]) schedule[date] = {};
            if (!schedule[date][row.slot_time]) { schedule[date][row.desired_time] = { pending: 0, confirmed: 0, blocked: false }; }
            schedule[date][row.slot_time].blocked = true;
        });
        res.json(schedule);
    } catch (err) {
        console.error('스케줄 조회 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// --- 온라인 예약 (Reservations) API (기능 추가) ---

// 1. 예약 신청 (기존 기능)
router.post('/reservations', async (req, res) => { 
    const { patientName, phoneNumber, desiredDate, desiredTime, notes } = req.body; 
    try { 
        const result = await pool.query('INSERT INTO reservations (patient_name, phone_number, desired_date, desired_time, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *', [patientName, phoneNumber, desiredDate, desiredTime, notes]); 
        res.status(201).json(toCamelCase(result.rows)[0]); 
    } catch (err) { 
        console.error('예약 신청 중 오류:', err); 
        res.status(500).send('서버 오류'); 
    } 
});

// 2. [새 기능] 예약 확인 및 인증 토큰 발급
router.post('/reservations/verify', async (req, res) => {
  const { patientName, phoneNumber } = req.body;
  try {
    const result = await pool.query(
      'SELECT id FROM reservations WHERE patient_name = $1 AND phone_number = $2',
      [patientName, phoneNumber]
    );
    if (result.rows.length === 0) {
      return res.status(404).send('일치하는 예약 정보를 찾을 수 없습니다.');
    }
    const reservation = result.rows[0];
    // 1시간 동안 유효한 임시 토큰 발급
    const accessToken = jwt.sign({ id: reservation.id, name: patientName }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ accessToken, reservationId: reservation.id });
  } catch (err) {
    console.error('예약 확인 중 오류:', err);
    res.status(500).send('서버 오류');
  }
});

// 3. [새 기능] 특정 예약 상세 정보 조회 (인증 필요)
router.get('/reservations/:id', authenticateReservationToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reservations WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).send('예약 정보를 찾을 수 없습니다.');
    }
    res.json(toCamelCase(result.rows)[0]);
  } catch (err) {
    console.error('예약 상세 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});

// 4. [새 기능] 예약 변경 (인증 필요)
router.put('/reservations/:id', authenticateReservationToken, async (req, res) => {
  const { desiredDate, desiredTime, notes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE reservations SET desired_date = $1, desired_time = $2, notes = $3, status = $4 WHERE id = $5 RETURNING *',
      [desiredDate, desiredTime, notes, 'pending', req.params.id] // 수정 시 상태를 'pending'으로 변경
    );
    res.json(toCamelCase(result.rows)[0]);
  } catch (err) {
    console.error('예약 변경 중 오류:', err);
    res.status(500).send('서버 오류');
  }
});

// 5. [새 기능] 예약 취소 (인증 필요)
router.delete('/reservations/:id', authenticateReservationToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
    res.status(204).send(); // 성공적으로 삭제됨 (No Content)
  } catch (err) {
    console.error('예약 취소 중 오류:', err);
    res.status(500).send('서버 오류');
  }
});






// --- 예약 및 후기 작성 ---
router.post('/reservations', async (req, res) => { const { patientName, phoneNumber, desiredDate, desiredTime, notes } = req.body; try { const result = await pool.query('INSERT INTO reservations (patient_name, phone_number, desired_date, desired_time, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *', [patientName, phoneNumber, desiredDate, desiredTime, notes]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error('예약 신청 중 오류:', err); res.status(500).send('서버 오류'); } });
router.get('/reviews', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 5;
  const offset = (page - 1) * limit;
  try {
    const itemsPromise = pool.query("SELECT * FROM reviews WHERE is_approved = TRUE ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
    const countPromise = pool.query('SELECT COUNT(*) FROM reviews WHERE is_approved = TRUE');
    const [itemsResult, countResult] = await Promise.all([itemsPromise, countPromise]);
    const totalItems = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(totalItems / limit);
    res.json({ items: toCamelCase(itemsResult.rows), totalPages, currentPage: page });
  } catch (err) { console.error('후기 조회 오류:', err); res.status(500).send('서버 오류'); }
});
router.post('/reviews', async (req, res) => { const { patientName, rating, content } = req.body; try { const result = await pool.query('INSERT INTO reviews (patient_name, rating, content) VALUES ($1, $2, $3) RETURNING *', [patientName, rating, content]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error('후기 작성 중 오류:', err); res.status(500).send('서버 오류'); } });

// --- [새 기능] 메인 페이지 동적 데이터 ---
router.get('/home-summary', async (req, res) => {
  try {
    const noticesPromise = pool.query('SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT 3');
    const casesPromise = pool.query('SELECT id, title, category, before_image_data FROM case_photos ORDER BY created_at DESC LIMIT 3');
    const reviewsPromise = pool.query('SELECT patient_name, rating, content FROM reviews WHERE is_approved = TRUE ORDER BY created_at DESC LIMIT 3');

    const [noticesResult, casesResult, reviewsResult] = await Promise.all([
      noticesPromise,
      casesPromise,
      reviewsPromise
    ]);

    res.json({
      notices: toCamelCase(noticesResult.rows),
      cases: toCamelCase(casesResult.rows),
      reviews: toCamelCase(reviewsResult.rows),
    });
  } catch (err) {
    console.error('메인 페이지 데이터 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});





module.exports = router;
