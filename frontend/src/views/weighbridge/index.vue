<template>
  <section class="page" data-module="weighbridge">
    <header class="page-head">
      <div>
        <h2>垃圾进厂计量管理</h2>
        <p class="page-desc">
          早高峰可一次勾选多条待过磅计量单批量核收，统一设定垃圾来源与过磅时间；净重按毛重减皮重自动计算、只读不可改。
          车牌挂在未结算单子上的会被逐条拦下并留在待过磅，复核通过后驱动垃圾池待投料清单重排。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openBatch()">批量核收过磅</button>
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
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              :checked="allPendingSelected"
              :disabled="!pendingRows.length"
              title="全选当前筛选结果中的待过磅单"
              @change="toggleAll"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-selected': isPending(row) && checkedIdList.includes(Number(row.id)) }">
          <td class="col-check">
            <input
              v-if="isPending(row)"
              type="checkbox"
              :value="Number(row.id)"
              v-model="checkedIdList"
            />
            <span v-else class="check-muted">—</span>
          </td>
          <td v-for="column in columns" :key="column">
            <template v-if="column === '净重'">
              <span :class="{ 'net-invalid': displayNet(row) === null }">{{ displayNet(row) ?? '无法计算' }}</span>
            </template>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="isPending(row)"
              class="link"
              type="button"
              @click="openBatch(Number(row.id))"
            >
              加入批量核收
            </button>
            <button
              v-if="String(row.status) === WB_STATUS_WEIGHED"
              class="link"
              type="button"
              @click="runReview(row)"
            >
              确认复核
            </button>
            <button
              v-if="String(row.status) !== WB_STATUS_REVIEWED && String(row.status) !== WB_STATUS_ABNORMAL"
              class="link link-danger"
              type="button"
              @click="runMarkAbnormal(row)"
            >
              标记异常
            </button>
            <span v-if="!hasRowAction(row)" class="check-muted">无</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无垃圾进厂计量数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条垃圾进厂计量记录，已勾选 {{ checkedIdList.length }} 条待过磅单</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 批量核收弹窗：统一设定来源与过磅时间，提交后逐条给出结果，被拦的留在待过磅不丢 -->
    <div v-if="batchOpen" class="modal-mask" @click.self="closeBatch">
      <div class="modal" role="dialog" aria-modal="true" aria-label="批量核收进厂计量单">
        <header class="modal-head">
          <h3>批量核收进厂计量单</h3>
          <button class="link" type="button" @click="closeBatch">关闭</button>
        </header>

        <div v-if="!batchResult" class="modal-body">
          <p class="modal-tip">
            已选 {{ dialogPendingRows.length }} 条待过磅单；本批统一设定垃圾来源与过磅时间，净重由毛重减皮重自动计算。
          </p>

          <div class="pick-list">
            <label v-for="row in dialogPendingRows" :key="String(row.id)" class="pick-item">
              <input type="checkbox" :value="Number(row.id)" v-model="dialogCheckedIds" />
              <span class="pick-no">{{ row.计量单号 }}</span>
              <span class="pick-plate">{{ row.进场车牌 }}</span>
              <span class="pick-weight">毛重 {{ row.毛重 }} / 皮重 {{ row.皮重 }}</span>
              <span class="pick-net" :class="{ 'net-invalid': displayNet(row) === null }">
                净重 {{ displayNet(row) ?? '无法计算' }} 吨
              </span>
            </label>
            <p v-if="!dialogPendingRows.length" class="empty-state">待过磅队列里没有可核收的计量单</p>
          </div>

          <form class="batch-form" @submit.prevent="submitBatch">
            <label class="filter-item">
              <span>垃圾来源（本批统一）</span>
              <input v-model="batchSource" list="waste-source-options" placeholder="例如：静安区压缩中转站" />
              <datalist id="waste-source-options">
                <option v-for="source in sourceOptions" :key="source" :value="source"></option>
              </datalist>
            </label>
            <label class="filter-item">
              <span>过磅时间（本批统一）</span>
              <input v-model="batchTime" type="datetime-local" />
            </label>
            <p v-if="batchFormError" class="error-text">{{ batchFormError }}</p>
            <div class="modal-actions">
              <button class="btn ghost" type="button" @click="closeBatch">取消</button>
              <button class="btn primary" type="submit" :disabled="submitting">
                {{ submitting ? '提交中…' : `提交核收（${dialogCheckedIds.length} 条）` }}
              </button>
            </div>
          </form>
        </div>

        <div v-else class="modal-body">
          <p class="modal-tip">
            本批 {{ batchResult.accepted.length + batchResult.blocked.length }} 条：
            <strong class="result-ok">{{ batchResult.accepted.length }} 条已收下</strong>，
            <strong class="result-blocked">{{ batchResult.blocked.length }} 条被拦下</strong>。
            被拦的单子原样留在待过磅队列，已收下的不会被退回。
          </p>

          <h4 class="result-title result-ok">已收下（{{ batchResult.accepted.length }} 条）</h4>
          <table class="data-table result-table">
            <thead>
              <tr><th>计量单号</th><th>进场车牌</th><th>垃圾来源</th><th>过磅时间</th><th>净重（吨）</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in batchResult.accepted" :key="`ok-${item.id}`">
                <td>{{ item.ticketNo }}</td>
                <td>{{ item.plate }}</td>
                <td>{{ item.source }}</td>
                <td>{{ item.weighTime }}</td>
                <td>{{ item.net }}</td>
              </tr>
              <tr v-if="!batchResult.accepted.length">
                <td colspan="5" class="empty-state">本批没有通过的单子</td>
              </tr>
            </tbody>
          </table>

          <h4 class="result-title result-blocked">被拦下、仍留在待过磅（{{ batchResult.blocked.length }} 条）</h4>
          <table class="data-table result-table">
            <thead>
              <tr><th>计量单号</th><th>进场车牌</th><th>拦截原因</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in batchResult.blocked" :key="`block-${item.id}`">
                <td>{{ item.ticketNo }}</td>
                <td>{{ item.plate || '—' }}</td>
                <td class="reason-cell">{{ item.reason }}</td>
              </tr>
            </tbody>
          </table>

          <div class="modal-actions">
            <button class="btn" type="button" @click="closeBatch">完成</button>
            <button v-if="batchResult.blocked.length" class="btn primary" type="button" @click="continueWithBlocked">
              继续处理被拦的 {{ batchResult.blocked.length }} 条
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  batchAccept,
  netWeight,
  reviewTicket,
  WB_STATUS_PENDING,
  WB_STATUS_WEIGHED,
  WB_STATUS_REVIEWED,
  WB_STATUS_ABNORMAL,
} from '@/api/weighbridge-service'
import type { BatchAcceptResult, EntryRow } from '@/data/types'

const meta = moduleMeta('weighbridge')
const columns = ['计量单号', '进场车牌', '垃圾来源', '毛重', '皮重', '净重', '过磅时间', '计量状态']
const statuses = ['待过磅', '已过磅', '已复核', '数据异常']

const sourceOptions = ['静安区压缩中转站', '黄浦区压缩中转站', '徐汇区压缩中转站', '长宁区压缩中转站', '普陀区压缩中转站']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 表格勾选只允许挂在待过磅单上；v-model 绑定的数组里混进非待过磅 id 时会被这里滤掉。
const checkedIdList = ref<number[]>([])

const batchOpen = ref(false)
const submitting = ref(false)
const batchSource = ref('')
const batchTime = ref('')
const batchFormError = ref('')
const dialogCheckedIds = ref<number[]>([])
const batchResult = ref<BatchAcceptResult | null>(null)

function isPending(row: EntryRow): boolean {
  return String(row.status) === WB_STATUS_PENDING
}

function displayNet(row: EntryRow): number | null {
  return netWeight(row)
}

function hasRowAction(row: EntryRow): boolean {
  const status = String(row.status)
  return status === WB_STATUS_PENDING || status === WB_STATUS_WEIGHED
}

const pendingRows = computed(() => rows.value.filter(isPending))

const allPendingSelected = computed(
  () =>
    pendingRows.value.length > 0 &&
    pendingRows.value.every((row) => checkedIdList.value.includes(Number(row.id))),
)

// 弹窗里展示当前筛选结果中的待过磅单，勾选状态与表格共享，被拦单子不会消失。
const dialogPendingRows = computed(() => pendingRows.value)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const todayPrefix = new Date().toISOString().slice(0, 10)

const stats = computed(() => [
  { label: '待过磅车辆', value: rows.value.filter((row) => String(row.status) === WB_STATUS_PENDING).length },
  { label: '已复核计量单', value: rows.value.filter((row) => String(row.status) === WB_STATUS_REVIEWED).length },
  {
    label: `当日进厂净重（吨，${todayPrefix}）`,
    value: rows.value
      .filter((row) => String(row.过磅时间).startsWith(todayPrefix))
      .reduce((sum, row) => sum + (netWeight(row) ?? 0), 0)
      .toFixed(1),
  },
])

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  checkedIdList.value = checked ? pendingRows.value.map((row) => Number(row.id)) : []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function defaultNowLocal(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function openBatch(preselectId?: number) {
  errorMessage.value = ''
  batchResult.value = null
  batchFormError.value = ''
  batchSource.value = ''
  batchTime.value = defaultNowLocal()
  if (preselectId !== undefined && !checkedIdList.value.includes(preselectId)) {
    checkedIdList.value = [...checkedIdList.value, preselectId]
  }
  dialogCheckedIds.value = [...checkedIdList.value]
  batchOpen.value = true
}

function closeBatch() {
  batchOpen.value = false
  batchResult.value = null
  batchFormError.value = ''
  submitting.value = false
  reload()
}

// 看完逐条结果后继续处理被拦单：回到核收表单，默认只勾选被拦的，已经收下的不会退回。
function continueWithBlocked() {
  if (!batchResult.value) {
    return
  }
  dialogCheckedIds.value = batchResult.value.blocked.map((item) => item.id)
  checkedIdList.value = [...dialogCheckedIds.value]
  batchResult.value = null
  batchFormError.value = ''
}

function submitBatch() {
  batchFormError.value = ''
  if (!dialogCheckedIds.value.length) {
    batchFormError.value = '请至少勾选一条待过磅计量单'
    return
  }
  submitting.value = true
  try {
    batchResult.value = batchAccept({
      ids: dialogCheckedIds.value,
      source: batchSource.value,
      weighTime: batchTime.value,
    })
    checkedIdList.value = []
    dialogCheckedIds.value = []
  } catch (error) {
    batchFormError.value = error instanceof Error ? error.message : '批量核收提交失败'
  } finally {
    submitting.value = false
  }
}

function runReview(row: EntryRow) {
  errorMessage.value = ''
  const result = reviewTicket(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  errorMessage.value = result.message
}

function runMarkAbnormal(row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), '标记异常')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 已经离开待过磅的勾选（刚被本批收下的）要从勾选中清掉，被拦的因为状态没变会保留。
    const pendingIds = new Set(rows.value.filter(isPending).map((row) => Number(row.id)))
    checkedIdList.value = checkedIdList.value.filter((id) => pendingIds.has(id))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '垃圾进厂计量列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.col-check {
  width: 36px;
  text-align: center;
}
.check-muted {
  color: var(--muted);
}
.row-selected {
  background: #eef5ff;
}
.net-invalid {
  color: #b42318;
}
.link-danger {
  color: #b42318;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 16px;
  z-index: 50;
  overflow-y: auto;
}
.modal {
  background: #fff;
  border-radius: 10px;
  width: min(860px, 100%);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25);
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.modal-body {
  padding: 16px 18px;
}
.modal-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted);
}
.pick-list {
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 240px;
  overflow-y: auto;
  margin-bottom: 14px;
}
.pick-item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid #eef2f7;
}
.pick-item:last-child {
  border-bottom: none;
}
.pick-no {
  font-weight: 600;
  min-width: 150px;
}
.pick-plate {
  min-width: 110px;
}
.pick-weight {
  color: var(--muted);
  flex: 1;
}
.pick-net {
  min-width: 120px;
  text-align: right;
}
.batch-form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}
.batch-form .filter-item {
  flex: 1;
  min-width: 220px;
}
.batch-form input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
  margin-top: 4px;
}
.result-title {
  margin: 16px 0 6px;
  font-size: 14px;
}
.result-ok {
  color: #067647;
}
.result-blocked {
  color: #b42318;
}
.result-table .reason-cell {
  color: #b42318;
}
</style>
