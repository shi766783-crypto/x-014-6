import { computed, reactive, ref } from 'vue'
import { createStorage } from '../services/storage'
import { config, seed } from '../data'

const storage = createStorage(config.storageKey, seed)

export function useKeeper() {
  // 已保存的数据损坏时不再静默用种子数据顶替（那会让用户以为档案还在），
  // 但也不能白屏：载入种子数据并挂出错误提示，且在用户确认前不主动写回。
  const loadError = ref(null)
  let initial
  try {
    initial = storage.read()
  } catch (error) {
    initial = structuredClone(seed)
    loadError.value = '本地档案数据无法读取（可能曾被异常写入破坏），当前显示为初始演示数据，请勿立即保存以免覆盖，请联系家人确认后再操作。'
  }

  const state = reactive(initial)

  // 关键顺序：先在快照上改、先把完整快照写入 localStorage，写成功后再同步到
  // 响应式状态。写盘抛错（例如配额不足）时内存与磁盘完全一致，不会出现
  // “这次没存上、以后也全都存不上、刷新后档案消失”的连锁数据丢失。
  const commit = (mutator) => {
    const snapshot = structuredClone(state)
    mutator(snapshot)
    storage.write(snapshot)
    Object.assign(state, snapshot)
  }

  const add = (collection, item) => {
    commit((next) => {
      next[collection].unshift({ id: `${collection}-${Date.now()}`, createdAt: new Date().toISOString(), ...item })
    })
  }
  const update = (collection, id, patch) => {
    commit((next) => {
      const item = next[collection].find((entry) => entry.id === id)
      if (item) Object.assign(item, patch)
    })
  }
  const remove = (collection, id) => {
    commit((next) => {
      next[collection] = next[collection].filter((entry) => entry.id !== id)
    })
  }
  const reset = () => {
    commit((next) => Object.assign(next, structuredClone(seed)))
  }
  // 在保存前预估整份数据的写入增长，供表单在提交前给出明确提示。
  const assessWrite = (collection, item) => {
    const snapshot = structuredClone(state)
    snapshot[collection].unshift({ id: 'preview', createdAt: '', ...item })
    const nextSize = storage.serialize(snapshot).length
    const currentSize = (localStorage.getItem(config.storageKey) || '').length
    return { need: Math.max(0, nextSize - currentSize), nextSize, ...storage.usage() }
  }
  const metrics = computed(() => config.metrics.map((metric) => ({ ...metric, value: metric.value ? metric.value(state) : state[metric.collection]?.length || 0 })))
  return { state, add, update, remove, reset, assessWrite, metrics, loadError }
}
