// /routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { toCamelCase } = require('../utils/helpers');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../middleware/upload');

// --- 관리자 인증 및 대시보드 ---
router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      await pool.query('INSERT INTO admin_logs (action, ip_address) VALUES ($1, $2)', ['login_success', ip]);
      const user = { name: 'admin' };
      const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });
      res.json({ accessToken });
    } catch (logError) {
      console.error('로그인 기록 중 오류 발생:', logError);
      const user = { name: 'admin' };
      const accessToken = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });
      res.json({ accessToken });
    }
  } else {
    res.status(401).send('비밀번호가 올바르지 않습니다.');
  }
});

router.get('/logs', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 100');
    res.json(toCamelCase(result.rows));
  } catch (err) {
    console.error('접근 기록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});

router.get('/dashboard-stats', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalNoticesPromise = pool.query('SELECT COUNT(*) FROM notices');
    const totalPostsPromise = pool.query('SELECT COUNT(*) FROM posts');
    const totalConsultationsPromise = pool.query('SELECT COUNT(*) FROM consultations');
    const unansweredConsultationsPromise = pool.query('SELECT COUNT(*) FROM consultations WHERE is_answered = false');
    const todayConsultationsPromise = pool.query('SELECT COUNT(*) FROM consultations WHERE created_at >= $1', [today]);
    const [totalNoticesResult, totalPostsResult, totalConsultationsResult, unansweredConsultationsResult, todayConsultationsResult] = await Promise.all([totalNoticesPromise, totalPostsPromise, totalConsultationsPromise, unansweredConsultationsPromise, todayConsultationsPromise]);
    res.json({
      totalNotices: parseInt(totalNoticesResult.rows[0].count, 10),
      totalPosts: parseInt(totalPostsResult.rows[0].count, 10),
      totalConsultations: parseInt(totalConsultationsResult.rows[0].count, 10),
      unansweredConsultations: parseInt(unansweredConsultationsResult.rows[0].count, 10),
      todayConsultations: parseInt(todayConsultationsResult.rows[0].count, 10),
    });
  } catch (err) {
    console.error('대시보드 통계 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});

router.get('/dashboard/recent-data', authenticateToken, async (req, res) => {
  try {
    const reservationsPromise = pool.query('SELECT id, patient_name, desired_date, status FROM reservations ORDER BY created_at DESC LIMIT 5');
    const logsPromise = pool.query("SELECT action, ip_address, created_at FROM admin_logs ORDER BY created_at DESC LIMIT 5");
    const [reservationsResult, logsResult] = await Promise.all([reservationsPromise, logsPromise]);
    res.json({
      recentReservations: toCamelCase(reservationsResult.rows),
      recentLogs: toCamelCase(logsResult.rows),
    });
  } catch (err) {
    console.error('대시보드 최근 데이터 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});


// --- 공지사항 관리 ---
router.get('/notices', authenticateToken, async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const offset = (page - 1) * limit;
  const query = req.query.query || '';
  try {
    let whereClause = '';
    const queryParams = [];
    if (query) {
      whereClause = `WHERE title ILIKE $1 OR content ILIKE $1`;
      queryParams.push(`%${query}%`);
    }
    const noticesQuery = `SELECT * FROM notices ${whereClause} ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    const countQuery = `SELECT COUNT(*) FROM notices ${whereClause}`;
    const countParams = [...queryParams];
    queryParams.push(limit, offset);
    const noticesResult = await pool.query(noticesQuery, queryParams);
    const countResult = await pool.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count, 10);
    res.json({
      notices: toCamelCase(noticesResult.rows),
      totalPages: Math.ceil(totalCount / limit),
      totalCount
    });
  } catch (err) {
    console.error('관리자 공지사항 목록 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});

router.get('/notices/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('관리자 공지사항 상세 조회 오류:', err);
        res.status(500).send('서버 오류');
    }
});

// [핵심 수정] 공지사항 생성: 이미지 업로드 기능 추가
router.post('/notices', authenticateToken, upload.single('image'), async (req, res) => {
    const { title, content, category } = req.body;
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    try {
        const result = await pool.query(
            'INSERT INTO notices (title, content, category, image_data) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, content, category, imageData]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
// [핵심 수정] 공지사항 수정: 이미지 업로드/삭제 기능 추가
router.put('/notices/:id', authenticateToken, upload.single('image'), async (req, res) => {
    const { title, content, category, existingImageData } = req.body;
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : existingImageData;
    try {
        const result = await pool.query(
            'UPDATE notices SET title = $1, content = $2, category = $3, image_data = $4, updated_at = NOW() WHERE id = $5 RETURNING *',
            [title, content, category, imageData, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error(err); res.status(500).send('서버 오류'); }
});
router.delete('/notices/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM notices WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('공지사항을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// --- 자유게시판 관리 ---
router.put('/posts/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE posts SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.delete('/posts/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('게시글을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.delete('/posts/comments/:commentId', authenticateToken, async (req, res) => { try { await pool.query('DELETE FROM post_comments WHERE id = $1', [req.params.commentId]); res.status(204).send(); } catch (err) { console.error('관리자 댓글 삭제 중 오류:', err); res.status(500).send('서버 오류'); } });

// --- 온라인 상담 관리 ---
router.put('/consultations/:id', authenticateToken, async (req, res) => { const { title, content } = req.body; try { const result = await pool.query('UPDATE consultations SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [title, content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.delete('/consultations/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM consultations WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('상담글을 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.post('/consultations/:id/replies', authenticateToken, async (req, res) => { const consultationId = req.params.id; const { content } = req.body; const client = await pool.connect(); try { await client.query('BEGIN'); const replyResult = await client.query('INSERT INTO replies (consultation_id, content) VALUES ($1, $2) RETURNING *', [consultationId, content]); await client.query('UPDATE consultations SET is_answered = TRUE, updated_at = NOW() WHERE id = $1', [consultationId]); await client.query('COMMIT'); res.status(201).json(toCamelCase(replyResult.rows)[0]); } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).send('서버 오류'); } finally { client.release(); } });
router.put('/replies/:id', authenticateToken, async (req, res) => { const { content } = req.body; try { const result = await pool.query('UPDATE replies SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [content, req.params.id]); if (result.rows.length === 0) return res.status(404).send('답변을 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });
router.delete('/replies/:id', authenticateToken, async (req, res) => { const client = await pool.connect(); try { await client.query('BEGIN'); const reply = await client.query('SELECT consultation_id FROM replies WHERE id = $1', [req.params.id]); if (reply.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).send('답변을 찾을 수 없습니다.'); } const { consultation_id } = reply.rows[0]; await client.query('DELETE FROM replies WHERE id = $1', [req.params.id]); const remainingReplies = await client.query('SELECT id FROM replies WHERE consultation_id = $1', [consultation_id]); if (remainingReplies.rows.length === 0) { await client.query('UPDATE consultations SET is_answered = FALSE WHERE id = $1', [consultation_id]); } await client.query('COMMIT'); res.status(204).send(); } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).send('서버 오류'); } finally { client.release(); } });

// --- 의료진 관리 ---
router.post('/doctors', authenticateToken, upload.single('image'), async (req, res) => { const { name, position, history } = req.body; const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null; try { const result = await pool.query('INSERT INTO doctors (name, position, history, image_data) VALUES ($1, $2, $3, $4) RETURNING *', [name, position, history, imageData]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error('의료진 추가 중 DB 오류:', err); res.status(500).send('서버 오류'); } });
router.put('/doctors/:id', authenticateToken, upload.single('image'), async (req, res) => { const { name, position, history, existingImageData } = req.body; const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : existingImageData; try { const result = await pool.query('UPDATE doctors SET name = $1, position = $2, history = $3, image_data = $4, updated_at = NOW() WHERE id = $5 RETURNING *', [name, position, history, imageData, req.params.id]); if (result.rows.length === 0) return res.status(404).send('의료진 정보를 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error('의료진 수정 중 DB 오류:', err); res.status(500).send('서버 오류'); } });
router.delete('/doctors/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM doctors WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('의료진 정보를 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error(err); res.status(500).send('서버 오류'); } });

// --- 병원소개 관리 ---
router.put('/about', authenticateToken, async (req, res) => { const { title, subtitle, content, imageData } = req.body; try { const result = await pool.query('UPDATE about_content SET title = $1, subtitle = $2, content = $3, image_data = $4, updated_at = NOW() WHERE id = 1 RETURNING *', [title, subtitle, content, imageData]); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error('병원소개 업데이트 중 DB 오류:', err); res.status(500).send('서버 오류'); } });

// --- 병원 사진 관리 ---
router.get('/clinic-photos', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM clinic_photos ORDER BY display_order ASC, id ASC');
        res.json(toCamelCase(result.rows));
    } catch (err) {
        console.error('관리자용 병원 사진 조회 오류:', err);
        res.status(500).send('서버 오류');
    }
});


router.post('/clinic-photos', authenticateToken, upload.single('image'), async (req, res) => { const { caption } = req.body; const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null; if (!imageData) { return res.status(400).send('이미지 파일이 없습니다.'); } try { const result = await pool.query('INSERT INTO clinic_photos (caption, image_data) VALUES ($1, $2) RETURNING *', [caption, imageData]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error('병원 사진 추가 중 DB 오류:', err); res.status(500).send('서버 오류'); } });
router.delete('/clinic-photos/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM clinic_photos WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('사진 정보를 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error('병원 사진 삭제 중 DB 오류:', err); res.status(500).send('서버 오류'); } });

// [핵심 추가] 병원 둘러보기 사진 캡션 수정 API
router.put('/clinic-photos/:id', authenticateToken, async (req, res) => {
    const { caption } = req.body;
    const { id } = req.params;
    try {
        const result = await pool.query(
            'UPDATE clinic_photos SET caption = $1 WHERE id = $2 RETURNING *',
            [caption, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).send('사진을 찾을 수 없습니다.');
        }
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) {
        console.error('병원 사진 캡션 수정 중 DB 오류:', err);
        res.status(500).send('서버 오류');
    }
});






// --- 예약 관리 ---
router.get('/reservations', authenticateToken, async (req, res) => { try { const result = await pool.query('SELECT * FROM reservations ORDER BY desired_date DESC, created_at DESC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error('예약 목록 조회 오류:', err); res.status(500).send('서버 오류'); } });
router.put('/reservations/:id/status', authenticateToken, async (req, res) => { const { status } = req.body; try { const result = await pool.query('UPDATE reservations SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]); if (result.rows.length === 0) return res.status(404).send('예약 정보를 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error('예약 상태 변경 오류:', err); res.status(500).send('서버 오류'); } });
router.delete('/reservations/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM reservations WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('예약 정보를 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error('예약 삭제 오류:', err); res.status(500).send('서버 오류'); } });

// --- 치료 사례 관리 ---
router.post('/cases', authenticateToken, upload.fields([{ name: 'beforeImage', maxCount: 1 }, { name: 'afterImage', maxCount: 1 }]), async (req, res) => { const { title, category, description } = req.body; const beforeImageData = req.files['beforeImage'] ? `data:${req.files['beforeImage'][0].mimetype};base64,${req.files['beforeImage'][0].buffer.toString('base64')}` : null; const afterImageData = req.files['afterImage'] ? `data:${req.files['afterImage'][0].mimetype};base64,${req.files['afterImage'][0].buffer.toString('base64')}` : null; try { const result = await pool.query('INSERT INTO case_photos (title, category, description, before_image_data, after_image_data) VALUES ($1, $2, $3, $4, $5) RETURNING *', [title, category, description, beforeImageData, afterImageData]); res.status(201).json(toCamelCase(result.rows)[0]); } catch (err) { console.error('치료 사례 추가 중 DB 오류:', err); res.status(500).send('서버 오류'); } });
router.put('/cases/:id', authenticateToken, upload.fields([{ name: 'beforeImage', maxCount: 1 }, { name: 'afterImage', maxCount: 1 }]), async (req, res) => { const { title, category, description, existingBeforeImage, existingAfterImage } = req.body; const beforeImageData = req.files['beforeImage'] ? `data:${req.files['beforeImage'][0].mimetype};base64,${req.files['beforeImage'][0].buffer.toString('base64')}` : existingBeforeImage; const afterImageData = req.files['afterImage'] ? `data:${req.files['afterImage'][0].mimetype};base64,${req.files['afterImage'][0].buffer.toString('base64')}` : existingAfterImage; try { const result = await pool.query('UPDATE case_photos SET title = $1, category = $2, description = $3, before_image_data = $4, after_image_data = $5 WHERE id = $6 RETURNING *', [title, category, description, beforeImageData, afterImageData, req.params.id]); if (result.rows.length === 0) return res.status(404).send('치료 사례를 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error('치료 사례 수정 중 DB 오류:', err); res.status(500).send('서버 오류'); } });
router.delete('/cases/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM case_photos WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('치료 사례를 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error('치료 사례 삭제 중 DB 오류:', err); res.status(500).send('서버 오류'); } });

// --- FAQ 관리 ---
// [핵심 수정] FAQ 생성: 이미지 업로드 기능 추가
router.post('/faqs', authenticateToken, upload.single('image'), async (req, res) => {
    const { category, question, answer } = req.body;
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    try {
        const result = await pool.query(
            'INSERT INTO faqs (category, question, answer, image_data) VALUES ($1, $2, $3, $4) RETURNING *',
            [category, question, answer, imageData]
        );
        res.status(201).json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error('FAQ 추가 중 DB 오류:', err); res.status(500).send('서버 오류'); }
});

// [핵심 수정] FAQ 수정: 이미지 업로드/삭제 기능 추가
router.put('/faqs/:id', authenticateToken, upload.single('image'), async (req, res) => {
    const { category, question, answer, existingImageData } = req.body;
    const imageData = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : existingImageData;
    try {
        const result = await pool.query(
            'UPDATE faqs SET category = $1, question = $2, answer = $3, image_data = $4 WHERE id = $5 RETURNING *',
            [category, question, answer, imageData, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).send('FAQ를 찾을 수 없습니다.');
        res.json(toCamelCase(result.rows)[0]);
    } catch (err) { console.error('FAQ 수정 중 DB 오류:', err); res.status(500).send('서버 오류'); }
});
router.delete('/faqs/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM faqs WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('FAQ를 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error('FAQ 삭제 중 DB 오류:', err); res.status(500).send('서버 오류'); } });

// --- 예약 스케줄 관리 ---
router.post('/blocked-slots', authenticateToken, async (req, res) => { const { slotDate, slotTime } = req.body; try { await pool.query('INSERT INTO blocked_slots (slot_date, slot_time) VALUES ($1, $2) ON CONFLICT DO NOTHING', [slotDate, slotTime]); res.status(201).send(); } catch (err) { console.error('예약 불가 시간 추가 오류:', err); res.status(500).send('서버 오류'); } });
router.delete('/blocked-slots', authenticateToken, async (req, res) => { const { slotDate, slotTime } = req.body; try { await pool.query('DELETE FROM blocked_slots WHERE slot_date = $1 AND slot_time = $2', [slotDate, slotTime]); res.status(204).send(); } catch (err) { console.error('예약 불가 시간 삭제 오류:', err); res.status(500).send('서버 오류'); } });

// --- 사용자 후기 관리 ---
router.get('/reviews', authenticateToken, async (req, res) => { try { const result = await pool.query('SELECT * FROM reviews ORDER BY created_at DESC'); res.json(toCamelCase(result.rows)); } catch (err) { console.error('관리자 후기 조회 오류:', err); res.status(500).send('서버 오류'); } });
router.put('/reviews/:id/approve', authenticateToken, async (req, res) => { const { isApproved } = req.body; try { const result = await pool.query('UPDATE reviews SET is_approved = $1 WHERE id = $2 RETURNING *', [isApproved, req.params.id]); if (result.rows.length === 0) return res.status(404).send('후기를 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error('후기 승인 오류:', err); res.status(500).send('서버 오류'); } });
router.post('/reviews/:id/reply', authenticateToken, async (req, res) => { const { reply } = req.body; try { const result = await pool.query('UPDATE reviews SET admin_reply = $1 WHERE id = $2 RETURNING *', [reply, req.params.id]); if (result.rows.length === 0) return res.status(404).send('후기를 찾을 수 없습니다.'); res.json(toCamelCase(result.rows)[0]); } catch (err) { console.error('답글 작성 오류:', err); res.status(500).send('서버 오류'); } });
router.delete('/reviews/:id', authenticateToken, async (req, res) => { try { const result = await pool.query('DELETE FROM reviews WHERE id = $1', [req.params.id]); if (result.rowCount === 0) return res.status(404).send('후기를 찾을 수 없습니다.'); res.status(204).send(); } catch (err) { console.error('후기 삭제 오류:', err); res.status(500).send('서버 오류'); } });

// --- [새 기능] 대시보드 차트용 통계 데이터 API ---
router.get('/dashboard-charts', authenticateToken, async (req, res) => {
  try {
    // 지난 7일간의 일별 상담 접수 현황
    const weeklyConsultationsQuery = `
      SELECT 
        TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as date,
        COUNT(*) as count
      FROM consultations
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date ASC;
    `;

    // 지난 6개월간의 월별 게시글(자유게시판+공지사항) 작성 수
    const monthlyPostsQuery = `
      SELECT 
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
        COUNT(*) as count
      FROM (
        SELECT created_at FROM posts
        UNION ALL
        SELECT created_at FROM notices
      ) as all_posts
      WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '5 months')
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month ASC;
    `;

    const [weeklyResult, monthlyResult] = await Promise.all([
      pool.query(weeklyConsultationsQuery),
      pool.query(monthlyPostsQuery)
    ]);

    res.json({
      weeklyConsultations: toCamelCase(weeklyResult.rows),
      monthlyPosts: toCamelCase(monthlyResult.rows),
    });

  } catch (err) {
    console.error('대시보드 차트 데이터 조회 오류:', err);
    res.status(500).send('서버 오류');
  }
});









module.exports = router;
