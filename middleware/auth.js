// /middleware/auth.js

const jwt = require('jsonwebtoken');

/**
 * JWT 토큰을 검증하여 사용자를 인증하는 미들웨어
 */
const authenticateToken = (req, res, next) => {
  // --- [진단 코드] 서버가 JWT_SECRET 환경 변수를 제대로 읽었는지 확인합니다. ---
  console.log('Is JWT_SECRET available on server?', !!process.env.JWT_SECRET);

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.sendStatus(401); // Unauthorized
  }

  // 비밀 키가 없으면 인증을 진행할 수 없으므로, 여기서 미리 확인합니다.
  if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined on the server!');
      return res.status(500).send('Server configuration error.');
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT verification failed:', err.message);
      return res.sendStatus(403); // Forbidden
    }
    req.user = user;
    next();
  });
};

module.exports = { authenticateToken };
