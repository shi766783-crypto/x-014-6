const PHOTO_KEY_SEPARATOR = ':photos:'
const CAPACITY_PROBE_SUFFIX = ':capacity-probe'
const RESERVED_CHARS = 32 * 1024

function clone(value) {
  return structuredClone(value)
}

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError'
    || error?.code === 22
    || /quota|storage/i.test(error?.message || '')
}

function quotaError(requiredChars) {
  const requiredKb = Math.max(1, Math.ceil((requiredChars + RESERVED_CHARS) / 1024))
  const error = new Error(`本地存储空间不足，至少还需要约 ${requiredKb} KB。请减少或删除部分照片后重试；本次档案未写入，现有档案未改动。`)
  error.name = 'QuotaExceededError'
  error.code = 'STORAGE_QUOTA'
  error.requiredChars = requiredChars
  return error
}

export function createStorage(key, seed) {
  const photoKey = (photoId) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(photoId)) throw new Error('无效的照片编号')
    return `${key}${PHOTO_KEY_SEPARATOR}${photoId}`
  }

  const ensureCapacity = (requiredChars) => {
    if (requiredChars <= 0) return
    const probeKey = `${key}${CAPACITY_PROBE_SUFFIX}`
    localStorage.removeItem(probeKey)
    try {
      localStorage.setItem(probeKey, '0'.repeat(requiredChars + RESERVED_CHARS))
    } catch (error) {
      if (isQuotaError(error)) throw quotaError(requiredChars)
      throw error
    } finally {
      localStorage.removeItem(probeKey)
    }
  }

  const read = () => {
    const raw = localStorage.getItem(key)
    if (raw == null) return clone(seed)
    try {
      const value = JSON.parse(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据结构不正确')
      return value
    } catch {
      const backupKey = `${key}:corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      try { localStorage.setItem(backupKey, raw) } catch { /* 原数据已无法解析，避免备份再次影响启动 */ }
      return clone(seed)
    }
  }

  const write = (value, assetChanges = {}) => {
    const serialized = JSON.stringify(value)
    const currentMainSize = localStorage.getItem(key)?.length || 0
    let requiredChars = Math.max(0, serialized.length - currentMainSize)
    const writes = []
    const deletes = []

    for (const [photoId, nextValue] of Object.entries(assetChanges)) {
      const fullKey = photoKey(photoId)
      const oldValue = localStorage.getItem(fullKey)
      if (nextValue == null) {
        deletes.push(fullKey)
      } else {
        if (typeof nextValue !== 'string') throw new Error('照片数据格式不正确')
        requiredChars += Math.max(0, nextValue.length - (oldValue?.length || 0))
        writes.push({ fullKey, nextValue, oldValue })
      }
    }

    ensureCapacity(requiredChars)

    const writtenKeys = []
    try {
      for (const asset of writes) {
        localStorage.setItem(asset.fullKey, asset.nextValue)
        writtenKeys.push(asset)
      }
      try {
        localStorage.setItem(key, serialized)
      } catch (error) {
        if (isQuotaError(error)) throw quotaError(requiredChars)
        throw error
      }
    } catch (error) {
      for (let i = writtenKeys.length - 1; i >= 0; i -= 1) {
        const asset = writtenKeys[i]
        if (asset.oldValue == null) localStorage.removeItem(asset.fullKey)
        else localStorage.setItem(asset.fullKey, asset.oldValue)
      }
      throw error
    }

    for (const fullKey of deletes) localStorage.removeItem(fullKey)
  }

  const readAsset = (photoId) => {
    try { return localStorage.getItem(photoKey(photoId)) } catch { return null }
  }

  const listAssetIds = () => {
    const prefix = `${key}${PHOTO_KEY_SEPARATOR}`
    const ids = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const itemKey = localStorage.key(i)
      if (itemKey?.startsWith(prefix)) ids.push(itemKey.slice(prefix.length))
    }
    return ids
  }

  return { read, write, readAsset, listAssetIds }
}
