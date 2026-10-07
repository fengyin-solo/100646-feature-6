<template>
  <section class="page" data-module="weighbridge">
    <header class="page-head">
      <div>
        <h2>垃圾进厂计量管理</h2>
        <p class="page-desc">早高峰批量核收：勾选多条待过磅计量单，一次设定垃圾来源与过磅时间；车牌被未结算单占用或磅单无效的逐条退回待过磅，不影响同批其他单。状态只许 待过磅 → 已过磅 → 已复核。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openBatch">批量核收</button>
        <button class="btn" type="button" @click="exportRows">导出垃圾进厂计量清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>计量状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="batch-bar">
      <label class="select-all">
        <input
          type="checkbox"
          :checked="allPendingChecked"
          :indeterminate.prop="somePendingChecked"
          @change="toggleSelectAll"
        />
        全选本页待过磅
      </label>
      <span class="batch-count">已选待过磅计量单 <strong>{{ selectedPending.length }}</strong> 条</span>
      <button class="btn primary" type="button" :disabled="selectedPending.length === 0" @click="openBatch">
        批量设定来源与过磅时间（{{ selectedPending.length }}）
      </button>
      <span class="batch-hint">净重＝毛重−皮重，系统自动计算只读；同一车辆重复提交只生效一次</span>
    </div>

    <p v-if="banner" class="banner" :class="banner.type">{{ banner.text }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">核收</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-blocked': isPending(row) }">
          <td class="col-check">
            <input
              v-if="isPending(row)"
              type="checkbox"
              :value="Number(row.id)"
              v-model="selectedIds"
            />
            <span v-else class="check-na">—</span>
          </td>
          <td>{{ row['计量单号'] ?? '—' }}</td>
          <td>{{ row['进场车牌'] ?? '—' }}</td>
          <td>{{ row['垃圾来源'] || '—' }}</td>
          <td>{{ formatWeight(row['毛重']) }}</td>
          <td>{{ formatWeight(row['皮重']) }}</td>
          <td>
            <span :class="{ 'net-invalid': isPending(row) && netWeight(row) === null }">
              {{ netCell(row) }}
            </span>
          </td>
          <td>{{ row['过磅时间'] || '—' }}</td>
          <td>
            <span class="status-tag" :data-status="row.status">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-if="String(row.status) === '已过磅'"
              class="link"
              type="button"
              @click="openReview(row)"
            >
              确认复核
            </button>
            <span v-else-if="isPending(row)" class="action-hint">勾选后批量核收</span>
            <span v-else-if="String(row.status) === '已复核'" class="action-done">流程完结</span>
            <span v-else class="action-hint">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">没有符合条件的进厂计量单</td>
        </tr>
      </tbody>
    </table>

    <section v-if="batchResult" class="result-panel">
      <header class="result-head">
        <h3>批量核收结果（共 {{ batchResult.accepted.length + batchResult.rejected.length }} 条）</h3>
        <div class="result-summary">
          <span class="badge accepted">通过 {{ batchResult.accepted.length }} 条</span>
          <span class="badge blocked">挡住 {{ blockedResults.length }} 条</span>
          <span class="badge invalid">无效 {{ invalidResults.length }} 条</span>
          <span class="badge duplicate">重复 {{ duplicateResults.length }} 条</span>
          <button class="btn ghost" type="button" @click="dismissResult">知道了</button>
        </div>
      </header>
      <ul class="result-list accepted-list">
        <li v-for="item in batchResult.accepted" :key="`ok-${item.id}`">
          <span class="badge accepted">通过</span>
          <span class="result-no">{{ item.计量单号 }}</span>
          <span class="result-plate">{{ item.进场车牌 }}</span>
          <span class="result-msg">{{ item.message }}</span>
        </li>
      </ul>
      <ul class="result-list rejected-list">
        <li v-for="item in batchResult.rejected" :key="`no-${item.id}`">
          <span class="badge" :class="item.reason">{{ reasonLabel(item.reason) }}</span>
          <span class="result-no">{{ item.计量单号 }}</span>
          <span class="result-plate">{{ item.进场车牌 }}</span>
          <span class="result-msg">{{ item.message }}</span>
          <span class="result-keep">已留在「待过磅」，勾选仍保留可直接重试</span>
        </li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条进厂计量记录</span>
      <span>状态流转不可逆、不可跳级；复核后自动驱动垃圾池待投料清单重排</span>
    </footer>

    <!-- 批量设定弹窗 -->
    <div v-if="batchOpen" class="modal-mask" @click.self="closeBatch">
      <div class="modal">
        <header class="modal-head">
          <h3>批量核收（{{ selectedPending.length }} 条待过磅计量单）</h3>
          <button class="modal-close" type="button" @click="closeBatch">×</button>
        </header>
        <div class="modal-body">
          <div class="form-grid">
            <label class="form-item">
              <span>垃圾来源（批量统一设定）</span>
              <input v-model="batchForm['垃圾来源']" list="source-options" placeholder="如：静安区压缩中转站" />
              <datalist id="source-options">
                <option v-for="source in sourceOptions" :key="source" :value="source" />
              </datalist>
            </label>
            <label class="form-item">
              <span>过磅时间（批量统一设定）</span>
              <input v-model="batchForm['过磅时间']" type="datetime-local" />
            </label>
          </div>
          <p v-if="batchError" class="banner error">{{ batchError }}</p>
          <table class="data-table preview-table">
            <thead>
              <tr><th>计量单号</th><th>进场车牌</th><th>毛重(kg)</th><th>皮重(kg)</th><th>净重(kg，只读)</th><th>预检</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in selectedPendingRows" :key="`preview-${String(row.id)}`">
                <td>{{ row['计量单号'] }}</td>
                <td>{{ row['进场车牌'] }}</td>
                <td>{{ row['毛重'] || '—' }}</td>
                <td>{{ row['皮重'] || '—' }}</td>
                <td :class="{ 'net-invalid': netWeight(row) === null }">
                  {{ netWeight(row) === null ? '无法计算' : netWeight(row)?.toLocaleString('zh-CN') }}
                </td>
                <td>{{ precheck(row) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="modal-hint">车牌若已挂在另一张「已过磅未复核」的单子上，提交后该条会被单独挡住并留在待过磅；通过的条目不受影响、不会整批退回。</p>
        </div>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="closeBatch">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitBatch">
            {{ submitting ? '提交中…' : '提交批量核收' }}
          </button>
        </footer>
      </div>
    </div>

    <!-- 复核弹窗 -->
    <div v-if="reviewRow" class="modal-mask" @click.self="closeReview">
      <div class="modal modal-sm">
        <header class="modal-head">
          <h3>确认复核 · {{ reviewRow['计量单号'] }}</h3>
          <button class="modal-close" type="button" @click="closeReview">×</button>
        </header>
        <div class="modal-body">
          <dl class="review-dl">
            <div><dt>进场车牌</dt><dd>{{ reviewRow['进场车牌'] }}</dd></div>
            <div><dt>垃圾来源</dt><dd>{{ reviewRow['垃圾来源'] || '—' }}</dd></div>
            <div><dt>毛重 / 皮重</dt><dd>{{ formatWeight(reviewRow['毛重']) }} / {{ formatWeight(reviewRow['皮重']) }}</dd></div>
            <div><dt>净重（只读）</dt><dd>{{ netWeight(reviewRow)?.toLocaleString('zh-CN') ?? '—' }} kg</dd></div>
            <div><dt>过磅时间</dt><dd>{{ reviewRow['过磅时间'] }}</dd></div>
          </dl>
          <label class="form-item">
            <span>复核后垃圾去向（待投料池区）</span>
            <select v-model="reviewPitCode">
              <option value="" disabled>请选择池区</option>
              <option v-for="pit in reviewPits" :key="String(pit.id)" :value="String(pit['池区编号'])">
                {{ pit['池区编号'] }}（存量 {{ pit['垃圾存量'] }} 吨）
              </option>
            </select>
          </label>
          <p v-if="reviewError" class="banner error">{{ reviewError }}</p>
          <p class="modal-hint">复核成功后，该单净重自动排入垃圾池待投料清单（先进先出）并触发重排；已复核单重复提交不生效。</p>
        </div>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="closeReview">取消</button>
          <button class="btn primary" type="button" :disabled="submitting || !reviewPitCode" @click="submitReview">
            {{ submitting ? '提交中…' : '确认复核并入池' }}
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  batchAcceptWeigh,
  formatWeight,
  netWeight,
  reviewTargets,
  reviewWeigh,
  weighRows,
} from '@/api/weighbridge-service'
import type { EntryRow, WeighAcceptReason, WeighAcceptResult } from '@/data/types'

const columns = ['计量单号', '进场车牌', '垃圾来源', '毛重', '皮重', '净重', '过磅时间']
const filterFields = ['计量单号', '进场车牌', '垃圾来源']
const statuses = ['待过磅', '已过磅', '已复核', '数据异常']
const sourceOptions = ['静安区压缩中转站', '黄浦区压缩中转站', '徐汇区压缩中转站', '普陀区环卫所', '余杭区清运公司']

const rows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const statusFilter = ref('')
const selectedIds = ref<number[]>([])
const batchOpen = ref(false)
const batchForm = ref<{ 垃圾来源: string; 过磅时间: string }>({ 垃圾来源: '', 过磅时间: '' })
const batchError = ref('')
const batchResult = ref<WeighAcceptResult | null>(null)
const reviewRow = ref<EntryRow | null>(null)
const reviewPits = ref<EntryRow[]>([])
const reviewPitCode = ref('')
const reviewError = ref('')
const submitting = ref(false)
const banner = ref<{ type: 'ok' | 'error'; text: string } | null>(null)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  const pendingCount = allRows.value.filter((row) => String(row.status) === '待过磅').length
  const reviewedCount = allRows.value.filter((row) => String(row.status) === '已复核').length
  const acceptedTodayKg = allRows.value
    .filter((row) => ['已过磅', '已复核'].includes(String(row.status)))
    .filter((row) => String(row['过磅时间'] ?? '').startsWith(today))
    .reduce((sum, row) => sum + (netWeight(row) ?? 0), 0)
  return [
    { label: '待过磅车辆', value: pendingCount },
    { label: '已复核计量单', value: reviewedCount },
    { label: '当日核收进厂量', value: `${(acceptedTodayKg / 1000).toFixed(2)} 吨` },
  ]
})

const selectedPending = computed(() => selectedIds.value)
const selectedPendingRows = computed(() =>
  rows.value.filter((row) => isPending(row) && selectedIds.value.includes(Number(row.id))),
)
const pendingIdsInPage = computed(() =>
  rows.value.filter(isPending).map((row) => Number(row.id)),
)
const allPendingChecked = computed(
  () =>
    pendingIdsInPage.value.length > 0 &&
    pendingIdsInPage.value.every((id) => selectedIds.value.includes(id)),
)
const somePendingChecked = computed(
  () => pendingIdsInPage.value.some((id) => selectedIds.value.includes(id)) && !allPendingChecked.value,
)

const blockedResults = computed(() => batchResult.value?.rejected.filter((i) => i.reason === 'blocked') ?? [])
const invalidResults = computed(() => batchResult.value?.rejected.filter((i) => i.reason === 'invalid') ?? [])
const duplicateResults = computed(() => batchResult.value?.rejected.filter((i) => i.reason === 'duplicate') ?? [])

function isPending(row: EntryRow): boolean {
  return String(row.status) === '待过磅'
}

function netCell(row: EntryRow): string {
  const net = netWeight(row)
  if (net !== null) {
    return `${net.toLocaleString('zh-CN')} kg`
  }
  return isPending(row) ? '待核收（磅单无效）' : '—'
}

function toggleSelectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const pagePending = pendingIdsInPage.value
  if (checked) {
    selectedIds.value = [...new Set([...selectedIds.value, ...pagePending])]
  } else {
    const pageSet = new Set(pagePending)
    selectedIds.value = selectedIds.value.filter((id) => !pageSet.has(id))
  }
}

function resetFilters() {
  filters.value = {}
  statusFilter.value = ''
  reload()
}

function exportRows() {
  downloadEntries('weighbridge')
}

// 预检按提交顺序模拟批内占位：排在前面且能收下的同车牌单，会把后面的挡住。
function precheckMap(): Map<number, string> {
  const map = new Map<number, string>()
  const acceptedPlates = new Set<string>()
  for (const row of selectedPendingRows.value) {
    const plate = String(row['进场车牌'] ?? '').trim()
    if (netWeight(row) === null) {
      map.set(Number(row.id), '磅单无效，将被退回')
      continue
    }
    const blocker = allRows.value.find(
      (item) =>
        Number(item.id) !== Number(row.id) &&
        String(item['进场车牌'] ?? '').trim() === plate &&
        String(item.status) === '已过磅',
    )
    if (blocker) {
      map.set(Number(row.id), `车牌被 ${String(blocker['计量单号'] ?? '')} 占用，将被挡住`)
    } else if (acceptedPlates.has(plate)) {
      map.set(Number(row.id), '同批内同车牌排在前面的单将先收下，本单会被挡住')
    } else {
      acceptedPlates.add(plate)
      map.set(Number(row.id), '可核收')
    }
  }
  return map
}

const precheckResult = computed(() => precheckMap())

function precheck(row: EntryRow): string {
  return precheckResult.value.get(Number(row.id)) ?? '—'
}

function openBatch() {
  banner.value = null
  if (selectedPendingRows.value.length === 0) {
    banner.value = { type: 'error', text: '请先在列表中勾选至少一条「待过磅」计量单' }
    return
  }
  batchError.value = ''
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  batchForm.value = {
    垃圾来源: '',
    过磅时间: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
  batchOpen.value = true
}

function closeBatch() {
  if (submitting.value) {
    return
  }
  batchOpen.value = false
}

function submitBatch() {
  if (!batchForm.value['垃圾来源'].trim()) {
    batchError.value = '请填写本批统一的垃圾来源'
    return
  }
  if (!batchForm.value['过磅时间']) {
    batchError.value = '请选择本批统一的过磅时间'
    return
  }
  submitting.value = true
  try {
    const ids = selectedPendingRows.value.map((row) => Number(row.id))
    batchResult.value = batchAcceptWeigh(ids, batchForm.value)
    batchOpen.value = false
    const { accepted, rejected } = batchResult.value
    banner.value = rejected.length
      ? {
          type: accepted.length ? 'ok' : 'error',
          text: accepted.length
            ? `核收完成：${accepted.length} 条通过，${rejected.length} 条被挡回，明细见下方结果`
            : `本批 ${rejected.length} 条均未通过，全部留在待过磅，明细见下方`,
        }
      : { type: 'ok', text: `本批 ${accepted.length} 条全部核收通过` }
    reload()
    // 被挡/无效的条目继续保留勾选，计量员改完可直接再提交；已通过的自动退出选择。
    const stillPending = new Set(
      allRows.value.filter(isPending).map((row) => Number(row.id)),
    )
    selectedIds.value = selectedIds.value.filter((id) => stillPending.has(id))
  } finally {
    submitting.value = false
  }
}

function dismissResult() {
  batchResult.value = null
}

function reasonLabel(reason: WeighAcceptReason): string {
  return reason === 'blocked' ? '车牌占用' : reason === 'invalid' ? '磅单无效' : '重复提交'
}

function openReview(row: EntryRow) {
  banner.value = null
  reviewError.value = ''
  reviewPits.value = reviewTargets()
  if (reviewPits.value.length === 0) {
    banner.value = { type: 'error', text: '当前没有「待投料」状态的池区，无法复核入池' }
    return
  }
  reviewRow.value = row
  reviewPitCode.value = String(reviewPits.value[0]['池区编号'] ?? '')
}

function closeReview() {
  if (submitting.value) {
    return
  }
  reviewRow.value = null
}

function submitReview() {
  if (!reviewRow.value) {
    return
  }
  submitting.value = true
  try {
    const result = reviewWeigh(Number(reviewRow.value.id), reviewPitCode.value)
    if (!result.ok) {
      reviewError.value = result.message
      return
    }
    banner.value = { type: 'ok', text: result.message }
    reviewRow.value = null
    reload()
  } finally {
    submitting.value = false
  }
}

function reload() {
  banner.value = null
  allRows.value = weighRows()
  let matched = allRows.value
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  if (pairs.length > 0) {
    matched = matched.filter((row) =>
      pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
    )
  }
  if (statusFilter.value) {
    matched = matched.filter((row) => String(row.status) === statusFilter.value)
  }
  rows.value = matched
  total.value = matched.length
}

onMounted(reload)
</script>

<style scoped>
.batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 13px;
}
.batch-bar .btn:disabled { opacity: .5; cursor: not-allowed; }
.select-all { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.batch-count { color: var(--muted); white-space: nowrap; }
.batch-count strong { color: var(--brand); font-size: 15px; }
.batch-hint { color: var(--muted); font-size: 12px; }
.col-check { width: 46px; text-align: center; }
.check-na { color: #9aa7b5; }
.row-blocked { background: #fcfdff; }
.net-invalid { color: #b42318; font-weight: 600; }
.action-hint, .action-done { color: var(--muted); font-size: 12px; }
.action-done { color: #15803d; }
.status-tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  background: #eef2f7;
}
.status-tag[data-status='已过磅'] { background: #e0edff; color: #1d4ed8; }
.status-tag[data-status='已复核'] { background: #dcfce7; color: #15803d; }
.status-tag[data-status='数据异常'] { background: #fee4e2; color: #b42318; }
.banner {
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  margin: 0 0 10px;
}
.banner.ok { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
.banner.error { background: #fee4e2; color: #b42318; border: 1px solid #fda29b; }
.result-panel {
  margin-top: 14px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.result-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.result-head h3 { margin: 0; font-size: 15px; }
.result-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.badge {
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  background: #eef2f7;
  color: #475569;
  white-space: nowrap;
}
.badge.accepted { background: #dcfce7; color: #15803d; }
.badge.blocked { background: #fef3c7; color: #b45309; }
.badge.invalid { background: #fee4e2; color: #b42318; }
.badge.duplicate { background: #e5e7eb; color: #6b7280; }
.result-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.result-list li { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 6px 8px; border-radius: 6px; }
.accepted-list li { background: #f0fdf4; }
.rejected-list li { background: #fffbeb; }
.result-no { font-weight: 600; min-width: 150px; }
.result-plate { color: var(--muted); min-width: 96px; }
.result-msg { flex: 1; }
.result-keep { color: #b45309; font-size: 12px; white-space: nowrap; }
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, .45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 10px;
  width: 820px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
}
.modal-sm { width: 520px; }
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.modal-head h3 { margin: 0; font-size: 15px; }
.modal-close { border: none; background: none; font-size: 20px; cursor: pointer; color: var(--muted); }
.modal-body { padding: 14px 16px; overflow: auto; }
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
}
.form-grid { display: flex; gap: 14px; margin-bottom: 12px; }
.form-item { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.form-item input, .form-item select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  color: #1f2937;
}
.preview-table { margin-top: 4px; }
.modal-hint { font-size: 12px; color: var(--muted); margin: 10px 0 0; }
.review-dl { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 0 0 12px; }
.review-dl div { display: flex; gap: 8px; font-size: 13px; }
.review-dl dt { color: var(--muted); min-width: 86px; margin: 0; }
.review-dl dd { margin: 0; }
</style>
