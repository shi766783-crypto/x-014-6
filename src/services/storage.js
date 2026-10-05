// 所有数据保存在同一个 localStorage 键里，因此任何一次写入都必须先确认放得下，
// 否则 QuotaExceededError 不仅会让本次保存失败，还会让后续每一次保存（即使是
// 很小的改动）都失败，用户却毫不知情。

export class StorageQuotaError extends Error {
  constructor({ need = 0, free = 0 } = {}) {
    super(`存储空间不足：本次写入约 ${formatBytes(need)}，当前仅剩约 ${formatBytes(free)} 可用。`)
    this.name = 'StorageQuotaError'
    this.need = need
    this.free = free
  }
}

// localStorage 以 UTF-16 码元计量配额，字符串长度（非多字节字符数）即占用量，
// 再算上 JSON 序列化本身基本不会放大，这个估算足够保守。
const PROBE_MARGIN = 2048

export function createStorage(key, seed) {
  const serialize = (value) => JSON.stringify(value)

  const read = () => {
    // 解析失败时绝不静默回退种子数据：那等于用一份空数据掩盖用户已有档案，
    // 而且随后的写入还会把坏数据覆盖掉。原样抛出让调用方决定如何提示。
    const raw = localStorage.getItem(key)
    if (raw == null) return structuredClone(seed)
    return JSON.parse(raw)
  }

  const isQuotaError = (error) =>
    error && (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)

  // 用探测键模拟真实写入，确认还能再写入 size 个码元。
  // 探测串用完即删，绝不留下占空间的垃圾数据。
  const fits = (size) => {
    const probeKey = `${key}__probe__`
    try {
      localStorage.setItem(probeKey, 'a'.repeat(Math.max(0, size + PROBE_MARGIN)))
      return true
    } catch (error) {
      if (!isQuotaError(error)) throw error
      return false
    } finally {
      try { localStorage.removeItem(probeKey) } catch { /* 忽略清理失败 */ }
    }
  }

  // 二分探测当前实际剩余空间，仅用于在报错时给出"还剩多少"的明确数字。
  const measureAvailable = () => {
    const probeKey = `${key}__probe__`
    let low = 0
    let high = 1 << 23 // 上限 8MB（localStorage 常见总配额约 5MB）
    try {
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        try {
          localStorage.setItem(probeKey, 'a'.repeat(mid))
          low = mid
        } catch {
          high = mid - 1
        }
      }
      return low
    } finally {
      try { localStorage.removeItem(probeKey) } catch { /* 忽略清理失败 */ }
    }
  }

  const usage = () => {
    const raw = localStorage.getItem(key) || ''
    return { used: raw.length, quota: 5 * 1024 * 1024 }
  }

  // 先探测、再写入。探测不通过时完全不触碰已保存的数据，
  // 返回结构化的错误供界面给出明确提示。
  const write = (value) => {
    const raw = serialize(value)
    const current = localStorage.getItem(key) || ''
    const growth = raw.length - current.length
    if (growth > 0 && !fits(growth)) {
      throw new StorageQuotaError({ need: growth, free: measureAvailable() })
    }
    try {
      localStorage.setItem(key, raw)
    } catch (error) {
      if (isQuotaError(error)) {
        throw new StorageQuotaError({ need: Math.max(growth, 0), free: measureAvailable() })
      }
      throw error
    }
  }

  return { read, write, usage, serialize }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
