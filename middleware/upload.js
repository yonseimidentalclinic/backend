// /middleware/upload.js

const multer = require('multer');

// 파일을 메모리에 저장하도록 설정
const storage = multer.memoryStorage();

// 파일 업로드 설정 (최대 5MB)
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = upload;