import { computed, reactive } from 'vue'
import { createStorage } from '../services/storage'
import { config, seed } from '../data'

const storage = createStorage(config.storageKey, seed)
export function useKeeper() {
  const state = reactive(storage.read())
  const persist = (assets) => storage.write(state, assets)
  const add = async (collection, item, assets = {}) => {
    const id = `${collection}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const record = { id, createdAt: new Date().toISOString(), ...item }
    const next = { ...state, [collection]: [record, ...state[collection]] }
    storage.write(next, assets)
    state[collection] = next[collection]
    return record
  }
  const update = async (collection, id, patch) => {
    const index = state[collection].findIndex((entry) => entry.id === id)
    if (index < 0) return
    const record = { ...state[collection][index], ...patch, id }
    const collectionItems = state[collection].slice()
    collectionItems[index] = record
    const next = { ...state, [collection]: collectionItems }
    storage.write(next)
    state[collection] = collectionItems
  }
  const remove = async (collection, id) => {
    const item = state[collection].find((entry) => entry.id === id)
    const collectionItems = state[collection].filter((entry) => entry.id !== id)
    const next = { ...state, [collection]: collectionItems }
    const assetChanges = collection === 'documents' && item?.photoId ? { [item.photoId]: null } : undefined
    storage.write(next, assetChanges)
    state[collection] = collectionItems
  }
  const reset = () => {
    const assetChanges = Object.fromEntries(storage.listAssetIds().map((photoId) => [photoId, null]))
    storage.write(structuredClone(seed), assetChanges)
    Object.assign(state, structuredClone(seed))
  }
  const metrics = computed(() => config.metrics.map((metric) => ({ ...metric, value: metric.value ? metric.value(state) : state[metric.collection]?.length || 0 })))
  const photoUrls = computed(() => Object.fromEntries(
    state.documents
      .filter((documentItem) => documentItem.photoId)
      .map((documentItem) => [documentItem.id, storage.readAsset(documentItem.photoId)])
  ))
  return { state, add, update, remove, reset, persist, metrics, photoUrls }
}
