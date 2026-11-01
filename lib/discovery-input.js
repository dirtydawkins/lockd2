// Existing marketplace categories shared by public discovery endpoints.
const categories = new Set(['stay','drive','play','technology','experience','camera','phone','laptop','audio','creative','other']);
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
module.exports = {categories,isDate};
