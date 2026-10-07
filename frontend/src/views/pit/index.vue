<template>
  <section class="page" data-module="pit">
    <header class="page-head">
      <div>
        <h2>垃圾池管理</h2>
        <p class="page-desc">进厂计量单复核后自动排入下方待投料清单并按入队先后重排（先进先出）；池区确认投料时对应批次出队。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出垃圾池管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="stat in stats" :key="stat.label" class="stat-card">
        <span class="stat-label">{{ stat.label }}</span>
        <strong class="stat-value">{{ stat.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 复核驱动的待投料清单 -->
    <section class="queue-panel">
      <header class="queue-head">
        <h3>待投料清单（复核动作自动入队 · 先进先出重排）</h3>
        <span class="queue-tip">共 {{ pendingEntries.length }} 个批次待投料，{{ pendingTons.toFixed(2) }} 吨</span>
      </header>
      <table class="data-table queue-table">
        <thead>
          <tr>
            <th>FIFO 序位</th>
            <th>计量单号</th>
            <th>进场车牌</th>
            <th>垃圾来源</th>
            <th>净重(吨)</th>
            <th>过磅时间</th>
            <th>复核时间</th>
            <th>去向池区</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, index) in pendingEntries" :key="entry.seq">
            <td><span class="seq-badge" :data-rank="index">{{ index + 1 }}</span></td>
            <td>{{ entry.计量单号 }}</td>
            <td>{{ entry.进场车牌 }}</td>
            <td>{{ entry.垃圾来源 }}</td>
            <td>{{ (entry.净重 / 1000).toFixed(2) }}</td>
            <td>{{ entry.过磅时间 }}</td>
            <td>{{ entry.复核时间 }}</td>
            <td>{{ entry.池区编号 }}</td>
          </tr>
          <tr v-if="!pendingEntries.length">
            <td colspan="8" class="empty-state">暂无待投料批次，去地磅页复核已过磅计量单后会自动排入</td>
          </tr>
        </tbody>
      </table>

      <div class="pit-order">
        <h4>待投料池区投料顺序（按各池区最早在队批次重排）</h4>
        <div class="pit-cards">
          <article v-for="(card, index) in pitOrderCards" :key="card.code" class="pit-card" :class="{ 'is-empty-pit': card.nextSeq === null }">
            <span class="pit-rank">序位 {{ index + 1 }}</span>
            <strong class="pit-code">{{ card.code }}</strong>
            <span class="pit-meta">在队 {{ card.count }} 批 · {{ card.tons.toFixed(2) }} 吨</span>
            <span class="pit-meta">存量 {{ card.stock }} 吨 · 发酵 {{ card.days }} 天</span>
            <span v-if="card.nextSeq !== null" class="pit-next">下一批次序位 #{{ card.nextSeq }}</span>
            <span v-else class="pit-next muted">暂无在队批次</span>
          </article>
        </div>
      </div>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="message" class="banner ok">{{ message }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td><span class="status-tag" :data-status="row.status">{{ row.status }}</span></td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无垃圾池管理数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条垃圾池管理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, runAction as applyAction } from '@/api/local-service'
import { confirmPitFeed, pendingFeedEntries } from '@/api/weighbridge-service'
import type { EntryRow, FeedQueueEntry } from '@/data/types'

const columns = ['池区编号', '垃圾存量(吨)', '发酵天数', '渗滤液液位', '抓斗操作人', '倒料日期', '池区温度']
const filterFields = ['池区编号', '抓斗操作人']
const statuses = ['待投料', '发酵中', '已投料', '需倒料']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const message = ref('')
const filters = ref<Record<string, string>>({})
const pendingEntries = ref<FeedQueueEntry[]>([])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed<{ label: string; value: number }[]>(() => [
  { label: '发酵中池区', value: rows.value.filter((row) => String(row.status) === '发酵中').length },
  { label: '已投料池区', value: rows.value.filter((row) => String(row.status) === '已投料').length },
  { label: '需倒料池区', value: rows.value.filter((row) => String(row.status) === '需倒料').length },
])

const pendingTons = computed(() =>
  pendingEntries.value.reduce((sum, entry) => sum + entry.净重 / 1000, 0),
)

// 池区重排：有待投料批次的池区，按各自最早在队批次的序位升序（先进先出）；无批次的排最后。
const pitOrderCards = computed(() => {
  const pendingPits = rows.value.filter((row) => String(row.status) === '待投料')
  const cards = pendingPits.map((pit) => {
    const code = String(pit['池区编号'] ?? '')
    const inQueue = pendingEntries.value.filter((entry) => entry.池区编号 === code)
    return {
      code,
      count: inQueue.length,
      tons: inQueue.reduce((sum, entry) => sum + entry.净重 / 1000, 0),
      nextSeq: inQueue.length ? Math.min(...inQueue.map((entry) => entry.seq)) : null,
      stock: pit['垃圾存量'] ?? 0,
      days: pit['发酵天数'] ?? 0,
    }
  })
  return cards.sort((a, b) => {
    if (a.nextSeq === null && b.nextSeq === null) return a.code.localeCompare(b.code)
    if (a.nextSeq === null) return 1
    if (b.nextSeq === null) return -1
    return a.nextSeq - b.nextSeq
  })
})

function availableActions(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待投料') return ['开始发酵']
  if (status === '发酵中') return ['确认投料', '安排倒料']
  if (status === '需倒料') return ['开始发酵']
  return []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('pit')
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  message.value = ''
  const result = applyAction('pit', Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  // 确认投料：池区转已投料，同时该池区在待投料队列里的批次 FIFO 出队，清单再次重排。
  if (action === '确认投料') {
    const { fed } = confirmPitFeed(String(row['池区编号'] ?? ''))
    message.value = `${result.message}；池区 ${String(row['池区编号'] ?? '')} 的 ${fed} 个待投料批次已按先进先出出队，清单已重排`
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries('pit', filters.value)
    rows.value = payload.items
    total.value = payload.total
    pendingEntries.value = pendingFeedEntries()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '垃圾池管理列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.queue-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.queue-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.queue-head h3 { margin: 0; font-size: 15px; }
.queue-tip { color: var(--muted); font-size: 12px; }
.queue-table { margin-bottom: 12px; }
.seq-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  border-radius: 999px;
  background: #e0edff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 600;
}
.seq-badge[data-rank='0'] { background: #15803d; color: #fff; }
.pit-order h4 { margin: 4px 0 8px; font-size: 13px; color: var(--muted); }
.pit-cards { display: flex; gap: 10px; flex-wrap: wrap; }
.pit-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  min-width: 168px;
  background: #fbfdff;
}
.pit-card.is-empty-pit { opacity: .65; }
.pit-rank { font-size: 12px; color: var(--brand); font-weight: 600; }
.pit-code { font-size: 16px; }
.pit-meta { font-size: 12px; color: var(--muted); }
.pit-next { font-size: 12px; color: #15803d; }
.pit-next.muted { color: #94a3b8; }
.status-tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  background: #eef2f7;
}
.status-tag[data-status='待投料'] { background: #fef3c7; color: #b45309; }
.status-tag[data-status='发酵中'] { background: #e0edff; color: #1d4ed8; }
.status-tag[data-status='已投料'] { background: #dcfce7; color: #15803d; }
.status-tag[data-status='需倒料'] { background: #fee4e2; color: #b42318; }
.banner.ok { background: #dcfce7; color: #15803d; border: 1px solid #86efac; border-radius: 6px; padding: 8px 12px; font-size: 13px; margin: 0 0 10px; }
</style>
