import { SEED_FEED_QUEUE } from './seed'
import type { FeedQueueEntry } from './types'

// 待投料队列单独持久化：复核即入队、确认投料即出队，与模块清单重置互不影响。
const QUEUE_KEY = 'waste-to-energy-plant:feed-queue:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readQueue(): FeedQueueEntry[] {
  const fallback = clone(SEED_FEED_QUEUE)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(QUEUE_KEY)
  if (!raw) {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as FeedQueueEntry[]
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: FeedQueueEntry[] | null = null

export function listFeedQueue(): FeedQueueEntry[] {
  if (cache === null) {
    cache = readQueue()
  }
  return cache
}

export function saveFeedQueue(entries: FeedQueueEntry[]): void {
  cache = entries
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries))
  }
}

export function appendFeedEntry(entry: FeedQueueEntry): void {
  saveFeedQueue([...listFeedQueue(), entry])
}

export function nextFeedSeq(): number {
  return listFeedQueue().reduce((max, item) => Math.max(max, item.seq), 0) + 1
}
