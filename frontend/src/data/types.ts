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

// 批量核收逐条结果：被拦的单子要带着拦截原因留在待过磅，不能被整批吞掉。
export type BatchAcceptOutcome = 'accepted' | 'blocked'

export type BatchAcceptItem = {
  id: number
  outcome: BatchAcceptOutcome
  ticketNo: string
  plate: string
  source: string
  weighTime: string
  gross: number
  tare: number
  net: number
  reason: string
}

export type BatchAcceptResult = {
  accepted: BatchAcceptItem[]
  blocked: BatchAcceptItem[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
