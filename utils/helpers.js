// /utils/helpers.js

/**
 * 데이터베이스에서 조회한 snake_case 키를 camelCase로 변환하는 함수
 * @param {Array} rows - 데이터베이스에서 조회한 데이터 배열
 * @returns {Array} - 키가 camelCase로 변환된 데이터 배열
 */
const toCamelCase = (rows) => {
  if (!rows) return [];
  return rows.map(row => {
    const newRow = {};
    for (let key in row) {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      newRow[camelKey] = row[key];
    }
    return newRow;
  });
};

module.exports = { toCamelCase };
