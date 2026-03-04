const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = (file.originalname || '').toLowerCase();
  const allowed = ['.csv', '.txt', '.tsv'];
  const ok = allowed.some((e) => ext.endsWith(e)) || /text\/(csv|plain|tab-separated-values)/.test(file.mimetype);
  if (ok) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV or TXT gene files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;
