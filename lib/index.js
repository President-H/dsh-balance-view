// dsh-balance-view
// 目的：把 DeepSeek 账号余额（充值钱包 + 赠金）定时落到一个本地 JSON 文件里，
// 并提供一个只读的 HTTP 接口 /dsh-balance/balance.json?refresh=1。
// 这样脚本、别的插件、甚至聊天机器人不必登录 DSH，也能读到最新余额。

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const INTERVAL_MS = 120 * 1000
const CACHE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-balance-view', 'cache.json')

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 汇总钱包：CNY 优先；充值钱包与赠金加在一起，跟官方 total_balance 同口径
function summarize(result) {
  const wallets = []
  const push = (list, kind) => {
    if (!Array.isArray(list)) return
    for (const w of list) {
      if (!w) continue
      const bal = num(w.balance)
      if (bal === null) continue
      wallets.push({ kind, currency: String(w.currency || 'CNY').toUpperCase(), balance: bal })
    }
  }
  push(result.value, 'recharge')
  push(result.bonusWallets, 'bonus')
  if (!wallets.length) return null
  const cny = wallets.filter((w) => w.currency === 'CNY')
  const picked = cny.length ? cny : wallets
  const currency = picked[0].currency
  const same = picked.filter((w) => w.currency === currency)
  const total = same.reduce((sum, w) => sum + w.balance, 0)
  const recharge = same.filter((w) => w.kind === 'recharge').reduce((sum, w) => sum + w.balance, 0)
  const bonus = same.filter((w) => w.kind === 'bonus').reduce((sum, w) => sum + w.balance, 0)
  return {
    total: Number(total.toFixed(6)),
    recharge: Number(recharge.toFixed(6)),
    bonus: Number(bonus.toFixed(6)),
    currency,
    wallets,
  }
}

export default {
  name: 'dsh-balance-view',
  apply(root) {
    let timer = null
    let last = null
    let lastAt = 0

    function readCache() {
      try {
        return JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
      } catch {
        return null
      }
    }

    function writeCache(payload) {
      try {
        mkdirSync(dirname(CACHE_FILE), { recursive: true })
        writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8')
      } catch (err) {
        try { console.warn('[dsh-balance-view] 写缓存失败：' + String(err && err.message || err)) } catch {}
      }
    }

    root.inject(['webServer'], (ctx) => {
      async function fetchBalance(force) {
        if (!force && last && Date.now() - lastAt < 30 * 1000) return last
        let account = null
        try { account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null } catch { account = null }
        if (!account || typeof account.getBalance !== 'function') {
          const payload = { ok: false, code: 'NO_ACCOUNT_SERVICE', error: '当前 DSH 没有账号服务（deepseekAccount）', checkedAt: new Date().toISOString() }
          last = payload; lastAt = Date.now(); writeCache(payload)
          return payload
        }
        try {
          const result = await account.getBalance({
            version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
            locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          })
          if (!result) {
            const payload = { ok: false, code: 'NOT_LOGGED_IN', error: '未登录 DeepSeek 账号', checkedAt: new Date().toISOString() }
            last = payload; lastAt = Date.now(); writeCache(payload)
            return payload
          }
          if (result.status !== 'ready') {
            const payload = { ok: false, code: String(result.status || 'NOT_READY'), error: '账号余额接口未就绪', checkedAt: new Date().toISOString() }
            last = payload; lastAt = Date.now(); writeCache(payload)
            return payload
          }
          const sum = summarize(result)
          if (!sum) {
            const payload = { ok: false, code: 'NO_WALLET', error: '账号没有余额钱包', checkedAt: new Date().toISOString() }
            last = payload; lastAt = Date.now(); writeCache(payload)
            return payload
          }
          const payload = { ok: true, ...sum, checkedAt: new Date().toISOString() }
          last = payload; lastAt = Date.now(); writeCache(payload)
          return payload
        } catch (err) {
          const payload = { ok: false, code: 'ERROR', error: String((err && err.message) || err).slice(0, 200), checkedAt: new Date().toISOString() }
          last = payload; lastAt = Date.now(); writeCache(payload)
          return payload
        }
      }

      // 启动就先取一次，之后定时刷新
      fetchBalance(true)
      timer = setInterval(() => { fetchBalance(true) }, INTERVAL_MS)
      if (timer && typeof timer.unref === 'function') timer.unref()

      try {
        ctx.effect(() => () => { if (timer) clearInterval(timer) })
      } catch {}

      try {
        ctx.webServer.register({
          kind: 'exact',
          path: '/dsh-balance/balance.json',
          handler: async (req, res) => {
            let refresh = false
            try {
              const url = new URL(req.url || '/', 'http://localhost')
              refresh = url.searchParams.get('refresh') === '1'
            } catch {}
            const payload = await fetchBalance(refresh)
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
            res.end(JSON.stringify(payload))
          },
        })
      } catch (err) {
        try { console.warn('[dsh-balance-view] 注册路由失败：' + String(err && err.message || err)) } catch {}
      }

      // 首次读缓存兜底：文件里本来就有上一次的数
      if (!last) last = readCache()
    })
  },
}
