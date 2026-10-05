<script setup>
import { computed, ref } from 'vue'
import { Archive, Award, Bell, BookOpen, CalendarClock, ChevronRight, CircleAlert, FilePlus2, FolderLock, Image as ImageIcon, LayoutDashboard, Loader2, Menu, Plus, RotateCcw, Search, ShieldCheck, TrendingUp, UserRound, X } from 'lucide-vue-next'
import { config, days } from './data'
import { useKeeper } from './composables/useKeeper'
import { compressIdPhoto, photoSizeLabel, PHOTO_BUDGET, ImageCompressError } from './services/image'
import { StorageQuotaError, formatBytes } from './services/storage'
const { state, add, update, metrics, reset, assessWrite, loadError } = useKeeper()
const active = ref('overview'); const query = ref(''); const showForm = ref(false); const mobileOpen = ref(false); const draft = ref({})
const activeNav = computed(() => config.nav.find((x) => x.id === active.value))
const docs = computed(() => state.documents.filter((x) => `${x.name}${x.holder}${x.category}`.toLowerCase().includes(query.value.toLowerCase())))
const alerts = computed(() => state.documents.map((x) => ({ ...x, remaining: days(x.expires) })).filter((x) => x.remaining <= 90).sort((a, b) => a.remaining - b.remaining))
const borrowed = computed(() => state.usages.filter((x) => x.status === '借用中'))
const completion = computed(() => Math.min(100, Math.round((state.documents.filter((x) => x.location && x.copyLocation).length / Math.max(state.documents.length, 1)) * 100)))

const photoBusy = ref(false)
const photoHint = ref('')
const formError = ref('')
const previewDoc = ref(null)
function clearPhoto() { draft.value.photo = undefined; draft.value.photoBytes = 0; photoHint.value = ''; formError.value = '' }
function openCreate() { draft.value = Object.fromEntries(config.form.fields.map(([key, , value]) => [key, value || ''])); draft.value.photo = undefined; draft.value.photoBytes = 0; photoHint.value = ''; formError.value = ''; showForm.value = true }
function closeForm() { showForm.value = false; formError.value = '' }

// 上传即压缩：原图从不进入待保存数据，避免一张大图占满整块本地存储。
async function readFile(event) {
  const input = event.target
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file) return
  formError.value = ''
  photoBusy.value = true
  photoHint.value = '正在压缩图片…'
  try {
    const result = await compressIdPhoto(file)
    draft.value.photo = result.dataUrl
    draft.value.photoBytes = result.bytes
    photoHint.value = result.keptOriginal
      ? `图片本身较小，保持原样（约 ${photoSizeLabel(result.bytes)}），内容仅保存在本机`
      : `已压缩至 ${result.width}×${result.height}，约 ${photoSizeLabel(result.bytes)}（原图 ${formatBytes(file.size)}），内容仅保存在本机`
  } catch (error) {
    draft.value.photo = undefined
    draft.value.photoBytes = 0
    photoHint.value = ''
    formError.value = error instanceof ImageCompressError ? error.message : '图片处理失败，请换一张图片重试'
  } finally {
    photoBusy.value = false
  }
}

function buildItem() {
  const { photo, photoBytes, ...rest } = draft.value
  const item = { ...rest }
  if (photo) { item.photo = photo; item.photoBytes = photoBytes }
  return item
}
function save() {
  const item = buildItem()
  // 保存前先按整份数据的序列化结果预估剩余空间，不够就明确提示并阻止写入，
  // 已保存的所有档案原封不动。
  const estimate = assessWrite(config.form.collection, item)
  if (estimate.need > estimate.quota - estimate.used) {
    formError.value = `本机存储空间不足，无法保存这份档案：本次需新增约 ${formatBytes(estimate.need)}，剩余约 ${formatBytes(Math.max(0, estimate.quota - estimate.used))}。请移除照片后重试，本次保存已取消，已有档案不受影响。`
    return
  }
  try {
    add(config.form.collection, item) // 写入前还会做一次真实配额探测
  } catch (error) {
    if (error instanceof StorageQuotaError) {
      formError.value = `${error.message}请移除或更换照片后重试（建议单张不超过 ${photoSizeLabel(PHOTO_BUDGET)}）。本次保存已取消，已有档案不受影响。`
      return
    }
    formError.value = '保存失败，请重试。已有档案未受影响。'
    return
  }
  showForm.value = false
}
function markRenewed(doc) { try { update('documents', doc.id, { expires: `${new Date().getFullYear() + 10}-12-31`, renewed: true }) } catch (error) { alert(error instanceof StorageQuotaError ? error.message : '保存失败，已有档案未受影响。') } }
function resetData() { try { reset() } catch (error) { alert(error instanceof StorageQuotaError ? error.message : '操作失败，已有档案未受影响。') } }
function navTo(id) { active.value = id; mobileOpen.value = false }
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ open: mobileOpen }"><div class="brand"><span class="brand-mark"><FolderLock :size="19" /></span><div><strong>{{ config.brand }}</strong><small>{{ config.subtitle }}</small></div><button class="icon-btn close" @click="mobileOpen = false"><X :size="17" /></button></div><div class="family-chip"><span>林</span><div><b>林家家庭空间</b><small>4 位成员 · 私密存储</small></div><ChevronRight :size="15" /></div><nav><button v-for="item in config.nav" :key="item.id" :class="{ active: active === item.id }" @click="navTo(item.id)"><component :is="item.id === 'overview' ? LayoutDashboard : item.id === 'documents' ? Archive : item.id === 'history' ? CalendarClock : item.id === 'insurance' ? ShieldCheck : Award" :size="17" /><span>{{ item.label }}</span><i v-if="item.id === 'documents' && alerts.length">{{ alerts.length }}</i></button></nav><div class="sidebar-foot"><button><BookOpen :size="17" />使用指南</button><button><UserRound :size="17" />个人中心</button><button class="reset" @click="resetData"><RotateCcw :size="15" />恢复演示数据</button></div></aside>
    <main class="main"><header class="topbar"><button class="icon-btn menu" @click="mobileOpen = true"><Menu :size="20" /></button><div><span class="eyebrow">家庭文件空间</span><h1>{{ activeNav.label }}</h1></div><div class="top-actions"><button class="icon-btn"><Bell :size="18" /><em v-if="alerts.length"></em></button><span class="avatar">林</span><b>Lin</b></div></header>
      <div class="page">
        <div v-if="loadError" class="data-warning"><CircleAlert :size="15" /><span>{{ loadError }}</span></div>
        <section class="intro"><div><span class="eyebrow">{{ active === 'overview' ? '星期三 · 2026年9月16日' : '数据随时保存在当前设备' }}</span><h2>{{ active === 'overview' ? config.heroTitle : activeNav.label }}</h2><p>{{ active === 'overview' ? config.heroCopy : '集中查看、编辑和追踪家庭资料。' }}</p></div><button class="primary" @click="openCreate"><Plus :size="16" />{{ config.createLabel || '新建档案' }}</button></section>
        <section v-if="active === 'overview'" class="metric-grid"><article v-for="metric in metrics" :key="metric.label" class="metric"><span class="metric-icon" :class="metric.tone"><Archive v-if="metric.tone === 'green'" :size="17" /><CalendarClock v-else-if="metric.tone === 'peach'" :size="17" /><CircleAlert v-else-if="metric.tone === 'red'" :size="17" /><ShieldCheck v-else :size="17" /></span><div><small>{{ metric.label }}</small><strong>{{ metric.value }}</strong><em>{{ metric.tone === 'red' && metric.value ? '需要尽快处理' : metric.tone === 'peach' && metric.value ? '请提前安排续办' : '较上月稳定' }}</em></div></article></section>
        <section v-if="active === 'overview'" class="content-grid"><article class="panel"><div class="panel-head"><div><span class="eyebrow">到期预警</span><h3>需要你留意的文件</h3></div><button class="text-btn" @click="navTo('documents')">查看全部 <ChevronRight :size="14" /></button></div><div class="alert-list"><div v-for="item in alerts.slice(0, 4)" :key="item.id" class="alert-row"><span class="alert-icon" :class="item.remaining < 0 ? 'danger' : 'warn'"><CircleAlert :size="16" /></span><div><b>{{ item.name }}</b><small>{{ item.holder }} · {{ item.location }}</small></div><span class="date-pill" :class="item.remaining < 0 ? 'danger' : 'warn'">{{ item.remaining < 0 ? `已过期 ${Math.abs(item.remaining)} 天` : `${item.remaining} 天后到期` }}</span><button v-if="item.remaining <= 90" class="tiny-btn" @click="markRenewed(item)">已续办</button></div><div v-if="!alerts.length" class="empty">目前没有临期文件，保持得很好。</div></div></article><article class="panel score"><div class="panel-head"><div><span class="eyebrow">档案完整度</span><h3>家庭资料健康度</h3></div><TrendingUp :size="18" class="accent" /></div><div class="score-ring"><strong>{{ completion }}<small>%</small></strong></div><p>每一份文件都有存放位置和备份位置，家人需要时可以快速找到。</p><div class="progress"><span :style="{ width: `${completion}%` }"></span></div><small class="muted">已完善 {{ state.documents.filter(x => x.location && x.copyLocation).length }} / {{ state.documents.length }} 份</small></article></section>
        <section v-else-if="active === 'documents'" class="panel"><div class="toolbar"><div class="search"><Search :size="16" /><input v-model="query" :placeholder="`搜索${config.entityLabel}`" /></div><select><option>全部类别</option><option v-for="item in config.categories" :key="item">{{ item }}</option></select></div><div class="table-head"><span>{{ config.entityLabel }}</span><span>类别 / 关联人</span><span>{{ config.dateLabel || '有效期' }}</span><span>{{ config.locationLabel || '存放位置' }}</span><span></span></div><div v-for="item in docs" :key="item.id" class="table-row"><div class="item-title"><button v-if="item.photo" type="button" class="file-icon photo-thumb" :title="`查看${item.name}照片`" @click="previewDoc = item"><img :src="item.photo" :alt="item.name" /></button><span v-else class="file-icon"><Archive :size="16" /></span><div><b>{{ item.name }}</b><small>{{ item.number || '未填写编号' }}</small></div></div><span><b>{{ item.category }}</b><small>{{ item.holder }}</small></span><span><b :class="{ dangerText: days(item.expires) < 0, warnText: days(item.expires) >= 0 && days(item.expires) <= 90 }">{{ item.expires }}</b><small>{{ days(item.expires) < 0 ? '已过期' : `${config.remainingPrefix || '剩余'} ${days(item.expires)} 天` }}</small></span><span><b>{{ item.location || '未填写' }}</b><small>{{ config.copyLabel || '备份位置' }}：{{ item.copyLocation || '未填写' }}</small></span><button class="icon-btn"><ChevronRight :size="16" /></button></div><div v-if="!docs.length" class="empty">没有匹配的档案。</div></section>
        <section v-else-if="active === 'history'" class="panel"><div class="panel-head"><div><span class="eyebrow">{{ config.historyLabel }}</span><h3>{{ config.historyTitle || `${config.entityLabel}历史` }}</h3></div><span class="count-note">{{ borrowed.length }} 条待处理</span></div><div class="history-grid"><div v-for="entry in state.usages" :key="entry.id" class="history-card"><div class="history-date">{{ entry.date }}<span :class="entry.status === '借用中' ? 'warnText' : 'goodText'">{{ entry.status }}</span></div><b>{{ state.documents.find(x => x.id === entry.documentId)?.name || config.entityLabel }}</b><p>{{ entry.purpose }} · 经办人 {{ entry.borrower }}</p><small>{{ entry.note || '无备注' }}</small></div></div></section>
        <section v-else-if="active === 'insurance'" class="panel"><div class="panel-head"><div><span class="eyebrow">{{ config.secondaryLabel }}</span><h3>{{ config.secondaryTitle || config.secondaryLabel }}</h3></div><button class="text-btn" @click="openCreate">{{ config.secondaryAction || '添加记录' }} <Plus :size="14" /></button></div><div class="policy-grid"><div v-for="item in state.policies" :key="item.id" class="policy-card"><div class="policy-logo"><ShieldCheck :size="20" /></div><div><b>{{ item.type }}</b><small>{{ item.company }} · {{ item.number }}</small></div><span class="policy-date">{{ config.secondaryDatePrefix || '到期' }} {{ item.expires }}</span><strong>{{ item.amount ? `¥${Number(item.amount).toLocaleString()}` : (item.score || '进行中') }} <small>{{ item.payment || item.meta || '' }}</small></strong><p>{{ item.insured || item.description || '已加入家庭计划' }}</p></div></div></section>
        <section v-else class="content-grid"><article class="panel"><div class="panel-head"><div><span class="eyebrow">成长记录</span><h3>成就徽章</h3></div><Award :size="18" class="accent" /></div><div class="badge-grid"><div v-for="(item, index) in config.achievements" :key="item" class="badge" :class="{ unlocked: index < Math.min(5, state.documents.length + 2) }"><span><Award :size="18" /></span><b>{{ item }}</b><small>{{ index < 5 ? '已解锁' : '待解锁' }}</small></div></div></article><article class="panel"><div class="panel-head"><div><span class="eyebrow">家庭榜单</span><h3>档案管理达人</h3></div></div><div class="rank"><b>01</b><span class="rank-avatar">林</span><div><b>林小满</b><small>建档 {{ state.documents.length }} 份 · 处理率 92%</small></div><strong>98</strong></div><div class="rank"><b>02</b><span class="rank-avatar alt">周</span><div><b>周予安</b><small>建档 8 份 · 处理率 88%</small></div><strong>86</strong></div></article></section>
      </div>
    </main>
    <div v-if="showForm" class="modal-backdrop" @click.self="closeForm"><form class="modal" @submit.prevent="save"><div class="modal-head"><div><span class="eyebrow">建立家庭档案</span><h3>{{ config.form.title }}</h3></div><button type="button" class="icon-btn" @click="closeForm"><X :size="17" /></button></div><div class="form-grid"><label v-for="[key, label, placeholder, type] in config.form.fields" :key="key" :class="{ wide: key === 'notes' }">{{ label }}<input v-model="draft[key]" :type="type || 'text'" :placeholder="placeholder" /></label><div class="wide upload-field"><span class="upload-label">照片或扫描件（可选）</span><div v-if="draft.photo" class="photo-preview"><img :src="draft.photo" alt="证件照片预览" /><div class="photo-meta"><small>{{ photoHint || `约 ${photoSizeLabel(draft.photoBytes)}` }}</small><button type="button" class="text-btn danger-link" @click="clearPhoto"><X :size="12" />移除照片</button></div></div><label v-else class="upload-drop"><input type="file" accept="image/*" @change="readFile" :disabled="photoBusy" /><Loader2 v-if="photoBusy" :size="18" class="spin" /><ImageIcon v-else :size="18" /><span>{{ photoBusy ? '正在压缩图片…' : '点击选择图片，将自动压缩后保存' }}</span><small>支持 JPG、PNG，内容仅保存在本机 · 单张约 450KB 以内</small></label></div></div><div v-if="formError" class="form-error"><CircleAlert :size="15" /><span>{{ formError }}</span></div><div class="modal-actions"><button type="button" class="secondary" @click="closeForm">取消</button><button class="primary" type="submit" :disabled="photoBusy"><FilePlus2 :size="16" />保存档案</button></div></form></div>
    <div v-if="previewDoc" class="lightbox" @click.self="previewDoc = null"><button class="icon-btn lightbox-close" @click="previewDoc = null"><X :size="18" /></button><img :src="previewDoc.photo" :alt="previewDoc.name" /><small>{{ previewDoc.name }}<em v-if="previewDoc.photoBytes"> · 存档尺寸约 {{ photoSizeLabel(previewDoc.photoBytes) }}</em></small></div>
  </div>
</template>
