/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 批量核收逐条结论：accepted 已收下 / blocked 车牌被未结算单占用 / invalid 磅单数据无效 / duplicate 重复提交
export type WeighAcceptReason = 'accepted' | 'blocked' | 'invalid' | 'duplicate'

export type WeighAcceptItem = {
  id: number
  计量单号: string
  进场车牌: string
  ok: boolean
  reason: WeighAcceptReason
  message: string
  净重?: number
}

export type WeighAcceptResult = {
  accepted: WeighAcceptItem[]
  rejected: WeighAcceptItem[]
}

// 垃圾池待投料队列：进厂计量单复核后入队，池区确认投料后出队
export type FeedQueueEntry = {
  seq: number
  计量单号: string
  进场车牌: string
  垃圾来源: string
  净重: number
  过磅时间: string
  复核时间: string
  池区编号: string
  settled: boolean
}

export type ReviewResult = ActionResult & {
  seq?: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
