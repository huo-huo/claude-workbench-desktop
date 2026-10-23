/** 隐藏错误信息中的常见密钥与令牌，避免随响应或模型提示词外泄 */
export function redacted(value) {
  return String(value)
    .replace(/((?:sk|cp|pk|api)[-_][A-Za-z0-9_-]{12,})/gi, '<已隐藏的密钥>')
    .replace(/((?:api[_-]?key|auth[_-]?token|access[_-]?token|secret|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1<已隐藏>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi, 'Bearer <已隐藏>');
}
