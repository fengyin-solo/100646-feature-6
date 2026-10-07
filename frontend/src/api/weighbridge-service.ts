import { appendFeedEntry, listFeedQueue, nextFeedSeq, saveFeedQueue } from '@/data/feed-ledger'
import { listRows, saveRows } from '@/data/local-store'
import type {
  EntryRow,
  FeedQueueEntry,
  ReviewResult,
  WeighAcceptItem,
  WeighAcceptReason,
  WeighAcceptResult,
} from '@/data/types'

const KEY = 'weighbridge'
const PIT_KEY = 'pit'

const STATUS_PENDING = '待过磅'
const STATUS_WEIGHED = '已过磅'
const STATUS_REVIEWED = '已复核'

// 未结算 = 已过磅但还没复核；车牌挂在这种单子上，新车不能再次核收。
const UNSETTLED_STATUSES = new Set([STATUS_WEIGHED])

export function weighRows(): EntryRow[] {
  return listRows(KEY)
}

export function toWeightNumber(value: string | number | boolean | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }
  return null
}

// 净重 = 毛重 - 皮重；数据不完整或毛小于皮时算不出来，调用方据此拦下。
export function netWeight(row: EntryRow): number | null {
  const gross = toWeightNumber(row['毛重'])
  const tare = toWeightNumber(row['皮重'])
  if (gross === null || tare === null || gross < tare) {
    return null
  }
  return gross - tare
}

export function formatWeight(value: string | number | boolean | undefined): string {
  const num = toWeightNumber(value)
  return num === null ? '—' : `${num.toLocaleString('zh-CN')} kg`
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function isUnsettled(row: EntryRow): boolean {
  return UNSETTLED_STATUSES.has(String(row.status))
}

function findBlocker(rows: EntryRow[], plate: string, selfId: number): EntryRow | null {
  return (
    rows.find(
      (row) =>
        Number(row.id) !== selfId &&
        String(row['进场车牌'] ?? '').trim() === plate &&
        isUnsettled(row),
    ) ?? null
  )
}

/**
 * 批量核收：逐条独立处理，绝不整批回滚。
 * - accepted：待过磅 + 车牌无未结算占用 + 磅单数据有效 → 已过磅
 * - blocked：车牌还挂在另一张未结算单上，原样留在待过磅
 * - invalid：皮重缺失或毛重小于皮重，净重算不出来，原样留在待过磅
 * - duplicate：状态已不是待过磅（同一辆车重复提交只生效一次）
 */
export function batchAcceptWeigh(
  ids: number[],
  payload: { 垃圾来源: string; 过磅时间: string },
): WeighAcceptResult {
  const source = payload['垃圾来源'].trim()
  const weighTime = payload['过磅时间'].trim() ? payload['过磅时间'].replace('T', ' ') : nowText()

  const rows = listRows(KEY)
  const working = [...rows]
  const accepted: WeighAcceptItem[] = []
  const rejected: WeighAcceptItem[] = []

  const push = (
    bucket: WeighAcceptItem[],
    row: EntryRow,
    ok: boolean,
    reason: WeighAcceptReason,
    message: string,
    net?: number,
  ) => {
    bucket.push({
      id: Number(row.id),
      计量单号: String(row['计量单号'] ?? ''),
      进场车牌: String(row['进场车牌'] ?? ''),
      ok,
      reason,
      message,
      ...(net === undefined ? {} : { 净重: net }),
    })
  }

  for (const id of ids) {
    const index = working.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      rejected.push({
        id,
        计量单号: '—',
        进场车牌: '—',
        ok: false,
        reason: 'duplicate',
        message: `编号 ${id} 的计量单不存在，可能已被他人处理`,
      })
      continue
    }
    const row = working[index]

    if (String(row.status) !== STATUS_PENDING) {
      push(
        rejected,
        row,
        false,
        'duplicate',
        `该单当前为「${row.status}」，重复提交不生效`,
      )
      continue
    }

    const plate = String(row['进场车牌'] ?? '').trim()
    const blocker = findBlocker(working, plate, Number(row.id))
    if (blocker) {
      push(
        rejected,
        row,
        false,
        'blocked',
        `车牌 ${plate} 还挂在未结算计量单 ${String(blocker['计量单号'] ?? '')}（${blocker.status}）上，需先完成结算`,
      )
      continue
    }

    const net = netWeight(row)
    if (net === null) {
      const gross = toWeightNumber(row['毛重'])
      const tare = toWeightNumber(row['皮重'])
      const reasonText =
        gross === null || tare === null
          ? '毛重或皮重缺失，净重无法计算'
          : '毛重小于皮重，净重为负，磅单数据无效'
      push(rejected, row, false, 'invalid', `${reasonText}，请回磅房核对后重试`)
      continue
    }

    const updated: EntryRow = {
      ...row,
      status: STATUS_WEIGHED,
      pending: true,
      abnormal: false,
      垃圾来源: source,
      净重: net,
      过磅时间: weighTime,
    }
    working[index] = updated
    push(accepted, updated, true, 'accepted', `核收通过，净重 ${net.toLocaleString('zh-CN')} kg`, net)
  }

  if (accepted.length > 0) {
    saveRows(KEY, working)
  }

  return { accepted, rejected }
}

// 可复核的目标池区：只有「待投料」池区允许接收新批次。
export function reviewTargets(): EntryRow[] {
  return listRows(PIT_KEY).filter((row) => String(row.status) === '待投料')
}

/**
 * 单条复核：只允许 已过磅 → 已复核，不许跳级；复核后净重入垃圾池待投料队列并触发重排。
 * 已复核的单子再点复核属于重复提交，幂等拒绝。
 */
export function reviewWeigh(id: number, pitCode: string): ReviewResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的进厂计量单` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current === STATUS_REVIEWED) {
    return { ok: false, message: `计量单 ${String(row['计量单号'] ?? '')} 已复核，重复提交不生效` }
  }
  if (current !== STATUS_WEIGHED) {
    return {
      ok: false,
      message: `计量单当前为「${current}」，只允许从「${STATUS_WEIGHED}」复核，禁止跳级`,
    }
  }

  const code = pitCode.trim()
  const pitRows = listRows(PIT_KEY)
  const pit = pitRows.find((item) => String(item['池区编号'] ?? '') === code)
  if (!pit) {
    return { ok: false, message: `没有找到池区「${code}」，请重新选择投料去向` }
  }
  if (String(pit.status) !== '待投料') {
    return { ok: false, message: `池区「${code}」当前为「${pit.status}」，不能接收复核后的垃圾` }
  }

  const net = netWeight(row)
  if (net === null) {
    return { ok: false, message: '净重无法计算（毛重/皮重缺失或毛重小于皮重），不能复核' }
  }

  const reviewed: EntryRow = {
    ...row,
    status: STATUS_REVIEWED,
    pending: false,
    abnormal: false,
    净重: net,
  }
  const nextRows = [...rows]
  nextRows[index] = reviewed
  saveRows(KEY, nextRows)

  // 存量按吨累加（磅单净重单位 kg）；队列入队即完成重排：新批次排在队尾。
  const stock = toWeightNumber(pit['垃圾存量']) ?? 0
  const nextPit: EntryRow = { ...pit, 垃圾存量: Number((stock + net / 1000).toFixed(2)) }
  const nextPitRows = [...pitRows]
  nextPitRows[pitRows.indexOf(pit)] = nextPit
  saveRows(PIT_KEY, nextPitRows)

  const entry: FeedQueueEntry = {
    seq: nextFeedSeq(),
    计量单号: String(reviewed['计量单号'] ?? ''),
    进场车牌: String(reviewed['进场车牌'] ?? ''),
    垃圾来源: String(reviewed['垃圾来源'] ?? ''),
    净重: net,
    过磅时间: String(reviewed['过磅时间'] ?? ''),
    复核时间: nowText(),
    池区编号: code,
    settled: false,
  }
  appendFeedEntry(entry)

  return {
    ok: true,
    seq: entry.seq,
    message: `计量单 ${entry.计量单号} 已复核入池「${code}」，待投料队列已重排（序位 ${entry.seq}）`,
  }
}

/**
 * 池区确认投料：该池区在待投料队列里的未结算批次按 FIFO 全部出队。
 */
export function confirmPitFeed(pitCode: string): { fed: number } {
  const queue = listFeedQueue()
  let fed = 0
  const next = queue.map((entry) => {
    if (!entry.settled && entry.池区编号 === pitCode) {
      fed += 1
      return { ...entry, settled: true }
    }
    return entry
  })
  saveFeedQueue(next)
  return { fed }
}

// 未结算的待投料批次，按入队先后（FIFO）排列。
export function pendingFeedEntries(): FeedQueueEntry[] {
  return listFeedQueue()
    .filter((entry) => !entry.settled)
    .sort((a, b) => a.seq - b.seq)
}
