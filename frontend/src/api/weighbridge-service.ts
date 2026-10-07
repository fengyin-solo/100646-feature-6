import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  BatchAcceptItem,
  BatchAcceptResult,
  EntryRow,
} from '@/data/types'

// 进厂计量单的状态只能顺着这条链往前走，任何动作都不许跳级。
export const WB_STATUS_PENDING = '待过磅'
export const WB_STATUS_WEIGHED = '已过磅'
export const WB_STATUS_REVIEWED = '已复核'
export const WB_STATUS_ABNORMAL = '数据异常'

// 「未结算」= 已经过磅、但还没复核结算的单子；车牌挂在这种单子上就不能再为同车过磅。
const PIT_STATUS_WAITING = '待投料'

const WEIGHBRIDGE_KEY = 'weighbridge'
const PIT_KEY = 'pit'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// 净重只由毛重减皮重推出，页面只读展示，不接受手填。
export function netWeight(row: EntryRow): number | null {
  const gross = Number(row.毛重)
  const tare = Number(row.皮重)
  if (!Number.isFinite(gross) || !Number.isFinite(tare) || gross < 0 || tare < 0 || gross < tare) {
    return null
  }
  return round2(gross - tare)
}

function ticketLabel(row: EntryRow): string {
  return `${String(row.计量单号)}（车牌 ${String(row.进场车牌)}）`
}

export type BatchAcceptInput = {
  ids: number[]
  source: string
  weighTime: string
}

// 批量核收：一次给多条待过磅单统一设定垃圾来源与过磅时间。
// 逐条判定、逐条落库——收下的立即生效，被拦的原样留在待过磅，绝不整批退回。
export function batchAccept(input: BatchAcceptInput): BatchAcceptResult {
  const ids = [...new Set(input.ids)]
  if (ids.length === 0) {
    throw new Error('请至少勾选一条待过磅计量单')
  }
  const source = input.source.trim()
  if (!source) {
    throw new Error('请先统一设定本批的垃圾来源')
  }
  const weighTime = input.weighTime
  if (!weighTime) {
    throw new Error('请先统一设定本批的过磅时间')
  }
  const displayTime = weighTime.replace('T', ' ')

  const rows = listRows(WEIGHBRIDGE_KEY)

  // 先盘点库里已经占用车牌的未结算单子（本批之外的已过磅单）。
  const holders = new Map<string, EntryRow>()
  for (const row of rows) {
    if (String(row.status) === WB_STATUS_WEIGHED) {
      holders.set(String(row.进场车牌), row)
    }
  }

  const accepted: BatchAcceptItem[] = []
  const blocked: BatchAcceptItem[] = []
  // 同一辆车在本次批量里只能有一张单生效，先到先得，其余的按重复提交拦下。
  const claimedInBatch = new Set<string>()

  const next = [...rows]
  for (const id of ids) {
    const index = next.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      blocked.push({
        id,
        outcome: 'blocked',
        ticketNo: `#${id}`,
        plate: '',
        source,
        weighTime: displayTime,
        gross: 0,
        tare: 0,
        net: 0,
        reason: '计量单不存在，可能已被其他人处理',
      })
      continue
    }
    const row = next[index]
    const plate = String(row.进场车牌 ?? '').trim()
    const base = {
      id: Number(row.id),
      ticketNo: String(row.计量单号 ?? ''),
      plate,
      source,
      weighTime: displayTime,
      gross: Number(row.毛重),
      tare: Number(row.皮重),
    }

    if (String(row.status) !== WB_STATUS_PENDING) {
      blocked.push({
        ...base,
        outcome: 'blocked',
        net: 0,
        reason: `该单当前状态为「${String(row.status)}」，已不在待过磅队列，本次不重复处理`,
      })
      continue
    }
    if (!plate) {
      blocked.push({
        ...base,
        outcome: 'blocked',
        net: 0,
        reason: '进场车牌缺失，无法核收过磅',
      })
      continue
    }
    const net = netWeight(row)
    if (net === null) {
      blocked.push({
        ...base,
        outcome: 'blocked',
        net: 0,
        reason: `毛重/皮重数据异常（毛重 ${base.gross}，皮重 ${base.tare}），净重无法计算`,
      })
      continue
    }
    if (claimedInBatch.has(plate)) {
      blocked.push({
        ...base,
        outcome: 'blocked',
        net,
        reason: '同一辆车在本次批量中重复提交，只有第一张单生效，本张留在待过磅',
      })
      continue
    }
    const holder = holders.get(plate)
    if (holder) {
      blocked.push({
        ...base,
        outcome: 'blocked',
        net,
        reason: `进场车牌 ${plate} 还挂在另一张未结算（已过磅未复核）的单子 ${String(holder.计量单号)} 上，需先结算后才能再次过磅`,
      })
      continue
    }

    const updated: EntryRow = {
      ...row,
      status: WB_STATUS_WEIGHED,
      pending: true,
      abnormal: false,
      垃圾来源: source,
      过磅时间: displayTime,
      净重: net,
      计量状态: WB_STATUS_WEIGHED,
    }
    next[index] = updated
    claimedInBatch.add(plate)
    holders.set(plate, updated)
    accepted.push({ ...base, outcome: 'accepted', net, reason: '' })
  }

  saveRows(WEIGHBRIDGE_KEY, next)
  return { accepted, blocked }
}

// 复核：只接受「已过磅 → 已复核」这一步，待过磅直接复核算跳级，重复复核不重复生效。
// 复核通过的单子按净重进入垃圾池待投料清单，并驱动待投料清单按到厂先后重排。
export function reviewTicket(id: number): ActionResult {
  const rows = listRows(WEIGHBRIDGE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的进厂计量单` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current === WB_STATUS_REVIEWED) {
    return { ok: false, message: `${ticketLabel(row)}已经复核过，复核只生效一次，垃圾池清单未重复加入` }
  }
  if (current !== WB_STATUS_WEIGHED) {
    return {
      ok: false,
      message: `${ticketLabel(row)}当前是「${current}」，状态只能按 待过磅 → 已过磅 → 已复核 逐级流转，不允许跳级复核`,
    }
  }

  const net = netWeight(row)
  if (net === null) {
    return {
      ok: false,
      message: `${ticketLabel(row)}毛重/皮重数据异常（毛重 ${String(row.毛重)}，皮重 ${String(row.皮重)}），无法结算复核`,
    }
  }

  const nextWb = [...rows]
  nextWb[index] = {
    ...row,
    status: WB_STATUS_REVIEWED,
    pending: false,
    abnormal: false,
    净重: net,
    计量状态: WB_STATUS_REVIEWED,
  }
  saveRows(WEIGHBRIDGE_KEY, nextWb)

  const position = enqueuePitWaiting(row, net)
  return {
    ok: true,
    message: `${ticketLabel(row)}已复核，净重 ${net} 吨已进入垃圾池待投料清单，按过磅时间重排后当前排第 ${position} 位投料`,
  }
}

// 把一张复核完的计量单挂进垃圾池待投料清单，然后重排；同一张计量单重复复核不会重复入池。
function enqueuePitWaiting(wbRow: EntryRow, net: number): number {
  const pitRows = listRows(PIT_KEY)
  const wbId = Number(wbRow.id)
  const ticketNo = String(wbRow.计量单号)
  const weighTime = String(wbRow.过磅时间)

  const exists = pitRows.some(
    (pit) =>
      String(pit.状态 ?? '') === PIT_STATUS_WAITING && Number(pit.来源计量单Id) === wbId,
  )
  if (!exists) {
    const nextId = pitRows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
    pitRows.push({
      id: nextId,
      status: PIT_STATUS_WAITING,
      pending: true,
      abnormal: false,
      池区编号: `WAIT-${String(wbId).padStart(4, '0')}`,
      垃圾存量: net,
      发酵天数: 0,
      渗滤液液位: 0,
      抓斗操作人: '',
      倒料日期: weighTime,
      池区温度: '',
      池区状态: PIT_STATUS_WAITING,
      来源计量单: ticketNo,
      来源计量单Id: wbId,
      进场车牌: String(wbRow.进场车牌),
      垃圾来源: String(wbRow.垃圾来源),
    })
  }

  // 重排：待投料区按过磅（到厂）时间先后排队投料，时间相同按计量单顺序；
  // 其余状态的池区相对顺序不变，整体放在待投料队列之后。
  const waiting = pitRows.filter((row) => String(row.status) === PIT_STATUS_WAITING)
  const others = pitRows.filter((row) => String(row.status) !== PIT_STATUS_WAITING)
  waiting.sort((a, b) => {
    const ta = String(a.倒料日期 ?? '')
    const tb = String(b.倒料日期 ?? '')
    if (ta !== tb) {
      return ta < tb ? -1 : 1
    }
    return Number(a.来源计量单Id ?? Infinity) - Number(b.来源计量单Id ?? Infinity)
  })
  saveRows(PIT_KEY, [...waiting, ...others])

  return waiting.findIndex((row) => Number(row.来源计量单Id) === wbId) + 1
}
